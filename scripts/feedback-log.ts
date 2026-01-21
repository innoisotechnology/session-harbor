#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_EXT = '.jsonl';
const FEEDBACK_FILE = path.join(process.cwd(), 'data', 'feedback.jsonl');

const SUCCESS_PATTERNS = [
  /\bthanks\b/i,
  /\bthank you\b/i,
  /\bthat works\b/i,
  /\bperfect\b/i,
  /\bgreat\b/i,
  /\bawesome\b/i,
  /\bsolved\b/i,
  /\bfixed\b/i,
  /\bworks now\b/i,
];

const FAILURE_PATTERNS = [
  /\bnot working\b/i,
  /\bdoesn't work\b/i,
  /\bwrong\b/i,
  /\bnot what I asked\b/i,
  /\bstill broken\b/i,
  /\berror\b/i,
];

const LOG_LIKE_PATTERNS = [
  /tool_use_id/i,
  /tool_result/i,
  /"type":"tool_/i,
  /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i,
];

function parseArgs(argv: string[]) {
  const args: { source: string; file?: string; latest?: boolean; manual?: boolean; input?: string } = { source: 'codex' };
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
    } else if (token === '--manual') {
      args.manual = true;
    } else if (token === '--input') {
      args.input = tokens[i + 1];
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
    'Feedback logger',
    '',
    'Usage:',
    '  tsx scripts/feedback-log.ts --source codex|claude --file <relPath>',
    '  tsx scripts/feedback-log.ts --source codex|claude --latest',
    '  tsx scripts/feedback-log.ts --manual --input <path>',
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

type ParsedMessage = { role: string; text: string; timestamp?: string | null };

async function readMessages(filePath: string, source: string): Promise<ParsedMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: ParsedMessage[] = [];
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
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
            if (!text) return;
            messages.push({ role, text, timestamp: parsed.timestamp || null });
          }
          return;
        }
        if (parsed.type === 'response_item') {
          const payload = parsed.payload;
          if (!payload || payload.type !== 'message') return;
          const role = payload.role || 'assistant';
          const text = normalizeMessageContent(payload.content).trim();
          if (!text) return;
          messages.push({ role, text, timestamp: parsed.timestamp || null });
        }
        return;
      }

      if (!parsed || !parsed.type) return;
      if (parsed.type === 'summary' && parsed.summary) {
        messages.push({ role: 'summary', text: String(parsed.summary).trim(), timestamp: parsed.timestamp || null });
        return;
      }
      if (parsed.type !== 'user' && parsed.type !== 'assistant') return;
      const message = parsed.message || {};
      const role = message.role || parsed.type || 'unknown';
      const text = normalizeMessageContent(message.content).trim();
      if (!text) return;
      messages.push({ role, text, timestamp: parsed.timestamp || null });
    });

    rl.on('close', () => resolve(messages));
    rl.on('error', reject);
    stream.on('error', reject);
  });
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

function matchesAny(text: string, patterns: RegExp[]) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function canonicalizeText(text: string) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function extractSnippet(lines: string[], index: number, radius = 1) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join('\n');
}

function shouldSkipMessageText(text: string) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(lowered))) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"type":"thinking"')) return true;
  return false;
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

function deriveFeedback(messages: ParsedMessage[], transcript: string, observations: any[]) {
  let successCount = 0;
  let failureCount = 0;
  const successSnippets: string[] = [];
  const failureSnippets: string[] = [];

  messages.forEach((message) => {
    if (message.role !== 'user') return;
    if (matchesAny(message.text, SUCCESS_PATTERNS)) {
      successCount += 1;
      successSnippets.push(message.text.slice(0, 240));
    }
    if (matchesAny(message.text, FAILURE_PATTERNS)) {
      failureCount += 1;
      failureSnippets.push(message.text.slice(0, 240));
    }
  });

  let label: 'positive' | 'negative' | 'mixed' = 'mixed';
  if (successCount > 0 && failureCount === 0) label = 'positive';
  if (failureCount > 0 && successCount === 0) label = 'negative';

  const wentWell: string[] = [];
  const needsImprovement: string[] = [];

  if (successCount > 0) {
    wentWell.push('User acknowledged success or completion.');
  }
  if (observations.length > 0) {
    needsImprovement.push(...observations.map((obs) => obs.title));
  }
  if (failureCount > 0) {
    needsImprovement.push('User reported issues or failures.');
  }

  const snippets = [...successSnippets, ...failureSnippets];

  return { label, wentWell, needsImprovement, snippets };
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

async function main() {
  const args = parseArgs(process.argv);

  if (args.manual) {
    if (!args.input) {
      console.error('Manual mode requires --input <path>.');
      process.exit(1);
    }
    const raw = await fs.promises.readFile(path.resolve(args.input), 'utf8');
    const parsed = JSON.parse(raw);
    const entry = normalizeManualEntry(parsed);
    const { transcript, ...entryToLog } = entry as any;
    await fs.promises.mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
    await fs.promises.appendFile(FEEDBACK_FILE, `${JSON.stringify(entryToLog)}\n`);
    console.log(`Feedback logged for ${entry.source}:${entry.relPath}`);
    return;
  }

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
  const messages = await readMessages(fullPath, source);
  const rawLines = await gatherRawLines(fullPath);
  const transcript = buildCompressedTranscript(rawLines, source);
  const observations = extractObservationsFromTranscript(transcript);
  const feedback = deriveFeedback(messages, transcript, observations);

  const entry = {
    createdAt: new Date().toISOString(),
    source,
    relPath,
    label: feedback.label,
    wentWell: feedback.wentWell,
    needsImprovement: feedback.needsImprovement,
    snippets: feedback.snippets,
    observations
  };

  await fs.promises.mkdir(path.dirname(FEEDBACK_FILE), { recursive: true });
  await fs.promises.appendFile(FEEDBACK_FILE, `${JSON.stringify(entry)}\n`);
  console.log(`Feedback logged for ${source}:${relPath}`);
}

function normalizeManualEntry(entry: any) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Manual entry must be a JSON object.');
  }
  const source = entry.source === 'claude' ? 'claude' : 'codex';
  const relPath = String(entry.relPath || '').trim();
  if (!relPath) {
    throw new Error('Manual entry requires relPath.');
  }
  const label = entry.label === 'positive' || entry.label === 'negative' || entry.label === 'mixed'
    ? entry.label
    : 'mixed';
  const wentWell = Array.isArray(entry.wentWell) ? entry.wentWell : [];
  const needsImprovement = Array.isArray(entry.needsImprovement) ? entry.needsImprovement : [];
  const snippets = Array.isArray(entry.snippets) ? entry.snippets : [];
  const observations = Array.isArray(entry.observations) ? entry.observations : [];

  return {
    createdAt: entry.createdAt ? String(entry.createdAt) : new Date().toISOString(),
    source,
    relPath,
    label,
    wentWell,
    needsImprovement,
    snippets,
    observations,
    transcript: entry.transcript
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
