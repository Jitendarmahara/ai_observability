import { useState } from "react";
import type { TraceSummary } from "../api";
import { fmtUsd, fmtMs, fmtTime } from "../format";

export function LogsExplorer({
  traces,
  q,
  status,
  onQuery,
  onStatus,
  onOpen,
}: {
  traces: TraceSummary[];
  q: string;
  status: string;
  onQuery: (q: string) => void;
  onStatus: (s: string) => void;
  onOpen: (id: string) => void;
}) {
  const [draft, setDraft] = useState(q);
  return (
    <div>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Search traces by name, model, input, output…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onQuery(draft)}
        />
        <div className="seg">
          {["", "ok", "error"].map((s) => (
            <button key={s || "all"} className={status === s ? "active" : ""} onClick={() => onStatus(s)}>
              {s === "" ? "All" : s === "ok" ? "OK" : "Errors"}
            </button>
          ))}
        </div>
      </div>

      {traces.length === 0 ? (
        <div className="empty">No traces match. Run the demo agent to generate some.</div>
      ) : (
        <table className="traces">
          <thead>
            <tr>
              <th>Trace</th>
              <th>Spans</th>
              <th>Duration</th>
              <th>Cost</th>
              <th>Tokens</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={t.traceId} onClick={() => onOpen(t.traceId)}>
                <td className="name">{t.rootName ?? t.traceId.slice(0, 8)}</td>
                <td className="mono">{t.spanCount}</td>
                <td className="mono">{fmtMs(t.durationMs)}</td>
                <td className="mono">{fmtUsd(t.costUsd)}</td>
                <td className="mono">{t.totalTokens.toLocaleString()}</td>
                <td>
                  <span className={`badge ${t.status}`}>{t.status}</span>
                </td>
                <td className="mono">{fmtTime(t.startTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
