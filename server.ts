import http, { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import os from 'os';
import { spawn } from 'child_process';
import readline from 'readline';
import https from 'https';

const PORT = Number(process.env.PORT) || 3434;
const HOST = process.env.HOST || '127.0.0.1';
const APP_ROOT = resolveAppRoot();
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const FRONTEND_DIR = path.join(APP_ROOT, 'frontend', 'dist');
const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const COPILOT_DIR = path.join(os.homedir(), '.copilot', 'session-state');
const SESSION_EXT = '.jsonl';
const DATA_DIR = process.env.SESSION_HARBOR_DATA_DIR || path.join(APP_ROOT, 'data');
const NAMES_FILE = path.join(DATA_DIR, 'session-names.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending-names.json');
const STATUS_FILE = path.join(DATA_DIR, 'session-status.json');
const META_FILE = path.join(DATA_DIR, 'session-meta.json');
const REPORTS_DIR = process.env.SESSION_HARBOR_REPORTS_DIR || path.join(APP_ROOT, 'reports');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.jsonl');
const CODEX_HOME = path.join(os.homedir(), '.codex');
const CONFIG_FILE = path.join(CODEX_HOME, 'config.toml');
const AUTH_FILE = path.join(CODEX_HOME, 'auth.json');
const VERSION_FILE = path.join(CODEX_HOME, 'version.json');
const CODEX_SKILLS_DIR = path.join(CODEX_HOME, 'skills');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const COPILOT_SKILLS_DIR = path.join(os.homedir(), '.copilot', 'skills');

let cachedSessions: any[] = [];
let lastScanAt = 0;
let cachedClaudeSessions: any[] = [];
let lastClaudeScanAt = 0;
let cachedCopilotSessions: any[] = [];
let lastCopilotScanAt = 0;
const CACHE_TTL_MS = 10_000;

function resolveAppRoot() {
  if (process.env.SESSION_HARBOR_APP_ROOT) {
    return process.env.SESSION_HARBOR_APP_ROOT;
  }
  if (fs.existsSync(path.join(__dirname, 'frontend'))) {
    return __dirname;
  }
  return path.resolve(__dirname, '..');
}

async function listSessionFiles(dir: string): Promise<string[]> {
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
    let firstMatch = null;
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

function toRelativeSessionPath(filePath) {
  return path.relative(SESSIONS_DIR, filePath);
}

function toRelativeClaudePath(filePath) {
  return path.relative(CLAUDE_DIR, filePath);
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

async function setSessionName(source: string, relPath: string, name: string): Promise<void> {
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
  } else if (source === 'copilot') {
    cachedCopilotSessions = [];
    lastCopilotScanAt = 0;
  }
}

async function setSessionStatus(
  source: string,
  relPath: string,
  status: 'archived' | 'complete' | null,
): Promise<void> {
  const statuses = await loadSessionStatuses();
  const key = buildNameKey(source, relPath);
  if (status) {
    statuses[key] = { status, updatedAt: new Date().toISOString() };
  } else {
    delete statuses[key];
  }
  await saveSessionStatuses(statuses);

  if (source === 'codex') {
    cachedSessions = [];
    lastScanAt = 0;
  } else if (source === 'claude') {
    cachedClaudeSessions = [];
    lastClaudeScanAt = 0;
  } else if (source === 'copilot') {
    cachedCopilotSessions = [];
    lastCopilotScanAt = 0;
  }
}

async function loadPendingNames(): Promise<any[]> {
  try {
    const raw = await fs.promises.readFile(PENDING_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function savePendingNames(pending: any[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(PENDING_FILE), { recursive: true });
  await fs.promises.writeFile(PENDING_FILE, JSON.stringify(pending, null, 2));
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

function buildNameKey(source, relPath) {
  return `${source}:${relPath}`;
}

function normalizeTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const seen = new Set<string>();
  const tags = [];
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

type SkillSummary = {
  name: string;
  description: string;
  relPath: string;
  updatedAt?: string;
  hasFrontMatter: boolean;
};

type SkillDetail = SkillSummary & {
  content: string;
  baseDir: string;
};

function skillsBaseDir(source: string) {
  if (source === 'claude') return CLAUDE_SKILLS_DIR;
  if (source === 'copilot') return COPILOT_SKILLS_DIR;
  return CODEX_SKILLS_DIR;
}

function isSafeSkillPath(relPath: string) {
  if (!relPath) return false;
  if (relPath.includes('..')) return false;
  if (path.isAbsolute(relPath)) return false;
  return true;
}

async function collectSkillDirs(baseDir: string, currentDir: string, results: { relPath: string; skillFile: string }[]) {
  let entries = [];
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch (err) {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.git') {
      continue;
    }
    const dirPath = path.join(currentDir, entry.name);
    const skillFile = path.join(dirPath, 'SKILL.md');
    try {
      const stat = await fs.promises.stat(skillFile);
      if (stat.isFile()) {
        results.push({ relPath: path.relative(baseDir, dirPath), skillFile });
      }
    } catch (err) {
      // ignore missing SKILL.md
    }
    await collectSkillDirs(baseDir, dirPath, results);
  }
}

function parseSkillFrontMatter(content: string) {
  const lines = content.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') {
    return { frontMatter: {}, bodyLines: lines, hasFrontMatter: false };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { frontMatter: {}, bodyLines: lines, hasFrontMatter: false };
  }

  const frontMatter: Record<string, string> = {};
  for (let i = 1; i < endIdx; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    frontMatter[match[1]] = value;
  }
  return { frontMatter, bodyLines: lines.slice(endIdx + 1), hasFrontMatter: true };
}

function extractHeading(lines: string[]) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }
  }
  return '';
}

function extractDescription(lines: string[]) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return '';
}

