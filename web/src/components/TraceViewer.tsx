import { useEffect, useState } from "react";
import { api, type Span } from "../api";
import { fmtUsd, fmtMs, pretty } from "../format";

export function TraceViewer({ traceId, onClose }: { traceId: string; onClose: () => void }) {
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .trace(traceId)
      .then((r) => alive && setSpans(r.spans))
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [traceId]);

  const maxLatency = spans ? Math.max(...spans.map((s) => s.latencyMs), 1) : 1;
  const depthOf = (s: Span, byId: Map<string, Span>): number =>
    s.parentId && byId.get(s.parentId) ? depthOf(byId.get(s.parentId)!, byId) + 1 : 0;

  const byId = new Map((spans ?? []).map((s) => [s.spanId, s]));
  const ordered = (spans ?? []).slice().sort((a, b) => a.startTime - b.startTime);
  const root = ordered.find((s) => s.parentId === null);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <div className="kicker mono" style={{ color: "#6b8299", fontSize: 11 }}>
          TRACE · {traceId.slice(0, 12)}
        </div>
        <h2 style={{ margin: "4px 0 2px", fontSize: 20 }}>{root?.name ?? "trace"}</h2>
        {root && (
          <p className="mono" style={{ color: "#9bb0c3", fontSize: 12, margin: "0 0 18px" }}>
            {fmtMs(root.latencyMs)} ·{" "}
            {fmtUsd(ordered.reduce((n, s) => n + (s.costUsd ?? 0), 0))} ·{" "}
            {ordered.reduce((n, s) => n + (s.totalTokens ?? 0), 0).toLocaleString()} tokens ·{" "}
            {ordered.length} spans
          </p>
        )}

        {err && <div className="err-note">Failed to load: {err}</div>}
        {!spans && !err && <div className="empty">Loading…</div>}

        {ordered.map((s) => (
          <div
            key={s.spanId}
            className="spanrow"
            style={{ marginLeft: depthOf(s, byId) * 18 }}
          >
            <div className="head">
              <span className={`badge ${s.type}`}>{s.type}</span>
              <span className="name">{s.name}</span>
              <span className="meta">
                {s.model && <span>{s.model}</span>}
                {s.totalTokens != null && <span>{s.totalTokens} tok</span>}
                {s.costUsd ? <span style={{ color: "#f5b945" }}>{fmtUsd(s.costUsd)}</span> : null}
                <span>{fmtMs(s.latencyMs)}</span>
                <span className={`badge ${s.status}`}>{s.status}</span>
              </span>
            </div>
            <div className="latbar" style={{ width: `${(s.latencyMs / maxLatency) * 100}%` }} />
            {s.error && <div className="io" style={{ color: "#fb7185" }}>{s.error}</div>}
            {s.input != null && <div className="io">in: {pretty(s.input)}</div>}
            {s.output != null && <div className="io">out: {pretty(s.output)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
