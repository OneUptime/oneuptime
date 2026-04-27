import * as k8s from "@kubernetes/client-node";
import Logger from "./Logger";
import OTLPBatcher, { LogEntry } from "./OTLPBatcher";
import { SINCE_SECONDS_ON_START } from "./Config";

/*
 * Kubernetes pod log lines, when requested with timestamps=true, look like:
 *   2026-04-22T10:12:33.123456789Z Hello world
 * We split off the leading RFC3339Nano timestamp and the rest becomes the body.
 */
const TS_SPLIT_REGEX: RegExp = /^(\S+)\s(.*)$/s;

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
    this.batcher.enqueue(entry);
  }

  private handleClose(err: Error | null): void {
    this.activeRequest = null;
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
