import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Minimal OpenRouter client (no SDK dependency). One key, every model.
 * https://openrouter.ai/docs — POST /api/v1/chat/completions with Bearer auth.
 *
 * - Structured outputs via response_format json_schema (strict) + zod validation.
 * - Usage accounting is always returned; `usage.cost` (USD-denominated credits)
 *   is surfaced so callers can record REPORTED cost next to estimates.
 * - Failures map to typed, retryability-aware errors.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterErrorKind =
  | "auth" // 401 — bad key
  | "insufficient_credits" // 402 — account out of credits
  | "rate_limited" // 429
  | "invalid_request" // 400/422 — our bug, do not retry
  | "model_unavailable" // 404/502 model or provider routing failure
  | "moderation" // 403 — input flagged
  | "transient" // network / 5xx
  | "invalid_response"; // schema validation failed

export class OpenRouterError extends Error {
  constructor(
    public readonly kind: OpenRouterErrorKind,
    message: string,
    public readonly status?: number,
    public readonly retryable: boolean = kind === "rate_limited" ||
      kind === "transient" ||
      kind === "model_unavailable",
  ) {
    super(`[openrouter/${kind}] ${message}`);
    this.name = "OpenRouterError";
  }
}

/** OpenAI-style content parts; audio must be base64 (URLs unsupported for audio). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "input_audio";
      input_audio: { data: string; format: "wav" | "mp3" };
    };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface OpenRouterUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  /** Amount charged to the OpenRouter account for this call, in USD credits. */
  costUsd: number | null;
}

export interface ChatResult<T> {
  data: T;
  usage: OpenRouterUsage;
  model: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** App attribution headers recommended by OpenRouter. */
  referer?: string;
  title?: string;
}

interface RawResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  model?: string;
  error?: { code?: number; message?: string };
}

async function callOpenRouter(
  opts: ChatOptions,
  responseFormat?: unknown,
): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        "http-referer":
          opts.referer ?? "https://github.com/nadeemramli/effen-social",
        "x-title": opts.title ?? "EFFEN Content Studio",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
  } catch (e) {
    throw new OpenRouterError(
      "transient",
      `Network failure calling OpenRouter: ${e instanceof Error ? e.message : e}`,
    );
  }

  let body: RawResponse;
  try {
    body = (await res.json()) as RawResponse;
  } catch {
    throw new OpenRouterError(
      "transient",
      `Non-JSON response (HTTP ${res.status})`,
      res.status,
    );
  }

  if (!res.ok || body.error) {
    const status = body.error?.code ?? res.status;
    const message = body.error?.message ?? `HTTP ${res.status}`;
    const kind: OpenRouterErrorKind =
      status === 401
        ? "auth"
        : status === 402
          ? "insufficient_credits"
          : status === 403
            ? "moderation"
            : status === 429
              ? "rate_limited"
              : status === 400 || status === 422
                ? "invalid_request"
                : status === 404 || status === 502
                  ? "model_unavailable"
                  : "transient";
    throw new OpenRouterError(kind, message, status);
  }
  return body;
}

function extractUsage(body: RawResponse): OpenRouterUsage {
  return {
    promptTokens: body.usage?.prompt_tokens ?? null,
    completionTokens: body.usage?.completion_tokens ?? null,
    costUsd: body.usage?.cost ?? null,
  };
}

/** Plain-text completion. */
export async function chatText(opts: ChatOptions): Promise<ChatResult<string>> {
  const body = await callOpenRouter(opts);
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.length) {
    throw new OpenRouterError("invalid_response", "Empty completion content");
  }
  return {
    data: text,
    usage: extractUsage(body),
    model: body.model ?? opts.model,
  };
}

/**
 * Structured completion: strict json_schema response_format derived from the zod
 * schema, then zod-validated. Unknown facts must be modeled as nullable fields in
 * the schema — validation failure is an invalid_response error, never a guess.
 */
export async function chatStructured<S extends z.ZodTypeAny>(
  opts: ChatOptions & { schema: S; schemaName: string },
): Promise<ChatResult<z.infer<S>>> {
  const jsonSchema = zodToJsonSchema(opts.schema, { target: "openAi" });
  const body = await callOpenRouter(opts, {
    type: "json_schema",
    json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema },
  });
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.length) {
    throw new OpenRouterError("invalid_response", "Empty completion content");
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new OpenRouterError(
      "invalid_response",
      "Completion was not valid JSON",
    );
  }
  const validated = opts.schema.safeParse(parsedJson);
  if (!validated.success) {
    throw new OpenRouterError(
      "invalid_response",
      `Completion failed schema validation: ${validated.error.issues[0]?.path.join(".")} ${validated.error.issues[0]?.message}`,
    );
  }
  return {
    data: validated.data,
    usage: extractUsage(body),
    model: body.model ?? opts.model,
  };
}

export function imagePart(
  base64: string,
  mime: "image/jpeg" | "image/png",
): ContentPart {
  return {
    type: "image_url",
    image_url: { url: `data:${mime};base64,${base64}` },
  };
}

export function audioPart(base64Wav: string): ContentPart {
  return {
    type: "input_audio",
    input_audio: { data: base64Wav, format: "wav" },
  };
}
