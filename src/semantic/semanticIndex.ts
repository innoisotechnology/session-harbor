import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import readline from 'readline';

import { generateOpenAiEmbeddings } from './openaiEmbeddings';

export type SessionSource = 'codex' | 'claude' | 'copilot';

export type SessionEmbeddingRecord = {
  provider: SessionSource;
  relPath: string;
  sessionPath: string;
  updated_at: string;
  content_hash: string;
  embedding: number[];
  model?: string;
};

export type IndexStats = {
  scanned: number;
  embedded: number;
  skipped: number;
  errors: number;
  wrote: number;
};

export type SemanticSearchResult = {
  provider: SessionSource;
  relPath: string;
  sessionPath: string;
  score: number;
};

export type SemanticIndexOptions = {
  dataDir: string;
  sessionsDir: string;
  claudeDir: string;
  copilotDir: string;
  maxCharsPerSession?: number;
  maxMessagesPerSession?: number;
  embedDelayMs?: number;
};

const DEFAULT_EMBED_DELAY_MS = 250;
const DEFAULT_MAX_CHARS = 20_000;
const DEFAULT_MAX_MESSAGES = 80;

function embeddingsFile(dataDir: string) {
  return path.join(dataDir, 'session-embeddings.jsonl');
}

function recordKey(provider: SessionSource, relPath: string) {
  return `${provider}:${relPath}`;
}

async function listJsonlFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === 'archive') continue;
        await walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  }
  await walk(rootDir);
  return results;
}

async function readJsonlTextForEmbedding(fullPath: string, provider: SessionSource, maxMessages: number, maxChars: number): Promise<string> {
  const stream = fs.createReadStream(fullPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const parts: string[] = [];
  let seenMessages = 0;
  let charCount = 0;

  const push = (label: string, text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    const line = `${label}: ${cleaned}`;
    parts.push(line);
    charCount += line.length + 1;
    seenMessages += 1;
  };

  for await (const line of rl) {
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (provider === 'claude') {
      if (entry?.type === 'summary' && entry?.summary) {
        push('summary', String(entry.summary));
      }
      if (entry?.type === 'user' || entry?.type === 'assistant') {
        const msg = entry?.message || {};
        const content = normalizeMessageContent(msg.content);
        push(entry.type, content);
      }
    } else if (provider === 'copilot') {
      if (entry?.type === 'user.message' || entry?.type === 'assistant.message') {
        const data = entry?.data || {};
        const content = String(data.content || data.transformedContent || '');
        push(entry.type === 'user.message' ? 'user' : 'assistant', content);
      }
    } else {
      if (entry?.type === 'response_item') {
        const payload = entry?.payload;
        if (payload?.type === 'message') {
          const content = normalizeMessageContent(payload.content);
          push('assistant', content);
        }
      }
      if (entry?.type === 'event_msg') {
        const t = entry?.payload?.type;
        if (t === 'user_message' || t === 'assistant_message') {
          push(t === 'user_message' ? 'user' : 'assistant', String(entry?.payload?.message || ''));
        }
      }
    }

    if (seenMessages >= maxMessages) break;
    if (charCount >= maxChars) break;
  }

  rl.close();
  stream.destroy();

  return parts.join('\n').slice(0, maxChars);
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

function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadEmbeddingIndex(dataDir: string): Promise<Map<string, SessionEmbeddingRecord>> {
  const file = embeddingsFile(dataDir);
  const map = new Map<string, SessionEmbeddingRecord>();
  let raw = '';
  try {
    raw = await fs.promises.readFile(file, 'utf8');
  } catch {
    return map;
  }

  raw
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      try {
        const rec = JSON.parse(line) as SessionEmbeddingRecord;
        if (!rec?.provider || !rec?.relPath || !Array.isArray(rec?.embedding)) return;
        map.set(recordKey(rec.provider, rec.relPath), rec);
      } catch {
        // ignore malformed line
      }
    });

  return map;
}

