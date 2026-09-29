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
 * Loose severity text -> the enum member actually stored on a log row.
 *
 * Only these seven strings ever reach the database: ingest discards whatever
 * severityText a client sent and re-derives it from severityNumber. So a value
 * that is merely severity-shaped ("INFO", "warn") matches nothing — and since
 * `=` and `IN` are case-sensitive, it fails silently rather than erroring.
 *
 * This exists because the filter and severity-remapper dropdowns spent a long
 * time emitting TRACE/DEBUG/INFO/WARNING/ERROR/FATAL. Those values are still
 * sitting in saved pipeline configs, so the remapper normalises through here on
 * the way in rather than trusting what was stored.
 *
 * Returns null for anything unrecognised. Callers decide what to do about it —
 * guessing a severity is worse than admitting we cannot tell.
 */
export function normalizeLogSeverity(text: string): LogSeverity | null {
  const normalized: string = (text || "").trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  const aliases: Record<string, LogSeverity> = {
    UNSPECIFIED: LogSeverity.Unspecified,
    TRACE: LogSeverity.Trace,
    DEBUG: LogSeverity.Debug,
    // INFO and WARN are the two the old dropdowns got wrong by more than case.
    INFO: LogSeverity.Information,
    INFORMATION: LogSeverity.Information,
    WARN: LogSeverity.Warning,
    WARNING: LogSeverity.Warning,
    ERR: LogSeverity.Error,
    ERROR: LogSeverity.Error,
    FATAL: LogSeverity.Fatal,
  };

  return aliases[normalized] || null;
}

export default LogSeverity;
