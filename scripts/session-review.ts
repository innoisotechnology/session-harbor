#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const CODEX_DIR = path.join(os.homedir(), '.codex', 'sessions');
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_EXT = '.jsonl';

const SUCCESS_PATTERNS = [
  /\bthanks\b/i,
  /\bthank you\b/i,
  /\bthat works\b/i,
  /\bperfect\b/i,
  /\bgreat\b/i,
  /\bawesome\b/i,
  /\bsolved\b/i,
  /\bfixed\b/i,
  /\bexactly\b/i,
  /\bworks now\b/i,
  /\btests? passed\b/i,
  /\bbuild succeeded\b/i,
  /\bdeploy(ed)? successfully\b/i,
  /\bmerged\b/i,
  /\bshipped\b/i,
];

const FAILURE_PATTERNS = [
  /\bnot working\b/i,
  /\bdoesn't work\b/i,
  /\bdoes not work\b/i,
  /\bwrong\b/i,
  /\bno\b/i,
  /\bnot what I asked\b/i,
  /\bstill broken\b/i,
  /\bfails\b/i,
  /\berror\b/i,
  /\btests? failed\b/i,
  /\bbuild failed\b/i,
  /\bdeploy(ed)? failed\b/i,
];

const TAG_KEYWORDS = {
  tests: ['test', 'tests', 'jest', 'vitest', 'pytest'],
  bugfix: ['bug', 'fix', 'issue', 'error', 'crash'],
  refactor: ['refactor', 'cleanup', 'restructure'],
  performance: ['performance', 'slow', 'optimize'],
  ui: ['ui', 'css', 'frontend', 'layout', 'design'],
  api: ['api', 'endpoint', 'http', 'request'],
  ops: ['deploy', 'docker', 'ci', 'pipeline', 'infra'],
  types: ['typescript', 'typecheck', 'types'],
  data: ['database', 'sql', 'query', 'migration'],
};

const INSTRUCTION_TOKENS = [
  'always',
  'never',
  'please',
  'make sure',
  'do not',
  "don't",
  'next time',
];

const INSTRUCTION_BLACKLIST = [
  'please proceed with the current tasks if applicable',
];

const ACTION_KEYWORDS = [
  'fix',
  'update',
  'add',
  'remove',
  'replace',
  'refactor',
  'implement',
  'design',
  'redesign',
  'align',
  'test',
  'build',
  'deploy',
  'run',
  'rename',
  'adjust',
  'configure',
  'migrate',
];

const PAST_ACTION_KEYWORDS = [
  'updated',
  'fixed',
  'added',
  'removed',
  'replaced',
  'refactored',
  'implemented',
  'designed',
  'redesigned',
  'aligned',
  'tested',
  'built',
  'deployed',
  'ran',
  'renamed',
  'adjusted',
  'configured',
  'migrated',
  'completed',
  'created',
  'resolved',
];

const SYSTEM_REMINDER_PATTERNS = [
  /<system-reminder>/i,
  /system reminder/i,
];

const LOG_LIKE_PATTERNS = [
  /tool_use_id/i,
  /tool_result/i,
  /"type":"tool_/i,
  /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}/i,
  /\berror\b/i,
  /\bno such container\b/i,
  /\bimage not found\b/i,
];

const PREFERENCE_PATTERNS = [
  /\bi don't like\b/i,
  /\bi do not like\b/i,
  /\bi prefer\b/i,
  /\bi'd like\b/i,
  /\bplease make it\b/i,
  /\bstyle\b/i,
  /\bdesign\b/i,
];

const TASK_BREAK_PATTERNS = [
  /\bnext\b/i,
  /\balso\b/i,
  /\banother\b/i,
  /\binstead\b/i,
  /\bseparately\b/i,
  /\bnew task\b/i,
  /\bwhile you're at it\b/i,
  /\bone more\b/i,
  /\bnow can you\b/i,
  /\bactually\b/i,
];

const FAILURE_CLUSTERS = [
  { key: 'tests', patterns: [/test/i, /jest/i, /vitest/i, /pytest/i] },
  { key: 'deploy', patterns: [/deploy/i, /amplify/i, /ci/i, /pipeline/i] },
  { key: 'auth', patterns: [/auth/i, /oauth/i, /token/i, /login/i] },
  { key: 'tooling', patterns: [/tool/i, /command/i, /exit code/i, /is_error/i] },
  { key: 'data', patterns: [/sql/i, /db/i, /database/i, /migration/i] },
  { key: 'ui', patterns: [/ui/i, /design/i, /css/i, /layout/i] },
  { key: 'performance', patterns: [/perf/i, /slow/i, /optimi/i] },
];

