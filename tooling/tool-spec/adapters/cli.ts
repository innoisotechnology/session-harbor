import path from 'node:path';
import { ToolsetSpec, resolveToolInput } from '../types.js';

export interface CliAdapterOptions<TContext> {
  argv?: string[];
  binName?: string;
  getContext?: (input: unknown, info: { command: string; rawArgs: string[] }) => TContext | Promise<TContext>;
  isUnauthorized?: (error: unknown) => boolean;
  onUnauthorized?: (error: unknown, info: { command: string; rawArgs: string[]; input: unknown }) => TContext | Promise<TContext>;
  output?: NodeJS.WritableStream;
  errorOutput?: NodeJS.WritableStream;
}

export async function runToolsetCli<TContext>(toolset: ToolsetSpec<TContext>, options: CliAdapterOptions<TContext> = {}): Promise<void> {
  const argv = options.argv || process.argv.slice(2);
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const binName = options.binName || path.basename(process.argv[1] || toolset.name.toLowerCase());
  const [command, ...rawArgs] = argv;

  const completionIndex = argv.indexOf('--completion');
  if (completionIndex >= 0) {
    const shell = argv[completionIndex + 1];
    const script = buildCompletionScript(toolset, shell, binName);
    if (!script) {
      errorOutput.write(`Unsupported completion shell: ${shell || '(missing)'}\n`);
      errorOutput.write('Available shells: bash, zsh\n');
      process.exitCode = 1;
      return;
    }
    output.write(`${script}\n`);
    return;
  }

  if (command === 'completion') {
    const shell = rawArgs[0];
    const script = buildCompletionScript(toolset, shell, binName);
    if (!script) {
      errorOutput.write(`Unsupported completion shell: ${shell || '(missing)'}\n`);
      errorOutput.write('Available shells: bash, zsh\n');
      process.exitCode = 1;
      return;
    }
    output.write(`${script}\n`);
    return;
  }

  const isHelp = !command || command === 'help' || command === '--help' || command === '-h' || rawArgs.includes('--help') || rawArgs.includes('-h');
  if (isHelp) {
    output.write(`${buildHelpText(toolset)}\n`);
    return;
  }

  const tool = toolset.tools.find((item) => item.name === command);
  if (!tool) {
    errorOutput.write(`Unknown command: ${command}\n`);
    output.write(`${buildHelpText(toolset)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const parsed = parseArgs(rawArgs);
    const input = await resolveInput(parsed);
    const resolved = resolveToolInput(tool, input);
    const validated = validateInputSchema(resolved, tool.inputSchema, tool.name);
    const context = options.getContext ? await options.getContext(validated, { command, rawArgs }) : (undefined as TContext);
    const debug = coerceBoolean((validated as any)?.debug);
    if (debug) {
      errorOutput.write(`[debug] ${command} input: ${JSON.stringify(validated)}\n`);
    }
    const result = await runWithOptionalRetry(tool, validated, context, options, { command, rawArgs, input: validated });
    output.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorOutput.write(`${message}\n`);
    process.exitCode = 1;
  }
}

async function runWithOptionalRetry<TContext>(tool: { run: (input: unknown, context: TContext) => Promise<unknown> }, input: unknown, context: TContext, options: CliAdapterOptions<TContext>, info: { command: string; rawArgs: string[]; input: unknown }) {
  try {
    return await tool.run(input, context);
  } catch (error) {
    const shouldRetry = options.onUnauthorized && (options.isUnauthorized ? options.isUnauthorized(error) : isUnauthorizedError(error));
    if (!shouldRetry) {
      throw error;
    }
    const nextContext = await options.onUnauthorized!(error, info);
    return tool.run(input, nextContext);
  }
}

function isUnauthorizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('401') || message.toLowerCase().includes('unauthorized');
}

function buildHelpText(toolset: ToolsetSpec<unknown>): string {
  const lines = [
    `${toolset.name} CLI`,
    '',
    'Usage:',
    '  <command> [key=value] [--json "{...}"] [--input "{...}"]',
    '  <command> --json "{...}"',
    '  completion <bash|zsh>',
    '  --completion <bash|zsh>',
    '',
    'Notes:',
    '  - Unknown arguments are rejected when the tool defines an input schema.',
    '  - Use debug=true to print resolved input when supported by a tool.',
    '',
    'Commands:'
  ];
  for (const tool of toolset.tools) {
    lines.push(`  ${tool.name} - ${tool.description}`);
  }
  return lines.join('\n');
}

function buildCompletionScript(toolset: ToolsetSpec<unknown>, shell: string | undefined, binName: string): string | null {
  const normalizedShell = (shell || '').trim().toLowerCase();
  if (normalizedShell === 'bash') {
    return buildBashCompletion(toolset, binName);
  }
  if (normalizedShell === 'zsh') {
    return buildZshCompletion(toolset, binName);
  }
  return null;
}

function buildBashCompletion(toolset: ToolsetSpec<unknown>, binName: string): string {
  const spec = buildCompletionSpec(toolset);
  const commands = spec.commands.join(' ');
  const funcName = `_complete_${sanitizeIdentifier(binName)}`;
  const optionCases = spec.commands.map((command) => {
    const options = spec.options[command].join(' ');
    const valueCases = buildValueCases(spec.values[command], 'bash');
    return `    ${command})\n${valueCases}      COMPREPLY=( $(compgen -W "${options}" -- "$cur") )\n      return 0\n      ;;`;
  }).join('\n');

  return `# bash completion for ${binName}
${funcName}() {
  local cur prev words cword
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words=(\"\${COMP_WORDS[@]}\")
  cword=$COMP_CWORD

  local cmd=""
  local i
  for (( i=1; i<\${#COMP_WORDS[@]}; i++ )); do
    local w="\${COMP_WORDS[i]}"
    if [[ "$w" != -* ]]; then
      cmd="$w"
      break
    fi
  done

  if [[ -z "$cmd" || $cword -le 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )
    return 0
  fi

  local key=""
  if [[ "$cur" == *=* ]]; then
    key="\${cur%%=*}"
    cur="\${cur#*=}"
  elif [[ "$prev" == --* ]]; then
    key="\${prev#--}"
  fi
  key="\${key#--}"

  case "$cmd" in
${optionCases}
  esac
}

complete -F ${funcName} ${binName}
`;
}

function buildZshCompletion(toolset: ToolsetSpec<unknown>, binName: string): string {
  const spec = buildCompletionSpec(toolset);
  const commands = spec.commands.map(escapeZsh).join(' ');
  const funcName = `_complete_${sanitizeIdentifier(binName)}`;
  const optionCases = spec.commands.map((command) => {
    const options = spec.options[command].map(escapeZsh).join(' ');
    const valueCases = buildValueCases(spec.values[command], 'zsh');
    return `    ${command})\n${valueCases}      compadd ${options}\n      return 0\n      ;;`;
  }).join('\n');

  return `#compdef ${binName}
${funcName}() {
  local cur prev cmd
  cur="\${words[CURRENT]}"
  prev="\${words[CURRENT-1]}"
  cmd=""

  local word
  for word in \${words[2,-1]}; do
    if [[ "$word" != -* ]]; then
      cmd="$word"
      break
    fi
  done

  if [[ -z "$cmd" || $CURRENT -le 2 ]]; then
    compadd ${commands}
    return 0
  fi

  local key=""
  if [[ "$cur" == *=* ]]; then
    key="\${cur%%=*}"
    cur="\${cur#*=}"
  elif [[ "$prev" == --* ]]; then
    key="\${prev#--}"
  fi
  key="\${key#--}"

  case "$cmd" in
${optionCases}
  esac
}

compdef ${funcName} ${binName}
`;
}

function buildCompletionSpec(toolset: ToolsetSpec<unknown>) {
  const commands = toolset.tools.map((tool) => tool.name);
  const options: Record<string, string[]> = {};
  const values: Record<string, Record<string, string[]>> = {};

  for (const tool of toolset.tools) {
    const schema = tool.inputSchema as any;
    const properties = schema?.properties ? Object.keys(schema.properties) : [];
    const toolOptions = new Set<string>();
    const toolValues: Record<string, string[]> = {};

    for (const property of properties) {
      toolOptions.add(`${property}=`);
      toolOptions.add(`--${property}`);
      toolOptions.add(`--${property}=`);

      const propertySchema = schema.properties?.[property];
      const suggested = getValueSuggestions(propertySchema);
      if (suggested.length > 0) {
        toolValues[property] = suggested;
      }
    }

    toolOptions.add('--json');
    toolOptions.add('--json=');
    toolOptions.add('--input');
    toolOptions.add('--input=');
    toolOptions.add('debug=');
    toolOptions.add('--debug');
    toolOptions.add('--debug=');

    options[tool.name] = Array.from(toolOptions);
    values[tool.name] = toolValues;
  }

  return { commands, options, values };
}

function getValueSuggestions(schema: any): string[] {
  if (!schema) return [];
  const enumValues = Array.isArray(schema.enum) ? schema.enum.map(String) : [];
  if (enumValues.length > 0) return enumValues;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes('boolean')) {
    return ['true', 'false'];
  }
  return [];
}

function buildValueCases(values: Record<string, string[]>, shell: 'bash' | 'zsh'): string {
  const cases = Object.entries(values);
  if (cases.length === 0) return '';
  const lines = cases.map(([key, list]) => {
    const joined = list.join(' ');
    if (shell === 'bash') {
      return `      ${key})\n        COMPREPLY=( $(compgen -W "${joined}" -- "$cur") )\n        return 0\n        ;;`;
    }
    return `      ${key})\n        compadd ${list.map(escapeZsh).join(' ')}\n        return 0\n        ;;`;
  }).join('\n');
  return `      case "$key" in\n${lines}\n      esac\n`;
}

function sanitizeIdentifier(input: string): string {
  return input.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeZsh(value: string): string {
  return value.replace(/([\\\s'"])/g, '\\$1');
}

function parseArgs(rawArgs: string[]) {
  const input: Record<string, unknown> = {};
  let jsonInput: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--json' || arg === '--input') {
      jsonInput = rawArgs[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith('--json=')) {
      jsonInput = arg.slice('--json='.length);
      continue;
    }

    if (arg.startsWith('--input=')) {
      jsonInput = arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      const pair = splitKeyValue(trimmed);
      if (pair) {
        input[pair.key] = pair.value;
        continue;
      }
      const next = rawArgs[i + 1];
      const value = next && !next.startsWith('-') ? next : 'true';
      if (value !== 'true') {
        i++;
      }
      input[trimmed] = value;
      continue;
    }

    const pair = splitKeyValue(arg);
    if (pair) {
      input[pair.key] = pair.value;
    }
  }

  return { input, jsonInput };
}

function splitKeyValue(raw: string) {
  const idx = raw.indexOf('=');
  if (idx === -1) {
    return null;
  }
  const key = raw.slice(0, idx);
  const value = raw.slice(idx + 1);
  return { key, value };
}

async function resolveInput(parsed: { input: Record<string, unknown>; jsonInput?: string }) {
  if (parsed.jsonInput) {
    return parseJsonInput(parsed.jsonInput, 'argument');
  }

  if (Object.keys(parsed.input).length > 0) {
    return parsed.input;
  }

  const stdin = await readStdin();
  if (!stdin) {
    return {};
  }
  return parseJsonInput(stdin, 'stdin');
}

function parseJsonInput(raw: string, label: string) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON: ${(error as Error).message}`);
  }
}

function validateInputSchema(input: unknown, schema: any, toolName: string) {
  if (!schema) {
    return input;
  }
  if (input === undefined || input === null) {
    input = {};
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${toolName} expects an object input`);
  }
  const normalized = input as Record<string, unknown>;
  const properties = schema?.properties ? Object.keys(schema.properties) : [];
  const additional = schema?.additionalProperties;
  const allowExtra = additional === true;
  const metaKeys = new Set(['debug']);
  if (properties.length > 0 && !allowExtra) {
    const extraKeys = Object.keys(normalized).filter((key) => !properties.includes(key) && !metaKeys.has(key));
    if (extraKeys.length > 0) {
      throw new Error(`Unknown argument(s) for ${toolName}: ${extraKeys.join(', ')}`);
    }
  }
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const missing = required.filter((key: string) => normalized[key] === undefined || normalized[key] === null || normalized[key] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required argument(s) for ${toolName}: ${missing.join(', ')}`);
  }
  return input;
}

function coerceBoolean(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return Boolean(value);
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.resolve('');
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', (error) => {
      reject(error);
    });
  });
}
