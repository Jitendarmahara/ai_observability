import { evaluateMonitors, formatValue, type MonitorStatus } from "./monitors";
import { insertAlert, type AlertEvent } from "./db";

const INTERVAL = Number(process.env.RESPAN_MONITOR_INTERVAL_MS ?? 5000);
const WEBHOOK = process.env.RESPAN_ALERT_WEBHOOK;

export function tick(wasFiring: Set<string>): { firing: Set<string>; events: AlertEvent[] } {
  const statuses = evaluateMonitors();
  const firing = new Set<string>();
  const events: AlertEvent[] = [];

  for (const s of statuses) {
    if (s.firing) firing.add(s.id);
    const was = wasFiring.has(s.id);
    if (s.firing && !was) events.push(fire(s, "fired"));
    else if (!s.firing && was) events.push(fire(s, "resolved"));
  }
  return { firing, events };
}

function fire(s: MonitorStatus, kind: "fired" | "resolved"): AlertEvent {
  const message =
    kind === "fired"
      ? `${s.name} breached: ${formatValue(s, s.observed)} > ${formatValue(s, s.threshold)}`
      : `${s.name} recovered: ${formatValue(s, s.observed)} ≤ ${formatValue(s, s.threshold)}`;
  const event = insertAlert({
    monitorId: s.id,
    kind,
    observed: s.observed,
    threshold: s.threshold,
    message,
  });
  return event;
}

async function dispatch(event: AlertEvent) {
  const icon = event.kind === "fired" ? "🔴" : "🟢";
  console.log(`${icon} [alert] ${event.message}`);
  if (WEBHOOK) {
    try {
      await fetch(WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `${icon} ${event.message}`, event }),
      });
    } catch (err) {
      console.warn("[alert] webhook failed:", err instanceof Error ? err.message : err);
    }
  }
}

async function loop() {
  console.log(`[respan] monitor worker started; interval ${INTERVAL}ms; webhook ${WEBHOOK ? "on" : "off"}`);
  let firing = new Set<string>();
  for (;;) {
    const res = tick(firing);
    firing = res.firing;
    for (const e of res.events) await dispatch(e);
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

if (import.meta.main) loop();
