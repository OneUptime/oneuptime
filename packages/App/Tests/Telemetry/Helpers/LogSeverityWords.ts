import LogSeverity from "Common/Types/Log/LogSeverity";

/*
 * THE LEVEL WORDS EVERY LOG INGEST READS, AND WHAT EACH IS STORED AS
 * (issue #8425).
 *
 * Written out by hand rather than read from the code's table
 * (LOG_SEVERITY_NUMBER_BY_TEXT), so a change that moves a word - or adds
 * or drops one - fails the suites that send these words through each path:
 * OTLP severityText (OtelLogsSeverityWireFormat.test.ts), Fluentd / Fluent
 * Bit records (FluentLogsSeverityWords.test.ts) and the pipeline severity
 * remapper (LogPipelineSeverityRemapper.test.ts).
 *
 * `source` says where the mapping comes from: the OpenTelemetry Logs Data
 * Model's short names and numbered steps, or its Appendix B (SeverityNumber
 * example mappings) and the column there that names the word.
 */
export interface LogSeverityWord {
  word: string;
  severityNumber: number;
  severity: LogSeverity;
  source: string;
}

// The spec's short names and their numbered steps: TRACE ... FATAL4.
export const SHORT_NAME_WORDS: Array<LogSeverityWord> = (
  [
    ["TRACE", 1, LogSeverity.Trace],
    ["DEBUG", 5, LogSeverity.Debug],
    ["INFO", 9, LogSeverity.Information],
    ["WARN", 13, LogSeverity.Warning],
    ["ERROR", 17, LogSeverity.Error],
    ["FATAL", 21, LogSeverity.Fatal],
  ] as Array<[string, number, LogSeverity]>
).flatMap(
  ([name, first, severity]: [
    string,
    number,
    LogSeverity,
  ]): Array<LogSeverityWord> => {
    return [0, 1, 2, 3].map((step: number): LogSeverityWord => {
      return {
        word: step === 0 ? name : `${name}${step + 1}`,
        severityNumber: first + step,
        severity: severity,
        source: "Logs Data Model: SeverityText, Displaying Severity",
      };
    });
  },
);

