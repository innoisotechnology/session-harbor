import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const SESSION_EXT = '.jsonl';
const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const COPILOT_DIR = path.join(os.homedir(), '.copilot', 'session-state');
export const DATA_DIR = process.env.SESSION_HARBOR_DATA_DIR || path.join(resolveAppRoot(), 'data');
const NAMES_FILE = path.join(DATA_DIR, 'session-names.json');
const STATUS_FILE = path.join(DATA_DIR, 'session-status.json');
const META_FILE = path.join(DATA_DIR, 'session-meta.json');

export type SessionSource = 'codex' | 'claude' | 'copilot';
export type SessionStatus = 'active' | 'complete' | 'archived';

export type SessionRecord = {
  id: string | null;
  timestamp: string | null;
  cwd?: string | null;
  project?: string | null;
  relPath: string;
  fileName: string;
  name: string;
  messageCount: number;
  status: SessionStatus;
  tags: string[];
  notes: string;
};

export type SessionMatch = SessionRecord & { matchCount: number; matchPreview: string | null };

export async function listSessions(source: SessionSource): Promise<SessionRecord[]> {
  if (source === 'claude') {
    return loadClaudeSessions();
  }
  if (source === 'copilot') {
    return loadCopilotSessions();
  }
  return loadCodexSessions();
}

export async function findSessionById(source: SessionSource, sessionId: string): Promise<SessionRecord | null> {
  const sessions = await listSessions(source);
  return sessions.find((session) => session.id === sessionId) || null;
}

export async function searchSessionsByMetadata(source: SessionSource, query: string): Promise<SessionRecord[]> {
  const sessions = await listSessions(source);
  const queryLower = query.toLowerCase();
  return sessions.filter((session) => {
    const haystack = [
      session.fileName,
      session.cwd,
      session.project,
      session.id,
      session.relPath,
      session.name,
      session.tags?.join(' '),
      session.notes,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(queryLower);
  });
}

export async function searchSessionsByMessages(source: SessionSource, query: string, project?: string): Promise<SessionMatch[]> {
  const sessions = await listSessions(source);
  const queryLower = query.toLowerCase();
  const matcher = getSearchMatcher(source, queryLower);
  const filtered = project
    ? sessions.filter((session) => {
        const projectKey = getSessionProject(session, source);
        return projectKey === project;
      })
    : sessions;

  const results: SessionMatch[] = [];
  for (const session of filtered) {
    if (session.status === 'archived') {
      continue;
    }
    const fullPath = resolveSessionPath(source, session.relPath);
    if (!fullPath) {
      continue;
    }
    let matchInfo;
    try {
      matchInfo = await searchJsonlMessages(fullPath, matcher);
    } catch (err) {
      continue;
    }
    if (matchInfo.count > 0) {
      results.push({
        ...session,
        matchCount: matchInfo.count,
        matchPreview: matchInfo.firstMatch,
      });
    }
  }
  return results;
}

export async function getSessionContent(source: SessionSource, relPath: string): Promise<{ relPath: string; content: string; messages: any[]; messageCount: number; meta?: any }> {
  const fullPath = resolveSessionPath(source, relPath);
  if (!fullPath) {
    throw new Error('Invalid session path.');
  }
  const content = await fs.promises.readFile(fullPath, 'utf8');
  if (source === 'claude') {
    const messages = parseClaudeMessages(content);
    const fallbackId = path.basename(relPath, SESSION_EXT);
    const meta = extractClaudeMeta(content, fallbackId);
    return { relPath, content, messages, messageCount: messages.length, meta };
  }
  if (source === 'copilot') {
    const messages = parseCopilotMessages(content);
    const fallbackId = relPath.split(path.sep)[0];
    return { relPath, content, messages, messageCount: messages.length, meta: { sessionId: fallbackId } };
  }
  const messages = parseCodexMessages(content);
  return { relPath, content, messages, messageCount: messages.length };
}

export async function setSessionName(source: SessionSource, relPath: string, name: string): Promise<void> {
  const names = await loadSessionNames();
  const key = buildNameKey(source, relPath);
  if (name) {
    names[key] = name;
  } else {
    delete names[key];
  }
  await saveSessionNames(names);
}

export async function setSessionStatus(source: SessionSource, relPath: string, status: SessionStatus | 'active'): Promise<void> {
  const statuses = await loadSessionStatuses();
  const key = buildNameKey(source, relPath);
  if (status === 'active') {
    delete statuses[key];
  } else {
    statuses[key] = { status, updatedAt: new Date().toISOString() };
  }
  await saveSessionStatuses(statuses);
}

export async function updateSessionMeta(source: SessionSource, relPath: string, tags: unknown, notes: unknown): Promise<void> {
  const meta = await loadSessionMeta();
  const key = buildNameKey(source, relPath);
  const normalizedTags = normalizeTags(tags);
  const normalizedNotes = typeof notes === 'string' ? notes.trim() : '';
  if (!normalizedTags.length && !normalizedNotes) {
    delete meta[key];
  } else {
    meta[key] = { tags: normalizedTags, notes: normalizedNotes, updatedAt: new Date().toISOString() };
  }
  await saveSessionMeta(meta);
}

export function normalizeStatus(input: unknown): SessionStatus {
  const value = typeof input === 'string' ? input.toLowerCase() : '';
  if (value === 'complete' || value === 'archived') return value;
  return 'active';
}

export function normalizeTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  raw.forEach((entry) => {
    if (typeof entry !== 'string') return;
    const trimmed = entry.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(trimmed);
  });
  return tags;
}

