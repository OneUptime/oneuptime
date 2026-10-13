import Dictionary from "../../Types/Dictionary";
import LogSeverity from "../../Types/Log/LogSeverity";

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

export interface LogSeverityOfSyslog {
  number: number;
  text: LogSeverity;
}

/*
 * Syslog severity -> log severity: 0-1 Fatal, 2-3 Error, 4 Warning, 5-6
 * Information, 7 Debug. The numbers sit inside the OTLP range of each
 * severity text, so text and number agree.
 */
export const SYSLOG_TO_OTEL_SEVERITY: Readonly<
  Dictionary<LogSeverityOfSyslog>
> = {
  "0": { number: 23, text: LogSeverity.Fatal },
  "1": { number: 23, text: LogSeverity.Fatal },
  "2": { number: 19, text: LogSeverity.Error },
  "3": { number: 19, text: LogSeverity.Error },
  "4": { number: 13, text: LogSeverity.Warning },
  "5": { number: 9, text: LogSeverity.Information },
  "6": { number: 9, text: LogSeverity.Information },
  "7": { number: 5, text: LogSeverity.Debug },
};

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
