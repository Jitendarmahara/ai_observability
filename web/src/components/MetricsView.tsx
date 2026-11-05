import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Metrics } from "../api";
import { fmtUsd, fmtMs, fmtClock } from "../format";

const AXIS = { stroke: "#2d3f52" };
const GRID = "#1b2733";

export function MetricsView({ m }: { m: Metrics | null }) {
  if (!m || m.buckets.length === 0) {
    return (
      <div className="empty">
        No data in this window yet. Run the demo agent or seed some traces, then watch these fill in.
      </div>
    );
  }

  const data = m.buckets.map((b) => ({
    t: fmtClock(b.bucketStart),
    cost: Number(b.costUsd.toFixed(6)),
    p50: b.p50LatencyMs,
    p95: b.p95LatencyMs,
    p99: b.p99LatencyMs,
    spans: b.spanCount,
    errors: b.errorCount,
  }));

  return (
    <div className="grid2">
      <div className="card">
        <h3>Cost over time</h3>
        <p className="sub">USD per bucket · {m.summary.totalTokens.toLocaleString()} tokens total</p>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" axisLine={AXIS} tickLine={false} />
            <YAxis axisLine={AXIS} tickLine={false} tickFormatter={(v) => fmtUsd(v)} width={58} />
            <Tooltip {...tip} formatter={(v: number) => [fmtUsd(v), "cost"]} />
            <Bar dataKey="cost" fill="#f5b945" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Latency percentiles</h3>
        <p className="sub">p50 · p95 · p99 per bucket</p>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" axisLine={AXIS} tickLine={false} />
            <YAxis axisLine={AXIS} tickLine={false} tickFormatter={(v) => fmtMs(v)} width={58} />
            <Tooltip {...tip} formatter={(v: number, n) => [fmtMs(v), n as string]} />
            <Line type="monotone" dataKey="p50" stroke="#2dd4bf" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p95" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="p99" stroke="#a78bfa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Span volume</h3>
        <p className="sub">spans per bucket</p>
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" axisLine={AXIS} tickLine={false} />
            <YAxis axisLine={AXIS} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip {...tip} />
            <Area type="monotone" dataKey="spans" stroke="#2dd4bf" strokeWidth={2} fill="url(#vol)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>Errors</h3>
        <p className="sub">error spans per bucket</p>
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="t" axisLine={AXIS} tickLine={false} />
            <YAxis axisLine={AXIS} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip {...tip} />
            <Bar dataKey="errors" fill="#fb7185" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const tip = {
  contentStyle: {
    background: "#0f1620",
    border: "1px solid #2d3f52",
    borderRadius: 8,
    fontFamily: "JetBrains Mono, monospace",
    fontSize: 12,
  },
  labelStyle: { color: "#9bb0c3" },
} as const;