function isLikelyCodeDump(text) {
  if (!text) return false;
  const lines = text.split('\n');
  if (lines.length >= 8) return true;
  const braceCount = (text.match(/[{}]/g) || []).length;
  if (braceCount >= 8) return true;
  if (text.includes('```')) return true;
  if (text.includes('</') || text.includes('/>')) return true;
  return false;
}

function isLikelyToolPayload(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  if (trimmed.includes('"type":"tool_use"')) return true;
  if (trimmed.includes('"name":"Bash"') || trimmed.includes('"name":"Write"')) return true;
  return false;
}

function isLowSignalTurn(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length < 20) return true;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('let me ')) return true;
  if (lowered.startsWith("i'll ")) return true;
  if (lowered.startsWith('i will ')) return true;
  if (lowered.startsWith("now i'll ")) return true;
  if (lowered.startsWith('now i will ')) return true;
  if (lowered.startsWith('now let me ')) return true;
  if (lowered.startsWith('i found ')) return true;
  if (lowered.startsWith('now i need to ')) return true;
  const hasAction = ACTION_KEYWORDS.some((keyword) => lowered.includes(keyword));
  return !hasAction;
}

function sanitizeSentence(text) {
  if (!text) return '';
  return text
    .replace(/[>"'}]+$/g, '')
    .replace(/^[{"']+/, '')
    .trim();
}

function canonicalizeText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function extractPreferenceIdeas(messages) {
  const ideas = [];
  const seen = new Set();
  messages.forEach((message) => {
    if (message.role !== 'user') return;
    const lowered = message.text.toLowerCase();
    if (!PREFERENCE_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (SYSTEM_REMINDER_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (isLikelyCodeDump(message.text)) return;
    const sentences = message.text.split(/[.!?]/g).map((part) => part.trim()).filter(Boolean);
    sentences.forEach((sentence) => {
      const cleaned = canonicalizeText(sanitizeSentence(sentence));
      const sentenceLower = cleaned.toLowerCase();
      if (!PREFERENCE_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (SYSTEM_REMINDER_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (isLikelyCodeDump(sentence)) return;
      if (cleaned.length > 240) return;
      if (seen.has(sentenceLower)) return;
      seen.add(sentenceLower);
      ideas.push(cleaned);
    });
  });
  return ideas.slice(0, 12);
}

function firstTwoSentences(text) {
  if (!text) return '';
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!parts.length) return text.trim();
  return parts.slice(0, 2).join(' ').trim();
}

function segmentTasks(messages) {
  const tasks = [];
  let current = null;
  messages.forEach((message, idx) => {
    if (message.role !== 'user') return;
    const lowered = message.text.toLowerCase();
    const shouldSplit = !current || TASK_BREAK_PATTERNS.some((pattern) => pattern.test(lowered));
    if (shouldSplit) {
      if (current) {
        current.end = idx - 1;
        tasks.push(current);
      }
      current = { start: idx, end: messages.length - 1 };
    }
  });
  if (current) tasks.push(current);
  return tasks.length ? tasks : [{ start: 0, end: messages.length - 1 }];
}

function extractToolSignals(rawLines) {
  const signals = {
    commands: [],
    errors: [],
    successes: [],
  };
  rawLines.forEach((line) => {
    if (!line) return;
    if (line.includes('"command"')) {
      const match = line.match(/"command":"([^"]+)"/);
      if (match) signals.commands.push(match[1]);
    }
    if (/"exit_code":\s*\d+/.test(line)) {
      const match = line.match(/"exit_code":\s*(\d+)/);
      if (match) {
        const code = Number(match[1]);
        if (code === 0) {
          signals.successes.push(`exit_code:${code}`);
        } else {
          signals.errors.push(`exit_code:${code}`);
        }
      }
    }
    if (/"is_error":\s*true/.test(line)) {
      signals.errors.push('tool_error:true');
    }
    if (/"status":"failed"/i.test(line)) {
      signals.errors.push('status:failed');
    }
    if (/"status":"success"/i.test(line)) {
      signals.successes.push('status:success');
    }
  });
  return signals;
}

function extractRepoSignals(rawLines) {
  const signals = {
    changes: 0,
    clean: 0,
    reverts: 0,
  };
  rawLines.forEach((line) => {
    if (!line) return;
    if (/working tree clean/i.test(line) || /nothing to commit/i.test(line)) {
      signals.clean += 1;
    }
    if (/files changed/i.test(line) || /create mode/i.test(line) || /rename from/i.test(line) || /diff --git/i.test(line)) {
      signals.changes += 1;
    }
    if (/git reset --hard/i.test(line) || /git checkout --/i.test(line) || /\brevert\b/i.test(line)) {
      signals.reverts += 1;
    }
  });
  return signals;
}

function gatherRawLines(filePath: string): Promise<string[]> {
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

function classifyFailures(texts) {
  const counts = new Map();
  texts.forEach((text) => {
    const lowered = text.toLowerCase();
    let matched = false;
    FAILURE_CLUSTERS.forEach((cluster) => {
      if (cluster.patterns.some((pattern) => pattern.test(lowered))) {
        counts.set(cluster.key, (counts.get(cluster.key) || 0) + 1);
        matched = true;
      }
    });
    if (!matched) {
      counts.set('other', (counts.get('other') || 0) + 1);
    }
  });
  return counts;
}

function sanitizeReportName(value) {
  if (!value) return 'report';
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
}

function formatToolInput(input) {
  if (!input) return '';
  let serialized = '';
  try {
    serialized = JSON.stringify(input);
  } catch (err) {
    serialized = String(input);
  }
  if (serialized.length > 600) {
    return `${serialized.slice(0, 600)}…`;
  }
  return serialized;
}

function shouldSkipMessageText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  const lowered = trimmed.toLowerCase();
  if (isLikelyToolPayload(trimmed)) return true;
  if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(lowered))) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"type":"thinking"')) return true;
  if (trimmed.startsWith('{') && trimmed.includes('"signature"')) return true;
  return false;
}

function buildCompressedTranscript(rawLines, source) {
  const lines = [];
  rawLines.forEach((line) => {
    if (!line) return;
    let parsed;
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
          const input = formatToolInput(payload.input);
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
      if (text && !shouldSkipMessageText(text)) {
        lines.push(`summary: ${text}`);
      }
    }
  });

  const filtered = lines
    .map((entry) => canonicalizeText(entry))
    .filter(Boolean);
  return filtered.join('\n');
}

function extractSnippet(lines, index, radius = 1) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length, index + radius + 1);
  return lines.slice(start, end).join('\n');
}

function extractObservationsFromTranscript(transcript) {
  if (!transcript) return [];
  const lines = transcript.split('\n').filter(Boolean);
  const observations = [];
  const seen = new Set();

  const rules = [
    {
      id: 'dedupe-repeat',
      title: 'Deduplicate repeated user requests',
      tags: ['workflow', 'efficiency'],
      pattern: /user: (.+)/i,
      check: (line, idx) => {
        const match = line.match(/user:\s*(.+)/i);
        if (!match) return false;
        const current = match[1].trim();
        const next = lines[idx + 1];
        if (!next) return false;
        const nextMatch = next.match(/user:\s*(.+)/i);
        if (!nextMatch) return false;
        return current && current === nextMatch[1].trim();
      },
      rationale: 'The same user instruction appears twice in a row, creating redundant execution.',
    },
    {
      id: 'migration-discipline',
      title: 'Never edit prior migrations',
      tags: ['schema', 'process'],
      pattern: /editing a previous migration|create a new one/i,
      rationale: 'Editing prior migrations introduces history rewrites and deploy risk.',
    },
    {
      id: 'runtime-validate',
      title: 'Confirm runtime state before retry loops',
      tags: ['ops', 'debugging'],
      pattern: /still 404|did you restart|running server/i,
      rationale: 'Retrying endpoints without verifying runtime state creates avoidable churn.',
    },
    {
      id: 'aggregate-over-bulk',
      title: 'Prefer aggregate endpoints over bulk row fetches',
      tags: ['performance', 'backend'],
      pattern: /bulk api call batching|_in operator|dedicated api instead/i,
      rationale: 'Large client-side fetches create long URLs and heavy payloads.',
    },
    {
      id: 'scope-checkpoint',
      title: 'Add checkpoints when scope expands',
      tags: ['workflow', 'planning'],
      pattern: /ALOT MORE|keep going|tour the entire experience/i,
      rationale: 'Scope expansion without checkpoints causes drift and weak outcomes.',
    },
    {
      id: 'log-cleanup',
      title: 'Clear debug logs and warnings early',
      tags: ['frontend', 'quality'],
      pattern: /remove all of these logs|console noise|form-field warnings/i,
      rationale: 'Debug logs and form warnings add noise and delay completion.',
    },
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
        snippet,
      });
    });
  });

  return observations;
}