export function resolveSessionPath(source: SessionSource, relPath: string): string | null {
  if (!relPath) return null;
  if (source === 'claude') {
    return isSafePath(CLAUDE_DIR, relPath) ? path.resolve(CLAUDE_DIR, relPath) : null;
  }
  if (source === 'copilot') {
    return isSafePath(COPILOT_DIR, relPath) ? path.resolve(COPILOT_DIR, relPath) : null;
  }
  return isSafePath(SESSIONS_DIR, relPath) ? path.resolve(SESSIONS_DIR, relPath) : null;
}

export function filterByStatus(sessions: SessionRecord[], status?: SessionStatus, includeArchived?: boolean): SessionRecord[] {
  if (status) {
    return sessions.filter((session) => session.status === status);
  }
  if (!includeArchived) {
    return sessions.filter((session) => session.status !== 'archived');
  }
  return sessions;
}

export function filterByProject(sessions: SessionRecord[], source: SessionSource, project?: string): SessionRecord[] {
  if (!project) return sessions;
  return sessions.filter((session) => getSessionProject(session, source) === project);
}

export function sliceSessions(sessions: SessionRecord[], limit?: number, offset?: number): SessionRecord[] {
  const start = Math.max(offset || 0, 0);
  if (!limit || limit <= 0) return sessions.slice(start);
  return sessions.slice(start, start + limit);
}

function resolveAppRoot() {
  if (process.env.SESSION_HARBOR_APP_ROOT) {
    return process.env.SESSION_HARBOR_APP_ROOT;
  }
  const cwd = process.cwd();
  const maxDepth = 6;
  let current = cwd;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = path.join(current, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed?.name === 'session-harbor') {
          return current;
        }
      } catch (err) {
        // ignore and continue
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwd;
}

async function listSessionFiles(dir: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() === 'archive') {
        continue;
      }
      files.push(...(await listSessionFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readFirstLine(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    let buffer = '';
    let done = false;

    const finish = (line: string) => {
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

async function readUpToLines(filePath: string, maxLines: number, maxBytes: number): Promise<string> {
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

async function countJsonlMessages(filePath: string, matcher: (entry: any) => boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    let count = 0;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        return;
      }
      if (matcher(parsed)) {
        count += 1;
      }
    });

    rl.on('close', () => resolve(count));
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

async function searchJsonlMessages(filePath: string, matcher: (entry: any) => string | null): Promise<{ count: number; firstMatch: string | null }> {
  return new Promise((resolve, reject) => {
    let count = 0;
    let firstMatch: string | null = null;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        return;
      }
      const text = matcher(parsed);
      if (text) {
        count += 1;
        if (!firstMatch) {
          firstMatch = text.slice(0, 240);
        }
      }
    });

    rl.on('close', () => resolve({ count, firstMatch }));
    rl.on('error', reject);
    stream.on('error', reject);
  });
}

function normalizeMessageContent(content: any) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  const parts: string[] = [];
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

function parseCodexMessages(rawContent: string) {
  const messages: any[] = [];
  if (!rawContent) return messages;

  const lines = rawContent.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      continue;
    }

    if (!parsed) continue;

    if (parsed.type === 'event_msg') {
      const payload = parsed.payload || {};
      if (payload.type === 'user_message' || payload.type === 'assistant_message') {
        const role = payload.type === 'assistant_message' ? 'assistant' : 'user';
        const text = String(payload.message || '').trim();
        if (!text) continue;
        messages.push({
          role,
          timestamp: parsed.timestamp || null,
          text,
        });
      }
      continue;
    }

    if (parsed.type !== 'response_item') continue;
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

