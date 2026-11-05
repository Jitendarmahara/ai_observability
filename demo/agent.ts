import OpenAI from "openai";
import { init, wrapOpenAI, trace, step, span, shutdown } from "../sdk/index";

const CLASSIFY_MODEL = process.env.RESPAN_CLASSIFY_MODEL ?? "gpt-4o-mini";
const REPLY_MODEL = process.env.RESPAN_REPLY_MODEL ?? "gpt-4o";
const ENDPOINT = process.env.RESPAN_ENDPOINT ?? "http://localhost:4318";

export function createAgent(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Export it, then re-run (this demo calls the real API).");
  }
  return wrapOpenAI(new OpenAI());
}

export const SAMPLE_MESSAGES = [
  "Book me a dentist appointment next week",
  "I need to see a dentist for a cleaning, what's available?",
  "Can I move my checkup to Wednesday?",
  "Do you have any evening slots for a filling?",
  "I'd like to cancel my appointment on Friday",
  "What's the earliest I can come in for a toothache?",
  "Schedule a routine cleaning for my son",
  "Is there availability this week for a crown fitting?",
];

export async function runBooking(openai: OpenAI, userMessage: string): Promise<string> {
  return trace(
    "booking request",
    async () => {
      await step("classify intent", async () => {
        const r = await openai.chat.completions.create({
          model: CLASSIFY_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'Classify the dental-clinic request. Respond ONLY with JSON: {"intent":"booking"|"reschedule"|"cancel"|"question","service":string}.',
            },
            { role: "user", content: userMessage },
          ],
        });
        return r.choices[0]?.message?.content ?? "{}";
      });

      const slots = await span(
        { type: "tool", name: "check_availability", input: { clinic: "downtown" } },
        async () => {
          await sleep(40 + Math.random() * 160);
          return ["Tue 10:00", "Tue 14:30", "Wed 09:15"];
        },
      );

      const policy = await span({ type: "retrieval", name: "fetch clinic policy" }, async () => {
        await sleep(15 + Math.random() * 60);
        return "Cancellations require 24h notice. New patients should arrive 10 minutes early.";
      });

      const reply = await step("generate reply", async () => {
        const r = await openai.chat.completions.create({
          model: REPLY_MODEL,
          temperature: 0.4,
          messages: [
            {
              role: "system",
              content:
                "You are a friendly dental-clinic booking assistant. Offer the available slots, mention the cancellation policy briefly, and keep it to 2-3 sentences.",
            },
            { role: "user", content: userMessage },
            {
              role: "assistant",
              content: `Context — available slots: ${slots.join(", ")}. Policy: ${policy}`,
            },
          ],
        });
        return r.choices[0]?.message?.content ?? "";
      });

      return reply;
    },
    { input: userMessage, metadata: { demo: "booking" } },
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  init({ endpoint: ENDPOINT, apiKey: process.env.RESPAN_API_KEY, debug: true });
  const openai = createAgent();
  const query = process.argv.slice(2).join(" ").trim() || SAMPLE_MESSAGES[0];

  console.log(`\n> ${query}\n`);
  const reply = await runBooking(openai, query);
  console.log(`\nassistant: ${reply}\n`);

  await shutdown();
  console.log(`✓ trace sent to ${ENDPOINT} — open the dashboard to see it.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
