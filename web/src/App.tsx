import { useCallback, useEffect, useState } from "react";
import { api, type Metrics, type TraceSummary } from "./api";
import { StatTiles } from "./components/StatTiles";
import { MetricsView } from "./components/MetricsView";
import { LogsExplorer } from "./components/LogsExplorer";
import { TraceViewer } from "./components/TraceViewer";
import { EvalsView } from "./components/EvalsView";
import { MonitorsView } from "./components/MonitorsView";

type Tab = "overview" | "traces" | "evals" | "monitors";

export default function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        api.metrics("24h", "5m"),
        api.traces({ q, status, limit: 100 }),
      ]);
      setMetrics(m);
      setTraces(t.traces);
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [q, status]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000); // poll for a "live" feel
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="app">
      <header className="top">
        <div>
          <div className="brand">
            Res<span className="g">pan</span>
          </div>
          <div className="kicker">LLM Observability</div>
        </div>
        <div className="live">
          <span className={`dot${live ? "" : " stale"}`} />
          {live ? "live" : "offline — is the server running?"}
        </div>
      </header>

      <StatTiles m={metrics} />

      <div className="tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button className={tab === "traces" ? "active" : ""} onClick={() => setTab("traces")}>
          Traces
        </button>
        <button className={tab === "evals" ? "active" : ""} onClick={() => setTab("evals")}>
          Evals
        </button>
        <button className={tab === "monitors" ? "active" : ""} onClick={() => setTab("monitors")}>
          Monitors
        </button>
      </div>

      {tab === "overview" && <MetricsView m={metrics} />}
      {tab === "traces" && (
        <LogsExplorer
          traces={traces}
          q={q}
          status={status}
          onQuery={setQ}
          onStatus={setStatus}
          onOpen={setOpen}
        />
      )}
      {tab === "evals" && <EvalsView onOpenTrace={setOpen} />}
      {tab === "monitors" && <MonitorsView />}

      {open && <TraceViewer traceId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
