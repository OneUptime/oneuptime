import Dictionary from "../../Types/Dictionary";
import LogSeverity, {
  LOG_SEVERITY_NUMBER_BY_TEXT,
  logSeverityFromNumber,
} from "../../Types/Log/LogSeverity";

/*
 * What a syslog priority says, in words and as a log severity - one copy
 * for every way syslog reaches OneUptime.
 *
 * The priority is facility * 8 + severity (RFC 5424, section 6.2.1):
 * facilities 0 to 23, severities 0 (emergency) to 7 (debug).
 */

export const SYSLOG_FACILITY_LABELS: ReadonlyArray<string> = [
  "kernel",
  "user",
  "mail",
  "system",
  "security",
  "syslogd",
  "line_printer",
  "network_news",
  "uucp",
  "clock",
  "security2",
  "ftp",
  "ntp",
  "log_audit",
  "log_alert",
  "clock2",
  "local0",
  "local1",
  "local2",
  "local3",
  "local4",
  "local5",
  "local6",
  "local7",
];

export const SYSLOG_SEVERITY_LABELS: ReadonlyArray<string> = [
  "emergency",
  "alert",
  "critical",
  "error",
  "warning",
  "notice",
  "informational",
  "debug",
];

/*
 * Each severity's keyword, 0 to 7 (RFC 5424, section 6.2.1): the text the
 * OpenTelemetry Collector's syslog parser and journald keep, and the word the
 * one table of level words stores a severity under. SYSLOG_SEVERITY_LABELS
 * above are the names a person reads; the table reads two of them otherwise
 * (`critical` in full is an application logger's top level there), so a
 * severity is stored by its keyword.
 */
export const SYSLOG_SEVERITY_KEYWORDS: ReadonlyArray<string> = [
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
];

export interface LogSeverityOfSyslog {
  number: number;
  text: LogSeverity;
}

/*
 * Syslog severity -> log severity, as the one table of level words stores
 * each severity's keyword (LOG_SEVERITY_NUMBER_BY_TEXT, issue #11228): 0
 * Fatal (21), 1-3 Error (19, 18, 17), 4 Warning (13), 5-6 Information (10,
 * 9), 7 Debug (5). That is Appendix B's syslog column of the OpenTelemetry
 * Logs Data Model, which the Collector's syslog parser and the host
 * collector's journald mapping follow too, so a message is stored the same
 * whether it reaches OneUptime as syslog, through a collector, or as a word
 * in a Fluent record. Alert (1) is an error that asks for action, not a
 * crash; it used to be stored as Fatal here alone.
 */
export const SYSLOG_TO_OTEL_SEVERITY: Readonly<
  Dictionary<LogSeverityOfSyslog>
> = Object.fromEntries(
  SYSLOG_SEVERITY_KEYWORDS.map(
    (keyword: string, severity: number): [string, LogSeverityOfSyslog] => {
      const number: number | undefined = LOG_SEVERITY_NUMBER_BY_TEXT.get(
        keyword.toUpperCase(),
      );

      if (number === undefined) {
        throw new Error(`The level words do not name syslog's ${keyword}`);
      }

      return [
        String(severity),
        { number, text: logSeverityFromNumber(number) },
      ];
    },
  ),
);

/*
 * What a relay assumes for a message that came without a priority (RFC
 * 3164, section 4.3.3): 13, which is facility 1 (user) and severity 5
 * (notice).
 */
export const DEFAULT_SYSLOG_FACILITY: number = 1;
export const DEFAULT_SYSLOG_SEVERITY: number = 5;

export function getSyslogFacilityLabel(facility: number): string {
  if (
    Number.isInteger(facility) &&
    facility >= 0 &&
    facility < SYSLOG_FACILITY_LABELS.length
  ) {
    return SYSLOG_FACILITY_LABELS[facility]!;
  }

  return "unknown";
}

export function getSyslogSeverityLabel(severity: number): string {
  if (
    Number.isInteger(severity) &&
    severity >= 0 &&
    severity < SYSLOG_SEVERITY_LABELS.length
  ) {
    return SYSLOG_SEVERITY_LABELS[severity]!;
  }

  return "unknown";
}

export function mapSyslogSeverity(
  severity: number | undefined | null,
): LogSeverityOfSyslog {
  if (severity === undefined || severity === null) {
    return { number: 0, text: LogSeverity.Unspecified };
  }

  const mapped: LogSeverityOfSyslog | undefined =
    SYSLOG_TO_OTEL_SEVERITY[severity.toString()];

  return mapped || { number: 0, text: LogSeverity.Unspecified };
}

export function isSyslogSeverity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 7
  );
}