function parseArgs(argv) {
  const args = {
    source: 'both',
    limit: 0,
    outDir: '',
    compress: 5,
  };
  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--source') {
      args.source = tokens[i + 1] || 'both';
      i += 1;
    } else if (token === '--limit') {
      args.limit = Number(tokens[i + 1] || 0);
      i += 1;
    } else if (token === '--out') {
      args.outDir = tokens[i + 1] || '';
      i += 1;
    } else if (token === '--compress') {
      args.compress = Number(tokens[i + 1] || 0);
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
    'Session review CLI',
    '',
    'Usage:',
    '  node scripts/session-review.js [--source codex|claude|both] [--limit N] [--out DIR] [--compress N]',
    '',
    'Examples:',
    '  node scripts/session-review.js --source codex --limit 50',
    '  node scripts/session-review.js --source both --out reports/custom',
    '  node scripts/session-review.js --compress 10',
  ];
  console.log(text.join('\n'));
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
      let parsed;
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
        messages.push({
          role: 'summary',
          text: String(parsed.summary).trim(),
          timestamp: parsed.timestamp || null,
        });
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

function matchesAny(text, patterns) {
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function extractInstructionIdeas(messages) {
  const ideas = [];
  const seen = new Set();
  messages.forEach((message) => {
    if (message.role !== 'user') return;
    const lowered = message.text.toLowerCase();
    if (SYSTEM_REMINDER_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(lowered))) return;
    if (isLikelyCodeDump(message.text)) return;
    if (!INSTRUCTION_TOKENS.some((token) => lowered.includes(token))) return;
    const sentences = message.text.split(/[.!?]/g).map((part) => part.trim()).filter(Boolean);
    sentences.forEach((sentence) => {
      const cleaned = canonicalizeText(sanitizeSentence(sentence));
      const sentenceLower = cleaned.toLowerCase();
      if (SYSTEM_REMINDER_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (LOG_LIKE_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(sentenceLower))) return;
      if (isLikelyCodeDump(sentence)) return;
      if (INSTRUCTION_BLACKLIST.includes(sentenceLower)) return;
      const hasAction = ACTION_KEYWORDS.some((keyword) => sentenceLower.includes(keyword));
      if (cleaned.length > 240) return;
      if (INSTRUCTION_TOKENS.some((token) => sentenceLower.includes(token)) && hasAction) {
        if (seen.has(sentenceLower)) return;
        seen.add(sentenceLower);
        ideas.push(cleaned);
      }
    });
  });
  return ideas.slice(0, 12);
}

