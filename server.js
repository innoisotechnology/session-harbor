const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3434;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_EXT = '.jsonl';
const NAMES_FILE = path.join(__dirname, 'data', 'session-names.json');

let cachedSessions = [];
let lastScanAt = 0;
let cachedClaudeSessions = [];
let lastClaudeScanAt = 0;
const CACHE_TTL_MS = 10_000;

async function listSessionFiles(dir) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSessionFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readFirstLine(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    let done = false;

    const finish = (line) => {
      if (done) return;
      done = true;
      resolve(line);
    };

    stream.on('data', (chunk) => {
      buffer += chunk;
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        stream.destroy();
        finish(buffer.slice(0, newlineIdx));
      } else if (buffer.length > 2_000_000) {
        stream.destroy();
        finish(buffer);
      }
    });

    stream.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });

    stream.on('close', () => {
      if (!done) finish(buffer);
    });
  });
}

async function readUpToLines(filePath, maxLines, maxBytes) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    let lines = 0;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      resolve(buffer);
    };

    stream.on('data', (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        lines += 1;
        if (lines >= maxLines) {
          stream.destroy();
          finish();
          return;
        }
        idx = buffer.indexOf('\n', idx + 1);
      }

      if (buffer.length >= maxBytes) {
        stream.destroy();
        finish();
      }
    });

    stream.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });

    stream.on('close', () => {
      if (!done) finish();
    });
  });
}

function toRelativeSessionPath(filePath) {
  return path.relative(SESSIONS_DIR, filePath);
}

function toRelativeClaudePath(filePath) {
  return path.relative(CLAUDE_DIR, filePath);
}

async function loadSessionNames() {
  try {
    const raw = await fs.promises.readFile(NAMES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function saveSessionNames(names) {
  await fs.promises.mkdir(path.dirname(NAMES_FILE), { recursive: true });
  await fs.promises.writeFile(NAMES_FILE, JSON.stringify(names, null, 2));
}

function buildNameKey(source, relPath) {
  return `${source}:${relPath}`;
}

function normalizeMessageContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  const parts = [];
  for (const item of content) {
    if (!item) continue;
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (typeof item.text === 'string') {
      parts.push(item.text);
      continue;
    }
    parts.push(JSON.stringify(item));
  }
  return parts.join('\n');
}

function parseSessionMessages(rawContent) {
  const messages = [];
  if (!rawContent) return messages;

  const lines = rawContent.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      continue;
    }

    if (!parsed || parsed.type !== 'response_item') continue;
    const payload = parsed.payload;
    if (!payload || payload.type !== 'message') continue;

    const role = payload.role || 'unknown';
    const text = normalizeMessageContent(payload.content).trim();
    if (!text) continue;

    messages.push({
      role,
      timestamp: parsed.timestamp || null,
      text,
    });
  }

  return messages;
}

function parseClaudeMessages(rawContent) {
  const messages = [];
  if (!rawContent) return messages;

  const lines = rawContent.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      continue;
    }

    if (!parsed || !parsed.type) continue;

    if (parsed.type === 'summary' && parsed.summary) {
      messages.push({
        role: 'summary',
        timestamp: parsed.timestamp || null,
        text: String(parsed.summary),
      });
      continue;
    }

    if (parsed.type !== 'user' && parsed.type !== 'assistant') continue;
    const message = parsed.message || {};
    const role = message.role || parsed.type || 'unknown';
    const text = normalizeMessageContent(message.content).trim();
    if (!text) continue;

    messages.push({
      role,
      timestamp: parsed.timestamp || null,
      text,
    });
  }

  return messages;
}

function extractClaudeMeta(rawContent, fallbackId) {
  const meta = { sessionId: fallbackId || null, cwd: null, gitBranch: null };
  if (!rawContent) return meta;

  const lines = rawContent.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      continue;
    }

    if (parsed && parsed.sessionId && !meta.sessionId) {
      meta.sessionId = parsed.sessionId;
    }
    if (parsed && parsed.cwd && !meta.cwd) {
      meta.cwd = parsed.cwd;
    }
    if (parsed && parsed.gitBranch && !meta.gitBranch) {
      meta.gitBranch = parsed.gitBranch;
    }

    if (meta.sessionId && meta.cwd && meta.gitBranch) {
      break;
    }
  }

  return meta;
}

async function getClaudeProjectInfo(filePath, fallbackProject) {
  try {
    const snippet = await readUpToLines(filePath, 120, 200_000);
    const meta = extractClaudeMeta(snippet, path.basename(filePath, SESSION_EXT));
    return meta.cwd || fallbackProject;
  } catch (err) {
    return fallbackProject;
  }
}

