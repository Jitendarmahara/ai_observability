import { useEffect, useState } from "react";
import { api, type MonitorStatus, type AlertEvent } from "../api";
import { fmtTime } from "../format";

function fmtVal(unit: string, v: number): string {
  if (unit === "%") return `${(v * 100).toFixed(1)}%`;
  if (unit === "ms") return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

export function MonitorsView() {
  const [monitors, setMonitors] = useState<MonitorStatus[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);

  useEffect(() => {
    const refresh = () => {
      api.monitors().then((r) => setMonitors(r.monitors)).catch(() => {});
      api.alerts().then((r) => setAlerts(r.alerts)).catch(() => {});
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="evalgrid">
        {monitors.map((m) => {
          const pct = Math.min(100, m.threshold ? (m.observed / m.threshold) * 50 : 0);
          return (
            <div className="evalcard" key={m.id}>
              <h4>
                <span className={`badge ${m.firing ? "error" : "ok"}`}>{m.firing ? "firing" : "ok"}</span>
                {m.name}
              </h4>
              <p>{m.description}</p>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: m.firing ? "#fb7185" : "#e6edf3", fontWeight: 700 }}>
                  {fmtVal(m.unit, m.observed)}
                </span>
                <span style={{ color: "#6b8299" }}>threshold {fmtVal(m.unit, m.threshold)}</span>
              </div>
              <div className="ratebar">
                <span style={{ width: `${pct}%`, background: m.firing ? "#fb7185" : "#2dd4bf" }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Alert feed</h3>
        <p className="sub">
          fired on ok→breach transition · resolved on recovery · start the monitor worker to populate
        </p>
        {alerts.length === 0 ? (
          <div className="empty">
            No alerts yet. Run <span className="mono">bun run monitor-worker</span>, then trip a threshold.
          </div>
        ) : (
          alerts.map((a) => (
            <div className="runrow" key={a.id} style={{ gridTemplateColumns: "28px 1fr 90px", cursor: "default" }}>
              <span>{a.kind === "fired" ? "🔴" : "🟢"}</span>
              <span className={a.kind === "fired" ? "" : ""} style={{ color: a.kind === "fired" ? "#fb7185" : "#2dd4bf" }}>
                {a.message}
              </span>
              <span className="mono" style={{ color: "#6b8299" }}>
                {fmtTime(a.createdAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
