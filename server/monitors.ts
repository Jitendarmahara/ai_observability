import { getMetrics } from "./db";

export type MonitorMetric = "errorRate" | "p95LatencyMs" | "totalCostUsd";

export interface MonitorDef {
  id: string;
  name: string;
  metric: MonitorMetric;
  windowMs: number;
  threshold: number;
  unit: "%" | "ms" | "$";
  description: string;
}

const MIN = 60_000;
const HOUR = 3_600_000;

export const MONITORS: MonitorDef[] = [
  {
    id: "error-rate",
    name: "Error rate",
    metric: "errorRate",
    windowMs: 15 * MIN,
    threshold: Number(process.env.RESPAN_MON_ERROR_RATE ?? 0.05),
    unit: "%",
    description: "Share of spans erroring in the last 15 minutes.",
  },
  {
    id: "p95-latency",
    name: "p95 latency",
    metric: "p95LatencyMs",
    windowMs: 15 * MIN,
    threshold: Number(process.env.RESPAN_MON_P95_MS ?? 8000),
    unit: "ms",
    description: "95th-percentile span latency in the last 15 minutes.",
  },
  {
    id: "spend",
    name: "Spend (24h)",
    metric: "totalCostUsd",
    windowMs: 24 * HOUR,
    threshold: Number(process.env.RESPAN_MON_SPEND_USD ?? 0.5),
    unit: "$",
    description: "Total LLM spend in the last 24 hours.",
  },
];

export interface MonitorStatus extends MonitorDef {
  observed: number;
  firing: boolean;
}

export function evaluateMonitors(now = Date.now()): MonitorStatus[] {
  return MONITORS.map((m) => {
    const metrics = getMetrics(now - m.windowMs, m.windowMs);
    const observed = metrics.summary[m.metric];
    return { ...m, observed, firing: observed > m.threshold };
  });
}

export function formatValue(m: MonitorDef, v: number): string {
  if (m.unit === "%") return `${(v * 100).toFixed(1)}%`;
  if (m.unit === "ms") return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}
