# From this demo to production

This repo runs the **entire** observability + evals product on a laptop. Every
component is deliberately a local stand-in for a production-grade one, chosen so
the *logic* is identical and only the *platform* changes. That's the honest
engineering lesson from the architecture (§11): **build the logic first; let the
platform scale it.**

Here is exactly what you swap, and why.

| Concern | This demo | Production | Why the swap |
|---|---|---|---|
| Span store | SQLite (`server/db.ts`) | **ClickHouse** | Columnar scans + 10×+ compression over billions of rows; SQLite can't aggregate "p95 per model per hour over 30d" at scale |
| Durable buffer | direct insert in the ingest handler | **Kafka / Redpanda** | Absorb bursty 100k+ inserts/sec, decouple intake from the DB, survive DB outages, replay, fan-out to evals + monitors |
| Fat payloads | JSON columns inline | **S3 / object store** | Keep the hot analytics store lean; 100KB+ prompts would wreck compression and scan speed |
| Metadata | (none separate yet) | **Postgres** | ACID config/auth/prompt versions — the opposite shape of append-only spans |
| Cache / rate-limit | (none yet) | **Redis** | Sub-100ms repeat dashboard reads, per-key throttling, batch dedup |
| Ingest / query / workers | one `Bun.serve` process | **stateless pods on Kubernetes** (HPA) | Each tier scales to its own very different load; autoscale on CPU / queue-lag; self-heal; zero-downtime deploys |
| Eval workers | `server/evalworker.ts` (one process) | **a worker pool** scaled on backlog | Evals are slow + bursty (LLM calls = seconds); must never starve ingest |
| Monitors | `server/monitorworker.ts` polling metrics | **a Kafka consumer group** evaluating the live stream | Real-time detection without competing with user dashboards |

## The one invariant that never changes

The **write path shape** is the same at every scale:

```
SDK (fire-and-forget) → ingress → stateless ingest (authn, cost, offload blobs)
  → durable buffer → batched insert into the columnar store
```

In the demo the "durable buffer" is a function call and the "columnar store" is
SQLite. In production they're Kafka and ClickHouse. The SDK, the span model, the
eval loop, and every screen in the UI are **byte-for-byte the same code**.

## What you'd build next, in order

1. **Swap the store behind an interface.** `server/db.ts` already isolates all
   SQL. Introduce a `SpanStore` interface with `insertSpans` / `listTraces` /
   `getMetrics` and add a ClickHouse implementation; keep SQLite for local dev.
2. **Insert a queue.** Move the `insertSpans` call in `/ingest` behind a Kafka
   produce; have `server/evalworker.ts`-style consumers do the batched writes.
3. **Offload blobs.** In the ingest path, push `input`/`output` over a size
   threshold to S3 and store only the key; the trace viewer already lazy-loads
   payloads, so only the read side changes.
4. **Containerize + orchestrate.** See `Dockerfile` and `deploy/k8s.yaml` for the
   shape: separate Deployments for ingest, query, eval-worker, monitor-worker,
   each with its own HPA.
5. **Observe the observer.** Prometheus + Grafana on the platform itself —
   SLOs on your own ingest lag and query latency.

None of these change what the product *does*. They change how much it can take.
