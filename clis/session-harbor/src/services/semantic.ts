import fs from 'fs';
import path from 'path';

import { generateEmbeddingsOpenAi } from '@innoisotechnology/ai-library';

import type { SessionSource, SessionRecord } from './sessions.js';

export type SemanticMatch = {
  provider: SessionSource;
  relPath: string;
  score: number;
  session?: SessionRecord;
};

type SessionEmbeddingRecord = {
  provider: SessionSource;
  relPath: string;
  sessionPath: string;
  updated_at: string;
  content_hash: string;
  embedding: number[];
};

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function recordKey(provider: SessionSource, relPath: string) {
  return `${provider}:${relPath}`;
}

export async function loadSessionEmbeddings(dataDir: string): Promise<Map<string, SessionEmbeddingRecord>> {
  const file = path.join(dataDir, 'session-embeddings.jsonl');
  const index = new Map<string, SessionEmbeddingRecord>();
  let raw = '';
  try {
    raw = await fs.promises.readFile(file, 'utf8');
  } catch {
    return index;
  }

  raw
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      try {
        const rec = JSON.parse(line) as SessionEmbeddingRecord;
        if (!rec?.provider || !rec?.relPath || !Array.isArray(rec?.embedding)) return;
        index.set(recordKey(rec.provider, rec.relPath), rec);
      } catch {
        // ignore
      }
    });

  return index;
}

export async function semanticSearchSessions(params: {
  dataDir: string;
  query: string;
  limit?: number;
  sessionsByProvider?: {
    codex?: SessionRecord[];
    claude?: SessionRecord[];
    copilot?: SessionRecord[];
  };
}): Promise<SemanticMatch[]> {
  if (!process.env.OPENAI_API_KEY) {
    const err: any = new Error('OPENAI_API_KEY is required for semantic search.');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }

  const index = await loadSessionEmbeddings(params.dataDir);
  const records = Array.from(index.values());
  if (!records.length) {
    return [];
  }

  const vectors = await generateEmbeddingsOpenAi([params.query]);
  const qvec = vectors?.[0];
  if (!qvec || !Array.isArray(qvec)) {
    throw new Error('Failed to generate query embedding.');
  }

  const limit = Math.max(1, Math.min(Number(params.limit) || 10, 50));

  const codexMap = new Map((params.sessionsByProvider?.codex || []).map((s) => [s.relPath, s]));
  const claudeMap = new Map((params.sessionsByProvider?.claude || []).map((s) => [s.relPath, s]));
  const copilotMap = new Map((params.sessionsByProvider?.copilot || []).map((s) => [s.relPath, s]));

  return records
    .map((rec) => {
      const session = rec.provider === 'claude'
        ? claudeMap.get(rec.relPath)
        : rec.provider === 'copilot'
          ? copilotMap.get(rec.relPath)
          : codexMap.get(rec.relPath);

      return {
        provider: rec.provider,
        relPath: rec.relPath,
        score: cosineSimilarity(qvec, rec.embedding),
        session,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
