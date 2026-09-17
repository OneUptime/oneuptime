import { URL } from "url";
import * as http from "http";
import * as https from "https";
import {
  BATCH_MAX_MS,
  BATCH_MAX_RECORDS,
  CLUSTER_NAME,
  EXPORT_MAX_RETRIES,
  MIN_SEVERITY,
  ONEUPTIME_API_KEY,
  ONEUPTIME_LABELS,
  ONEUPTIME_URL,
} from "./Config";
import Logger from "./Logger";

/*
 * OTLP-HTTP JSON severity numbers follow the OpenTelemetry spec:
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 *
 * These are the numbers the collector chain emits for the same keywords, and
 * they have to be those numbers rather than "something in the right bucket":
 * OneUptime's ingest throws away severityText and re-derives it from
 * severityNumber (OtelLogsIngestService.getSeverityText), so a keyword the two
 * Kubernetes log modes number differently can still surface as two different
 * levels on the Logs page. NOTICE and CRITICAL used to be 10 and 20 here
 * against the chain's 9 and 17; Tests/Severity.test.js reads the chain's own
 * mapping block out of the Helm template and fails if they drift again.
 *
 * ALERT and EMERGENCY (PSR-3, syslog, nginx's [emerg]) sit above CRITICAL and
 * land on FATAL.
 */
export const severityTextToNumber: Record<string, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  NOTICE: 9,
  WARN: 13,
  WARNING: 13,
  ERROR: 17,
  ERR: 17,
  CRITICAL: 17,
  CRIT: 17,
  FATAL: 21,
  PANIC: 21,
  ALERT: 21,
  EMERG: 21,
  EMERGENCY: 21,
};

/*
 * The RE2 pattern the collector chain uses, character for character.
 *
 * A level keyword is only believed when it sits where a LEVEL sits, not merely
 * because the word turns up somewhere in the line. Two shapes count, in this
 * order:
 *
 *   1. LINE PREAMBLE — the keyword is on the first line and everything before
 *      it is preamble: punctuation, digits, and word tokens ending on a
 *      structural delimiter. That is "[ERROR] ...", Monolog's "app.INFO: ...",
 *      "2026-08-31 07:25:04 INFO ...", Python's "... - myapp - INFO - ..." and
 *      logfmt's leading "level=error ...". Prose is not: "Connection error,
 *      retrying" stops the preamble dead at "Connection ". The repetition is
 *      LAZY, so the first keyword in preamble position wins, not the last.
 *   2. LEVEL FIELD — the keyword is the value of a level-ish key anywhere in
 *      the line (level / lvl / severity / severity_text / levelname /
 *      log.level / log_level), quoted or not, separated by ":" or "=". That is
 *      zap and logrus JSON, and logfmt whose level is not the first field.
 *
 * Not covered: klog's single-letter prefix ("I0831 07:25:04.123456"), which
 * needs its own letter-to-level mapping.
 *
 * Kept verbatim, as the collector's own RE2 source rather than a JS regex
 * literal, because it MUST stay in step with the `severity-router` /
 * `parse-severity-from-body` operators in
 * HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml. The two
 * log modes are meant to be behaviourally identical (see MIN_SEVERITY in
 * Config.ts), and a keyword one mode recognises and the other does not is
 * exactly the kind of divergence a preset would silently impose on a user.
 * Tests/Severity.test.js reads the pattern back out of that template and fails
 * on any difference.
 */
export const SEVERITY_PATTERN: string = String.raw`(?i)(?:^(?:[^A-Za-z"\n]|[A-Za-z][A-Za-z0-9_]*[ \t]*[.:=,/>|)}\]-])*?|(?:^|[\s,{\[])"?(?:log[._]?level|severity_?text|severity|levelname|level|lvl)"?[ \t]*[:=][ \t]*"?)(?P<severity_text>TRACE|DEBUG|INFO|NOTICE|WARNING|WARN|EMERGENCY|EMERG|ALERT|CRITICAL|CRIT|ERROR|ERR|FATAL|PANIC)(?:$|[\s\]:=,)"}|>])`;

