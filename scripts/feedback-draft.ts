#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_EXT = '.jsonl';
const DRAFT_DIR = path.join(process.cwd(), 'data', 'feedback-drafts');

function parseArgs(argv: string[]) {
  const args: { source: string; file?: string; latest?: boolean; out?: string } = { source: 'codex' };
  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--source') {
      args.source = tokens[i + 1] || 'codex';
      i += 1;
    } else if (token === '--file') {
      args.file = tokens[i + 1];
      i += 1;
    } else if (token === '--latest') {
      args.latest = true;
    } else if (token === '--out') {
      args.out = tokens[i + 1];
      i += 1;
    } else if (token === '--help') {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  const text = [
    'Feedback draft generator',
    '',
    'Usage:',
    '  tsx scripts/feedback-draft.ts --source codex|claude --file <relPath>',
    '  tsx scripts/feedback-draft.ts --source codex|claude --latest',
    '  tsx scripts/feedback-draft.ts --source codex|claude --file <relPath> --out <path>',
  ];
  console.log(text.join('\n'));
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
      files.push(...(await listSessionFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(SESSION_EXT)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function findLatestSession(source: string) {
  const dir = source === 'claude' ? CLAUDE_DIR : CODEX_DIR;
  const files = await listSessionFiles(dir);
  let latest: { filePath: string; mtime: number } | null = null;
  for (const filePath of files) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      continue;
    }
    const mtime = stat.mtime.getTime();
    if (!latest || mtime > latest.mtime) {
      latest = { filePath, mtime };
    }
  }
  return latest?.filePath || null;
}

async function gatherRawLines(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => lines.push(line));
    rl.on('close', () => resolve(lines));
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
    if (item.type === 'tool_use') {
      const name = item.name || 'tool';
      const input = item.input ? JSON.stringify(item.input) : '';
      parts.push(`[tool:${name}] ${input}`.trim());
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

const LOG_LIKE_PATTERNS = [
  /tool_use_id/i,
  /tool_result/i,
  /"type":"tool_/i,
  /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i,
];

function shouldSkipMessageText(text: string) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(lowered))) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"type":"thinking"')) return true;
  return false;
}

function canonicalizeText(text: string) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function buildCompressedTranscript(rawLines: string[], source: string) {
  const lines: string[] = [];
  rawLines.forEach((line) => {
    if (!line) return;
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      return;
    }

    if (source === 'codex') {
      if (parsed.type === 'event_msg') {
        const payload = parsed.payload || {};
        if (payload.type === 'user_message' || payload.type === 'assistant_message') {
          const role = payload.type === 'assistant_message' ? 'assistant' : 'user';
          const text = String(payload.message || '').trim();
          if (text && !shouldSkipMessageText(text)) lines.push(`${role}: ${text}`);
        }
        return;
      }
      if (parsed.type === 'response_item') {
        const payload = parsed.payload || {};
        if (payload.type === 'message') {
          const role = payload.role || 'assistant';
          const text = normalizeMessageContent(payload.content).trim();
          if (text && !shouldSkipMessageText(text)) lines.push(`${role}: ${text}`);
          return;
        }
        if (payload.type === 'tool_use') {
          const name = payload.name || 'tool';
          const input = payload.input ? JSON.stringify(payload.input) : '';
          lines.push(`tool:${name} ${input}`.trim());
        }
      }
      return;
    }

    if (!parsed || !parsed.type) return;
    if (parsed.type === 'user' || parsed.type === 'assistant') {
      const message = parsed.message || {};
      const role = message.role || parsed.type || 'unknown';
      const text = normalizeMessageContent(message.content).trim();
      if (text && !shouldSkipMessageText(text)) lines.push(`${role}: ${text}`);
      return;
    }
    if (parsed.type === 'summary' && parsed.summary) {
      const text = String(parsed.summary).trim();
      if (text && !shouldSkipMessageText(text)) lines.push(`summary: ${text}`);
    }
  });

  return lines.map((line) => canonicalizeText(line)).filter(Boolean).join('\n');
}

function extractSnippet(lines: string[], index: number, radius = 1) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join('\n');
}

