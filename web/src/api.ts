import type { Span, SpanStatus } from "../../sdk/types";
import type { EvaluatorMeta, EvalRun, Score } from "../../server/evaltypes";

const BASE = "/api";

export interface TraceSummary {
  traceId: string;
  rootName: string | null;
  startTime: number;
  endTime: number;
  durationMs: number;
  spanCount: number;
  costUsd: number;
  totalTokens: number;
  status: SpanStatus;
}

export interface MetricsBucket {
  bucketStart: number;
  spanCount: number;
  llmCount: number;
  errorCount: number;
  costUsd: number;
  totalTokens: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface Metrics {
  sinceMs: number;
  bucketMs: number;
  summary: {
    traceCount: number;
    spanCount: number;
    errorRate: number;
    totalCostUsd: number;
    totalTokens: number;
    p95LatencyMs: number;
  };
  buckets: MetricsBucket[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<{ ok: boolean; spans: number; traces: number }>("/health"),
  metrics: (window = "24h", bucket = "1h") =>
    get<Metrics>(`/metrics?window=${window}&bucket=${bucket}`),
  traces: (opts: { q?: string; status?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.q) p.set("q", opts.q);
    if (opts.status) p.set("status", opts.status);
    p.set("limit", String(opts.limit ?? 100));
    return get<{ traces: TraceSummary[] }>(`/traces?${p.toString()}`);
  },
  trace: (id: string) => get<{ traceId: string; spans: Span[] }>(`/traces/${encodeURIComponent(id)}`),

  monitors: () => get<{ monitors: MonitorStatus[] }>("/monitors"),
  alerts: () => get<{ alerts: AlertEvent[] }>("/alerts"),

  evaluators: () => get<{ evaluators: EvaluatorMeta[] }>("/evaluators"),
  evalRuns: () => get<{ runs: EvalRun[] }>("/evals/runs"),
  evalRun: (id: string) => get<{ run: EvalRun; scores: Score[] }>(`/evals/runs/${encodeURIComponent(id)}`),
  runEval: (evaluatorId: string, sampleSize: number) =>
    post<{ run: EvalRun }>("/evals/run", { evaluatorId, sampleSize }),
};

export interface MonitorStatus {
  id: string;
  name: string;
  metric: string;
  windowMs: number;
  threshold: number;
  unit: "%" | "ms" | "$";
  description: string;
  observed: number;
  firing: boolean;
}

export interface AlertEvent {
  id: string;
  monitorId: string;
  kind: "fired" | "resolved";
  observed: number;
  threshold: number;
  message: string;
  createdAt: number;
}

export type { Span, EvaluatorMeta, EvalRun, Score };