function parseClaudeMessages(rawContent: string) {
  const messages: any[] = [];
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

function parseCopilotMessages(rawContent: string) {
  const messages: any[] = [];
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
    if (parsed.type !== 'user.message' && parsed.type !== 'assistant.message') continue;

    const data = parsed.data || {};
    const role = parsed.type === 'user.message' ? 'user' : 'assistant';
    const text = String(data.content || data.transformedContent || '').trim();
    if (!text) continue;

    messages.push({
      role,
      timestamp: parsed.timestamp || null,
      text,
    });
  }

  return messages;
}

function extractClaudeMeta(rawContent: string, fallbackId: string) {
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

async function readCopilotWorkspace(workspacePath: string): Promise<Record<string, string | undefined>> {
  try {
    const raw = await fs.promises.readFile(workspacePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const meta: Record<string, string | undefined> = {};
    lines.forEach((line) => {
      const match = line.match(/^\s*([a-z_]+)\s*:\s*(.+)\s*$/i);
      if (!match) return;
      const key = match[1];
      const value = match[2];
      meta[key] = value;
    });
    return meta;
  } catch (err) {
    return {};
  }
}

async function getClaudeProjectInfo(filePath: string, fallbackProject: string) {
  try {
    const snippet = await readUpToLines(filePath, 120, 200_000);
    const meta = extractClaudeMeta(snippet, path.basename(filePath, SESSION_EXT));
    return meta.cwd || fallbackProject;
  } catch (err) {
    return fallbackProject;
  }
}

async function loadCodexSessions() {
  const files = await listSessionFiles(SESSIONS_DIR);
  const sessions: SessionRecord[] = [];
  const names = await loadSessionNames();
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();

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

    const messageCount = await countJsonlMessages(filePath, (entry) => {
      if (entry?.type === 'response_item' && entry?.payload?.type === 'message') {
        return true;
      }
      if (
        entry?.type === 'event_msg' &&
        (entry?.payload?.type === 'user_message' || entry?.payload?.type === 'assistant_message')
      ) {
        return true;
      }
      return false;
    });

    const relPath = path.relative(SESSIONS_DIR, filePath);
    const statusKey = buildNameKey('codex', relPath);
    const statusEntry = statuses[statusKey];
    const metaEntry = meta[statusKey] || {};
    sessions.push({
      id: parsed.payload.id || null,
      timestamp: parsed.payload.timestamp || parsed.timestamp || null,
      cwd: parsed.payload.cwd || null,
      relPath,
      fileName: path.basename(filePath),
      name: names[buildNameKey('codex', relPath)] || '',
      messageCount,
      status: normalizeStatus(statusEntry?.status),
      tags: Array.isArray(metaEntry.tags) ? metaEntry.tags : [],
      notes: typeof metaEntry.notes === 'string' ? metaEntry.notes : '',
    });
  }

  sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  return sessions;
}

async function loadClaudeSessions() {
  const files = await listSessionFiles(CLAUDE_DIR);
  const sessions: SessionRecord[] = [];
  const names = await loadSessionNames();
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();

  for (const filePath of files) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      continue;
    }

    const relPath = path.relative(CLAUDE_DIR, filePath);
    const fallbackProject = relPath.split(path.sep)[0] || 'Unknown';
    const project = await getClaudeProjectInfo(filePath, fallbackProject);
    const fileName = path.basename(filePath);
    const id = path.basename(filePath, SESSION_EXT);

    const messageCount = await countJsonlMessages(filePath, (entry) => {
      return entry?.type === 'user' || entry?.type === 'assistant';
    });

    const statusKey = buildNameKey('claude', relPath);
    const statusEntry = statuses[statusKey];
    const metaEntry = meta[statusKey] || {};
    sessions.push({
      id,
      timestamp: stat.mtime ? new Date(stat.mtime).toISOString() : null,
      project,
      relPath,
      fileName,
      name: names[buildNameKey('claude', relPath)] || '',
      messageCount,
      status: normalizeStatus(statusEntry?.status),
      tags: Array.isArray(metaEntry.tags) ? metaEntry.tags : [],
      notes: typeof metaEntry.notes === 'string' ? metaEntry.notes : '',
    });
  }

  sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  return sessions;
}

