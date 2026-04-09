// Thin wrapper around the Anthropic Messages API for the Pulse edge
// functions. Uses direct fetch rather than the SDK so we don't pull in
// an npm dep inside Deno and to keep cold starts fast.
//
// The API key is read from the Supabase secrets at invocation time via
// Deno.env.get('ANTHROPIC_API_KEY'). Never log it, never return it.
//
// Default model: claude-haiku-4-5. Override per-call if needed.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallAnthropicParams {
  system: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface AnthropicResponse {
  id: string;
  model: string;
  role: string;
  stop_reason: string;
  stop_sequence: string | null;
  type: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  content: Array<{ type: string; text: string }>;
}

/**
 * Call Claude. Returns the full API response object so the caller can
 * extract text from `content[0].text`. Throws on any non-2xx.
 *
 * Safe to call from a Supabase edge function. Never exposes the API key
 * in errors (we log only the status + the 'type' of error).
 */
export async function callAnthropic(params: CallAnthropicParams): Promise<AnthropicResponse> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on this edge function');
  }

  const body = {
    model: params.model ?? DEFAULT_MODEL,
    // 2500 is enough for ~12 insights × 50 words each including JSON overhead.
    max_tokens: params.maxTokens ?? 2500,
    temperature: params.temperature ?? 0.3,
    system: params.system,
    messages: params.messages,
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody: unknown = null;
    try {
      errBody = await res.json();
    } catch {
      // ignore
    }
    const errType =
      typeof errBody === 'object' && errBody !== null && 'error' in errBody
        ? (errBody as { error?: { type?: string; message?: string } }).error
        : null;
    console.error(`Anthropic API error ${res.status}:`, errType);
    throw new Error(`Anthropic API returned ${res.status}: ${errType?.type ?? 'unknown'}`);
  }

  return (await res.json()) as AnthropicResponse;
}

/**
 * Extract the first text block from a response. Claude Messages API can
 * technically return multiple blocks (thinking, tool use, etc) but for
 * a plain text system prompt + user message, the first block is always
 * the text we want.
 */
export function extractText(resp: AnthropicResponse): string {
  const text = resp.content.find(c => c.type === 'text')?.text;
  if (!text) {
    throw new Error('Anthropic response contained no text block');
  }
  return text;
}

/**
 * Attempt to parse a JSON array/object from the model output. Claude is
 * well-behaved with JSON mode-ish prompting but sometimes wraps the JSON
 * in ```json fences or adds a preamble. This function strips those
 * politely and falls back to extracting the first {} or [] block.
 */
export function extractJson<T>(raw: string): T {
  let s = raw.trim();

  // Strip ```json / ``` fences
  if (s.startsWith('```')) {
    const firstNewline = s.indexOf('\n');
    if (firstNewline !== -1) {
      s = s.slice(firstNewline + 1);
    }
    if (s.endsWith('```')) {
      s = s.slice(0, -3);
    }
    s = s.trim();
  }

  try {
    return JSON.parse(s) as T;
  } catch {
    // Fall back: find the first { or [ and the matching close
    const firstBrace = s.search(/[\[{]/);
    if (firstBrace === -1) {
      throw new Error('No JSON object/array found in model output');
    }
    const open = s[firstBrace];
    const close = open === '[' ? ']' : '}';
    const lastClose = s.lastIndexOf(close);
    if (lastClose === -1 || lastClose < firstBrace) {
      throw new Error('Unbalanced JSON in model output');
    }
    const sliced = s.slice(firstBrace, lastClose + 1);
    return JSON.parse(sliced) as T;
  }
}