function extractTags(messages) {
  const tags = new Set();
  const combined = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.toLowerCase())
    .join('\n');
  Object.entries(TAG_KEYWORDS).forEach(([tag, keywords]) => {
    if (keywords.some((keyword) => combined.includes(keyword))) {
      tags.add(tag);
    }
  });
  return Array.from(tags);
}

function findCriticalTurns(messages, signalIndex) {
  if (!Number.isFinite(signalIndex)) return null;
  for (let i = signalIndex - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      if (isLikelyToolPayload(messages[i].text)) continue;
      if (isLowSignalTurn(messages[i].text)) continue;
      const snippet = firstTwoSentences(messages[i].text);
      const lowered = snippet.toLowerCase();
      const hasPastAction = PAST_ACTION_KEYWORDS.some((keyword) => lowered.includes(keyword));
      if (!hasPastAction) continue;
      return {
        index: i,
        role: messages[i].role,
        text: snippet.slice(0, 400),
      };
    }
  }
  return null;
}

function analyzeSession(messages) {
  const signalWindow = 4;
  const tasks = segmentTasks(messages);
  const taskResults = [];
  let lastSuccess = -1;
  let lastFailure = -1;
  const successSignals = [];
  const failureSignals = [];

  tasks.forEach((task) => {
    let successScore = 0;
    let failureScore = 0;
    let taskLastSuccess = -1;
    let taskLastFailure = -1;
    for (let i = task.start; i <= task.end; i += 1) {
      const message = messages[i];
      if (!message || message.role !== 'user') continue;
      if (!matchesAny(message.text, SUCCESS_PATTERNS) && !matchesAny(message.text, FAILURE_PATTERNS)) {
        continue;
      }
      let recentAssistant = false;
      for (let j = i - 1; j >= Math.max(task.start, i - signalWindow); j -= 1) {
        if (messages[j]?.role === 'assistant') {
          recentAssistant = true;
          break;
        }
      }
      if (!recentAssistant) continue;
      if (matchesAny(message.text, SUCCESS_PATTERNS)) {
        successScore += 2;
        taskLastSuccess = i;
        successSignals.push({ index: i, text: message.text.slice(0, 240) });
      }
      if (matchesAny(message.text, FAILURE_PATTERNS)) {
        failureScore += 2;
        taskLastFailure = i;
        failureSignals.push({ index: i, text: message.text.slice(0, 240) });
      }
    }
    let outcome = 'unknown';
    if (successScore > 0 && failureScore === 0) outcome = 'success';
    else if (failureScore > 0 && successScore === 0) outcome = 'fail';
    else if (successScore > 0 && failureScore > 0) {
      outcome = taskLastSuccess > taskLastFailure ? 'success' : 'partial';
    }
    if (taskLastSuccess >= 0) lastSuccess = taskLastSuccess;
    if (taskLastFailure >= 0) lastFailure = taskLastFailure;
    taskResults.push({
      start: task.start,
      end: task.end,
      outcome,
      successScore,
      failureScore,
    });
  });

  let outcome = 'unknown';
  if (lastSuccess >= 0 && lastFailure < 0) {
    outcome = 'success';
  } else if (lastFailure >= 0 && lastSuccess < 0) {
    outcome = 'fail';
  } else if (lastSuccess >= 0 && lastFailure >= 0) {
    outcome = lastSuccess > lastFailure ? 'success' : 'partial';
  }

  const criticalTurns = [];
  const seenCritical = new Set();
  if (lastSuccess >= 0) {
    const turn = findCriticalTurns(messages, lastSuccess);
    if (turn && !seenCritical.has(turn.text)) {
      seenCritical.add(turn.text);
      criticalTurns.push({ outcome: 'success', ...turn });
    }
  }
  if (lastFailure >= 0) {
    const turn = findCriticalTurns(messages, lastFailure);
    if (turn && !seenCritical.has(turn.text)) {
      seenCritical.add(turn.text);
      criticalTurns.push({ outcome: 'fail', ...turn });
    }
  }

  return {
    outcome,
    taskResults,
    successSignals,
    failureSignals,
    criticalTurns,
    tags: extractTags(messages),
    instructionIdeas: extractInstructionIdeas(messages),
    preferenceIdeas: extractPreferenceIdeas(messages),
  };
}

