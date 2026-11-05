import type { Span, IngestBatch } from "./types";

export interface ExporterOptions {
  endpoint?: string;
  apiKey?: string;
  flushIntervalMs?: number;
  maxBatch?: number;
  debug?: boolean;
  sink?: (batch: IngestBatch) => void | Promise<void>;
}

export class Exporter {
  private buffer: Span[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<Pick<ExporterOptions, "flushIntervalMs" | "maxBatch" | "debug">> &
    ExporterOptions;

  constructor(options: ExporterOptions = {}) {
    this.opts = {
      flushIntervalMs: options.flushIntervalMs ?? 2000,
      maxBatch: options.maxBatch ?? 100,
      debug: options.debug ?? false,
      ...options,
    };
    this.start();
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    (this.timer as any).unref?.();
  }

  enqueue(span: Span) {
    if (this.opts.debug) {
      const tok = span.totalTokens != null ? `${span.totalTokens}tok` : "-";
      const cost = span.costUsd ? `$${span.costUsd}` : "-";
      console.log(
        `[respan] ${span.type.padEnd(9)} ${span.name.padEnd(22)} ${span.latencyMs}ms ${tok} ${cost} ${span.status}`,
      );
    }
    this.buffer.push(span);
    if (this.buffer.length >= this.opts.maxBatch) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch: IngestBatch = { spans: this.buffer };
    this.buffer = [];
    try {
      if (this.opts.sink) {
        await this.opts.sink(batch);
      } else if (this.opts.endpoint) {
        await fetch(`${this.opts.endpoint.replace(/\/$/, "")}/ingest`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          body: JSON.stringify(batch),
        });
      }
    } catch (err) {
      if (this.opts.debug) {
        console.warn(`[respan] export failed, dropping ${batch.spans.length} spans:`, err);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
