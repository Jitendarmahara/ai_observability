# Respan — an LLM observability & evals platform, built end to end

**Datadog + Sentry + a QA-lab for AI apps** — a working, from-scratch
implementation of an LLM observability and evaluation platform. An SDK captures
every step your agent takes as a nested trace, ships it to an ingest backend,
stores it, and surfaces it as live dashboards **and** lets you score it for
quality with code checks, LLM judges, and behavior models.

Both halves of a real platform run locally:

- **Observability** — "what is my AI doing?" → traces, metrics, logs, monitors
- **Evaluation** — "is my AI any good?" → datasets, evaluators, scores, the ship-with-confidence loop

> Full architecture explainer (diagrams): [`docs/architecture.html`](docs/architecture.html)
> Scaling it to production: [`docs/production.md`](docs/production.md)

## Quickstart

```bash
bun install

# 1) ingest + query API
bun run server                 # http://localhost:4318

# 2) workers (separate processes, like production)
bun run eval-worker            # scores traces; add OPENAI_API_KEY for judge/behavior evals
bun run monitor-worker         # fires alerts on threshold breaches

# 3) generate real traffic (needs an OpenAI key)
OPENAI_API_KEY=sk-... bun run seed 30
#   or a single run:  OPENAI_API_KEY=sk-... bun run demo "Book me a dentist"

# 4) the dashboard
bun run web                    # http://localhost:5173
```

No OpenAI key? Every component has a key-free self-test (see **Tests** below) that
exercises the real code paths against local fakes.

## The four surfaces

1. **SDK** (`sdk/`) — `wrapOpenAI(client)` captures every call as a span; `trace()`,
   `span()`, `step()` build the nested tree. Batched, async, **fire-and-forget**:
   if Respan is down, the customer's app keeps serving users.
2. **Ingest + query API** (`server/`) — receives span batches (authn, validate,
   cost-enrich), stores them, and answers the dashboard's queries.
3. **Workers** (`server/evalworker.ts`, `server/monitorworker.ts`) — slow/bursty
   work on its own compute, off the ingest path.
4. **Dashboard** (`web/`, React + Recharts) — Overview (cost / latency p50-p95-p99
   / volume / errors), Traces (search + nested trace viewer), Evals (run
   evaluators, watch pass rates, drill into failures), Monitors (live status + alert feed).

## How the code maps to the concepts

| Concept | Where |
|---|---|
| Trace / span data model | `sdk/types.ts` |
| One-line capture | `sdk/index.ts` → `wrapOpenAI` |
| Fire-and-forget export | `sdk/exporter.ts` |
| Cost accounting | `sdk/pricing.ts` |
| Write path (ingest) + read path (queries) | `server/index.ts` |
| Columnar store stand-in | `server/db.ts` (SQLite → ClickHouse in prod) |
| Evaluators: code / LLM-judge / behavior | `server/evaluators.ts` |
| Eval worker pool | `server/evalworker.ts` |
| Monitors & alerting | `server/monitors.ts`, `server/monitorworker.ts` |
| The booking demo agent | `demo/agent.ts` |

## Scripts

| Command | What it does |
|---|---|
| `bun run server` | Ingest + query API on `:4318` |
| `bun run web` | Vite dashboard on `:5173` (proxies `/api` → server) |
| `bun run eval-worker` | Processes eval-run jobs (`--once` to drain and exit) |
| `bun run monitor-worker` | Evaluates monitors, fires alerts (+ optional webhook) |
| `bun run demo "..."` | One booking conversation → one trace |
| `bun run seed N` | Backfill N booking traces |
| `bun run typecheck` | `tsc --noEmit` across the repo |

## Tests (no key, no cost)

```bash
bun sdk/selftest.ts        # SDK: nested trace + cost accounting
bun server/inttest.ts      # SDK → HTTP ingest → SQLite → query API round-trip
bun demo/agenttest.ts      # real OpenAI client → booking agent → instrumented trace
bun server/evaltest.ts     # code + LLM-judge + behavior evaluators
bun server/monitortest.ts  # monitor evaluation + fire-on-transition
```

## Project layout

```
sdk/      the installable client — wrapOpenAI, trace/span/step, exporter, pricing
server/   ingest+query API, SQLite store, evaluators, eval & monitor workers
web/      React + Recharts dashboard (overview, traces, evals, monitors)
demo/     the booking-assistant agent + seeder
docs/     architecture.html (the explainer), production.md
deploy/   k8s.yaml sketch + Dockerfile (repo root)
```

## Stack

Bun · TypeScript · React + Recharts · SQLite (→ ClickHouse) · OpenAI SDK.
Production targets: ClickHouse, Kafka, S3, Postgres, Redis, Kubernetes + HPA — see
[`docs/production.md`](docs/production.md).
