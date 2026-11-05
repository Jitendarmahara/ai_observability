export type SpanType = "llm" | "tool" | "retrieval" | "agent";
export type SpanStatus = "ok" | "error";

export interface Span {
  traceId: string;
  spanId: string;
  parentId: string | null;

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

  metadata?: Record<string, unknown>;
}

export interface IngestBatch {
  spans: Span[];
}
