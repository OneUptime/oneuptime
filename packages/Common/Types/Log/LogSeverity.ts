enum LogSeverity {
  Unspecified = "Unspecified",
  Information = "Information",
  Warning = "Warning",
  Error = "Error",
  Trace = "Trace",
  Debug = "Debug",
  Fatal = "Fatal",
}

/*
 * The OTLP severity number stored alongside each level.
 *
 * These are the low end of each OTLP range (Trace 1-4, Debug 5-8, Info 9-12,
 * Warn 13-16, Error 17-20, Fatal 21-24), so they are the inverse of the
 * bucketing OtelLogsIngestService.getSeverityText applies on ingest. Anything
 * that writes severityText must take the number from here too, or the row says
 * one thing in its text and another in its number.
 *
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
export const LogSeverityNumber: Record<LogSeverity, number> = {
  [LogSeverity.Unspecified]: 0,
  [LogSeverity.Trace]: 1,
  [LogSeverity.Debug]: 5,
  [LogSeverity.Information]: 9,
  [LogSeverity.Warning]: 13,
  [LogSeverity.Error]: 17,
  [LogSeverity.Fatal]: 21,
};

/*
 * THE LEVEL WORDS, AND THE SEVERITY EACH ONE NAMES (issues #8425, #11228).
 *
 * One table for every place that turns a level word into a stored severity,
 * so the same line is stored the same way whichever way it came in:
 *
 *   - OTLP logs ingest, for a record that sets a severityText and no
 *     severityNumber (OtelLogsIngestService.severityNumberFromText, #8248);
 *   - Fluentd and Fluent Bit records' level fields (FluentLogsIngestService),
 *     and the Loki, Splunk HEC, Datadog and Sentry intakes (OtlpJson);
 *   - the pipeline severity remapper's target, and saved filters
 *     (normalizeLogSeverity, below);
 *   - syslog's eight severities by number, through their keywords
 *     (SyslogSeverity), and CloudWatch Logs' first-word read;
 *   - and outside this package, the agents that read a level off a log line
 *     themselves: the severity chain of the Docker, Podman and Docker Swarm
 *     agents and of the Kubernetes agent's DaemonSet, and the Kubernetes
 *     agent's API-mode log tailer. They send the number, so they must carry
 *     this table's numbers; Tests/Ops/LogSeverityOneTable.test.js holds
 *     every one of these copies to this table, number for number.
 *
 * Keyed upper-cased; matched after trimming, in any case. A Map, so a word
 * such as "constructor" or "toString" names nothing: an object literal would
 * hand back an Object.prototype member for it.
 *
 * What a word names is what the OpenTelemetry Logs Data Model says, where it
 * says it:
 *
 *   - The spec's short names, TRACE, DEBUG, INFO, WARN, ERROR and FATAL,
 *     each with its numbered steps (INFO2, WARN4, ...): the name of each
 *     step is its number's (Field: SeverityText; Displaying Severity).
 *   - The spellings of other logging systems, as Appendix B (SeverityNumber
 *     example mappings) maps them: syslog's keywords (RFC 5424, which
 *     journald and the Collector's syslog parser keep as the text: `emerg`,
 *     `alert`, `crit`, `err`, `warning`, `notice`, `info`, `debug`), the
 *     Windows Event Log's and ETW's (`Verbose`, `Information`), log4j's,
 *     zap's (`DPanic`) and java.util.logging's (`FINEST` ... `SEVERE`).
 *
 * Syslog's severities are Appendix B's syslog column, which is RFC 5424's
 * meaning of each read against the data model's ranges: Emergency, "system
 * is unusable", is FATAL's "application or system crash"; Alert ("action
 * must be taken immediately"), Critical and Error are errors, in that order
 * (ERROR3, ERROR2, ERROR); Notice is INFO2. The Collector's own syslog
 * parser, the host collector's journald mapping and OpenTelemetry's PHP SDK
 * (PSR-3's levels are RFC 5424's) number them the same way.
 *
 * Three words, decided where the copies disagreed (issue #11228):
 *
 *   - `critical`, which Appendix B maps two ways. Syslog's Critical (2) and
 *     the Windows Event Log's Critical are ERROR2, but ETW's CRITICAL and
 *     .NET's LogLevel.Critical are FATAL. A level that says `critical` in
 *     full is nearly always an application logger's top level - .NET's
 *     Critical, Python's CRITICAL (whose FATAL is the same level, and which
 *     OpenTelemetry's own Python SDK sends as FATAL) - while syslog writes the
 *     keyword `crit`. So `critical` is FATAL here and `crit` is ERROR2, which
 *     is also what Fluent ingest has always stored. The cost: PSR-3's and
 *     Elixir's CRITICAL, which sit below their ALERT, land above it here. A
 *     vocabulary OneUptime knows to be syslog's reads its Critical as
 *     syslog's: the priority numbers (SyslogSeverity), Datadog's statuses.
 *   - `alert`: syslog's Alert, ERROR3, as above. Not FATAL: it asks for
 *     action, it is no crash.
 *   - `panic`: FATAL. A panic is a crash, the data model's FATAL: Go's
 *     runtime panic, PostgreSQL's PANIC (every session aborted), logrus's
 *     and zerolog's top level, above their own fatal. OpenTelemetry's own zap
 *     and logrus bridges send it as FATAL2 and FATAL4. Appendix B's zap
 *     example (ERROR3) would put a logrus or zerolog panic below its fatal.
 *     zap's DPanic stays ERROR2: it panics only in development.
 *
 * Numbers are not words: "3" names nothing here. A syslog priority is mapped
 * by number where the sender says it is one (SyslogSeverity). Nor are the
 * marks only one format's own position gives a meaning: klog's letter,
 * pino's number, or "log", which as a level field's value is console.log's
 * word (PostgreSQL's LOG is read in capitals only, by the agents).
 */