async function saveEmbeddingIndex(dataDir: string, index: Map<string, SessionEmbeddingRecord>) {
  await fs.promises.mkdir(dataDir, { recursive: true });
  const file = embeddingsFile(dataDir);
  const lines = Array.from(index.values())
    .sort((a, b) => recordKey(a.provider, a.relPath).localeCompare(recordKey(b.provider, b.relPath)))
    .map((rec) => JSON.stringify(rec));
  await fs.promises.writeFile(file, lines.join('\n') + (lines.length ? '\n' : ''));
  return lines.length;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function indexSessionEmbeddingsIncremental(options: SemanticIndexOptions): Promise<IndexStats> {
  if (!process.env.OPENAI_API_KEY) {
    const err: any = new Error('OPENAI_API_KEY is required for semantic indexing.');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }

  const maxChars = options.maxCharsPerSession ?? DEFAULT_MAX_CHARS;
  const maxMessages = options.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES;
  const embedDelayMs = options.embedDelayMs ?? DEFAULT_EMBED_DELAY_MS;

  const index = await loadEmbeddingIndex(options.dataDir);

  const sources: Array<{ provider: SessionSource; root: string }> = [
    { provider: 'codex', root: options.sessionsDir },
    { provider: 'claude', root: options.claudeDir },
    { provider: 'copilot', root: options.copilotDir },
  ];

  const stats: IndexStats = { scanned: 0, embedded: 0, skipped: 0, errors: 0, wrote: 0 };

  for (const src of sources) {
    const files = await listJsonlFiles(src.root);
    for (const fullPath of files) {
      stats.scanned += 1;
      const relPath = path.relative(src.root, fullPath);
      const key = recordKey(src.provider, relPath);

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch {
        stats.errors += 1;
        continue;
      }

      let text = '';
      try {
        text = await readJsonlTextForEmbedding(fullPath, src.provider, maxMessages, maxChars);
      } catch {
        stats.errors += 1;
        continue;
      }

      const content_hash = sha256(text);
      const existing = index.get(key);
      if (existing && existing.content_hash === content_hash) {
        stats.skipped += 1;
        continue;
      }

      try {
        const vectors = await generateOpenAiEmbeddings([text]);
        const embedding = vectors?.[0];
        if (!embedding || !Array.isArray(embedding)) {
          throw new Error('Embedding generation returned empty result.');
        }
        index.set(key, {
          provider: src.provider,
          relPath,
          sessionPath: fullPath,
          updated_at: stat.mtime.toISOString(),
          content_hash,
          embedding,
          model: 'text-embedding-3-small',
        });
        stats.embedded += 1;
        await sleep(embedDelayMs);
      } catch (err: any) {
        stats.errors += 1;
        // Log a short error once per file to aid debugging (avoid dumping full API key or giant bodies)
        const msg = err?.message ? String(err.message).slice(0, 500) : String(err).slice(0, 500);
        console.warn(`Semantic index embed failed (${src.provider}:${relPath}): ${msg}`);
      }
    }
  }

  stats.wrote = await saveEmbeddingIndex(options.dataDir, index);
  return stats;
}

export async function semanticSearch(options: SemanticIndexOptions & { query: string; limit?: number }): Promise<SemanticSearchResult[]> {
  if (!process.env.OPENAI_API_KEY) {
    const err: any = new Error('OPENAI_API_KEY is required for semantic search.');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }

  const index = await loadEmbeddingIndex(options.dataDir);
  const records = Array.from(index.values());
  if (!records.length) return [];

  const vectors = await generateOpenAiEmbeddings([options.query]);
  const qvec = vectors?.[0];
  if (!qvec || !Array.isArray(qvec)) {
    throw new Error('Failed to generate query embedding.');
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 10, 50));
  const scored: SemanticSearchResult[] = records
    .map((rec) => {
      return {
        provider: rec.provider,
        relPath: rec.relPath,
        sessionPath: rec.sessionPath,
        score: cosineSimilarity(qvec, rec.embedding),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}
