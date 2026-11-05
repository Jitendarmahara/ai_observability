export {};

process.env.RESPAN_DB = ":memory:";
process.env.PORT = "4319";

const BASE = "http://localhost:4319";

const { init, wrapOpenAI, trace, span, flush } = await import("../sdk/index");
await import("./index");

function fakeOpenAI(replies: { content: string; pt: number; ct: number }[]) {
  let i = 0;
  return {
    chat: {
      completions: {
        async create(body: any) {
          const r = replies[Math.min(i++, replies.length - 1)];
          await new Promise((res) => setTimeout(res, 4));
          return {
            choices: [{ message: { role: "assistant", content: r.content } }],
            usage: { prompt_tokens: r.pt, completion_tokens: r.ct, total_tokens: r.pt + r.ct },
            model: body.model,
          };
        },
      },
    },
  };
}

init({ endpoint: BASE, metadata: { project: "inttest" } });
const openai = wrapOpenAI(
  fakeOpenAI([
    { content: '{"intent":"booking"}', pt: 180, ct: 8 },
    { content: "Two slots Tuesday: 10am or 2:30pm.", pt: 420, ct: 60 },
  ]),
);

await trace(
  "booking request",
  async () => {
    await span({ type: "llm", name: "classify intent" }, () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Book me a dentist" }],
      }),
    );
    await span({ type: "tool", name: "check_availability" }, async () => ["10:00", "14:30"]);
    await span({ type: "retrieval", name: "fetch clinic policy" }, async () => "24h notice.");
    return openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Generate reply" }],
    });
  },
  { input: "Book me a dentist" },
);

await flush();

const errors: string[] = [];
const expect = (cond: boolean, msg: string) => void (cond || errors.push(msg));

const health = await (await fetch(`${BASE}/health`)).json();
expect(health.ok === true, "health not ok");
expect(health.spans === 6, `expected 6 spans stored, got ${health.spans}`);
expect(health.traces === 1, `expected 1 trace, got ${health.traces}`);

const { traces } = await (await fetch(`${BASE}/traces`)).json();
expect(traces.length === 1, `expected 1 trace summary, got ${traces.length}`);
expect(traces[0]?.rootName === "booking request", `rootName was ${traces[0]?.rootName}`);
expect(traces[0]?.spanCount === 6, `spanCount was ${traces[0]?.spanCount}`);
expect(traces[0]?.costUsd > 0, "trace cost should be > 0");

const detail = await (await fetch(`${BASE}/traces/${traces[0].traceId}`)).json();
expect(detail.spans.length === 6, `detail spans ${detail.spans.length}`);
const root = detail.spans.find((s: any) => s.parentId === null);
expect(root?.type === "agent", "root not agent");
expect(
  detail.spans.filter((s: any) => s.type === "llm").length === 3,
  "expected 3 llm spans in detail",
);

const metrics = await (await fetch(`${BASE}/metrics?window=1h&bucket=1h`)).json();
expect(metrics.summary.spanCount === 6, `metrics spanCount ${metrics.summary.spanCount}`);
expect(metrics.summary.totalCostUsd > 0, "metrics total cost should be > 0");
expect(metrics.summary.errorRate === 0, `errorRate ${metrics.summary.errorRate}`);

const search = await (await fetch(`${BASE}/traces?q=booking`)).json();
expect(search.traces.length === 1, "search q=booking should match 1 trace");
const searchMiss = await (await fetch(`${BASE}/traces?q=zzzznope`)).json();
expect(searchMiss.traces.length === 0, "search q=zzzznope should match 0 traces");

console.log(`\nhealth: ${JSON.stringify(health)}`);
console.log(`trace:  ${traces[0].rootName} · ${traces[0].spanCount} spans · $${traces[0].costUsd}`);
console.log(`metrics: p95=${metrics.summary.p95LatencyMs}ms  cost=$${metrics.summary.totalCostUsd}`);

if (errors.length) {
  console.error("\n❌ FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("\n✅ self-test passed: SDK → HTTP ingest → SQLite → query API round-trip works.");
process.exit(0);