function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

type SessionEntry = {
  source: string;
  id: string | null;
  timestamp: string | null;
  cwd: string | null;
  relPath: string;
  filePath: string;
};

async function getCodexSessions(): Promise<SessionEntry[]> {
  const files = await listSessionFiles(CODEX_DIR);
  const sessions: SessionEntry[] = [];
  for (const filePath of files) {
    let firstLine = '';
    try {
      firstLine = await readFirstLine(filePath);
    } catch (err) {
      continue;
    }
    if (!firstLine) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(firstLine);
    } catch (err) {
      continue;
    }
    if (!parsed || parsed.type !== 'session_meta' || !parsed.payload) continue;
    sessions.push({
      source: 'codex',
      id: parsed.payload.id || null,
      timestamp: formatTimestamp(parsed.payload.timestamp || parsed.timestamp),
      cwd: parsed.payload.cwd || null,
      relPath: path.relative(CODEX_DIR, filePath),
      filePath,
    });
  }
  return sessions;
}

async function getClaudeSessions(): Promise<SessionEntry[]> {
  const files = await listSessionFiles(CLAUDE_DIR);
  const sessions: SessionEntry[] = [];
  for (const filePath of files) {
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (err) {
      continue;
    }
    sessions.push({
      source: 'claude',
      id: path.basename(filePath, SESSION_EXT),
      timestamp: stat.mtime ? stat.mtime.toISOString() : null,
      cwd: null,
      relPath: path.relative(CLAUDE_DIR, filePath),
      filePath,
    });
  }
  return sessions;
}

