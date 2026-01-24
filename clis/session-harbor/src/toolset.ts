import { defineToolset } from '../../../tooling/tool-spec/index.js';
import {
  filterByProject,
  filterByStatus,
  findSessionById,
  getSessionContent,
  listSessions,
  normalizeStatus,
  searchSessionsByMessages,
  searchSessionsByMetadata,
  setSessionName,
  setSessionStatus,
  sliceSessions,
  updateSessionMeta,
  type SessionSource,
  type SessionStatus,
  resolveSessionPath,
  type SessionRecord,
} from './services/sessions.js';

const DEFAULT_SOURCE: SessionSource = 'codex';

export function createSessionHarborToolset() {
  return defineToolset({
    name: 'SessionHarbor',
    version: '1.0.0',
    tools: [
      {
        name: 'session-list',
        title: 'List Sessions',
        description: 'List recent sessions with optional filters.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' },
            status: { type: 'string' },
            includeArchived: { type: 'boolean' },
            project: { type: 'string' },
            search: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const limit = toNumber((input as any)?.limit);
          const offset = toNumber((input as any)?.offset);
          const includeArchived = toBoolean((input as any)?.includeArchived);
          const status = normalizeStatusValue((input as any)?.status);
          const project = toStringOrUndefined((input as any)?.project);
          const search = toStringOrUndefined((input as any)?.search);

          let sessions = await listSessions(source);
          sessions = filterByStatus(sessions, status, includeArchived);
          sessions = filterByProject(sessions, source, project);
          if (search) {
            sessions = await searchSessionsByMetadata(source, search);
            sessions = filterByStatus(sessions, status, includeArchived);
            sessions = filterByProject(sessions, source, project);
          }

          const total = sessions.length;
          const sliced = sliceSessions(sessions, limit, offset);
          return { source, total, sessions: sliced };
        }
      },
      {
        name: 'session-search',
        title: 'Search Sessions',
        description: 'Search sessions by metadata or message content.',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            source: { type: 'string' },
            query: { type: 'string' },
            mode: { type: 'string' },
            project: { type: 'string' },
            includeArchived: { type: 'boolean' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const query = requireString((input as any)?.query, 'query');
          const mode = normalizeMode((input as any)?.mode);
          const project = toStringOrUndefined((input as any)?.project);
          const includeArchived = toBoolean((input as any)?.includeArchived);

          if (mode === 'messages') {
            const matches = await searchSessionsByMessages(source, query, project);
            const filtered = includeArchived ? matches : matches.filter((session) => session.status !== 'archived');
            return { source, total: filtered.length, sessions: filtered };
          }

          let sessions = await searchSessionsByMetadata(source, query);
          sessions = filterByProject(sessions, source, project);
          sessions = includeArchived ? sessions : sessions.filter((session) => session.status !== 'archived');
          return { source, total: sessions.length, sessions };
        }
      },
      {
        name: 'session-show',
        title: 'Show Session',
        description: 'Return a session record and optional parsed messages.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            includeMessages: { type: 'boolean' },
            limit: { type: 'number' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const includeMessages = toBoolean((input as any)?.includeMessages);
          const limit = toNumber((input as any)?.limit);

          const session = await resolveSessionRecord(source, relPath, sessionId);
          if (!includeMessages) {
            return { source, session };
          }
          const content = await getSessionContent(source, session.relPath);
          const messages = typeof limit === 'number' && limit >= 0 ? content.messages.slice(0, limit) : content.messages;
          return { source, session, ...content, messages };
        }
      },
      {
        name: 'session-rename',
        title: 'Rename Session',
        description: 'Set or clear the session name.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            name: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const name = toStringOrUndefined((input as any)?.name) || '';

          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionName(source, session.relPath, name);
          return { ok: true, source, relPath: session.relPath, name };
        }
      },
      {
        name: 'session-update',
        title: 'Update Session Meta',
        description: 'Update session tags and notes.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            tags: { type: ['array', 'string'] },
            notes: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const tags = (input as any)?.tags;
          const notes = (input as any)?.notes;

          const session = await resolveSessionRecord(source, relPath, sessionId);
          await updateSessionMeta(source, session.relPath, tags, notes);
          return { ok: true, source, relPath: session.relPath };
        }
      },
      {
        name: 'session-status',
        title: 'Set Session Status',
        description: 'Set session status to active, complete, or archived.',
        inputSchema: {
          type: 'object',
          required: ['status'],
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            status: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const status = requireStatus((input as any)?.status);

          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionStatus(source, session.relPath, status);
          return { ok: true, source, relPath: session.relPath, status };
        }
      },
      {
        name: 'session-archive',
        title: 'Archive Session',
        description: 'Mark a session as archived.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionStatus(source, session.relPath, 'archived');
          return { ok: true, source, relPath: session.relPath, status: 'archived' };
        }
      },
      {
        name: 'session-unarchive',
        title: 'Unarchive Session',
        description: 'Remove archived status from a session.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionStatus(source, session.relPath, 'active');
          return { ok: true, source, relPath: session.relPath, status: 'active' };
        }
      },
      {
        name: 'session-complete',
        title: 'Complete Session',
        description: 'Mark a session as complete.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionStatus(source, session.relPath, 'complete');
          return { ok: true, source, relPath: session.relPath, status: 'complete' };
        }
      },
      {
        name: 'session-reopen',
        title: 'Reopen Session',
        description: 'Remove completion status from a session.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            relPath: { type: 'string' },
            sessionId: { type: 'string' },
            debug: { type: 'boolean' },
          }
        },
        run: async (input) => {
          const source = normalizeSource((input as any)?.source);
          const relPath = toStringOrUndefined((input as any)?.relPath);
          const sessionId = toStringOrUndefined((input as any)?.sessionId);
          const session = await resolveSessionRecord(source, relPath, sessionId);
          await setSessionStatus(source, session.relPath, 'active');
          return { ok: true, source, relPath: session.relPath, status: 'active' };
        }
      }
    ]
  });
}

