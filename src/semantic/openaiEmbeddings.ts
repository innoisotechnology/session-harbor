export type OpenAiEmbeddingOptions = {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_TIMEOUT_MS = 30_000;

export async function generateOpenAiEmbeddings(texts: string[], options: OpenAiEmbeddingOptions = {}): Promise<number[][]> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err: any = new Error('OPENAI_API_KEY is required for embeddings.');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }

  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await safeReadText(resp);
      const err: any = new Error(`OpenAI embeddings API failed: ${resp.status} ${resp.statusText}${body ? `: ${body}` : ''}`);
      err.code = 'OPENAI_EMBEDDINGS_FAILED';
      err.status = resp.status;
      throw err;
    }

    const json: any = await resp.json();
    const data = Array.isArray(json?.data) ? json.data : [];
    const vectors = data.map((row: any) => row?.embedding).filter((v: any) => Array.isArray(v));

    if (vectors.length !== texts.length) {
      const err: any = new Error('OpenAI embeddings API returned unexpected response shape.');
      err.code = 'OPENAI_EMBEDDINGS_BAD_RESPONSE';
      throw err;
    }

    return vectors as number[][];
  } finally {
    clearTimeout(timer);
  }
}

async function safeReadText(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.slice(0, 2000);
  } catch {
    return '';
  }
}
