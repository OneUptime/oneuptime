import * as k8s from "@kubernetes/client-node";
import Logger from "./Logger";
import OTLPBatcher, { LogEntry } from "./OTLPBatcher";
import {
  LOG_RECOMBINE_ENABLED,
  LOG_RECOMBINE_FLUSH_MS,
  LOG_RECOMBINE_MAX_BYTES,
  SINCE_SECONDS_ON_START,
} from "./Config";

/*
 * Kubernetes pod log lines, when requested with timestamps=true, look like:
 *   2026-04-22T10:12:33.123456789Z Hello world
 * We split off the leading RFC3339Nano timestamp and the rest becomes the body.
 */
const TS_SPLIT_REGEX: RegExp = /^(\S+)\s(.*)$/s;

/*
 * A line begins a new log record unless it starts with whitespace or a closing
 * bracket/brace/paren. Continuation lines — stack frames ("    at ..."), wrapped
 * structured output, trailing "}"/"]"/")" — are merged into the preceding
 * record. Mirrors the collector's `is_first_entry` expression
 * (`^[^\s}\)\]]`) so the API-mode tailer recombines the same way the DaemonSet
 * collector does.
 */
const FIRST_ENTRY_REGEX: RegExp = /^[^\s})\]]/;

export type StreamKey = string;

export const makeStreamKey: (args: {
  namespace: string;
  podUID: string;
  containerName: string;
}) => StreamKey = (args: {
  namespace: string;
  podUID: string;
  containerName: string;
}): StreamKey => {
  return `${args.namespace}/${args.podUID}/${args.containerName}`;
};

export type PodContext = {
  namespace: string;
  podName: string;
  podUID: string;
  containerName: string;
  nodeName: string;
  labels: Record<string, string>;
  serviceName: string;
};

export class LogStream {
  private readonly key: StreamKey;
  private readonly context: PodContext;
  private readonly log: k8s.Log;
  private readonly batcher: OTLPBatcher;
  /*
   * @kubernetes/client-node's Log.log() returns a `request.Request` (from the
   * legacy `request` library) with an `.abort()` method. We only need that,
   * so we store it with a minimal structural type.
   */
  private activeRequest: { abort: () => void } | null = null;
  private stopped: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures: number = 0;
  private firstStart: boolean = true;
  /*
   * In-progress multi-line record being recombined, plus the timer that
   * force-flushes it after a period of stream silence. Each LogStream follows
   * exactly one container, so no per-source keying is needed here.
   */
  private pending: LogEntry | null = null;
  private recombineTimer: NodeJS.Timeout | null = null;

  public constructor(
    kubeConfig: k8s.KubeConfig,
    context: PodContext,
    batcher: OTLPBatcher,
  ) {
    this.key = makeStreamKey(context);
    this.context = context;
    this.log = new k8s.Log(kubeConfig);
    this.batcher = batcher;
  }

