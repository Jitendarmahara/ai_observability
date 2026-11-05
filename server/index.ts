import type { Span, IngestBatch, SpanStatus } from "../sdk/types";
import {
  insertSpans,
  listTraces,
  getTrace,
  getMetrics,
  stats,
  createEvalRun,
  listEvalRuns,
  getEvalRun,
  listAlerts,
} from "./db";
import { listEvaluators, getEvaluator } from "./evaluators";
import { evaluateMonitors } from "./monitors";

const PORT = Number(process.env.PORT ?? 4318);
const API_KEY = process.env.RESPAN_API_KEY;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function cleanSpan(x: any): Span | null {
  if (!x || typeof x.spanId !== "string" || typeof x.traceId !== "string") return null;
  if (typeof x.type !== "string" || typeof x.name !== "string") return null;
  const status: SpanStatus = x.status === "error" ? "error" : "ok";
  return {
    traceId: x.traceId,
    spanId: x.spanId,
    parentId: typeof x.parentId === "string" ? x.parentId : null,
    type: x.type,
    name: x.name,
    model: x.model,
    promptTokens: num(x.promptTokens),
    completionTokens: num(x.completionTokens),
    totalTokens: num(x.totalTokens),
    costUsd: num(x.costUsd),
    latencyMs: num(x.latencyMs) ?? 0,
    status,
    error: typeof x.error === "string" ? x.error : undefined,
    startTime: num(x.startTime) ?? Date.now(),
    endTime: num(x.endTime) ?? Date.now(),
    input: x.input ?? null,
    output: x.output ?? null,
    metadata: x.metadata && typeof x.metadata === "object" ? x.metadata : undefined,
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseWindow(s: string | null): number {
  const m = /^(\d+)([smhd])$/.exec(s ?? "");
  if (!m) return 24 * 3600_000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 }[m[2] as "s" | "m" | "h" | "d"];
  return n * unit;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (req.method === "POST" && pathname === "/ingest") {
      if (API_KEY) {
        const auth = req.headers.get("authorization");
        if (auth !== `Bearer ${API_KEY}`) return json({ error: "unauthorized" }, 401);
      }
      let body: IngestBatch;
      try {
        body = (await req.json()) as IngestBatch;
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      const incoming = Array.isArray(body?.spans) ? body.spans : [];
      const clean: Span[] = [];
      let rejected = 0;
      for (const s of incoming) {
        const c = cleanSpan(s);
        if (c) clean.push(c);
        else rejected++;
      }
      const stored = insertSpans(clean);
      return json({ accepted: stored, rejected }, 202);
    }

    if (req.method === "GET" && pathname === "/health") {
      return json({ ok: true, ...stats() });
    }

    if (req.method === "GET" && pathname === "/traces") {
      const status = url.searchParams.get("status");
      const traces = listTraces({
        limit: Number(url.searchParams.get("limit") ?? 50),
        offset: Number(url.searchParams.get("offset") ?? 0),
        status: status === "error" || status === "ok" ? status : undefined,
        q: url.searchParams.get("q") ?? undefined,
      });
      return json({ traces });
    }

    const traceMatch = /^\/traces\/([^/]+)$/.exec(pathname);
    if (req.method === "GET" && traceMatch) {
      const spans = getTrace(decodeURIComponent(traceMatch[1]));
      if (spans.length === 0) return json({ error: "not found" }, 404);
      return json({ traceId: traceMatch[1], spans });
    }

    if (req.method === "GET" && pathname === "/metrics") {
      const windowMs = parseWindow(url.searchParams.get("window"));
      const sinceMs = Date.now() - windowMs;
      const bucketMs = parseWindow(url.searchParams.get("bucket") ?? "1h");
      return json(getMetrics(sinceMs, bucketMs));
    }

    if (req.method === "GET" && pathname === "/evaluators") {
      return json({ evaluators: listEvaluators() });
    }

    if (req.method === "POST" && pathname === "/evals/run") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body?.evaluatorId || !getEvaluator(body.evaluatorId)) {
        return json({ error: "unknown evaluatorId" }, 400);
      }
      const sampleSize = Math.max(1, Math.min(Number(body.sampleSize ?? 20), 500));
      const run = createEvalRun(body.evaluatorId, sampleSize, body.target);
      return json({ run }, 202);
    }

    if (req.method === "GET" && pathname === "/evals/runs") {
      return json({ runs: listEvalRuns(Number(url.searchParams.get("limit") ?? 50)) });
    }

    const runMatch = /^\/evals\/runs\/([^/]+)$/.exec(pathname);
    if (req.method === "GET" && runMatch) {
      const result = getEvalRun(decodeURIComponent(runMatch[1]));
      if (!result) return json({ error: "not found" }, 404);
      return json(result);
    }

    if (req.method === "GET" && pathname === "/monitors") {
      return json({ monitors: evaluateMonitors() });
    }
    if (req.method === "GET" && pathname === "/alerts") {
      return json({ alerts: listAlerts(Number(url.searchParams.get("limit") ?? 50)) });
    }

    if (pathname === "/") {
      return json({
        service: "respan-ingest",
        endpoints: [
          "POST /ingest",
          "GET /traces",
          "GET /traces/:id",
          "GET /metrics",
          "GET /evaluators",
          "POST /evals/run",
          "GET /evals/runs",
          "GET /evals/runs/:id",
          "GET /monitors",
          "GET /alerts",
          "GET /health",
        ],
      });
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`[respan] ingest + query API on http://localhost:${server.port}`);
if (API_KEY) console.log("[respan] /ingest requires an API key");
