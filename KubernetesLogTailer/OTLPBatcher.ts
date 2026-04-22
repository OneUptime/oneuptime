import { URL } from "url";
import * as http from "http";
import * as https from "https";
import {
  BATCH_MAX_MS,
  BATCH_MAX_RECORDS,
  CLUSTER_NAME,
  EXPORT_MAX_RETRIES,
  ONEUPTIME_API_KEY,
  ONEUPTIME_URL,
} from "./Config";
import Logger from "./Logger";

/*
 * OTLP-HTTP JSON severity numbers follow the OpenTelemetry spec:
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
const severityTextToNumber: Record<string, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  NOTICE: 10,
  WARN: 13,
  WARNING: 13,
  ERROR: 17,
  ERR: 17,
  CRITICAL: 20,
  CRIT: 20,
  FATAL: 21,
  PANIC: 21,
};

const SEVERITY_REGEX: RegExp =
  /(?:^|[\s\[(])(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERR(?:OR)?|CRIT(?:ICAL)?|FATAL|PANIC)(?:[\s\]:=,)])/i;

type Stream = "stdout" | "stderr";

export type LogEntry = {
  timestampNanos: string;
  body: string;
  stream: Stream;
  namespace: string;
  podName: string;
  podUID: string;
  containerName: string;
  nodeName: string;
  serviceName: string;
  labels: Record<string, string>;
};

type OtlpKeyValue = {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { boolValue: boolean };
};

type OtlpLogRecord = {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: Array<OtlpKeyValue>;
};

type OtlpResourceLogs = {
  resource: { attributes: Array<OtlpKeyValue> };
  scopeLogs: Array<{
    scope: { name: string };
    logRecords: Array<OtlpLogRecord>;
  }>;
};

const kv: (key: string, value: string) => OtlpKeyValue = (
  key: string,
  value: string,
): OtlpKeyValue => {
  return { key, value: { stringValue: value } };
};

const deriveSeverity: (
  body: string,
  stream: Stream,
) => { text: string; number: number } = (
  body: string,
  stream: Stream,
): { text: string; number: number } => {
  const match: RegExpMatchArray | null = body.match(SEVERITY_REGEX);
  if (match && match[1]) {
    const text: string = match[1].toUpperCase();
    const num: number | undefined = severityTextToNumber[text];
    if (num !== undefined) {
      return { text, number: num };
    }
  }
  if (stream === "stderr") {
    return { text: "ERROR", number: severityTextToNumber["ERROR"]! };
  }
  return { text: "INFO", number: severityTextToNumber["INFO"]! };
};

const groupByResource: (entries: Array<LogEntry>) => Array<OtlpResourceLogs> = (
  entries: Array<LogEntry>,
): Array<OtlpResourceLogs> => {
  const groups: Map<string, OtlpResourceLogs> = new Map();
  for (const entry of entries) {
    const key: string = `${entry.namespace}|${entry.podName}|${entry.containerName}`;
    let group: OtlpResourceLogs | undefined = groups.get(key);
    if (!group) {
      const resourceAttrs: Array<OtlpKeyValue> = [
        kv("k8s.cluster.name", CLUSTER_NAME),
        kv("k8s.namespace.name", entry.namespace),
        kv("k8s.pod.name", entry.podName),
        kv("k8s.pod.uid", entry.podUID),
        kv("k8s.container.name", entry.containerName),
        kv("service.name", entry.serviceName),
      ];
      if (entry.nodeName) {
        resourceAttrs.push(kv("k8s.node.name", entry.nodeName));
      }
      for (const [labelKey, labelValue] of Object.entries(entry.labels)) {
        resourceAttrs.push(kv(`k8s.pod.label.${labelKey}`, labelValue));
      }
      group = {
        resource: { attributes: resourceAttrs },
        scopeLogs: [
          {
            scope: { name: "oneuptime.kubernetes-log-tailer" },
            logRecords: [],
          },
        ],
      };
      groups.set(key, group);
    }
    const severity: { text: string; number: number } = deriveSeverity(
      entry.body,
      entry.stream,
    );
    group.scopeLogs[0]!.logRecords.push({
      timeUnixNano: entry.timestampNanos,
      observedTimeUnixNano: entry.timestampNanos,
      severityNumber: severity.number,
      severityText: severity.text,
      body: { stringValue: entry.body },
      attributes: [kv("log.iostream", entry.stream)],
    });
  }
  return Array.from(groups.values());
};

const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

class OTLPBatcher {
  private buffer: Array<LogEntry> = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private lastExportOk: number = 0;
  private lastExportErr: string | null = null;
  private stopped: boolean = false;
  private readonly endpoint: URL;
  private readonly transport: typeof http | typeof https;

  public constructor() {
    this.endpoint = new URL(`${ONEUPTIME_URL}/otlp/v1/logs`);
    this.transport = this.endpoint.protocol === "https:" ? https : http;
  }

  public enqueue(entry: LogEntry): void {
    if (this.stopped) {
      return;
    }
    this.buffer.push(entry);
    if (this.buffer.length >= BATCH_MAX_RECORDS) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout((): void => {
        void this.flush();
      }, BATCH_MAX_MS);
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.inFlight;
  }

  public healthy(): boolean {
    /*
     * Consider healthy if we haven't tried to export yet, or last successful
     * export was within 5 minutes.
     */
    if (this.lastExportOk === 0 && this.lastExportErr === null) {
      return true;
    }
    return Date.now() - this.lastExportOk < 5 * 60 * 1000;
  }

  public lastError(): string | null {
    return this.lastExportErr;
  }

  public flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) {
      return this.inFlight;
    }
    const batch: Array<LogEntry> = this.buffer;
    this.buffer = [];
    const payload: { resourceLogs: Array<OtlpResourceLogs> } = {
      resourceLogs: groupByResource(batch),
    };
    // Serialize sends so we apply backpressure when the server is slow.
    this.inFlight = this.inFlight.then((): Promise<void> => {
      return this.send(payload, batch.length);
    });
    return this.inFlight;
  }

  private async send(
    payload: { resourceLogs: Array<OtlpResourceLogs> },
    recordCount: number,
  ): Promise<void> {
    const body: Buffer = Buffer.from(JSON.stringify(payload), "utf8");
    for (let attempt: number = 0; attempt <= EXPORT_MAX_RETRIES; attempt++) {
      try {
        await this.post(body);
        this.lastExportOk = Date.now();
        this.lastExportErr = null;
        Logger.debug("exported log batch", { records: recordCount, attempt });
        return;
      } catch (err: unknown) {
        const message: string =
          err instanceof Error ? err.message : String(err);
        this.lastExportErr = message;
        if (attempt >= EXPORT_MAX_RETRIES) {
          Logger.error("dropping log batch after retries exhausted", {
            records: recordCount,
            error: message,
          });
          return;
        }
        const backoff: number = Math.min(30000, 500 * Math.pow(2, attempt));
        Logger.warn("log export failed; retrying", {
          records: recordCount,
          attempt,
          backoffMs: backoff,
          error: message,
        });
        await sleep(backoff);
      }
    }
  }

  private post(body: Buffer): Promise<void> {
    return new Promise(
      (resolve: () => void, reject: (err: Error) => void): void => {
        const req: http.ClientRequest = this.transport.request(
          {
            method: "POST",
            hostname: this.endpoint.hostname,
            port:
              this.endpoint.port ||
              (this.endpoint.protocol === "https:" ? 443 : 80),
            path: this.endpoint.pathname + this.endpoint.search,
            headers: {
              "Content-Type": "application/json",
              "Content-Length": body.length,
              "x-oneuptime-token": ONEUPTIME_API_KEY,
            },
            timeout: 30000,
          },
          (res: http.IncomingMessage): void => {
            const chunks: Array<Buffer> = [];
            res.on("data", (chunk: Buffer): void => {
              chunks.push(chunk);
            });
            res.on("end", (): void => {
              const status: number = res.statusCode || 0;
              if (status >= 200 && status < 300) {
                resolve();
                return;
              }
              const responseBody: string =
                Buffer.concat(chunks).toString("utf8");
              if (status >= 400 && status < 500 && status !== 429) {
                // 4xx (except 429) usually means bad request — don't retry.
                Logger.error("log export rejected with 4xx; dropping batch", {
                  status,
                  body: responseBody.slice(0, 500),
                });
                resolve();
                return;
              }
              reject(
                new Error(
                  `OTLP export failed with status ${status}: ${responseBody.slice(0, 200)}`,
                ),
              );
            });
          },
        );
        req.on("error", (err: Error): void => {
          reject(err);
        });
        req.on("timeout", (): void => {
          req.destroy(new Error("OTLP export timed out"));
        });
        req.write(body);
        req.end();
      },
    );
  }
}

export default OTLPBatcher;
