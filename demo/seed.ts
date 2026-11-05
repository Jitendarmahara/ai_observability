import { init, flush } from "../sdk/index";
import { createAgent, runBooking, SAMPLE_MESSAGES } from "./agent";

const ENDPOINT = process.env.RESPAN_ENDPOINT ?? "http://localhost:4318";
const COUNT = Math.max(1, Number(process.argv[2] ?? 12));
const CONCURRENCY = 3;

async function main() {
  init({ endpoint: ENDPOINT, apiKey: process.env.RESPAN_API_KEY });
  const openai = createAgent();

  console.log(`Seeding ${COUNT} booking traces → ${ENDPOINT} (concurrency ${CONCURRENCY})`);
  console.log("This calls the real OpenAI API and spends tokens.\n");

  let done = 0;
  let failed = 0;
  const queue = Array.from({ length: COUNT }, (_, i) => i);

  async function worker() {
    for (;;) {
      const i = queue.shift();
      if (i === undefined) return;
      const msg = SAMPLE_MESSAGES[i % SAMPLE_MESSAGES.length];
      try {
        await runBooking(openai, msg);
        done++;
      } catch (err) {
        failed++;
        console.warn(`  run ${i} failed: ${err instanceof Error ? err.message : err}`);
      }
      process.stdout.write(`\r  ${done + failed}/${COUNT} done`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();
  console.log(`\n\n✓ seeded ${done} traces (${failed} failed). Open the dashboard to explore them.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