async function loadSessions() {
  const files = await listSessionFiles(SESSIONS_DIR);
  const sessions = [];
  const names = await loadSessionNames();

  for (const filePath of files) {
    let firstLine = '';
    try {
      firstLine = await readFirstLine(filePath);
    } catch (err) {
      continue;
    }

    if (!firstLine) continue;

    let parsed;
    try {
      parsed = JSON.parse(firstLine);
    } catch (err) {
      continue;
    }

    if (!parsed || parsed.type !== 'session_meta' || !parsed.payload) continue;

    sessions.push({
      id: parsed.payload.id || null,
      timestamp: parsed.payload.timestamp || parsed.timestamp || null,
      cwd: parsed.payload.cwd || null,
      relPath: toRelativeSessionPath(filePath),
      fileName: path.basename(filePath),
      name: names[buildNameKey('codex', toRelativeSessionPath(filePath))] || '',
    });
  }

  sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  cachedSessions = sessions;
  lastScanAt = Date.now();
  return sessions;
}

async function loadClaudeSessions() {
  const files = await listSessionFiles(CLAUDE_DIR);
  const sessions = [];
  const names = await loadSessionNames();

  for (const filePath of files) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      continue;
    }

    const relPath = toRelativeClaudePath(filePath);
    const fallbackProject = relPath.split(path.sep)[0] || 'Unknown';
    const project = await getClaudeProjectInfo(filePath, fallbackProject);
    const fileName = path.basename(filePath);
    const id = path.basename(filePath, SESSION_EXT);

    sessions.push({
      id,
      timestamp: stat.mtime ? new Date(stat.mtime).toISOString() : null,
      project,
      relPath,
      fileName,
      name: names[buildNameKey('claude', relPath)] || '',
    });
  }

  sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  cachedClaudeSessions = sessions;
  lastClaudeScanAt = Date.now();
  return sessions;
}

async function getSessions() {
  if (!cachedSessions.length || Date.now() - lastScanAt > CACHE_TTL_MS) {
    return loadSessions();
  }
  return cachedSessions;
}

async function getClaudeSessions() {
  if (!cachedClaudeSessions.length || Date.now() - lastClaudeScanAt > CACHE_TTL_MS) {
    return loadClaudeSessions();
  }
  return cachedClaudeSessions;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
    });
    res.end(data);
  });
}

function isSafeSessionPath(relPath) {
  if (!relPath) return false;
  const resolved = path.resolve(SESSIONS_DIR, relPath);
  const base = path.resolve(SESSIONS_DIR) + path.sep;
  return resolved.startsWith(base);
}

function isSafeClaudePath(relPath) {
  if (!relPath) return false;
  const resolved = path.resolve(CLAUDE_DIR, relPath);
  const base = path.resolve(CLAUDE_DIR) + path.sep;
  return resolved.startsWith(base);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function openTerminalWithCommand(command) {
  return new Promise((resolve, reject) => {
    const script = [
      'tell application "Terminal"',
      'activate',
      `do script ${JSON.stringify(command)}`,
      'end tell'
    ].join('\n');

    const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`osascript exited with code ${code}`));
      }
    });
  });
}