/*
 * RE2 -> JavaScript. Only two dialect differences matter here: the inline (?i)
 * flag is legal in RE2 and not in JS, so it becomes the `i` flag; and named
 * groups are (?P<name>...) in RE2 and (?<name>...) in JS. Everything else —
 * anchors, classes, alternation, and the leftmost-first alternation both
 * engines use — behaves the same, and `$` means end of input in both because
 * neither is in multiline mode.
 */
export const SEVERITY_REGEX: RegExp = new RegExp(
  SEVERITY_PATTERN.replace("(?i)", "").replace("(?P<", "(?<"),
  "i",
);

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

/*
 * `parsed` records whether the severity was actually read off the log line, or
 * merely assumed. Only a SEVERITY_REGEX hit counts as parsed; both fallbacks
 * below are guesses.
 *
 * This distinction is what MIN_SEVERITY filters on, and it matters because the
 * stream fallback is unreliable in this mode: the Kubernetes pods/log API
 * merges stdout and stderr into one stream with no per-line marker, so
 * LogStream always reports "stdout" (see LogStream.ts). Dropping on an assumed
 * INFO would therefore delete exactly the records the threshold exists to
 * preserve — a Python traceback or `npm ERR!` on stderr carries no severity
 * keyword and would look like INFO.
 */
export const deriveSeverity: (
  body: string,
  stream: Stream,
) => { text: string; number: number; parsed: boolean } = (
  body: string,
  stream: Stream,
): { text: string; number: number; parsed: boolean } => {
  const match: RegExpMatchArray | null = body.match(SEVERITY_REGEX);
  const keyword: string | undefined = match?.groups?.["severity_text"];
  if (keyword) {
    const text: string = keyword.toUpperCase();
    const num: number | undefined = severityTextToNumber[text];
    if (num !== undefined) {
      return { text, number: num, parsed: true };
    }
  }
  if (stream === "stderr") {
    return {
      text: "ERROR",
      number: severityTextToNumber["ERROR"]!,
      parsed: false,
    };
  }
  return { text: "INFO", number: severityTextToNumber["INFO"]!, parsed: false };
};

/*
 * The severity floor, resolved once at startup. 0 means "keep everything",
 * which is also what an unrecognised MIN_SEVERITY resolves to — the safe
 * failure for a filter is to send too much, not to silently delete logs.
 *
 * Only the six canonical levels are accepted here, matching the enum the Helm
 * chart's values.schema.json allows. The aliases in severityTextToNumber
 * (WARNING, ERR, CRIT, PANIC, ...) exist to parse what applications *emit*;
 * they are not threshold values a user configures.
 */
const minSeverityNumber: number = ((): number => {
  if (!MIN_SEVERITY) {
    return 0;
  }
  const allowed: Array<string> = [
    "TRACE",
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
    "FATAL",
  ];
  if (!allowed.includes(MIN_SEVERITY)) {
    Logger.warn(
      `MIN_SEVERITY "${MIN_SEVERITY}" is not one of ${allowed.join(", ")} - keeping all logs`,
    );
    return 0;
  }
  return severityTextToNumber[MIN_SEVERITY] ?? 0;
})();

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
      /*
       * Project labels from .Values.oneuptime.labels (helm chart). The
       * OneUptime ingest pipeline promotes `oneuptime.label.*` resource
       * attributes into project Labels on the host/service.
       */
      for (const [labelKey, labelValue] of Object.entries(ONEUPTIME_LABELS)) {
        resourceAttrs.push(kv(`oneuptime.label.${labelKey}`, labelValue));
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
    /*
     * Drop below the severity floor before buffering, so filtered logs cost no
     * memory and no egress. deriveSeverity runs again in groupByResource for
     * the records that survive; it is one regex against a line we are about to
     * ship over the network either way.
     *
     * Only records whose severity we actually parsed are eligible to be
     * dropped. An assumed severity is not evidence, and keeping a line we could
     * not classify is the safe failure — see deriveSeverity.
     */
    if (minSeverityNumber > 0) {
      const severity: { number: number; parsed: boolean } = deriveSeverity(
        entry.body,
        entry.stream,
      );
      if (severity.parsed && severity.number < minSeverityNumber) {
        return;
      }
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
