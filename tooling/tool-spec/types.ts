export type MaybePromise<T> = T | Promise<T>;

export type ToolValidator<TInput> = (input: unknown) => TInput;

export type ToolRunner<TInput, TOutput, TContext> = (input: TInput, context: TContext) => MaybePromise<TOutput>;

export interface ToolSpec<TInput = unknown, TOutput = unknown, TContext = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema?: unknown;
  validate?: ToolValidator<TInput>;
  run: ToolRunner<TInput, TOutput, TContext>;
}

export type PromptMessage = {
  role: 'user' | 'assistant' | 'system';
  content: { type: 'text'; text: string };
};

export interface InstructionSpec {
  name: string;
  title: string;
  description: string;
  markdown?: string;
  messages?: PromptMessage[];
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface ToolsetSpec<TContext = unknown> {
  name: string;
  version: string;
  tools: Array<ToolSpec<any, any, TContext>>;
  instructions?: InstructionSpec[];
}

export function defineToolset<TContext>(toolset: ToolsetSpec<TContext>): ToolsetSpec<TContext> {
  return toolset;
}

export function resolveToolInput<TInput>(tool: ToolSpec<TInput, any, any>, input: unknown): TInput {
  return tool.validate ? tool.validate(input) : (input as TInput);
}
