export {};

import OpenAI from "openai";
import { init, wrapOpenAI, flush } from "../sdk/index";
import { runBooking } from "./agent";
import type { Span, IngestBatch } from "../sdk/types";

const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (!url.pathname.endsWith("/chat/completions")) return new Response("no", { status: 404 });
    const body = (await req.json()) as any;
    const wantsJson = body?.response_format?.type === "json_object";
    const content = wantsJson
      ? '{"intent":"booking","service":"dentist"}'
      : "I can offer Tue 10:00 or Wed 09:15. Cancellations need 24h notice — see you then!";
    return Response.json({
      id: "chatcmpl-fake",
      object: "chat.completion",
      model: body?.model ?? "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 },
    });
  },
});
const baseURL = `http://localhost:${fake.port}/v1`;

const captured: Span[] = [];
init({ sink: (b: IngestBatch) => void captured.push(...b.spans), metadata: { test: "agent" } });

const openai = wrapOpenAI(new OpenAI({ apiKey: "test-key", baseURL }));

const reply = await runBooking(openai, "Book me a dentist next week");
await flush();
fake.stop();

const errors: string[] = [];
const names = captured.map((s) => s.name);
const need = ["booking request", "classify intent", "check_availability", "fetch clinic policy", "generate reply"];
for (const n of need) if (!names.includes(n)) errors.push(`missing span "${n}"`);

if (!reply || reply.length < 5) errors.push("empty reply from agent");
if (new Set(captured.map((s) => s.traceId)).size !== 1) errors.push("spans span multiple traces");

const llm = captured.filter((s) => s.type === "llm");
if (llm.length !== 2) errors.push(`expected 2 llm spans, got ${llm.length}`);
if (!llm.every((s) => (s.totalTokens ?? 0) > 0)) errors.push("llm spans missing token counts");
if (!llm.every((s) => (s.costUsd ?? 0) > 0)) errors.push("llm spans missing cost");
const root = captured.find((s) => s.parentId === null);
if (root?.type !== "agent") errors.push("root span is not the agent trace");

console.log(`\nassistant reply: ${reply}`);
console.log("span tree:");
const byId = new Map(captured.map((s) => [s.spanId, s]));
const depth = (s: Span): number => (s.parentId ? depth(byId.get(s.parentId)!) + 1 : 0);
for (const s of [...captured].sort((a, b) => a.startTime - b.startTime)) {
  const cost = s.costUsd ? ` $${s.costUsd}` : "";
  console.log(`${"  ".repeat(depth(s))}• [${s.type}] ${s.name}${cost}`);
}

if (errors.length) {
  console.error("\n❌ FAIL:\n - " + errors.join("\n - "));
  process.exit(1);
}
console.log("\n✅ self-test passed: real OpenAI client → booking agent → nested instrumented trace.");
process.exit(0);
