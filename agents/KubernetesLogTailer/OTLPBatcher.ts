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
 * Each is the number OneUptime's ingest stores the same word at
 * (LOG_SEVERITY_NUMBER_BY_TEXT in packages/Common/Types/Log/LogSeverity.ts,
 * issue #11228), and the number the collector chain emits for it. They have
 * to be those numbers rather than "something in the right bucket": ingest
 * re-derives a record's level from its severityNumber, so a word numbered
 * two ways surfaces as two levels on the Logs page. CRITICAL, ALERT and PANIC
 * once landed in different levels here and in ingest; now syslog's ALERT, CRIT
 * and NOTICE are ERROR3, ERROR2 and INFO2, as Appendix B maps them, and an
 * application logger's CRITICAL and a PANIC are FATAL.
 * Tests/Ops/LogSeverityOneTable.test.js holds these to that table, and
 * Tests/Severity.test.js to the chain's own mapping block.
 *
 * The rest are the texts the readers below lift for the formats they read
 * (issues #10972 and #11226): klog's letter, pino's number, PostgreSQL's
 * LOG, MySQL's Note and System, .NET's four-letter prefixes, zerolog's and
 * Serilog's three letters, logrus's four, java.util.logging's levels,
 * log15's EROR, zap's DPANIC, MongoDB's and Gitea's letters, Redis's
 * symbols, PHP's error types, and Go's log/slog between its names (its
 * level plus 9, as OpenTelemetry's slog bridge numbers it).
 */
export const severityTextToNumber: Record<string, number> = {
  TRACE: 1,
  TRCE: 1,
  TRC: 1,
  TRAC: 1,
  FINEST: 1,
  "DEBUG-4": 1,
  "DEBUG-3": 2,
  "DEBUG-2": 3,
  "DEBUG-1": 4,
  DEBUG: 5,
  DBUG: 5,
  DBG: 5,
  DEBU: 5,
  VRB: 5,
  VERBOSE: 5,
  FINER: 5,
  FINE: 6,
  "DEBUG+1": 6,
  CONFIG: 7,
  "DEBUG+2": 7,
  "DEBUG+3": 8,
  INFO: 9,
  INF: 9,
  INFORMATION: 9,
  NOTE: 9,
  SYSTEM: 9,
  LOG: 9,
  NOTICE: 10,
  "INFO+1": 10,
  "INFO+2": 11,
  "INFO+3": 12,
  WARN: 13,
  WARNING: 13,
  WRN: 13,
  DEPRECATED: 13,
  "WARN+1": 14,
  "WARN+2": 15,
  "WARN+3": 16,
  ERROR: 17,
  ERR: 17,
  EROR: 17,
  ERRO: 17,
  FAIL: 17,
  SEVERE: 17,
  "RECOVERABLE FATAL ERROR": 17,
  CRIT: 18,
  DPANIC: 18,
  "ERROR+1": 18,
  ALERT: 19,
  "ERROR+2": 19,
  "ERROR+3": 20,
  FATAL: 21,
  FTL: 21,
  FATA: 21,
  CRITICAL: 21,
  PANIC: 21,
  PNC: 21,
  PANI: 21,
  EMERG: 21,
  EMERGENCY: 21,
  "FATAL ERROR": 21,
  "PARSE ERROR": 21,
  "ERROR+4": 21,
  "ERROR+5": 22,
  "ERROR+6": 23,
  "ERROR+7": 24,
  // klog and glog's letter, MongoDB's and Gitea's.
  T: 1,
  D: 5,
  I: 9,
  W: 13,
  E: 17,
  F: 21,
  // MongoDB's debug levels.
  D1: 5,
  D2: 5,
  D3: 5,
  D4: 5,
  D5: 5,
  // Redis's and Valkey's symbols: debug, verbose, notice, warning.
  ".": 5,
  "-": 6,
  "*": 10,
  "#": 13,
  // pino and bunyan's numbers.
  "10": 1,
  "20": 5,
  "30": 9,
  "40": 13,
  "50": 17,
  "60": 21,
};

/*
 * The readers of the DaemonSet collector's severity chain, in the order its
 * router tries them, as the collector's own RE2 source, character for
 * character. The first one that matches decides:
 *
 *   parse-klog-severity       klog and glog's first letter: I W E F.
 *   add-exception-severity    an exception's header (a traceback, an
 *                             uncaught exception, a panic): ERROR.
 *   add-warning-severity      a Python or Node warning category: WARN.
 *   parse-numeric-severity    pino and bunyan's "level":30, among the
 *                             top-level fields.
 *   parse-mongodb-severity    the formats that keep their level in a place
 *   ... parse-gitea-severity  of their own (issue #11226), each read only
 *                             there: MongoDB's "s", CloudNativePG's wrapped
 *                             record, Serilog's compact JSON (and its
 *                             Information, which writes no "@l"), Redis's
 *                             symbol, NestJS's ConsoleLogger, logrus with
 *                             colours, MySQL 8's [System], java.util.
 *                             logging's FINE to CONFIG, Sidekiq 7, PHP's
 *                             error log, Gitea's letter.
 *   parse-severity-from-body  a level word where a level sits: on the first
 *                             line, after nothing but preamble (punctuation,
 *                             digits, word tokens ending on a delimiter,
 *                             colour codes, a time at the start read with its
 *                             letters), or as the value of a level field.
 *   parse-slog-severity       Go's log/slog between its names, level=ERROR+4,
 *                             where the general read found no level.
 *
 * The chain's last route, its stdout fallback, is not here: this mode cannot
 * tell stdout from stderr (see deriveSeverity).
 *
 * Kept verbatim, as the collector's RE2 source rather than JS regex literals,
 * because they MUST stay in step with the `severity-router` and its operators
 * in HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml. The
 * two log modes are meant to be behaviourally identical (see MIN_SEVERITY in
 * Config.ts), and a format one mode reads and the other does not is exactly
 * the kind of divergence a user would only see as their severities moving.
 * Tests/Severity.test.js reads the routes, their order, their patterns and the
 * levels back out of that template and fails on any difference.
 */
export type SeverityReader = {
  id: string;
  pattern: string;
  // A reader that recognises a shape rather than lifting a word writes this.
  level?: string;
};

export const SEVERITY_READERS: Array<SeverityReader> = [
  {
    id: "parse-klog-severity",
    pattern: String.raw`^(?P<severity_text>[IWEF])\d{4}(?:\d{4})? \d\d:\d\d:\d\d\.\d{6} +\d+ [^ :\]]+:\d+\]`,
  },
  {
    id: "add-exception-severity",
    pattern: String.raw`^(?:Traceback \(most recent call last\):|Exception in thread "|Caused by: |Unhandled [Ee]xception[.:]|thread \x27[^\x27]*\x27 panicked at |(?:[A-Za-z_$][\w$]*\.)*(?:[A-Z][\w$]*)?(?:Error|Exception)(?::(?:\s|$)|[\r\n]|$))`,
    level: "ERROR",
  },
  {
    id: "add-warning-severity",
    pattern: String.raw`^(?:\S+:\d+: |\(node:\d+\) (?:\[[A-Z]+\d+\] )?)[A-Z][A-Za-z]*Warning: `,
    level: "WARN",
  },
  {
    id: "parse-numeric-severity",
    pattern: String.raw`^\{(?:"(?:[^"\\]|\\.)*":(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null),)*?"level":(?P<severity_text>[1-6]0)[,}]`,
  },
  {
    id: "parse-mongodb-severity",
    pattern: String.raw`^\{"t":\{"[$]date":"[^"]*"\},"s":"(?P<severity_text>[FEWI]|D[1-5])"`,
  },
  {
    id: "parse-cnpg-severity",
    pattern: String.raw`^\{"level":"[a-z]+","ts":"[^"]*","logger":"postgres","msg":"record",.*?"error_severity":"(?P<severity_text>DEBUG|LOG|INFO|NOTICE|WARNING|ERROR|FATAL|PANIC)"`,
  },
  {
    id: "parse-clef-severity",
    pattern: String.raw`^\{"@t":"[^"\\]*","@mt?":"(?:[^"\\]|\\.)*",(?:"@r":\[(?:"(?:[^"\\]|\\.)*",?)*\],)?(?:"@i":"[0-9a-f]+",)?"@l":"(?P<severity_text>Verbose|Debug|Information|Warning|Error|Fatal)"`,
  },
  {
    id: "add-clef-information",
    pattern: String.raw`^\{"@t":"[^"\\]*","@mt?":"`,
    level: "INFO",
  },
  {
    id: "parse-redis-severity",
    pattern: String.raw`^\d+:[CMSX] \d\d? [A-Z][a-z]{2} \d{4} \d\d:\d\d:\d\d\.\d{3} (?P<severity_text>[.*#-]) `,
  },
  {
    id: "parse-nest-severity",
    pattern: String.raw`^(?:\x1b\[[0-9;]*m)?\[Nest\] \d+  - (?:\x1b\[[0-9;]*m)?[^\x1b\n]*?\d(?: ?[AP]M)? (?:\x1b\[[0-9;]*m)? *(?P<severity_text>VERBOSE|DEBUG|LOG|WARN|ERROR|FATAL)(?:\x1b\[[0-9;]*m)? `,
  },
  {
    id: "parse-logrus-severity",
    pattern: String.raw`^\x1b\[\d+m(?P<severity_text>TRAC|DEBU|INFO|WARN|ERRO|FATA|PANI)\x1b\[0m\[[^\]\n]*\] `,
  },
  {
    id: "parse-mysql-severity",
    pattern: String.raw`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}(?:Z|[+-]\d\d:\d\d) \d+ \[(?P<severity_text>System|ERROR|Warning|Note)\] \[MY-\d{6}\] `,
  },
  {
    id: "parse-jul-severity",
    pattern: String.raw`^(?P<severity_text>FINEST|FINER|FINE|CONFIG): `,
  },
  {
    id: "parse-sidekiq-severity",
    pattern: String.raw`^(?:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z )?pid=\d+ tid=[a-z0-9]+(?: [a-z_]+=[^ =]+)* (?P<severity_text>DEBUG|INFO|WARN|ERROR|FATAL): `,
  },
  {
    id: "parse-php-severity",
    pattern: String.raw`^PHP (?P<severity_text>Fatal error|Parse error|Recoverable fatal error|Warning|Notice|Deprecated):  `,
  },
  {
    id: "parse-gitea-severity",
    pattern: String.raw`^\d{4}/\d\d/\d\d \d\d:\d\d:\d\d(?:\.\d+)? (?:\S+\(\) )?\[(?P<severity_text>[TDIWEF])\] `,
  },
  {
    id: "parse-severity-from-body",
    pattern: String.raw`(?i)(?:^(?:(?:\x1b\[[0-9;]*m)*(?:\[(?:\x1b\[[0-9;]*m)*)?(?:\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:[.,]\d+)?)?(?:Z|[+-]\d\d(?::?\d\d)?)?(?:[ \t]+(?-i:UTC|GMT|CET|CEST|EET|EEST|WET|WEST|BST|IST|MSK|EST|EDT|CST|CDT|MST|MDT|PST|PDT|HST|AKST|AKDT|JST|KST|HKT|SGT|AEST|AEDT|ACST|ACDT|AWST|NZST|NZDT))?|(?-i:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?-i:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d\d? \d\d:\d\d:\d\d(?:\.\d+)? \d{4}|\d\d?:\d\d(?-i:AM|PM)))?(?:[^A-Za-z"\n\x1b]|\x1b\[[0-9;]*m|[A-Za-z][A-Za-z0-9_]*[ \t]*[.:=,/>|)}\]-])*?|(?:^|[\s,{\[])"?(?:@?(?:log[._]?level|severity_?text|severity|level_?name|level|lvl)|@l)"?[ \t]*[:=][ \t]*"?)(?P<severity_text>TRACE|TRCE|TRC|DEBUG|DBUG|DBG|VRB|INFORMATION|INFO|INF|NOTICE|NOTE|(?-i:LOG)|WARNING|WARN|WRN|EMERGENCY|EMERG|ALERT|CRITICAL|CRIT|ERROR|EROR|ERR|FAIL|SEVERE|DPANIC|FATAL|FTL|PANIC|PNC)(?:$|[\s\]:=,)"}|>\x1b]|/[A-Za-z][A-Za-z0-9_-]*\])`,
  },
  {
    id: "parse-slog-severity",
    pattern: String.raw`(?:^|[\s{,])"?level"?[=:]"?(?P<severity_text>DEBUG-[1-4]|DEBUG\+[1-3]|INFO\+[1-3]|WARN\+[1-3]|ERROR\+[1-7])(?:$|[\s",}])`,
  },
];

/*
 * RE2 -> JavaScript. Only two dialect differences matter here: the inline (?i)
 * flag at the start of a pattern is legal in RE2 and not in JS, so it becomes
 * the `i` flag; and named groups are (?P<name>...) in RE2 and (?<name>...) in
 * JS. Everything else — anchors, classes, alternation, the scoped (?-i:...)
 * that keeps a word to one case, and the leftmost-first alternation both
 * engines use — behaves the same, and `$` means end of input in both because
 * neither is in multiline mode.
 */
const toRegExp: (pattern: string) => RegExp = (pattern: string): RegExp => {
  const caseless: boolean = pattern.startsWith("(?i)");

  return new RegExp(
    (caseless ? pattern.slice("(?i)".length) : pattern).replace("(?P<", "(?<"),
    caseless ? "i" : "",
  );
};

const COMPILED_READERS: Array<{ reader: SeverityReader; regex: RegExp }> =
  SEVERITY_READERS.map(
    (reader: SeverityReader): { reader: SeverityReader; regex: RegExp } => {
      return { reader, regex: toRegExp(reader.pattern) };
    },
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
 * merely assumed. Only a reader's hit counts as parsed; the fallback below is
 * a guess.
 *
 * This distinction is what MIN_SEVERITY filters on, and it matters because the
 * stream fallback is unreliable in this mode: the Kubernetes pods/log API
 * merges stdout and stderr into one stream with no per-line marker, so
 * LogStream always reports "stdout" (see LogStream.ts). Dropping on an assumed
 * INFO would therefore delete exactly the records the threshold exists to
 * preserve — a bare error message, or an `npm ERR!`, on stderr carries no level
 * and would look like INFO.
 *
 * As in the collector chain, the first reader that matches decides, and a
 * stderr line no reader reads gets no severity at all, not the ERROR the chain
 * used to guess (issue #10972): stderr is where programs write their
 * diagnostics, every level of them. This mode never sees a stderr line, but it
 * reads one the way the chain does.
 */
export const deriveSeverity: (
  body: string,
  stream: Stream,
) => { text: string; number: number; parsed: boolean } = (
  body: string,
  stream: Stream,
): { text: string; number: number; parsed: boolean } => {
  for (const { reader, regex } of COMPILED_READERS) {
    const match: RegExpMatchArray | null = body.match(regex);

    if (!match) {
      continue;
    }

    const text: string = (
      reader.level ??
      match.groups?.["severity_text"] ??
      ""
    ).toUpperCase();
    const num: number | undefined = severityTextToNumber[text];

    if (num !== undefined) {
      return { text, number: num, parsed: true };
    }

    /*
     * The collector's router hands the line to this reader alone; a text it
     * cannot number is a drift Tests/Severity.test.js fails on.
     */
    break;
  }

  if (stream === "stderr") {
    return { text: "", number: 0, parsed: false };
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
