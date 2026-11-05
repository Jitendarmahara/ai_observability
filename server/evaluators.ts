import type OpenAI from "openai";
import type { EvaluatorMeta, EvaluatorType } from "./evaltypes";

export interface EvalSample {
  input: string;
  output: string;
  context: string;
}

export interface EvalResult {
  value: number;
  passed: boolean;
  label: string;
  reasoning?: string;
}

export interface EvalContext {
  openai?: OpenAI;
}

interface EvaluatorDef extends EvaluatorMeta {
  run(sample: EvalSample, ctx: EvalContext): Promise<EvalResult>;
}

const JUDGE_MODEL = process.env.RESPAN_JUDGE_MODEL ?? "gpt-4o-mini";

const hasSlot: EvaluatorDef = {
  id: "reply-has-slot",
  name: "Offers a time slot",
  type: "code",
  description: "The reply proposes a concrete day or time (e.g. 'Tue 10:00').",
  needsLlm: false,
  async run({ output }) {
    const hit = /\b(\d{1,2}:\d{2}|mon|tue|wed|thu|fri|sat|sun)/i.test(output);
    return { value: hit ? 1 : 0, passed: hit, label: hit ? "has slot" : "no slot" };
  },
};

const mentionsPolicy: EvaluatorDef = {
  id: "reply-mentions-policy",
  name: "Mentions cancellation policy",
  type: "code",
  description: "The reply references the 24h notice / cancellation policy.",
  needsLlm: false,
  async run({ output }) {
    const hit = /notice|cancel|24\s*h|hours?/i.test(output);
    return { value: hit ? 1 : 0, passed: hit, label: hit ? "mentions policy" : "omits policy" };
  },
};

const validLength: EvaluatorDef = {
  id: "reply-valid-length",
  name: "Reasonable length",
  type: "code",
  description: "The reply is between 20 and 600 characters (not empty, not a wall of text).",
  needsLlm: false,
  async run({ output }) {
    const n = output.trim().length;
    const ok = n >= 20 && n <= 600;
    return { value: ok ? 1 : 0, passed: ok, label: `${n} chars` };
  },
};

const helpfulness: EvaluatorDef = {
  id: "helpfulness-judge",
  name: "Helpfulness (LLM judge)",
  type: "llm_judge",
  description: "An LLM scores how helpful & correct the reply is for the request, 1–5.",
  needsLlm: true,
  async run({ input, output }, ctx) {
    if (!ctx.openai) throw new Error("helpfulness-judge needs an OpenAI key on the worker");
    const r = await ctx.openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You are a strict evaluator for a dental-clinic booking assistant. Score how helpful and correct the ASSISTANT reply is for the USER request. Respond ONLY as JSON: {"score": 1-5, "reasoning": "one sentence"}.',
        },
        { role: "user", content: `USER: ${input}\n\nASSISTANT: ${output}` },
      ],
    });
    const parsed = safeJson(r.choices[0]?.message?.content);
    const score = clamp(Number(parsed.score) || 0, 0, 5);
    return {
      value: score / 5,
      passed: score >= 4,
      label: `${score}/5`,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  },
};

const noHallucination: EvaluatorDef = {
  id: "no-hallucination",
  name: "Grounded (no hallucination)",
  type: "behavior",
  description:
    "Probability the reply states facts NOT supported by the retrieved context; passes when low.",
  needsLlm: true,
  async run({ output, context }, ctx) {
    if (!ctx.openai) throw new Error("no-hallucination needs an OpenAI key on the worker");
    const r = await ctx.openai.chat.completions.create({
      model: JUDGE_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Estimate the probability (0.0–1.0) that the REPLY contains a factual claim NOT supported by the CONTEXT (a hallucination). Respond ONLY as JSON: {"probability": 0.0-1.0, "reasoning": "one sentence"}.',
        },
        { role: "user", content: `CONTEXT:\n${context || "(none)"}\n\nREPLY:\n${output}` },
      ],
    });
    const parsed = safeJson(r.choices[0]?.message?.content);
    const p = clamp(Number(parsed.probability) || 0, 0, 1);
    return {
      value: 1 - p,
      passed: p < 0.5,
      label: p < 0.5 ? "grounded" : "hallucinated",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  },
};

const ALL: EvaluatorDef[] = [hasSlot, mentionsPolicy, validLength, helpfulness, noHallucination];
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

export function getEvaluator(id: string): EvaluatorDef | undefined {
  return BY_ID.get(id);
}

export function listEvaluators(): EvaluatorMeta[] {
  return ALL.map(({ id, name, type, description, needsLlm }) => ({ id, name, type, description, needsLlm }));
}

export type { EvaluatorType };

function safeJson(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
