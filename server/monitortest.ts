export {};
import { randomUUID } from "node:crypto";
import type { Span } from "../sdk/types";

process.env.RESPAN_DB = ":memory:";
process.env.RESPAN_MON_ERROR_RATE = "0.05";
process.env.RESPAN_MON_SPEND_USD = "0.5";
process.env.RESPAN_MON_P95_MS = "8000";

const db = await import("./db");
const { evaluateMonitors } = await import("./monitors");
const { tick } = await import("./monitorworker");

const now = Date.now();
const spans: Span[] = Array.from({ length: 10 }, (_, i) => ({
  traceId: randomUUID(),
  spanId: randomUUID(),
  parentId: null,
  type: "llm",
  name: "generate reply",
  input: "q",
  output: "a",
  model: "gpt-4o",
  totalTokens: 100,
  costUsd: 0.1,
  latencyMs: 200 + i * 50,
  status: i < 3 ? "error" : "ok",
  startTime: now,
  endTime: now + 200,
}));
db.insertSpans(spans);

const errors: string[] = [];
const expect = (c: boolean, m: string) => void (c || errors.push(m));

const statuses = evaluateMonitors();
const byId = new Map(statuses.map((s) => [s.id, s]));
console.log("monitor statuses:");
for (const s of statuses) console.log(`  ${s.firing ? "🔴" : "🟢"} ${s.name}: observed=${s.observed}`);

expect(byId.get("error-rate")!.firing === true, "error-rate should fire (30% > 5%)");
expect(byId.get("spend")!.firing === true, "spend should fire ($1.00 > $0.50)");
expect(byId.get("p95-latency")!.firing === false, "p95 should NOT fire (<8s)");

const first = tick(new Set<string>());
console.log(`\nfirst tick: ${first.events.length} events (${first.events.map((e) => e.kind).join(",")})`);
expect(first.events.length === 2, `first tick should emit 2 fired events, got ${first.events.length}`);
expect(first.events.every((e) => e.kind === "fired"), "first-tick events should be 'fired'");

const second = tick(first.firing);
expect(second.events.length === 0, `second tick should emit 0 events, got ${second.events.length}`);

const alerts = db.listAlerts();
expect(alerts.length === 2, `expected 2 persisted alerts, got ${alerts.length}`);

if (errors.length) {
  console.error("\n❌ FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("\n✅ self-test passed: monitors evaluate correctly and fire once per ok→breach transition.");
process.exit(0);
