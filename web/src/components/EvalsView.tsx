import { useEffect, useState } from "react";
import { api, type EvaluatorMeta, type EvalRun, type Score } from "../api";
import { fmtTime } from "../format";

export function EvalsView({ onOpenTrace }: { onOpenTrace: (id: string) => void }) {
  const [evaluators, setEvaluators] = useState<EvaluatorMeta[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [size, setSize] = useState(20);
  const [busy, setBusy] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  useEffect(() => {
    api.evaluators().then((r) => setEvaluators(r.evaluators)).catch(() => {});
  }, []);

  useEffect(() => {
    const refresh = () => api.evalRuns().then((r) => setRuns(r.runs)).catch(() => {});
    refresh();
    const id = setInterval(refresh, 2000); // watch runs progress pending→running→done
    return () => clearInterval(id);
  }, []);

  async function run(evaluatorId: string) {
    setBusy(evaluatorId);
    try {
      await api.runEval(evaluatorId, size);
      const r = await api.evalRuns();
      setRuns(r.runs);
    } finally {
      setBusy(null);
    }
  }

  const nameOf = (id: string) => evaluators.find((e) => e.id === id)?.name ?? id;

  return (
    <div>
      <div className="evalgrid">
        {evaluators.map((e) => (
          <div className="evalcard" key={e.id}>
            <h4>
              <span className={`badge ${e.type === "code" ? "tool" : e.type === "behavior" ? "retrieval" : "llm"}`}>
                {e.type.replace("_", " ")}
              </span>
              {e.name}
            </h4>
            <p>{e.description}</p>
            <div className="run-row">
              <input
                type="number"
                min={1}
                max={500}
                value={size}
                onChange={(ev) => setSize(Math.max(1, Number(ev.target.value) || 1))}
                title="sample size"
              />
              <button className="btn" disabled={busy === e.id} onClick={() => run(e.id)}>
                {busy === e.id ? "Queued…" : "Run"}
              </button>
              {e.needsLlm && <span className="need-key">needs key on worker</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Eval runs</h3>
        <p className="sub">newest first · click a run to see scores · a worker processes the queue</p>
        {runs.length === 0 ? (
          <div className="empty">No runs yet. Pick an evaluator above and hit Run.</div>
        ) : (
          runs.map((r) => {
            const rate = r.totalCount ? r.passCount / r.totalCount : 0;
            return (
              <div className="runrow" key={r.id} onClick={() => setOpenRun(r.id)}>
                <span className="ev">{nameOf(r.evaluatorId)}</span>
                <div className="ratebar" title={`${r.passCount}/${r.totalCount} passed`}>
                  <span style={{ width: `${rate * 100}%` }} />
                </div>
                <span className="mono">
                  {r.status === "done" ? `${Math.round(rate * 100)}% pass` : "—"}
                </span>
                <span className={`status ${r.status}`}>{r.status}</span>
                <span className="mono" style={{ color: "#6b8299" }}>
                  {fmtTime(r.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {openRun && (
        <ScoresDrawer runId={openRun} name={nameOf} onClose={() => setOpenRun(null)} onOpenTrace={onOpenTrace} />
      )}
    </div>
  );
}

function ScoresDrawer({
  runId,
  name,
  onClose,
  onOpenTrace,
}: {
  runId: string;
  name: (id: string) => string;
  onClose: () => void;
  onOpenTrace: (id: string) => void;
}) {
  const [run, setRun] = useState<EvalRun | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [failOnly, setFailOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.evalRun(runId).then((r) => {
        if (!alive) return;
        setRun(r.run);
        setScores(r.scores);
      });
    load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId]);

  const shown = failOnly ? scores.filter((s) => !s.passed) : scores;
  const rate = run && run.totalCount ? run.passCount / run.totalCount : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ✕
        </button>
        <div className="kicker mono" style={{ color: "#6b8299", fontSize: 11 }}>
          EVAL RUN
        </div>
        <h2 style={{ margin: "4px 0 2px", fontSize: 20 }}>{run ? name(run.evaluatorId) : "…"}</h2>
        {run && (
          <p className="mono" style={{ color: "#9bb0c3", fontSize: 12, margin: "0 0 14px" }}>
            {run.status} · {run.passCount}/{run.totalCount} passed ({Math.round(rate * 100)}%) · avg{" "}
            {run.avgValue.toFixed(2)}
            {run.error ? ` · error: ${run.error}` : ""}
          </p>
        )}

        <div className="toolbar">
          <div className="seg">
            <button className={!failOnly ? "active" : ""} onClick={() => setFailOnly(false)}>
              All
            </button>
            <button className={failOnly ? "active" : ""} onClick={() => setFailOnly(true)}>
              Failures
            </button>
          </div>
        </div>

        {shown.length === 0 && <div className="empty">No scores yet (worker may still be running).</div>}
        {shown.map((s) => (
          <div className="scorerow" key={s.id}>
            <div className="top">
              <span className={`badge ${s.passed ? "ok" : "error"}`}>{s.passed ? "pass" : "fail"}</span>
              <span>{s.label}</span>
              <span style={{ color: "#6b8299", fontFamily: "var(--mono)", fontSize: 11 }}>
                value {s.value.toFixed(2)}
              </span>
              <span
                className="tid"
                onClick={() => onOpenTrace(s.traceId)}
                title="open trace"
                style={{ cursor: "pointer" }}
              >
                trace ↗
              </span>
            </div>
            {s.reasoning && <div className="reason">“{s.reasoning}”</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