function extractObservationsFromTranscript(transcript: string) {
  if (!transcript) return [] as any[];
  const lines = transcript.split('\n').filter(Boolean);
  const observations: any[] = [];
  const seen = new Set<string>();

  const rules = [
    {
      id: 'dedupe-repeat',
      title: 'Deduplicate repeated user requests',
      tags: ['workflow', 'efficiency'],
      pattern: /user: (.+)/i,
      check: (line: string, idx: number) => {
        const match = line.match(/user:\s*(.+)/i);
        if (!match) return false;
        const current = match[1].trim();
        const next = lines[idx + 1];
        if (!next) return false;
        const nextMatch = next.match(/user:\s*(.+)/i);
        if (!nextMatch) return false;
        return current && current === nextMatch[1].trim();
      },
      rationale: 'The same user instruction appears twice in a row, creating redundant execution.'
    },
    {
      id: 'migration-discipline',
      title: 'Never edit prior migrations',
      tags: ['schema', 'process'],
      pattern: /editing a previous migration|create a new one/i,
      rationale: 'Editing prior migrations introduces history rewrites and deploy risk.'
    },
    {
      id: 'runtime-validate',
      title: 'Confirm runtime state before retry loops',
      tags: ['ops', 'debugging'],
      pattern: /still 404|did you restart|running server/i,
      rationale: 'Retrying endpoints without verifying runtime state creates avoidable churn.'
    },
    {
      id: 'aggregate-over-bulk',
      title: 'Prefer aggregate endpoints over bulk row fetches',
      tags: ['performance', 'backend'],
      pattern: /bulk api call batching|_in operator|dedicated api instead/i,
      rationale: 'Large client-side fetches create long URLs and heavy payloads.'
    },
    {
      id: 'scope-checkpoint',
      title: 'Add checkpoints when scope expands',
      tags: ['workflow', 'planning'],
      pattern: /ALOT MORE|keep going|tour the entire experience/i,
      rationale: 'Scope expansion without checkpoints causes drift and weak outcomes.'
    },
    {
      id: 'log-cleanup',
      title: 'Clear debug logs and warnings early',
      tags: ['frontend', 'quality'],
      pattern: /remove all of these logs|console noise|form-field warnings/i,
      rationale: 'Debug logs and form warnings add noise and delay completion.'
    }
  ];

  lines.forEach((line, idx) => {
    rules.forEach((rule) => {
      if (!rule.pattern.test(line)) return;
      if (rule.check && !rule.check(line, idx)) return;
      const snippet = extractSnippet(lines, idx);
      const key = `${rule.id}:${snippet}`;
      if (seen.has(key)) return;
      seen.add(key);
      observations.push({
        id: rule.id,
        title: rule.title,
        tags: rule.tags,
        rationale: rule.rationale,
        snippet
      });
    });
  });

  return observations;
}

function buildDefaultOutputPath(relPath: string) {
  const base = path.basename(relPath).replace(/\.jsonl$/i, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(DRAFT_DIR, `${base}-${stamp}.json`);
}

async function main() {
  const args = parseArgs(process.argv);
  const source = args.source === 'claude' ? 'claude' : 'codex';
  const baseDir = source === 'claude' ? CLAUDE_DIR : CODEX_DIR;

  let relPath = args.file;
  if (!relPath && args.latest) {
    const latestFile = await findLatestSession(source);
    if (!latestFile) {
      console.error('No sessions found.');
      process.exit(1);
    }
    relPath = path.relative(baseDir, latestFile);
  }
  if (!relPath) {
    printHelp();
    process.exit(1);
  }

  const fullPath = path.resolve(baseDir, relPath);
  const rawLines = await gatherRawLines(fullPath);
  const transcript = buildCompressedTranscript(rawLines, source);
  const observations = extractObservationsFromTranscript(transcript);

  const entry = {
    createdAt: new Date().toISOString(),
    source,
    relPath,
    label: 'mixed',
    wentWell: [],
    needsImprovement: [],
    snippets: [],
    observations,
    transcript
  };

  const outPath = args.out ? path.resolve(args.out) : buildDefaultOutputPath(relPath);
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, `${JSON.stringify(entry, null, 2)}\n`);

  console.log(`Draft created: ${outPath}`);
  console.log(`Edit fields, then run: npm run feedback:log -- --manual --input ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
