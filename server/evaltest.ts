export {};
import { randomUUID } from "node:crypto";
import type { Span } from "../sdk/types";

process.env.RESPAN_DB = ":memory:";

const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (!u.pathname.endsWith("/chat/completions")) return new Response("no", { status: 404 });
    return Response.json({
      id: "x",
      choices: [
        { index: 0, message: { role: "assistant", content: '{"score":5,"probability":0.1,"reasoning":"grounded and helpful"}' }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
    });
  },
});
process.env.OPENAI_API_KEY = "test";
process.env.OPENAI_BASE_URL = `http://localhost:${fake.port}/v1`;

const db = await import("./db");
const worker = await import("./evalworker");

function makeTrace(userMsg: string, reply: string, withContext = true): Span[] {
  const traceId = randomUUID();
  const now = Date.now();
  const root = span(traceId, null, "agent", "booking request", userMsg, reply, now);
  const classify = span(traceId, root.spanId, "llm", "classify intent", userMsg, '{"intent":"booking"}', now, "gpt-4o-mini", 60);
  const tool = span(traceId, root.spanId, "tool", "check_availability", {}, withContext ? ["Tue 10:00", "Wed 09:15"] : [], now);
  const ret = span(traceId, root.spanId, "retrieval", "fetch clinic policy", {}, withContext ? "Cancellations require 24h notice." : "", now);
  const gen = span(traceId, root.spanId, "llm", "generate reply", userMsg, { role: "assistant", content: reply }, now, "gpt-4o", 180);
  return [root, classify, tool, ret, gen];
}
function span(
  traceId: string, parentId: string | null, type: Span["type"], name: string,
  input: unknown, output: unknown, t: number, model?: string, tokens?: number,
): Span {
  return {
    traceId, spanId: randomUUID(), parentId, type, name, input, output,
    model, totalTokens: tokens, promptTokens: tokens, completionTokens: 0,
    costUsd: tokens ? 0.0001 : undefined, latencyMs: 10 + Math.random() * 40,
    status: "ok", startTime: t, endTime: t + 20,
  };
}

db.insertSpans(makeTrace("Book me a dentist", "I can offer Tue 10:00 or Wed 09:15. Cancellations need 24h notice."));
db.insertSpans(makeTrace("Book me a dentist", "ok"));

const errors: string[] = [];
const expect = (c: boolean, m: string) => void (c || errors.push(m));

const codeRun = db.createEvalRun("reply-has-slot", 10);
await worker.drainPending();
const code = db.getEvalRun(codeRun.id)!;
console.log(`\ncode  [reply-has-slot]  status=${code.run.status} pass=${code.run.passCount}/${code.run.totalCount}`);
expect(code.run.status === "done", "code run not done");
expect(code.run.totalCount === 2, `code total ${code.run.totalCount} (want 2)`);
expect(code.run.passCount === 1, `code pass ${code.run.passCount} (want 1: good passes, bad fails)`);
for (const s of code.scores) console.log(`   · ${s.passed ? "PASS" : "FAIL"} ${s.label}`);

const judgeRun = db.createEvalRun("helpfulness-judge", 10);
await worker.drainPending();
const judge = db.getEvalRun(judgeRun.id)!;
console.log(`\njudge [helpfulness-judge] status=${judge.run.status} avg=${judge.run.avgValue.toFixed(2)} pass=${judge.run.passCount}/${judge.run.totalCount}`);
expect(judge.run.status === "done", `judge status ${judge.run.status} ${judge.run.error ?? ""}`);
expect(judge.run.totalCount === 2, `judge total ${judge.run.totalCount}`);
expect(judge.scores.every((s) => !!s.reasoning), "judge scores missing reasoning");
expect(judge.scores.every((s) => s.value === 1), "judge value should be 5/5=1 from fake");

const behRun = db.createEvalRun("no-hallucination", 10);
await worker.drainPending();
const beh = db.getEvalRun(behRun.id)!;
console.log(`\nbehav [no-hallucination]  status=${beh.run.status} pass=${beh.run.passCount}/${beh.run.totalCount}`);
expect(beh.run.status === "done", "behavior run not done");
expect(beh.scores.every((s) => s.passed), "behavior should pass (prob 0.1 < 0.5)");

fake.stop();

if (errors.length) {
  console.error("\n❌ FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("\n✅ self-test passed: code + LLM-judge + behavior evaluators run on sampled traces, scores link to spans.");
process.exit(0);