function focusTerminalTabByTitle(titleNeedle) {
  return new Promise((resolve, reject) => {
    const script = [
      'set needle to ' + JSON.stringify(titleNeedle),
      'tell application "Terminal"',
      'activate',
      'set foundTab to false',
      'repeat with w in windows',
      'repeat with t in tabs of w',
      'set tabName to name of t',
      'set tabTitle to ""',
      'try',
      'set tabTitle to custom title of t',
      'end try',
      'if tabName contains needle or tabTitle contains needle then',
      'set selected tab of w to t',
      'set frontmost to true',
      'set foundTab to true',
      'exit repeat',
      'end if',
      'end repeat',
      'if foundTab then exit repeat',
      'end repeat',
      'end tell',
      'return foundTab'
    ].join('\n');

    const child = spawn('/usr/bin/osascript', ['-e', script], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`osascript exited with code ${code}`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/api/sessions') {
    const search = (parsedUrl.query.search || '').toString().toLowerCase();
    const sessions = await getSessions();
    const filtered = search
      ? sessions.filter((session) => {
          const haystack = [session.fileName, session.cwd, session.id, session.relPath]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : sessions;
    sendJson(res, 200, { sessions: filtered });
    return;
  }

  if (pathname === '/api/claude/sessions') {
    const search = (parsedUrl.query.search || '').toString().toLowerCase();
    const sessions = await getClaudeSessions();
    const filtered = search
      ? sessions.filter((session) => {
          const haystack = [session.fileName, session.project, session.id, session.relPath]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : sessions;
    sendJson(res, 200, { sessions: filtered });
    return;
  }

  if (pathname === '/api/projects') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const sessions = source === 'claude' ? await getClaudeSessions() : await getSessions();
    const counts = new Map();
    sessions.forEach((session) => {
      const key = session.project || session.cwd || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const projects = Array.from(counts.entries())
      .map(([pathKey, count]) => ({ path: pathKey, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.path.localeCompare(b.path);
      });
    sendJson(res, 200, { projects });
    return;
  }

  if (pathname === '/api/session') {
    const relPath = (parsedUrl.query.file || '').toString();
    if (!isSafeSessionPath(relPath)) {
      sendJson(res, 400, { error: 'Invalid file path.' });
      return;
    }

    const fullPath = path.resolve(SESSIONS_DIR, relPath);
    try {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const messages = parseSessionMessages(content);
      sendJson(res, 200, { relPath, content, messages, messageCount: messages.length });
    } catch (err) {
      sendJson(res, 404, { error: 'File not found.' });
    }
    return;
  }

  if (pathname === '/api/claude/session') {
    const relPath = (parsedUrl.query.file || '').toString();
    if (!isSafeClaudePath(relPath)) {
      sendJson(res, 400, { error: 'Invalid file path.' });
      return;
    }

    const fullPath = path.resolve(CLAUDE_DIR, relPath);
    const fallbackId = path.basename(relPath, SESSION_EXT);
    try {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const messages = parseClaudeMessages(content);
      const meta = extractClaudeMeta(content, fallbackId);
      sendJson(res, 200, {
        relPath,
        content,
        messages,
        messageCount: messages.length,
        meta,
      });
    } catch (err) {
      sendJson(res, 404, { error: 'File not found.' });
    }
    return;
  }

  if (pathname === '/api/resume') {
    const sessionId = (parsedUrl.query.sessionId || '').toString().trim();
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required.' });
      return;
    }

    try {
      const title = `codex:${sessionId}`;
      const command = `printf '\\033]0;${title}\\007'; codex resume ${sessionId}`;
      await openTerminalWithCommand(command);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: 'Failed to open Terminal.' });
    }
    return;
  }

  if (pathname === '/api/names') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    const names = await loadSessionNames();
    sendJson(res, 200, { names });
    return;
  }

  if (pathname === '/api/name') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }

    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { error: 'Invalid JSON.' });
      return;
    }

    const source = (payload.source || '').toString();
    const relPath = (payload.relPath || '').toString();
    const name = (payload.name || '').toString().trim();

    if (!source || !relPath) {
      sendJson(res, 400, { error: 'source and relPath are required.' });
      return;
    }

    const names = await loadSessionNames();
    const key = buildNameKey(source, relPath);
    if (name) {
      names[key] = name;
    } else {
      delete names[key];
    }
    await saveSessionNames(names);

    if (source === 'codex') {
      cachedSessions = [];
      lastScanAt = 0;
    } else if (source === 'claude') {
      cachedClaudeSessions = [];
      lastClaudeScanAt = 0;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/new-session') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const cwd = (parsedUrl.query.cwd || '').toString().trim();
    if (!cwd) {
      sendJson(res, 400, { error: 'cwd is required.' });
      return;
    }

    try {
      const stat = await fs.promises.stat(cwd);
      if (!stat.isDirectory()) {
        sendJson(res, 400, { error: 'cwd must be a directory.' });
        return;
      }
    } catch (err) {
      sendJson(res, 400, { error: 'cwd not found.' });
      return;
    }

    const commandName = source === 'claude' ? 'claude' : 'codex';
    const title = `${commandName}:new:${path.basename(cwd)}`;
    const command = `printf '\\033]0;${title}\\007'; cd ${shellEscape(cwd)} && ${commandName}`;
    try {
      await openTerminalWithCommand(command);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: 'Failed to open Terminal.' });
    }
    return;
  }

  if (pathname === '/api/focus') {
    const sessionId = (parsedUrl.query.sessionId || '').toString().trim();
    if (!sessionId) {
      sendJson(res, 400, { error: 'sessionId is required.' });
      return;
    }

    try {
      await focusTerminalTabByTitle(`codex:${sessionId}`);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: 'Failed to focus Terminal tab.' });
    }
    return;
  }

  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    sendFile(res, filePath);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Codex session browser running at http://${HOST}:${PORT}`);
  console.log(`Reading sessions from ${SESSIONS_DIR}`);
});
