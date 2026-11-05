import type { Span, SpanType, SpanStatus } from "./types";
import { Exporter, type ExporterOptions } from "./exporter";
import { traceStore, currentContext, newId } from "./context";
import { costForUsage } from "./pricing";

export type { Span, SpanType, SpanStatus, IngestBatch } from "./types";
export type { ExporterOptions } from "./exporter";

let exporter: Exporter | null = null;
let defaultMetadata: Record<string, unknown> = {};

export function init(options: ExporterOptions & { metadata?: Record<string, unknown> } = {}) {
  const { metadata, ...exporterOpts } = options;
  defaultMetadata = metadata ?? {};
  exporter = new Exporter(exporterOpts);
  return exporter;
}

function getExporter(): Exporter {
  if (!exporter) exporter = new Exporter({ debug: true });
  return exporter;
}

export async function flush(): Promise<void> {
  if (exporter) await exporter.flush();
}

export async function shutdown(): Promise<void> {
  if (exporter) await exporter.shutdown();
}

interface RecordInput {
  type: SpanType;
  name: string;
  input: unknown;
  output: unknown;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs: number;
  status: SpanStatus;
  error?: string;
  startTime: number;
  endTime: number;
  traceId: string;
  spanId: string;
  parentId: string | null;
  metadata?: Record<string, unknown>;
}

function record(r: RecordInput) {
  const span: Span = {
    ...r,
    metadata: { ...defaultMetadata, ...(r.metadata ?? {}) },
  };
  getExporter().enqueue(span);
}

export async function trace<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { input?: unknown; metadata?: Record<string, unknown> } = {},
): Promise<T> {
  const traceId = newId();
  const spanId = newId();
  const startTime = Date.now();
  return traceStore.run({ traceId, spanId }, async () => {
    try {
      const output = await fn();
      record({
        type: "agent",
        name,
        input: opts.input,
        output,
        latencyMs: Date.now() - startTime,
        status: "ok",
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId: null,
        metadata: opts.metadata,
      });
      return output;
    } catch (err) {
      record({
        type: "agent",
        name,
        input: opts.input,
        output: null,
        latencyMs: Date.now() - startTime,
        status: "error",
        error: errText(err),
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId: null,
        metadata: opts.metadata,
      });
      throw err;
    }
  });
}

export function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const parent = currentContext();
  return traceStore.run(
    { traceId: parent?.traceId ?? newId(), spanId: parent?.spanId ?? null, nameHint: name },
    fn,
  );
}

export async function span<T>(
  opts: { type: SpanType; name: string; input?: unknown; metadata?: Record<string, unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  const parent = currentContext();
  const traceId = parent?.traceId ?? newId();
  const spanId = newId();
  const parentId = parent?.spanId ?? null;
  const startTime = Date.now();
  return traceStore.run({ traceId, spanId }, async () => {
    try {
      const output = await fn();
      record({
        type: opts.type,
        name: opts.name,
        input: opts.input,
        output,
        latencyMs: Date.now() - startTime,
        status: "ok",
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId,
        metadata: opts.metadata,
      });
      return output;
    } catch (err) {
      record({
        type: opts.type,
        name: opts.name,
        input: opts.input,
        output: null,
        latencyMs: Date.now() - startTime,
        status: "error",
        error: errText(err),
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId,
        metadata: opts.metadata,
      });
      throw err;
    }
  });
}

interface OpenAILike {
  chat: {
    completions: {
      create(body: any, options?: any): Promise<any>;
    };
  };
}

export function wrapOpenAI<T extends OpenAILike>(client: T): T {
  const completions = client.chat.completions;
  const original = completions.create.bind(completions);

  completions.create = async function wrappedCreate(body: any, options?: any) {
    if (body?.stream) return original(body, options);

    const parent = currentContext();
    const traceId = parent?.traceId ?? newId();
    const spanId = newId();
    const parentId = parent?.spanId ?? null;
    const name = parent?.nameHint ?? body?.model ?? "llm";
    const startTime = Date.now();

    try {
      const res = await original(body, options);
      const usage = res?.usage ?? {};
      const promptTokens = usage.prompt_tokens;
      const completionTokens = usage.completion_tokens;
      record({
        type: "llm",
        name,
        input: body?.messages ?? body,
        output: res?.choices?.[0]?.message ?? res,
        model: body?.model,
        promptTokens,
        completionTokens,
        totalTokens: usage.total_tokens,
        costUsd: costForUsage(body?.model, promptTokens ?? 0, completionTokens ?? 0),
        latencyMs: Date.now() - startTime,
        status: "ok",
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId,
      });
      return res;
    } catch (err) {
      record({
        type: "llm",
        name,
        input: body?.messages ?? body,
        output: null,
        model: body?.model,
        latencyMs: Date.now() - startTime,
        status: "error",
        error: errText(err),
        startTime,
        endTime: Date.now(),
        traceId,
        spanId,
        parentId,
      });
      throw err;
    }
  };

  return client;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
