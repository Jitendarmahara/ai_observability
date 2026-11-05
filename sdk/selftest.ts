import { init, wrapOpenAI, trace, span, flush } from "./index";
import type { Span, IngestBatch } from "./types";

function fakeOpenAI(replies: Record<string, { content: string; pt: number; ct: number }>) {
  let i = 0;
  const order = Object.keys(replies);
  return {
    chat: {
      completions: {
        async create(body: any) {
          const key = order[i++] ?? order[order.length - 1];
          const r = replies[key];
          await new Promise((res) => setTimeout(res, 5));
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

const captured: Span[] = [];
init({
  debug: true,
  sink: (batch: IngestBatch) => {
    captured.push(...batch.spans);
  },
  metadata: { project: "selftest", env: "local" },
});

const openai = wrapOpenAI(
  fakeOpenAI({
    classify: { content: '{"intent":"booking"}', pt: 180, ct: 8 },
    reply: { content: "I found two slots Tuesday: 10am or 2:30pm.", pt: 420, ct: 60 },
  }),
);

await trace(
  "booking request",
  async () => {
    await span({ type: "llm", name: "classify intent" }, async () => {
      return openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Book me a dentist next week" }],
      });
    });

    await span({ type: "tool", name: "check_availability" }, async () => {
      await new Promise((r) => setTimeout(r, 3));
      return ["10:00", "14:30"];
    });

    await span({ type: "retrieval", name: "fetch clinic policy" }, async () => {
      await new Promise((r) => setTimeout(r, 2));
      return "Cancellations require 24h notice.";
    });

    return openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Generate the reply" }],
    });
  },
  { input: "Book me a dentist next week", metadata: { userId: "u_123" } },
);

await flush();

console.log("\n── captured trace ──");
const byId = new Map(captured.map((s) => [s.spanId, s]));
const depth = (s: Span): number => (s.parentId ? depth(byId.get(s.parentId)!) + 1 : 0);
const sorted = [...captured].sort((a, b) => a.startTime - b.startTime);
for (const s of sorted) {
  const pad = "  ".repeat(depth(s));
  const cost = s.costUsd ? ` $${s.costUsd}` : "";
  const tok = s.totalTokens ? ` ${s.totalTokens}tok` : "";
  console.log(`${pad}• [${s.type}] ${s.name} — ${s.latencyMs}ms${tok}${cost} (${s.status})`);
}

const errors: string[] = [];
const root = captured.find((s) => s.parentId === null);
if (!root) errors.push("no root span");
if (root && root.type !== "agent") errors.push("root is not an agent span");
if (new Set(captured.map((s) => s.traceId)).size !== 1)
  errors.push("spans are not all in the same trace");
const llmSpans = captured.filter((s) => s.type === "llm");
if (llmSpans.length < 2) errors.push("expected >= 2 llm spans");
const totalCost = captured.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
if (totalCost <= 0) errors.push("total cost should be > 0");
if (!captured.every((s) => (s.metadata as any)?.project === "selftest"))
  errors.push("default metadata not applied");

console.log(
  `\ntrace total: $${totalCost.toFixed(6)} across ${captured.length} spans (${llmSpans.length} llm)`,
);
if (errors.length) {
  console.error("\n❌ FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("\n✅ self-test passed: SDK captures a nested trace with cost accounting.");
