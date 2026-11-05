import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceContext {
  traceId: string;
  spanId: string | null;
  nameHint?: string | null;
}

export const traceStore = new AsyncLocalStorage<TraceContext>();

export function currentContext(): TraceContext | undefined {
  return traceStore.getStore();
}

export function newId(): string {
  return randomUUID();
}