function normalizeSource(input: unknown): SessionSource {
  const value = typeof input === 'string' ? input.toLowerCase() : '';
  if (value === 'claude' || value === 'copilot' || value === 'codex') {
    return value as SessionSource;
  }
  return DEFAULT_SOURCE;
}

function normalizeMode(input: unknown): 'meta' | 'messages' {
  const value = typeof input === 'string' ? input.toLowerCase() : '';
  if (value === 'messages' || value === 'message') return 'messages';
  return 'meta';
}

function normalizeStatusValue(input: unknown): SessionStatus | undefined {
  if (!input) return undefined;
  return normalizeStatus(input) as SessionStatus;
}

function toNumber(input: unknown): number | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  const value = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function toBoolean(input: unknown): boolean {
  if (input === undefined || input === null || input === '') return false;
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return Boolean(input);
}

function toStringOrUndefined(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'string') return input.trim() || undefined;
  return String(input);
}

function requireString(input: unknown, label: string): string {
  const value = toStringOrUndefined(input);
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requireStatus(input: unknown): SessionStatus | 'active' {
  const value = typeof input === 'string' ? input.toLowerCase() : '';
  if (value === 'active' || value === 'complete' || value === 'archived') {
    return value as SessionStatus | 'active';
  }
  throw new Error('status must be one of: active, complete, archived');
}

async function resolveSessionRecord(source: SessionSource, relPath?: string, sessionId?: string): Promise<SessionRecord> {
  if (relPath) {
    const resolved = resolveSessionPath(source, relPath);
    if (!resolved) {
      throw new Error('Invalid relPath.');
    }
    const sessions = await listSessions(source);
    const match = sessions.find((session) => session.relPath === relPath);
    if (match) {
      return match;
    }
    return {
      id: sessionId || null,
      timestamp: null,
      relPath,
      fileName: relPath,
      name: '',
      messageCount: 0,
      status: 'active',
      tags: [],
      notes: '',
    };
  }
  if (sessionId) {
    const match = await findSessionById(source, sessionId);
    if (!match) {
      throw new Error('Session not found.');
    }
    return match;
  }
  throw new Error('relPath or sessionId is required.');
}