export const LOG_SEVERITY_NUMBER_BY_TEXT: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ...(
    [
      ["TRACE", 1],
      ["DEBUG", 5],
      ["INFO", 9],
      ["WARN", 13],
      ["ERROR", 17],
      ["FATAL", 21],
    ] as Array<[string, number]>
  ).flatMap(([level, first]: [string, number]): Array<[string, number]> => {
    return [0, 1, 2, 3].map((step: number): [string, number] => {
      return [step === 0 ? level : `${level}${step + 1}`, first + step];
    });
  }),
  // java.util.logging, the Windows Event Log, ETW, .NET and zap.
  ["FINEST", 1],
  ["VERBOSE", 5],
  ["FINER", 5],
  ["FINE", 6],
  ["CONFIG", 7],
  ["INFORMATION", 9],
  ["INFORMATIONAL", 9],
  ["WARNING", 13],
  ["SEVERE", 17],
  ["DPANIC", 18],
  // A crash, whoever writes it (see above): not Appendix B's zap example.
  ["PANIC", 21],
  // syslog's keywords (RFC 5424), as Appendix B's syslog column maps them.
  ["NOTICE", 10],
  ["ERR", 17],
  ["CRIT", 18],
  ["ALERT", 19],
  ["EMERG", 21],
  ["EMERGENCY", 21],
  // An application logger's top level (see above): not syslog's Critical.
  ["CRITICAL", 21],
  /*
   * The short forms loggers write in a level field (issue #8536): Serilog's
   * VRB, DBG, INF, WRN and FTL (its ERR is syslog's, above), zerolog's TRC,
   * and log15's DBUG and EROR (its CRIT is syslog's too). And the ones the
   * agents read off a line (issue #11228): .NET's console prefixes TRCE and
   * FAIL (its dbug, info and warn are above, its crit is syslog's), MySQL's
   * and MariaDB's NOTE, zerolog's PNC.
   */
  ["TRC", 1],
  ["TRCE", 1],
  ["VRB", 5],
  ["DBG", 5],
  ["DBUG", 5],
  ["INF", 9],
  ["NOTE", 9],
  ["WRN", 13],
  ["EROR", 17],
  ["FAIL", 17],
  ["FTL", 21],
  ["PNC", 21],
]);

/*
 * The OTLP SeverityNumber a level word names (LOG_SEVERITY_NUMBER_BY_TEXT),
 * in any case and with spaces around it. Anything else - a word that names
 * no level, or a value that is not text - is UNSPECIFIED (0): a severity is
 * never guessed from a word that does not name one.
 */
export function logSeverityNumberFromText(text: unknown): number {
  if (typeof text !== "string") {
    return 0;
  }

  return LOG_SEVERITY_NUMBER_BY_TEXT.get(text.trim().toUpperCase()) ?? 0;
}

/*
 * The severity a log row stores for an OTLP SeverityNumber: each of the
 * spec's six ranges (Trace 1-4, Debug 5-8, Info 9-12, Warn 13-16, Error
 * 17-20, Fatal 21-24), and Unspecified for anything else.
 */
export function logSeverityFromNumber(severityNumber: number): LogSeverity {
  if (severityNumber >= 1 && severityNumber <= 4) {
    return LogSeverity.Trace;
  } else if (severityNumber >= 5 && severityNumber <= 8) {
    return LogSeverity.Debug;
  } else if (severityNumber >= 9 && severityNumber <= 12) {
    return LogSeverity.Information;
  } else if (severityNumber >= 13 && severityNumber <= 16) {
    return LogSeverity.Warning;
  } else if (severityNumber >= 17 && severityNumber <= 20) {
    return LogSeverity.Error;
  } else if (severityNumber >= 21 && severityNumber <= 24) {
    return LogSeverity.Fatal;
  }
  return LogSeverity.Unspecified;
}

/*
 * Loose severity text -> the enum member actually stored on a log row.
 *
 * Only these seven strings ever reach the database: ingest discards whatever
 * severityText a client sent and re-derives it from severityNumber (or, for a
 * record that sets no number, from the level the text names:
 * logSeverityNumberFromText). So a value that is merely severity-shaped
 * ("INFO", "warn") matches nothing — and since `=` and `IN` are
 * case-sensitive, it fails silently rather than erroring.
 *
 * This exists because the filter and severity-remapper dropdowns spent a long
 * time emitting TRACE/DEBUG/INFO/WARNING/ERROR/FATAL. Those values are still
 * sitting in saved pipeline configs, so the remapper normalises through here on
 * the way in rather than trusting what was stored.
 *
 * Every enum member names itself, and every word in LOG_SEVERITY_NUMBER_BY_TEXT
 * names what ingest stores for it (issue #8425): a pipeline that sets a
 * severity of `critical` or `notice` stores what a log sent with that level
 * would have been stored as.
 *
 * Returns null for anything unrecognised. Callers decide what to do about it —
 * guessing a severity is worse than admitting we cannot tell.
 */
export function normalizeLogSeverity(text: string): LogSeverity | null {
  if (typeof text !== "string") {
    return null;
  }

  const normalized: string = text.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "UNSPECIFIED") {
    return LogSeverity.Unspecified;
  }

  const severityNumber: number = logSeverityNumberFromText(normalized);

  return severityNumber > 0 ? logSeverityFromNumber(severityNumber) : null;
}

export default LogSeverity;