async function loadCopilotSessions() {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(COPILOT_DIR, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const sessions: SessionRecord[] = [];
  const names = await loadSessionNames();
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.toLowerCase() === 'archive') continue;
    const sessionDir = path.join(COPILOT_DIR, entry.name);
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    const workspacePath = path.join(sessionDir, 'workspace.yaml');
    let stat;
    try {
      stat = await fs.promises.stat(eventsPath);
    } catch (err) {
      continue;
    }

    const workspace = await readCopilotWorkspace(workspacePath);
    const timestamp = workspace.updated_at || workspace.created_at || (stat.mtime ? new Date(stat.mtime).toISOString() : null);
    const messageCount = await countJsonlMessages(eventsPath, (entry) => {
      return entry?.type === 'user.message' || entry?.type === 'assistant.message';
    });

    const relPath = path.relative(COPILOT_DIR, eventsPath);
    const statusKey = buildNameKey('copilot', relPath);
    const statusEntry = statuses[statusKey];
    const metaEntry = meta[statusKey] || {};
    sessions.push({
      id: (workspace.id as string) || entry.name,
      timestamp: timestamp || null,
      cwd: (workspace.cwd as string) || null,
      project: (workspace.repository as string) || null,
      relPath,
      fileName: path.basename(eventsPath),
      name: names[buildNameKey('copilot', relPath)] || '',
      messageCount,
      status: normalizeStatus(statusEntry?.status),
      tags: Array.isArray(metaEntry.tags) ? metaEntry.tags : [],
      notes: typeof metaEntry.notes === 'string' ? metaEntry.notes : '',
    });
  }

  sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

  return sessions;
}

async function loadSessionNames(): Promise<Record<string, string>> {
  try {
    const raw = await fs.promises.readFile(NAMES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function saveSessionNames(names: Record<string, string>): Promise<void> {
  await fs.promises.mkdir(path.dirname(NAMES_FILE), { recursive: true });
  await fs.promises.writeFile(NAMES_FILE, JSON.stringify(names, null, 2));
}

async function loadSessionStatuses(): Promise<Record<string, { status: string; updatedAt?: string }>> {
  try {
    const raw = await fs.promises.readFile(STATUS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function saveSessionStatuses(statuses: Record<string, { status: string; updatedAt?: string }>): Promise<void> {
  await fs.promises.mkdir(path.dirname(STATUS_FILE), { recursive: true });
  await fs.promises.writeFile(STATUS_FILE, JSON.stringify(statuses, null, 2));
}

async function loadSessionMeta(): Promise<Record<string, { tags?: string[]; notes?: string; updatedAt?: string }>> {
  try {
    const raw = await fs.promises.readFile(META_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

async function saveSessionMeta(meta: Record<string, { tags?: string[]; notes?: string; updatedAt?: string }>): Promise<void> {
  await fs.promises.mkdir(path.dirname(META_FILE), { recursive: true });
  await fs.promises.writeFile(META_FILE, JSON.stringify(meta, null, 2));
}

function buildNameKey(source: SessionSource, relPath: string) {
  return `${source}:${relPath}`;
}

function isSafePath(baseDir: string, relPath: string) {
  const resolved = path.resolve(baseDir, relPath);
  const base = path.resolve(baseDir) + path.sep;
  return resolved.startsWith(base);
}

function getSessionProject(session: SessionRecord, source: SessionSource) {
  if (source === 'claude') {
    return session.project || session.cwd || '';
  }
  if (source === 'copilot') {
    return session.project || session.cwd || '';
  }
  return session.cwd || session.project || '';
}

function getSearchMatcher(source: SessionSource, queryLower: string) {
  if (source === 'claude') {
    return (entry: any) => {
      if (!entry || !entry.type) return null;
      if (entry.type === 'summary' && entry.summary) {
        const text = String(entry.summary);
        return text.toLowerCase().includes(queryLower) ? text : null;
      }
      if (entry.type !== 'user' && entry.type !== 'assistant') return null;
      const message = entry.message || {};
      const text = normalizeMessageContent(message.content).trim();
      if (!text) return null;
      return text.toLowerCase().includes(queryLower) ? text : null;
    };
  }

  if (source === 'copilot') {
    return (entry: any) => {
      if (!entry || !entry.type) return null;
      if (entry.type !== 'user.message' && entry.type !== 'assistant.message') return null;
      const data = entry.data || {};
      const text = String(data.content || data.transformedContent || '').trim();
      if (!text) return null;
      return text.toLowerCase().includes(queryLower) ? text : null;
    };
  }

  return (entry: any) => {
    if (!entry) return null;
    if (entry.type === 'response_item') {
      const payload = entry.payload;
      if (!payload || payload.type !== 'message') return null;
      const text = normalizeMessageContent(payload.content).trim();
      if (!text) return null;
      return text.toLowerCase().includes(queryLower) ? text : null;
    }
    if (
      entry.type === 'event_msg' &&
      (entry.payload?.type === 'user_message' || entry.payload?.type === 'assistant_message')
    ) {
      const text = String(entry.payload.message || '').trim();
      if (!text) return null;
      return text.toLowerCase().includes(queryLower) ? text : null;
    }
    return null;
  };
}
