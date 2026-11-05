import type { Metrics } from "../api";
import { fmtUsd, fmtMs, fmtNum } from "../format";

export function StatTiles({ m }: { m: Metrics | null }) {
  const s = m?.summary;
  const errPct = s ? (s.errorRate * 100).toFixed(1) : "0.0";
  return (
    <div className="tiles">
      <Tile label="Traces" value={s ? fmtNum(s.traceCount) : "—"} />
      <Tile label="Spans" value={s ? fmtNum(s.spanCount) : "—"} />
      <Tile label="Total cost" value={s ? fmtUsd(s.totalCostUsd) : "—"} />
      <Tile label="p95 latency" value={s ? fmtMs(s.p95LatencyMs) : "—"} />
      <Tile label="Error rate" value={`${errPct}%`} err={!!s && s.errorRate > 0} />
    </div>
  );
}

function Tile({ label, value, err }: { label: string; value: string; err?: boolean }) {
  return (
    <div className={`tile${err ? " err" : ""}`}>
      <div className="label">{label}</div>
      <div className={`value${value.length > 7 ? " small" : ""}`}>{value}</div>
    </div>
  );
}
