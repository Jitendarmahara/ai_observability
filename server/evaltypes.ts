export type EvaluatorType = "code" | "llm_judge" | "behavior";

export interface EvaluatorMeta {
  id: string;
  name: string;
  type: EvaluatorType;
  description: string;
  needsLlm: boolean;
}

export interface EvalTarget {
  spanName?: string;
  type?: string;
}

export type RunStatus = "pending" | "running" | "done" | "error";

export interface EvalRun {
  id: string;
  evaluatorId: string;
  status: RunStatus;
  sampleSize: number;
  totalCount: number;
  passCount: number;
  avgValue: number;
  target: EvalTarget;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface Score {
  id: string;
  runId: string;
  evaluatorId: string;
  traceId: string;
  spanId: string;
  value: number;
  passed: boolean;
  label: string;
  reasoning?: string;
  createdAt: number;
}