// The spellings of other logging systems, as Appendix B maps them.
export const OTHER_LOGGER_WORDS: Array<LogSeverityWord> = [
  {
    word: "finest",
    severityNumber: 1,
    severity: LogSeverity.Trace,
    source: "Appendix B: java.util.logging FINEST",
  },
  {
    word: "verbose",
    severityNumber: 5,
    severity: LogSeverity.Debug,
    source: "Appendix B: WinEvtLog Verbose, ETW VERBOSE",
  },
  {
    word: "finer",
    severityNumber: 5,
    severity: LogSeverity.Debug,
    source: "Appendix B: java.util.logging FINER",
  },
  {
    word: "fine",
    severityNumber: 6,
    severity: LogSeverity.Debug,
    source: "Appendix B: java.util.logging FINE",
  },
  {
    word: "config",
    severityNumber: 7,
    severity: LogSeverity.Debug,
    source: "Appendix B: java.util.logging CONFIG",
  },
  {
    word: "information",
    severityNumber: 9,
    severity: LogSeverity.Information,
    source: "Appendix B: WinEvtLog Information",
  },
  {
    word: "informational",
    severityNumber: 9,
    severity: LogSeverity.Information,
    source: "Appendix B: syslog Informational (6)",
  },
  {
    word: "notice",
    severityNumber: 10,
    severity: LogSeverity.Information,
    source: "Appendix B: syslog Notice (5)",
  },
  {
    word: "warning",
    severityNumber: 13,
    severity: LogSeverity.Warning,
    source: "Appendix B: syslog Warning (4), WinEvtLog, ETW, java.util.logging",
  },
  {
    word: "err",
    severityNumber: 17,
    severity: LogSeverity.Error,
    source: "Appendix B: syslog Error (3), keyword err",
  },
  {
    word: "severe",
    severityNumber: 17,
    severity: LogSeverity.Error,
    source: "Appendix B: java.util.logging SEVERE",
  },
  {
    word: "crit",
    severityNumber: 18,
    severity: LogSeverity.Error,
    source: "Appendix B: syslog Critical (2), keyword crit",
  },
  {
    word: "dpanic",
    severityNumber: 18,
    severity: LogSeverity.Error,
    source: "Appendix B: zap DPanic",
  },
  {
    word: "alert",
    severityNumber: 19,
    severity: LogSeverity.Error,
    source: "Appendix B: syslog Alert (1)",
  },
  /*
   * A panic is a crash, the data model's FATAL (issue #11228): Go's runtime
   * panic, PostgreSQL's PANIC, logrus's and zerolog's top level, which
   * OpenTelemetry's own zap and logrus bridges send as FATAL2 and FATAL4.
   * Appendix B's zap example (ERROR3) would rank a logrus or zerolog panic
   * below its fatal.
   */
  {
    word: "panic",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source:
      "a crash: Go, PostgreSQL, logrus, zerolog; the zap and logrus bridges",
  },
  {
    word: "emerg",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source: "Appendix B: syslog Emergency (0), keyword emerg",
  },
  {
    word: "emergency",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source: "Appendix B: syslog Emergency (0)",
  },
  /*
   * The one word Appendix B maps two ways - syslog's and the Windows Event
   * Log's Critical are ERROR2, ETW's CRITICAL and .NET's LogLevel.Critical
   * FATAL. Spelled in full it is an application logger's top level (.NET,
   * Python, whose CRITICAL OpenTelemetry's Python SDK sends as FATAL), and
   * what Fluent ingest always stored it as; syslog writes `crit`.
   */
  {
    word: "critical",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source: "Appendix B: ETW CRITICAL, .NET LogLevel.Critical",
  },
  /*
   * The short forms loggers write in a level field (issue #8536), each at
   * the level it abbreviates.
   */
  {
    word: "trc",
    severityNumber: 1,
    severity: LogSeverity.Trace,
    source: "zerolog's TRC: TRACE",
  },
  // And the ones the agents read off a line (issue #11228).
  {
    word: "trce",
    severityNumber: 1,
    severity: LogSeverity.Trace,
    source: ".NET's console trce: TRACE",
  },
  {
    word: "note",
    severityNumber: 9,
    severity: LogSeverity.Information,
    source: "MySQL's and MariaDB's Note: INFO",
  },
  {
    word: "fail",
    severityNumber: 17,
    severity: LogSeverity.Error,
    source: ".NET's console fail: ERROR",
  },
  {
    word: "pnc",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source: "zerolog's PNC: a panic",
  },
  {
    word: "vrb",
    severityNumber: 5,
    severity: LogSeverity.Debug,
    source: "Serilog's VRB: Verbose, Appendix B's DEBUG",
  },
  {
    word: "dbg",
    severityNumber: 5,
    severity: LogSeverity.Debug,
    source: "Serilog's DBG: DEBUG",
  },
  {
    word: "dbug",
    severityNumber: 5,
    severity: LogSeverity.Debug,
    source: "log15's dbug: DEBUG",
  },
  {
    word: "inf",
    severityNumber: 9,
    severity: LogSeverity.Information,
    source: "Serilog's INF: INFO",
  },
  {
    word: "wrn",
    severityNumber: 13,
    severity: LogSeverity.Warning,
    source: "Serilog's WRN: WARN",
  },
  {
    word: "eror",
    severityNumber: 17,
    severity: LogSeverity.Error,
    source: "log15's eror: ERROR",
  },
  {
    word: "ftl",
    severityNumber: 21,
    severity: LogSeverity.Fatal,
    source: "Serilog's FTL: FATAL",
  },
];

/*
 * logrus's four letters, which its text formatter writes when it colours a
 * level (issue #11226), each at the level it cuts short.
 */