function sortByTimestamp(sessions) {
  return sessions.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildSummary(entries) {
  const outcomeCounts = { success: 0, partial: 0, fail: 0, unknown: 0 };
  const taskOutcomeCounts = { success: 0, partial: 0, fail: 0, unknown: 0 };
  const tagCounts = new Map();
  const instructionIdeas = [];
  const preferenceIdeas = [];
  const criticalTurns = [];
  const failureTexts = [];

  entries.forEach((entry) => {
    outcomeCounts[entry.outcome] = (outcomeCounts[entry.outcome] || 0) + 1;
    (entry.taskResults || []).forEach((task) => {
      taskOutcomeCounts[task.outcome] = (taskOutcomeCounts[task.outcome] || 0) + 1;
    });
    entry.tags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
    entry.instructionIdeas.forEach((idea) => {
      instructionIdeas.push({ session: entry.label, text: idea });
    });
    (entry.preferenceIdeas || []).forEach((idea) => {
      preferenceIdeas.push({ session: entry.label, text: idea });
    });
    entry.criticalTurns.forEach((turn) => {
      criticalTurns.push({ session: entry.label, ...turn });
    });
    (entry.failureSignals || []).forEach((signal) => {
      failureTexts.push(signal.text);
    });
    (entry.toolSignals?.errors || []).forEach((error) => {
      failureTexts.push(error);
    });
  });

  const sortedTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines = [];
  lines.push('# Session Review Summary');
  lines.push('');
  lines.push('## Outcomes');
  lines.push(`- success: ${outcomeCounts.success}`);
  lines.push(`- partial: ${outcomeCounts.partial}`);
  lines.push(`- fail: ${outcomeCounts.fail}`);
  lines.push(`- unknown: ${outcomeCounts.unknown}`);
  lines.push('');
  lines.push('## Task Outcomes');
  lines.push(`- success: ${taskOutcomeCounts.success}`);
  lines.push(`- partial: ${taskOutcomeCounts.partial}`);
  lines.push(`- fail: ${taskOutcomeCounts.fail}`);
  lines.push(`- unknown: ${taskOutcomeCounts.unknown}`);
  lines.push('');

  lines.push('## Top Tags');
  if (sortedTags.length) {
    sortedTags.forEach(([tag, count]) => {
      lines.push(`- ${tag} (${count})`);
    });
  } else {
    lines.push('- No tags detected.');
  }
  lines.push('');

  lines.push('## Instruction Ideas');
  if (instructionIdeas.length) {
    instructionIdeas.slice(0, 12).forEach((idea) => {
      lines.push(`- ${idea.session}: ${idea.text}`);
    });
  } else {
    lines.push('- No instruction ideas extracted.');
  }
  lines.push('');

  lines.push('## Preference Ideas');
  if (preferenceIdeas.length) {
    preferenceIdeas.slice(0, 12).forEach((idea) => {
      lines.push(`- ${idea.session}: ${idea.text}`);
    });
  } else {
    lines.push('- No preference ideas extracted.');
  }
  lines.push('');

  const failureClusters = classifyFailures(failureTexts);
  lines.push('## Failure Clusters');
  if (failureClusters.size) {
    Array.from(failureClusters.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, count]) => {
        lines.push(`- ${key}: ${count}`);
      });
  } else {
    lines.push('- No failure clusters found.');
  }
  lines.push('');

  lines.push('## Critical Turns');
  if (criticalTurns.length) {
    criticalTurns.slice(0, 12).forEach((turn) => {
      lines.push(`- ${turn.session} (${turn.outcome}): ${turn.text}`);
    });
  } else {
    lines.push('- No critical turns captured.');
  }
  lines.push('');

  lines.push('## Notes');
  lines.push('- Heuristics-only pass; add an LLM judge for deeper labeling.');
  lines.push('- Signals come from user text, so silent successes are likely undercounted.');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const sources = args.source === 'both' ? ['codex', 'claude'] : [args.source];
  const outDir = args.outDir || path.join(process.cwd(), 'reports', `session-review-${Date.now()}`);
  ensureDir(outDir);

  let sessions: SessionEntry[] = [];
  if (sources.includes('codex')) {
    sessions = sessions.concat(await getCodexSessions());
  }
  if (sources.includes('claude')) {
    sessions = sessions.concat(await getClaudeSessions());
  }

  sessions = sortByTimestamp(sessions);
  if (args.limit > 0) {
    sessions = sessions.slice(0, args.limit);
  }

  const results: any[] = [];
  for (const session of sessions) {
    let messages: ParsedMessage[] = [];
    let rawLines: string[] = [];
    try {
      messages = await readMessages(session.filePath, session.source);
      rawLines = await gatherRawLines(session.filePath);
    } catch (err) {
      continue;
    }
    const analysis = analyzeSession(messages);
    const toolSignals = extractToolSignals(rawLines);
    const repoSignals = extractRepoSignals(rawLines);
    let derivedOutcome = analysis.outcome;
    if (analysis.outcome === 'unknown') {
      if (toolSignals.errors.length && !toolSignals.successes.length) {
        derivedOutcome = 'fail';
      } else if (toolSignals.successes.length && !toolSignals.errors.length) {
        derivedOutcome = 'partial';
      } else if (repoSignals.changes > 0) {
        derivedOutcome = 'partial';
      }
    } else if (analysis.outcome === 'success' && toolSignals.errors.length > toolSignals.successes.length) {
      derivedOutcome = 'partial';
    }
    if (derivedOutcome === 'success' && repoSignals.reverts > 0) {
      derivedOutcome = 'partial';
    }
    const label = session.relPath || session.id || 'unknown';
    const compressedTranscript = buildCompressedTranscript(rawLines, session.source);
    const observations = extractObservationsFromTranscript(compressedTranscript).map((item) => ({
      ...item,
      session: label,
    }));
    results.push({
      source: session.source,
      id: session.id,
      timestamp: session.timestamp,
      cwd: session.cwd,
      relPath: session.relPath,
      label,
      messageCount: messages.length,
      outcome: derivedOutcome,
      tags: analysis.tags,
      instructionIdeas: analysis.instructionIdeas,
      preferenceIdeas: analysis.preferenceIdeas,
      criticalTurns: analysis.criticalTurns,
      successSignals: analysis.successSignals,
      failureSignals: analysis.failureSignals,
      taskResults: analysis.taskResults,
      toolSignals,
      repoSignals,
      compressedTranscript,
      observations,
    });
  }

  const summary = buildSummary(results);
  fs.writeFileSync(path.join(outDir, 'sessions.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary);

  const observations = results.flatMap((entry) => entry.observations || []);
  if (observations.length) {
    const tagsSummary = observations.reduce((acc, obs) => {
      (obs.tags || []).forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {});
    const payload = {
      generatedAt: new Date().toISOString(),
      totalObservations: observations.length,
      tagsSummary,
      observations,
    };
    fs.writeFileSync(path.join(outDir, 'recommendations.json'), JSON.stringify(payload, null, 2));
  }

  if (args.compress > 0) {
    const compressedDir = path.join(outDir, 'compressed');
    ensureDir(compressedDir);
    const sorted = [...results].sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0));
    const targets = sorted.slice(0, args.compress);
    const index = targets.map((entry) => {
      const name = sanitizeReportName(entry.label);
      const fileName = `${name}.md`;
      const filePath = path.join(compressedDir, fileName);
      fs.writeFileSync(filePath, entry.compressedTranscript || '');
      return {
        label: entry.label,
        file: path.relative(outDir, filePath),
        messageCount: entry.messageCount,
        outcome: entry.outcome,
      };
    });
    fs.writeFileSync(path.join(outDir, 'longest.json'), JSON.stringify(index, null, 2));
  }

  console.log(`Reviewed ${results.length} session(s).`);
  console.log(`Wrote ${path.join(outDir, 'sessions.json')}`);
  console.log(`Wrote ${path.join(outDir, 'summary.md')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