function buildSkillSummary(relPath: string, content: string) {
  const parsed = parseSkillFrontMatter(content);
  const name = (parsed.frontMatter.name || '').trim() || extractHeading(parsed.bodyLines) || path.basename(relPath);
  const description = (parsed.frontMatter.description || '').trim() || extractDescription(parsed.bodyLines);
  return {
    name,
    description,
    hasFrontMatter: parsed.hasFrontMatter
  };
}

async function listSkillsForSource(source: string) {
  const baseDir = skillsBaseDir(source);
  if (!baseDir) {
    return { skills: [], baseDir: '', error: 'Unknown source.' };
  }
  if (!fs.existsSync(baseDir)) {
    return { skills: [], baseDir, missing: true };
  }

  const entries: { relPath: string; skillFile: string }[] = [];
  await collectSkillDirs(baseDir, baseDir, entries);

  const summaries: SkillSummary[] = [];
  for (const entry of entries) {
    let content = '';
    try {
      content = await fs.promises.readFile(entry.skillFile, 'utf8');
    } catch (err) {
      continue;
    }
    let updatedAt;
    try {
      const stat = await fs.promises.stat(entry.skillFile);
      updatedAt = stat.mtime ? stat.mtime.toISOString() : undefined;
    } catch (err) {
      updatedAt = undefined;
    }
    const summary = buildSkillSummary(entry.relPath, content);
    summaries.push({
      ...summary,
      relPath: entry.relPath,
      updatedAt
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return { skills: summaries, baseDir };
}

async function readSkillDetail(source: string, relPath: string): Promise<SkillDetail | null> {
  const baseDir = skillsBaseDir(source);
  if (!baseDir) return null;
  if (!isSafeSkillPath(relPath)) return null;

  const skillDir = path.resolve(baseDir, relPath);
  const normalizedBase = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
  if (!skillDir.startsWith(normalizedBase)) return null;
  const skillFile = path.join(skillDir, 'SKILL.md');
  let content = '';
  try {
    content = await fs.promises.readFile(skillFile, 'utf8');
  } catch (err) {
    return null;
  }
  let updatedAt;
  try {
    const stat = await fs.promises.stat(skillFile);
    updatedAt = stat.mtime ? stat.mtime.toISOString() : undefined;
  } catch (err) {
    updatedAt = undefined;
  }
  const summary = buildSkillSummary(relPath, content);
  return {
    ...summary,
    relPath,
    content,
    baseDir,
    updatedAt
  };
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

function parseCopilotMessages(rawContent) {
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

type CopilotWorkspace = {
  id?: string;
  cwd?: string;
  repository?: string;
  branch?: string;
  created_at?: string;
  updated_at?: string;
  summary?: string;
  [key: string]: string | undefined;
};

async function readCopilotWorkspace(workspacePath): Promise<CopilotWorkspace> {
  try {
    const raw = await fs.promises.readFile(workspacePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const meta: CopilotWorkspace = {};
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
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();
  const pending = await loadPendingNames();

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

    const relPath = toRelativeSessionPath(filePath);
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

  const pendingChanged = applyPendingNames('codex', sessions, names, pending);
  if (pendingChanged.changed) {
    await saveSessionNames(names);
    await savePendingNames(pendingChanged.pending);
  }

  cachedSessions = sessions;
  lastScanAt = Date.now();
  return sessions;
}

async function loadClaudeSessions() {
  const files = await listSessionFiles(CLAUDE_DIR);
  const sessions = [];
  const names = await loadSessionNames();
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();
  const pending = await loadPendingNames();

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

  const pendingChanged = applyPendingNames('claude', sessions, names, pending);
  if (pendingChanged.changed) {
    await saveSessionNames(names);
    await savePendingNames(pendingChanged.pending);
  }

  cachedClaudeSessions = sessions;
  lastClaudeScanAt = Date.now();
  return sessions;
}

async function loadCopilotSessions() {
  let entries = [];
  try {
    entries = await fs.promises.readdir(COPILOT_DIR, { withFileTypes: true });
  } catch (err) {
    return [];
  }

  const sessions = [];
  const names = await loadSessionNames();
  const meta = await loadSessionMeta();
  const statuses = await loadSessionStatuses();
  const pending = await loadPendingNames();

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
    const timestamp = workspace.updated_at
      || workspace.created_at
      || (stat.mtime ? new Date(stat.mtime).toISOString() : null);
    const messageCount = await countJsonlMessages(eventsPath, (entry) => {
      return entry?.type === 'user.message' || entry?.type === 'assistant.message';
    });

    const relPath = path.relative(COPILOT_DIR, eventsPath);
    const statusKey = buildNameKey('copilot', relPath);
    const statusEntry = statuses[statusKey];
    const metaEntry = meta[statusKey] || {};
    sessions.push({
      id: workspace.id || entry.name,
      timestamp,
      cwd: workspace.cwd || null,
      project: workspace.repository || null,
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

  const pendingChanged = applyPendingNames('copilot', sessions, names, pending);
  if (pendingChanged.changed) {
    await saveSessionNames(names);
    await savePendingNames(pendingChanged.pending);
  }

  cachedCopilotSessions = sessions;
  lastCopilotScanAt = Date.now();
  return sessions;
}

function filterArchived(sessions) {
  return sessions.filter((session) => session.status !== 'archived');
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

async function getCopilotSessions() {
  if (!cachedCopilotSessions.length || Date.now() - lastCopilotScanAt > CACHE_TTL_MS) {
    return loadCopilotSessions();
  }
  return cachedCopilotSessions;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
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

function isSafeCopilotPath(relPath) {
  if (!relPath) return false;
  const resolved = path.resolve(COPILOT_DIR, relPath);
  const base = path.resolve(COPILOT_DIR) + path.sep;
  return resolved.startsWith(base);
}

function normalizeStatus(input: unknown): 'active' | 'complete' | 'archived' {
  const value = typeof input === 'string' ? input.toLowerCase() : '';
  if (value === 'complete' || value === 'archived') return value;
  return 'active';
}

function getSessionProject(session, source) {
  if (source === 'claude') {
    return session.project || session.cwd || '';
  }
  if (source === 'copilot') {
    return session.project || session.cwd || '';
  }
  return session.cwd || session.project || '';
}

function applyPendingNames(source, sessions, names, pending) {
  if (!pending.length) return { changed: false, pending };
  let changed = false;
  const remaining = [];

  pending.forEach((entry) => {
    if (!entry || entry.source !== source) {
      remaining.push(entry);
      return;
    }

    const candidates = sessions.filter((session) => {
      const project = getSessionProject(session, source);
      if (!project || project !== entry.cwd) return false;
      const key = buildNameKey(source, session.relPath);
      return !names[key];
    });

    if (!candidates.length) {
      remaining.push(entry);
      return;
    }

    const target = candidates[0];
    const key = buildNameKey(source, target.relPath);
    names[key] = entry.name;
    target.name = entry.name;
    changed = true;
  });

  return { changed, pending: remaining };
}

function getSearchMatcher(source, queryLower) {
  if (source === 'claude') {
    return (entry) => {
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
    return (entry) => {
      if (!entry || !entry.type) return null;
      if (entry.type !== 'user.message' && entry.type !== 'assistant.message') return null;
      const data = entry.data || {};
      const text = String(data.content || data.transformedContent || '').trim();
      if (!text) return null;
      return text.toLowerCase().includes(queryLower) ? text : null;
    };
  }

  return (entry) => {
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

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function parseJwtClaims(token) {
  if (!token) return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
  try {
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    return {};
  }
}

async function readConfigToml() {
  try {
    const raw = await fs.promises.readFile(CONFIG_FILE, 'utf8');
    const model = raw.match(/^model\\s*=\\s*\"(.+)\"/m)?.[1] || null;
    const effort = raw.match(/^model_reasoning_effort\\s*=\\s*\"(.+)\"/m)?.[1] || null;
    const summary = raw.match(/^model_reasoning_summary\\s*=\\s*(true|false)/m)?.[1] || null;
    const baseUrl = raw.match(/^chatgpt_base_url\\s*=\\s*\"(.+)\"/m)?.[1] || null;
    return { model, effort, summary, baseUrl };
  } catch (err) {
    return {};
  }
}

async function readAuthJson() {
  try {
    const raw = await fs.promises.readFile(AUTH_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed || {};
  } catch (err) {
    return {};
  }
}

async function readVersion() {
  try {
    const raw = await fs.promises.readFile(VERSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.cli_version || parsed?.version || null;
  } catch (err) {
    return null;
  }
}

function normalizeBaseUrl(baseUrl) {
  let url = baseUrl || 'https://chatgpt.com/backend-api';
  while (url.endsWith('/')) url = url.slice(0, -1);
  if ((url.startsWith('https://chatgpt.com') || url.startsWith('https://chat.openai.com')) && !url.includes('/backend-api')) {
    url = `${url}/backend-api`;
  }
  return url;
}

function rateLimitPath(baseUrl) {
  if (baseUrl.includes('/backend-api')) {
    return `${baseUrl}/wham/usage`;
  }
  return `${baseUrl}/api/codex/usage`;
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`status ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function openTerminalWithCommand(command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

function focusTerminalTabByTitle(titleNeedle: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
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

async function listReports() {
  let entries = [];
  try {
    entries = await fs.promises.readdir(REPORTS_DIR, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  const reports = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(REPORTS_DIR, entry.name);
    let stat;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch (err) {
      continue;
    }
    const summaryPath = path.join(fullPath, 'summary.md');
    let hasSummary = false;
    try {
      await fs.promises.access(summaryPath, fs.constants.R_OK);
      hasSummary = true;
    } catch (err) {
      hasSummary = false;
    }
    reports.push({
      name: entry.name,
      createdAt: stat.mtime ? new Date(stat.mtime).toISOString() : null,
      hasSummary,
    });
  }
  reports.sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });
  return reports;
}

async function readReportSummary(reportName) {
  const safeName = reportName.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName) return null;
  const fullPath = path.join(REPORTS_DIR, safeName);
  const summaryPath = path.join(fullPath, 'summary.md');
  try {
    const content = await fs.promises.readFile(summaryPath, 'utf8');
    return content;
  } catch (err) {
    return null;
  }
}

async function readReportRecommendations(reportName) {
  const safeName = reportName.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName) return null;
  const fullPath = path.join(REPORTS_DIR, safeName);
  const recommendationsPath = path.join(fullPath, 'recommendations.json');
  try {
    const raw = await fs.promises.readFile(recommendationsPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function readFeedbackEntries() {
  try {
    const raw = await fs.promises.readFile(FEEDBACK_FILE, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

function resolveStaticDir() {
  try {
    if (fs.existsSync(FRONTEND_DIR)) {
      return FRONTEND_DIR;
    }
  } catch (err) {
    // ignore and fall back to public
  }
  return PUBLIC_DIR;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/api/sessions') {
    const search = (parsedUrl.query.search || '').toString().toLowerCase();
    const sessions = await getSessions();
    const filtered = search
      ? sessions.filter((session) => {
          const haystack = [session.fileName, session.cwd, session.id, session.relPath, session.name, session.tags?.join(' '), session.notes]
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
          const haystack = [session.fileName, session.project, session.id, session.relPath, session.name, session.tags?.join(' '), session.notes]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(search);
        })
      : sessions;
    sendJson(res, 200, { sessions: filtered });
    return;
  }

  if (pathname === '/api/copilot/sessions') {
    const search = (parsedUrl.query.search || '').toString().toLowerCase();
    const sessions = await getCopilotSessions();
    const filtered = search
      ? sessions.filter((session) => {
          const haystack = [session.fileName, session.project, session.cwd, session.id, session.relPath, session.name, session.tags?.join(' '), session.notes]
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
    const sessions = source === 'claude'
      ? await getClaudeSessions()
      : source === 'copilot'
        ? await getCopilotSessions()
        : await getSessions();
    const counts = new Map();
    filterArchived(sessions).forEach((session) => {
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

  if (pathname === '/api/skills') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const result = await listSkillsForSource(source);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/skill') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const relPath = (parsedUrl.query.path || '').toString();
    if (!relPath) {
      sendJson(res, 400, { error: 'path is required.' });
      return;
    }
    const detail = await readSkillDetail(source, relPath);
    if (!detail) {
      sendJson(res, 404, { error: 'Skill not found.' });
      return;
    }
    sendJson(res, 200, { skill: detail });
    return;
  }

  if (pathname === '/api/reports') {
    const reports = await listReports();
    sendJson(res, 200, { reports });
    return;
  }

  if (pathname === '/api/report') {
    const name = (parsedUrl.query.name || '').toString();
    if (!name) {
      sendJson(res, 400, { error: 'name is required.' });
      return;
    }
    const summary = await readReportSummary(name);
    if (!summary) {
      sendJson(res, 404, { error: 'Report not found.' });
      return;
    }
    const recommendations = await readReportRecommendations(name);
    sendJson(res, 200, { name, summary, recommendations });
    return;
  }

  if (pathname === '/api/feedback-log') {
    const source = (parsedUrl.query.source || '').toString();
    const relPath = (parsedUrl.query.relPath || '').toString();
    const entries = await readFeedbackEntries();
    const filtered = entries.filter((entry) => {
      if (source && entry.source !== source) return false;
      if (relPath && entry.relPath !== relPath) return false;
      return true;
    });
    sendJson(res, 200, { entries: filtered.reverse().slice(0, 200) });
    return;
  }

  if (pathname === '/api/search') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const query = (parsedUrl.query.query || '').toString().trim();
    const project = (parsedUrl.query.project || '').toString().trim();
    if (!query) {
      sendJson(res, 400, { error: 'query is required.' });
      return;
    }

    const sessions = source === 'claude'
      ? await getClaudeSessions()
      : source === 'copilot'
        ? await getCopilotSessions()
        : await getSessions();
    const filtered = project
      ? sessions.filter((session) => {
          const projectKey = session.project || session.cwd || '';
          return projectKey === project;
        })
      : sessions;

    const queryLower = query.toLowerCase();
    const matcher = getSearchMatcher(source, queryLower);
    const results = [];

    for (const session of filterArchived(filtered)) {
      const fullPath = source === 'claude'
        ? path.resolve(CLAUDE_DIR, session.relPath)
        : source === 'copilot'
          ? path.resolve(COPILOT_DIR, session.relPath)
          : path.resolve(SESSIONS_DIR, session.relPath);
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

    sendJson(res, 200, { sessions: results });
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

  if (pathname === '/api/copilot/session') {
    const relPath = (parsedUrl.query.file || '').toString();
    if (!isSafeCopilotPath(relPath)) {
      sendJson(res, 400, { error: 'Invalid file path.' });
      return;
    }

    const fullPath = path.resolve(COPILOT_DIR, relPath);
    const fallbackId = relPath.split(path.sep)[0];
    try {
      const content = await fs.promises.readFile(fullPath, 'utf8');
      const messages = parseCopilotMessages(content);
      sendJson(res, 200, {
        relPath,
        content,
        messages,
        messageCount: messages.length,
        meta: { sessionId: fallbackId }
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
    await setSessionName(source, relPath, name);

    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/name-by-id') {
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
    const sessionId = (payload.sessionId || '').toString().trim();
    const name = (payload.name || '').toString().trim();

    if (!source || !sessionId) {
      sendJson(res, 400, { error: 'source and sessionId are required.' });
      return;
    }

    const sessions = source === 'claude'
      ? await getClaudeSessions()
      : source === 'copilot'
        ? await getCopilotSessions()
        : await getSessions();

    const match = sessions.find((session) => session.id === sessionId);
    if (!match || !match.relPath) {
      sendJson(res, 404, { error: 'Session not found.' });
      return;
    }

    await setSessionName(source, match.relPath, name);
    sendJson(res, 200, { ok: true, relPath: match.relPath });
    return;
  }

  if (pathname === '/api/archive-session') {
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

    if (!source || !relPath) {
      sendJson(res, 400, { error: 'source and relPath are required.' });
      return;
    }

    const archive = payload.archive !== false;
    await setSessionStatus(source, relPath, archive ? 'archived' : null);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/archive-by-id') {
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
    const sessionId = (payload.sessionId || '').toString().trim();
    const archive = payload.archive !== false;

    if (!source || !sessionId) {
      sendJson(res, 400, { error: 'source and sessionId are required.' });
      return;
    }

    const sessions = source === 'claude'
      ? await getClaudeSessions()
      : source === 'copilot'
        ? await getCopilotSessions()
        : await getSessions();

    const match = sessions.find((session) => session.id === sessionId);
    if (!match || !match.relPath) {
      sendJson(res, 404, { error: 'Session not found.' });
      return;
    }

    await setSessionStatus(source, match.relPath, archive ? 'archived' : null);
    sendJson(res, 200, { ok: true, relPath: match.relPath });
    return;
  }

  if (pathname === '/api/complete-session') {
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
    const complete = Boolean(payload.complete);

    if (!source || !relPath) {
      sendJson(res, 400, { error: 'source and relPath are required.' });
      return;
    }

    await setSessionStatus(source, relPath, complete ? 'complete' : null);

    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/complete-by-id') {
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
    const sessionId = (payload.sessionId || '').toString().trim();
    const complete = Boolean(payload.complete);

    if (!source || !sessionId) {
      sendJson(res, 400, { error: 'source and sessionId are required.' });
      return;
    }

    const sessions = source === 'claude'
      ? await getClaudeSessions()
      : source === 'copilot'
        ? await getCopilotSessions()
        : await getSessions();

    const match = sessions.find((session) => session.id === sessionId);
    if (!match || !match.relPath) {
      sendJson(res, 404, { error: 'Session not found.' });
      return;
    }

    await setSessionStatus(source, match.relPath, complete ? 'complete' : null);
    sendJson(res, 200, { ok: true, relPath: match.relPath });
    return;
  }

  if (pathname === '/api/session-meta') {
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
    const tags = normalizeTags(payload.tags);
    const notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';

    if (!source || !relPath) {
      sendJson(res, 400, { error: 'source and relPath are required.' });
      return;
    }

    const meta = await loadSessionMeta();
    const key = buildNameKey(source, relPath);
    if (!tags.length && !notes) {
      delete meta[key];
    } else {
      meta[key] = { tags, notes, updatedAt: new Date().toISOString() };
    }
    await saveSessionMeta(meta);

    if (source === 'codex') {
      cachedSessions = [];
      lastScanAt = 0;
    } else if (source === 'claude') {
      cachedClaudeSessions = [];
      lastClaudeScanAt = 0;
    } else if (source === 'copilot') {
      cachedCopilotSessions = [];
      lastCopilotScanAt = 0;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/new-session') {
    const source = (parsedUrl.query.source || 'codex').toString();
    const cwd = (parsedUrl.query.cwd || '').toString().trim();
    const name = (parsedUrl.query.name || '').toString().trim();
    if (!cwd) {
      sendJson(res, 400, { error: 'cwd is required.' });
      return;
    }

    if (source === 'copilot') {
      sendJson(res, 400, { error: 'Copilot sessions must be started from the Copilot CLI.' });
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

    if (name) {
      const pending = await loadPendingNames();
      pending.push({
        source,
        cwd,
        name,
        createdAt: new Date().toISOString()
      });
      await savePendingNames(pending);
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

  if (pathname === '/api/status') {
    const config = await readConfigToml();
    const auth = await readAuthJson();
    const version = await readVersion();
    const latest = (await getSessions())[0];
    const tokens = auth.tokens || {};
    const idToken = tokens.id_token || tokens.idToken || '';
    const claims = parseJwtClaims(idToken);
    const authClaims = claims['https://api.openai.com/auth'] || {};
    const email = claims.email || null;
    const plan = authClaims.chatgpt_plan_type || null;
    const accountId = authClaims.chatgpt_account_id || tokens.account_id || null;
    const accessToken = tokens.access_token || tokens.accessToken || null;

    let rateLimits = null;
    if (accessToken) {
      const baseUrl = normalizeBaseUrl(config.baseUrl);
      const url = rateLimitPath(baseUrl);
      try {
        rateLimits = await fetchJson(url, {
          Authorization: `Bearer ${accessToken}`,
          'ChatGPT-Account-Id': accountId || ''
        });
      } catch (err) {
        rateLimits = null;
      }
    }

    sendJson(res, 200, {
      source: 'codex',
      model: config.model || null,
      reasoningEffort: config.effort || null,
      reasoningSummaries: config.summary || null,
      cwd: latest?.cwd || null,
      sessionId: latest?.id || null,
      approval: null,
      sandbox: null,
      cliVersion: version,
      account: {
        email,
        plan
      },
      rateLimits: rateLimits || null
    });
    return;
  }

  if (pathname === '/api/claude/status') {
    const latest = (await getClaudeSessions())[0];
    sendJson(res, 200, {
      source: 'claude',
      cwd: latest?.cwd || null,
      sessionId: latest?.id || null,
      cliVersion: null,
      model: null,
      account: {}
    });
    return;
  }

  if (pathname === '/api/copilot/status') {
    const latest = (await getCopilotSessions())[0];
    sendJson(res, 200, {
      source: 'copilot',
      cwd: latest?.cwd || null,
      sessionId: latest?.id || null,
      cliVersion: null,
      model: null,
      account: {}
    });
    return;
  }

  if (pathname === '/status') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const response = { status: 'ok', service: 'session-harbor' };
    res.end(JSON.stringify(response, null, 2));
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

  const staticDir = resolveStaticDir();
  let filePath = pathname === '/' ? path.join(staticDir, 'index.html') : path.join(staticDir, pathname);
  if (!filePath.startsWith(staticDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err) {
      const fallback = path.join(staticDir, 'index.html');
      sendFile(res, fallback);
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
