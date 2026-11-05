import { Database } from "bun:sqlite";
import type { Span, SpanStatus, SpanType } from "../sdk/types";
import type { EvalRun, EvalTarget, RunStatus, Score } from "./evaltypes";
import { randomUUID } from "node:crypto";

const DB_PATH = process.env.RESPAN_DB ?? "respan.db";

export const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
  CREATE TABLE IF NOT EXISTS spans (
    span_id           TEXT PRIMARY KEY,
    trace_id          TEXT NOT NULL,
    parent_id         TEXT,
    type              TEXT NOT NULL,
    name              TEXT NOT NULL,
    model             TEXT,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    cost_usd          REAL,
    latency_ms        INTEGER NOT NULL,
    status            TEXT NOT NULL,
    error             TEXT,
    start_time        INTEGER NOT NULL,
    end_time          INTEGER NOT NULL,
    input_json        TEXT,
    output_json       TEXT,
    metadata_json     TEXT
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);");
db.exec("CREATE INDEX IF NOT EXISTS idx_spans_start ON spans(start_time);");

db.exec(`
  CREATE TABLE IF NOT EXISTS eval_runs (
    id            TEXT PRIMARY KEY,
    evaluator_id  TEXT NOT NULL,
    status        TEXT NOT NULL,
    sample_size   INTEGER NOT NULL,
    total_count   INTEGER NOT NULL DEFAULT 0,
    pass_count    INTEGER NOT NULL DEFAULT 0,
    avg_value     REAL NOT NULL DEFAULT 0,
    target_json   TEXT,
    error         TEXT,
    created_at    INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id            TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL,
    evaluator_id  TEXT NOT NULL,
    trace_id      TEXT NOT NULL,
    span_id       TEXT NOT NULL,
    value         REAL NOT NULL,
    passed        INTEGER NOT NULL,
    label         TEXT,
    reasoning     TEXT,
    created_at    INTEGER NOT NULL
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_scores_run ON scores(run_id);");
db.exec("CREATE INDEX IF NOT EXISTS idx_scores_span ON scores(span_id);");

db.exec(`
  CREATE TABLE IF NOT EXISTS alert_events (
    id         TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    kind       TEXT NOT NULL,
    observed   REAL NOT NULL,
    threshold  REAL NOT NULL,
    message    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO spans (
    span_id, trace_id, parent_id, type, name, model,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    latency_ms, status, error, start_time, end_time,
    input_json, output_json, metadata_json
  ) VALUES (
    $span_id, $trace_id, $parent_id, $type, $name, $model,
    $prompt_tokens, $completion_tokens, $total_tokens, $cost_usd,
    $latency_ms, $status, $error, $start_time, $end_time,
    $input_json, $output_json, $metadata_json
  )
`);

const insertBatchTx = db.transaction((spans: Span[]) => {
  for (const s of spans) {
    insertStmt.run({
      $span_id: s.spanId,
      $trace_id: s.traceId,
      $parent_id: s.parentId,
      $type: s.type,
      $name: s.name,
      $model: s.model ?? null,
      $prompt_tokens: s.promptTokens ?? null,
      $completion_tokens: s.completionTokens ?? null,
      $total_tokens: s.totalTokens ?? null,
      $cost_usd: s.costUsd ?? null,
      $latency_ms: s.latencyMs,
      $status: s.status,
      $error: s.error ?? null,
      $start_time: s.startTime,
      $end_time: s.endTime,
      $input_json: s.input === undefined ? null : JSON.stringify(s.input),
      $output_json: s.output === undefined ? null : JSON.stringify(s.output),
      $metadata_json: s.metadata ? JSON.stringify(s.metadata) : null,
    });
  }
  return spans.length;
});

export function insertSpans(spans: Span[]): number {
  if (spans.length === 0) return 0;
  return insertBatchTx(spans) as number;
}

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

export interface ListTracesParams {
  limit?: number;
  offset?: number;
  status?: SpanStatus;
  q?: string;
}

export function listTraces(params: ListTracesParams = {}): TraceSummary[] {
  const limit = Math.min(params.limit ?? 50, 500);
  const offset = params.offset ?? 0;

  const where: string[] = [];
  const args: Record<string, string | number> = { $limit: limit, $offset: offset };

  if (params.q) {
    where.push(`trace_id IN (
      SELECT trace_id FROM spans
      WHERE name LIKE $q OR model LIKE $q OR input_json LIKE $q OR output_json LIKE $q
    )`);
    args.$q = `%${params.q}%`;
  }
  if (params.status === "error") where.push("has_error = 1");
  if (params.status === "ok") where.push("has_error = 0");

  const sql = `
    SELECT
      trace_id AS traceId,
      MIN(start_time) AS startTime,
      MAX(end_time)   AS endTime,
      COUNT(*)        AS spanCount,
      COALESCE(SUM(cost_usd), 0)     AS costUsd,
      COALESCE(SUM(total_tokens), 0) AS totalTokens,
      MAX(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS has_error,
      (SELECT name FROM spans r WHERE r.trace_id = s.trace_id AND r.parent_id IS NULL LIMIT 1) AS rootName
    FROM spans s
    GROUP BY trace_id
    ${where.length ? "HAVING " + where.join(" AND ") : ""}
    ORDER BY startTime DESC
    LIMIT $limit OFFSET $offset
  `;

  const rows = db.query(sql).all(args) as any[];
  return rows.map((r) => ({
    traceId: r.traceId,
    rootName: r.rootName ?? null,
    startTime: r.startTime,
    endTime: r.endTime,
    durationMs: r.endTime - r.startTime,
    spanCount: r.spanCount,
    costUsd: r.costUsd,
    totalTokens: r.totalTokens,
    status: r.has_error ? "error" : "ok",
  }));
}

export function getTrace(traceId: string): Span[] {
  const rows = db
    .query("SELECT * FROM spans WHERE trace_id = $t ORDER BY start_time ASC")
    .all({ $t: traceId }) as any[];
  return rows.map(rowToSpan);
}

function rowToSpan(r: any): Span {
  return {
    traceId: r.trace_id,
    spanId: r.span_id,
    parentId: r.parent_id,
    type: r.type as SpanType,
    name: r.name,
    model: r.model ?? undefined,
    promptTokens: r.prompt_tokens ?? undefined,
    completionTokens: r.completion_tokens ?? undefined,
    totalTokens: r.total_tokens ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    latencyMs: r.latency_ms,
    status: r.status as SpanStatus,
    error: r.error ?? undefined,
    startTime: r.start_time,
    endTime: r.end_time,
    input: r.input_json ? JSON.parse(r.input_json) : null,
    output: r.output_json ? JSON.parse(r.output_json) : null,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
  };
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

export interface MetricsResult {
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function getMetrics(sinceMs: number, bucketMs: number): MetricsResult {
  const rows = db
    .query(
      `SELECT trace_id, type, latency_ms, cost_usd, total_tokens, status, start_time
       FROM spans WHERE start_time >= $since ORDER BY start_time ASC`,
    )
    .all({ $since: sinceMs }) as any[];

  const buckets = new Map<number, { lat: number[]; cost: number; tok: number; err: number; n: number; llm: number }>();
  const allLat: number[] = [];
  const traceIds = new Set<string>();
  let errorSpans = 0;
  let totalCost = 0;
  let totalTokens = 0;

  for (const r of rows) {
    traceIds.add(r.trace_id);
    const key = Math.floor(r.start_time / bucketMs) * bucketMs;
    let b = buckets.get(key);
    if (!b) {
      b = { lat: [], cost: 0, tok: 0, err: 0, n: 0, llm: 0 };
      buckets.set(key, b);
    }
    b.n++;
    b.lat.push(r.latency_ms);
    allLat.push(r.latency_ms);
    b.cost += r.cost_usd ?? 0;
    b.tok += r.total_tokens ?? 0;
    totalCost += r.cost_usd ?? 0;
    totalTokens += r.total_tokens ?? 0;
    if (r.type === "llm") b.llm++;
    if (r.status === "error") {
      b.err++;
      errorSpans++;
    }
  }

  const bucketList: MetricsBucket[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, b]) => {
      const s = [...b.lat].sort((x, y) => x - y);
      return {
        bucketStart,
        spanCount: b.n,
        llmCount: b.llm,
        errorCount: b.err,
        costUsd: Math.round(b.cost * 1e6) / 1e6,
        totalTokens: b.tok,
        p50LatencyMs: percentile(s, 50),
        p95LatencyMs: percentile(s, 95),
        p99LatencyMs: percentile(s, 99),
      };
    });

  const sortedAll = allLat.sort((x, y) => x - y);
  return {
    sinceMs,
    bucketMs,
    summary: {
      traceCount: traceIds.size,
      spanCount: rows.length,
      errorRate: rows.length ? Math.round((errorSpans / rows.length) * 1000) / 1000 : 0,
      totalCostUsd: Math.round(totalCost * 1e6) / 1e6,
      totalTokens,
      p95LatencyMs: percentile(sortedAll, 95),
    },
    buckets: bucketList,
  };
}

export function stats(): { spans: number; traces: number } {
  const spans = (db.query("SELECT COUNT(*) AS c FROM spans").get() as any).c;
  const traces = (db.query("SELECT COUNT(DISTINCT trace_id) AS c FROM spans").get() as any).c;
  return { spans, traces };
}

const DEFAULT_TARGET: EvalTarget = { spanName: "generate reply" };

export function sampleTargetSpans(target: EvalTarget, limit: number): Span[] {
  const where: string[] = [];
  const args: Record<string, string | number> = { $limit: Math.min(limit, 500) };
  if (target.spanName) {
    where.push("name = $name");
    args.$name = target.spanName;
  }
  if (target.type) {
    where.push("type = $type");
    args.$type = target.type;
  }
  const sql = `SELECT * FROM spans ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY start_time DESC LIMIT $limit`;
  return (db.query(sql).all(args) as any[]).map(rowToSpan);
}

export function createEvalRun(evaluatorId: string, sampleSize: number, target?: EvalTarget): EvalRun {
  const id = randomUUID();
  const t = target ?? DEFAULT_TARGET;
  const createdAt = Date.now();
  db.query(
    `INSERT INTO eval_runs (id, evaluator_id, status, sample_size, target_json, created_at)
     VALUES ($id, $ev, 'pending', $n, $target, $created)`,
  ).run({ $id: id, $ev: evaluatorId, $n: sampleSize, $target: JSON.stringify(t), $created: createdAt });
  return {
    id,
    evaluatorId,
    status: "pending",
    sampleSize,
    totalCount: 0,
    passCount: 0,
    avgValue: 0,
    target: t,
    createdAt,
  };
}

export function claimNextPendingRun(): EvalRun | null {
  const claim = db.transaction(() => {
    const row = db
      .query("SELECT * FROM eval_runs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get() as any;
    if (!row) return null;
    db.query("UPDATE eval_runs SET status = 'running', started_at = $t WHERE id = $id").run({
      $t: Date.now(),
      $id: row.id,
    });
    return row;
  });
  const row = claim() as any;
  return row ? rowToRun({ ...row, status: "running", started_at: Date.now() }) : null;
}

export function insertScore(s: Omit<Score, "id" | "createdAt">): Score {
  const id = randomUUID();
  const createdAt = Date.now();
  db.query(
    `INSERT INTO scores (id, run_id, evaluator_id, trace_id, span_id, value, passed, label, reasoning, created_at)
     VALUES ($id,$run,$ev,$trace,$span,$value,$passed,$label,$reason,$created)`,
  ).run({
    $id: id,
    $run: s.runId,
    $ev: s.evaluatorId,
    $trace: s.traceId,
    $span: s.spanId,
    $value: s.value,
    $passed: s.passed ? 1 : 0,
    $label: s.label ?? null,
    $reason: s.reasoning ?? null,
    $created: createdAt,
  });
  return { ...s, id, createdAt };
}

export function finishRun(
  id: string,
  result: { totalCount: number; passCount: number; avgValue: number; error?: string },
) {
  db.query(
    `UPDATE eval_runs SET status = $status, total_count = $total, pass_count = $pass,
       avg_value = $avg, error = $err, finished_at = $fin WHERE id = $id`,
  ).run({
    $status: result.error ? "error" : "done",
    $total: result.totalCount,
    $pass: result.passCount,
    $avg: result.avgValue,
    $err: result.error ?? null,
    $fin: Date.now(),
    $id: id,
  });
}

export function listEvalRuns(limit = 50): EvalRun[] {
  const rows = db
    .query("SELECT * FROM eval_runs ORDER BY created_at DESC LIMIT $l")
    .all({ $l: limit }) as any[];
  return rows.map(rowToRun);
}

export function getEvalRun(id: string): { run: EvalRun; scores: Score[] } | null {
  const row = db.query("SELECT * FROM eval_runs WHERE id = $id").get({ $id: id }) as any;
  if (!row) return null;
  const scoreRows = db
    .query("SELECT * FROM scores WHERE run_id = $id ORDER BY passed ASC, created_at ASC")
    .all({ $id: id }) as any[];
  return { run: rowToRun(row), scores: scoreRows.map(rowToScore) };
}

function rowToRun(r: any): EvalRun {
  return {
    id: r.id,
    evaluatorId: r.evaluator_id,
    status: r.status as RunStatus,
    sampleSize: r.sample_size,
    totalCount: r.total_count,
    passCount: r.pass_count,
    avgValue: r.avg_value,
    target: r.target_json ? JSON.parse(r.target_json) : {},
    createdAt: r.created_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  };
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

export function insertAlert(a: Omit<AlertEvent, "id" | "createdAt">): AlertEvent {
  const id = randomUUID();
  const createdAt = Date.now();
  db.query(
    `INSERT INTO alert_events (id, monitor_id, kind, observed, threshold, message, created_at)
     VALUES ($id,$m,$k,$o,$t,$msg,$c)`,
  ).run({
    $id: id,
    $m: a.monitorId,
    $k: a.kind,
    $o: a.observed,
    $t: a.threshold,
    $msg: a.message,
    $c: createdAt,
  });
  return { ...a, id, createdAt };
}

export function listAlerts(limit = 50): AlertEvent[] {
  const rows = db
    .query("SELECT * FROM alert_events ORDER BY created_at DESC LIMIT $l")
    .all({ $l: limit }) as any[];
  return rows.map((r) => ({
    id: r.id,
    monitorId: r.monitor_id,
    kind: r.kind,
    observed: r.observed,
    threshold: r.threshold,
    message: r.message,
    createdAt: r.created_at,
  }));
}

function rowToScore(r: any): Score {
  return {
    id: r.id,
    runId: r.run_id,
    evaluatorId: r.evaluator_id,
    traceId: r.trace_id,
    spanId: r.span_id,
    value: r.value,
    passed: !!r.passed,
    label: r.label ?? "",
    reasoning: r.reasoning ?? undefined,
    createdAt: r.created_at,
  };
}