  public start(): void {
    if (this.stopped) {
      return;
    }
    void this.connect();
  }

  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Flush any in-progress multi-line record into the batcher before we tear
    // down. PodWatcher stops streams before the batcher drains, so this lands.
    this.flushPending();
    if (this.activeRequest) {
      try {
        this.activeRequest.abort();
      } catch {
        // ignore
      }
      this.activeRequest = null;
    }
  }

  public getKey(): StreamKey {
    return this.key;
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const passthrough: import("stream").PassThrough = new (
      await import("stream")
    ).PassThrough();
    let carry: string = "";

    passthrough.on("data", (chunk: Buffer | string): void => {
      const text: string =
        typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const combined: string = carry + text;
      const lines: Array<string> = combined.split("\n");
      // Keep the trailing partial line for the next chunk.
      carry = lines.pop() || "";
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        this.emitLine(line);
      }
    });

    passthrough.on("end", (): void => {
      if (carry.length > 0) {
        this.emitLine(carry);
        carry = "";
      }
      this.handleClose(null);
    });

    passthrough.on("error", (err: Error): void => {
      this.handleClose(err);
    });

    try {
      const sinceSeconds: number = this.firstStart ? SINCE_SECONDS_ON_START : 1;
      this.firstStart = false;
      /*
       * @kubernetes/client-node's Log.log() streams the response body into
       * the given writable and returns a Request handle whose `.abort()` we
       * use to cancel. When the underlying HTTP connection ends (container
       * exits, network blip), the writable gets its "end" event — which we
       * then handle by reconnecting with backoff.
       */
      const req: { abort: () => void } = (await this.log.log(
        this.context.namespace,
        this.context.podName,
        this.context.containerName,
        passthrough,
        {
          follow: true,
          timestamps: true,
          sinceSeconds,
        },
      )) as unknown as { abort: () => void };
      if (this.stopped) {
        try {
          req.abort();
        } catch {
          // ignore
        }
        return;
      }
      this.activeRequest = req;
      this.consecutiveFailures = 0;
      Logger.debug("log stream connected", {
        key: this.key,
        namespace: this.context.namespace,
        pod: this.context.podName,
        container: this.context.containerName,
      });
    } catch (err: unknown) {
      this.handleClose(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emitLine(line: string): void {
    const match: RegExpMatchArray | null = line.match(TS_SPLIT_REGEX);
    let body: string;
    let timestampNanos: string;
    if (match && match[1] && match[2] !== undefined) {
      const parsedMs: number = Date.parse(match[1]);
      if (!Number.isNaN(parsedMs)) {
        // Preserve sub-millisecond precision if available.
        const subMs: RegExpMatchArray | null = match[1].match(
          /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/,
        );
        let subNanos: bigint = 0n;
        if (subMs && subMs[1]) {
          const frac: string = (subMs[1] + "000000000").slice(0, 9);
          subNanos = BigInt(frac) - BigInt(parsedMs % 1000) * 1000000n;
          if (subNanos < 0n) {
            subNanos = 0n;
          }
        }
        timestampNanos = (BigInt(parsedMs) * 1000000n + subNanos).toString();
        body = match[2];
      } else {
        timestampNanos = (BigInt(Date.now()) * 1000000n).toString();
        body = line;
      }
    } else {
      timestampNanos = (BigInt(Date.now()) * 1000000n).toString();
      body = line;
    }

    /*
     * Kubernetes embeds the stream marker (stdout/stderr) in CRI logs on disk
     * but not in the API response. Fall back to stdout; severity derivation
     * will still detect ERROR/WARN keywords in the body.
     */
    const entry: LogEntry = {
      timestampNanos,
      body,
      stream: "stdout",
      namespace: this.context.namespace,
      podName: this.context.podName,
      podUID: this.context.podUID,
      containerName: this.context.containerName,
      nodeName: this.context.nodeName,
      serviceName: this.context.serviceName,
      labels: this.context.labels,
    };
    this.recombine(entry);
  }

  /*
   * Recombine multi-line log events. The Kubernetes API emits one line per
   * newline, so a stack trace or pretty-printed JSON arrives as several lines.
   * We hold an in-progress record and append continuation lines — those that do
   * not start a new entry — onto its body, keeping the first line's timestamp,
   * so each event becomes a single log in OneUptime. A following first-entry
   * line (or a period of silence) flushes it. This mirrors the recombine
   * operator the DaemonSet collector and Docker agent use.
   */
  private recombine(entry: LogEntry): void {
    if (!LOG_RECOMBINE_ENABLED) {
      this.batcher.enqueue(entry);
      return;
    }

    const startsNewEntry: boolean = FIRST_ENTRY_REGEX.test(entry.body);
    if (
      !startsNewEntry &&
      this.pending &&
      this.pending.body.length + 1 + entry.body.length <=
        LOG_RECOMBINE_MAX_BYTES
    ) {
      // Continuation line: fold it into the in-progress record.
      this.pending.body += "\n" + entry.body;
      return;
    }

    // New entry, nothing to merge into, or the record hit the size cap: flush
    // what we have and start a fresh record from this line.
    this.flushPending();
    this.pending = entry;
    this.armRecombineTimer();
  }

  private armRecombineTimer(): void {
    if (this.recombineTimer) {
      // Already counting down from when this record started; do not reset, so a
      // record is held at most LOG_RECOMBINE_FLUSH_MS regardless of trickle.
      return;
    }
    this.recombineTimer = setTimeout((): void => {
      this.recombineTimer = null;
      this.flushPending();
    }, LOG_RECOMBINE_FLUSH_MS);
  }

  private flushPending(): void {
    if (this.recombineTimer) {
      clearTimeout(this.recombineTimer);
      this.recombineTimer = null;
    }
    if (this.pending) {
      this.batcher.enqueue(this.pending);
      this.pending = null;
    }
  }

  private handleClose(err: Error | null): void {
    this.activeRequest = null;
    // The stream ended (container exited, rotated, or a network blip). Flush any
    // in-progress record rather than holding it across the reconnect backoff.
    this.flushPending();
    if (this.stopped) {
      return;
    }
    this.consecutiveFailures++;
    const backoff: number = Math.min(
      60000,
      1000 * Math.pow(2, Math.min(this.consecutiveFailures, 6)),
    );
    if (err) {
      Logger.warn("log stream closed with error; reconnecting", {
        key: this.key,
        error: err.message,
        backoffMs: backoff,
      });
    } else {
      /*
       * Normal end — container may have exited or rotated. Reconnect shortly;
       * if the container is gone, PodWatcher will stop() us.
       */
      Logger.debug("log stream ended; reconnecting", {
        key: this.key,
        backoffMs: backoff,
      });
    }
    this.reconnectTimer = setTimeout((): void => {
      this.reconnectTimer = null;
      void this.connect();
    }, backoff);
  }
}
