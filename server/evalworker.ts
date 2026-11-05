import OpenAI from "openai";
import type { Span } from "../sdk/types";
import type { EvalRun } from "./evaltypes";
import { claimNextPendingRun, sampleTargetSpans, getTrace, insertScore, finishRun } from "./db";
import { getEvaluator } from "./evaluators";

const openai = process.env.OPENAI_API_KEY ? new OpenAI() : undefined;

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof (v as any).content === "string") return (v as any).content;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function buildSample(target: Span, traceSpans: Span[]) {
  const root = traceSpans.find((s) => s.parentId === null);
  const input = text(root?.input) || text(target.input);
  const output = text(target.output);
  const context = traceSpans
    .filter((s) => s.type === "tool" || s.type === "retrieval")
    .map((s) => text(s.output))
    .filter(Boolean)
    .join("\n");
  return { input, output, context };
}

export async function processRun(run: EvalRun): Promise<void> {
  const evaluator = getEvaluator(run.evaluatorId);
  if (!evaluator) {
    finishRun(run.id, { totalCount: 0, passCount: 0, avgValue: 0, error: `unknown evaluator ${run.evaluatorId}` });
    return;
  }
  if (evaluator.needsLlm && !openai) {
    finishRun(run.id, {
      totalCount: 0,
      passCount: 0,
      avgValue: 0,
      error: `${evaluator.id} needs OPENAI_API_KEY on the worker`,
    });
    return;
  }

  const spans = sampleTargetSpans(run.target, run.sampleSize);
  let pass = 0;
  let sum = 0;
  let total = 0;

  for (const span of spans) {
    const sample = buildSample(span, getTrace(span.traceId));
    try {
      const res = await evaluator.run(sample, { openai });
      insertScore({
        runId: run.id,
        evaluatorId: evaluator.id,
        traceId: span.traceId,
        spanId: span.spanId,
        value: res.value,
        passed: res.passed,
        label: res.label,
        reasoning: res.reasoning,
      });
      total++;
      sum += res.value;
      if (res.passed) pass++;
    } catch (err) {
      insertScore({
        runId: run.id,
        evaluatorId: evaluator.id,
        traceId: span.traceId,
        spanId: span.spanId,
        value: 0,
        passed: false,
        label: "eval error",
        reasoning: err instanceof Error ? err.message : String(err),
      });
      total++;
    }
  }

  finishRun(run.id, { totalCount: total, passCount: pass, avgValue: total ? sum / total : 0 });
}

export async function drainPending(): Promise<number> {
  let n = 0;
  for (;;) {
    const run = claimNextPendingRun();
    if (!run) break;
    await processRun(run);
    n++;
  }
  return n;
}

async function loop() {
  const once = process.argv.includes("--once");
  console.log(`[respan] eval worker started${once ? " (once)" : ""}; LLM evaluators ${openai ? "enabled" : "DISABLED (no key)"}`);
  for (;;) {
    const handled = await drainPending();
    if (handled) console.log(`[respan] processed ${handled} eval run(s)`);
    if (once) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (import.meta.main) {
  loop().then(() => process.exit(0));
}