export const LOGRUS_WORDS: Array<LogSeverityWord> = (
  [
    ["trac", 1, LogSeverity.Trace],
    ["debu", 5, LogSeverity.Debug],
    ["erro", 17, LogSeverity.Error],
    ["fata", 21, LogSeverity.Fatal],
    ["pani", 21, LogSeverity.Fatal],
  ] as Array<[string, number, LogSeverity]>
).map(
  ([word, severityNumber, severity]: [
    string,
    number,
    LogSeverity,
  ]): LogSeverityWord => {
    return {
      word,
      severityNumber,
      severity,
      source: "logrus's coloured four letters",
    };
  },
);

/*
 * Go's log/slog between its four names (issue #11226): a level that is no
 * name is written as the name below it and the distance, and OpenTelemetry's
 * slog bridge numbers it as the slog level plus 9. Written out, not
 * computed, so a change to the rule fails here.
 */
export const SLOG_OFFSET_WORDS: Array<LogSeverityWord> = (
  [
    ["DEBUG-4", 1, LogSeverity.Trace],
    ["DEBUG-3", 2, LogSeverity.Trace],
    ["DEBUG-2", 3, LogSeverity.Trace],
    ["DEBUG-1", 4, LogSeverity.Trace],
    ["DEBUG+1", 6, LogSeverity.Debug],
    ["DEBUG+2", 7, LogSeverity.Debug],
    ["DEBUG+3", 8, LogSeverity.Debug],
    ["INFO+1", 10, LogSeverity.Information],
    ["INFO+2", 11, LogSeverity.Information],
    ["INFO+3", 12, LogSeverity.Information],
    ["WARN+1", 14, LogSeverity.Warning],
    ["WARN+2", 15, LogSeverity.Warning],
    ["WARN+3", 16, LogSeverity.Warning],
    ["ERROR+1", 18, LogSeverity.Error],
    ["ERROR+2", 19, LogSeverity.Error],
    ["ERROR+3", 20, LogSeverity.Error],
    ["ERROR+4", 21, LogSeverity.Fatal],
    ["ERROR+5", 22, LogSeverity.Fatal],
    ["ERROR+6", 23, LogSeverity.Fatal],
    ["ERROR+7", 24, LogSeverity.Fatal],
  ] as Array<[string, number, LogSeverity]>
).map(
  ([word, severityNumber, severity]: [
    string,
    number,
    LogSeverity,
  ]): LogSeverityWord => {
    return {
      word,
      severityNumber,
      severity,
      source: "Go's log/slog: its level plus 9, as its OpenTelemetry bridge",
    };
  },
);

export const LOG_SEVERITY_WORDS: Array<LogSeverityWord> = [
  ...SHORT_NAME_WORDS,
  ...OTHER_LOGGER_WORDS,
  ...LOGRUS_WORDS,
  ...SLOG_OFFSET_WORDS,
];

// A word the way different senders write it: any case, spaces around it.
export function spellingsOf(word: string): Array<string> {
  const lower: string = word.toLowerCase();

  return [
    lower,
    word.toUpperCase(),
    `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`,
    ` ${lower}\t`,
  ];
}

// Text that names no level: stored as Unspecified by every path.
export const WORDS_THAT_NAME_NOTHING: Array<[string, string]> = [
  ["a word that is no level", "DETAIL"],
  ["another word that is no level", "LOG"],
  ["a single letter", "E"],
  ["a step past the fourth", "INFO5"],
  ["a step before the second", "WARN1"],
  ["step zero", "ERROR0"],
  ["the enum name of a number", "SEVERITY_NUMBER_ERROR"],
  ["a level inside other words", "ERROR: disk full"],
  ["a level with punctuation", "[ERROR]"],
  ["a number, which is no word", "3"],
  ["an Object.prototype key", "constructor"],
  ["another Object.prototype key", "toString"],
  ["a third Object.prototype key", "hasOwnProperty"],
  ["__proto__", "__proto__"],
];
