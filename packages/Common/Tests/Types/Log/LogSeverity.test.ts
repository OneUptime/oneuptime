import LogSeverity, {
  LOG_SEVERITY_NUMBER_BY_TEXT,
  LogSeverityNumber,
  logSeverityFromNumber,
  logSeverityNumberFromText,
  normalizeLogSeverity,
} from "../../../Types/Log/LogSeverity";

/*
 * severityText on a log row is not what the client sent — ingest throws that
 * away and re-derives it from severityNumber into one of these seven enum
 * members. Filter comparisons are case-sensitive, so anything that writes or
 * offers a severity-shaped string ("INFO", "warn") produces a value that
 * matches nothing and reports no error. These tests pin the two things that
 * prevent that: the enum is the only vocabulary, and the number always agrees
 * with the text.
 */
describe("LogSeverity", () => {
  describe("LogSeverityNumber agrees with the OTLP ranges ingest buckets on", () => {
    test.each([
      [LogSeverity.Unspecified, 0],
      [LogSeverity.Trace, 1],
      [LogSeverity.Debug, 5],
      [LogSeverity.Information, 9],
      [LogSeverity.Warning, 13],
      [LogSeverity.Error, 17],
      [LogSeverity.Fatal, 21],
    ])("%s -> %i", (severity: LogSeverity, expected: number) => {
      expect(LogSeverityNumber[severity]).toBe(expected);
    });

    test("every enum member has a number", () => {
      for (const severity of Object.values(LogSeverity)) {
        expect(LogSeverityNumber[severity]).toBeDefined();
      }
    });
  });

  describe("normalizeLogSeverity rescues the values the old dropdowns emitted", () => {
    /*
     * These six are exactly what the filter builder and the severity remapper
     * used to write. INFO and WARNING are the dangerous ones: they differ from
     * the stored value by more than case, so no amount of case-insensitive
     * comparison would have saved them.
     */
    test.each([
      ["TRACE", LogSeverity.Trace],
      ["DEBUG", LogSeverity.Debug],
      ["INFO", LogSeverity.Information],
      ["WARNING", LogSeverity.Warning],
      ["ERROR", LogSeverity.Error],
      ["FATAL", LogSeverity.Fatal],
    ])("legacy %s -> %s", (legacy: string, expected: LogSeverity) => {
      expect(normalizeLogSeverity(legacy)).toBe(expected);
    });

    test.each([
      ["info", LogSeverity.Information],
      ["Information", LogSeverity.Information],
      ["warn", LogSeverity.Warning],
      ["  Error  ", LogSeverity.Error],
      ["err", LogSeverity.Error],
      ["Unspecified", LogSeverity.Unspecified],
    ])("%s -> %s", (input: string, expected: LogSeverity) => {
      expect(normalizeLogSeverity(input)).toBe(expected);
    });

    test("every enum member normalizes to itself", () => {
      for (const severity of Object.values(LogSeverity)) {
        expect(normalizeLogSeverity(severity)).toBe(severity);
      }
    });

    test.each([
      [""],
      ["   "],
      ["nonsense"],
      ["3"],
      ["17"],
      ["constructor"],
      ["toString"],
      ["__proto__"],
      ["INFO5"],
      ["[ERROR]"],
    ])("%s -> null rather than a guess", (input: string) => {
      expect(normalizeLogSeverity(input)).toBeNull();
    });

    test("a value that is not text -> null, never a throw", () => {
      for (const value of [undefined, null, 17, {}, ["ERROR"]]) {
        expect(normalizeLogSeverity(value as unknown as string)).toBeNull();
      }
    });

    /*
     * Issue #8425: the remapper's target and a saved filter's value name a
     * severity with the same words ingest reads a sender's level with, so
     * a pipeline that sets `critical` stores what a log sent at `critical`
     * is stored as. INFORMATIONAL used to be null here.
     */
    test.each([
      ["INFORMATIONAL", LogSeverity.Information],
      ["notice", LogSeverity.Information],
      ["crit", LogSeverity.Error],
      ["alert", LogSeverity.Error],
      ["severe", LogSeverity.Error],
      ["critical", LogSeverity.Fatal],
      ["emerg", LogSeverity.Fatal],
      ["emergency", LogSeverity.Fatal],
      ["verbose", LogSeverity.Debug],
      ["WARN2", LogSeverity.Warning],
      ["fatal4", LogSeverity.Fatal],
    ])(
      "%s -> %s, as ingest stores it",
      (input: string, expected: LogSeverity) => {
        expect(normalizeLogSeverity(input)).toBe(expected);
      },
    );

    test("every word of the table names the severity its number is in", () => {
      for (const [word, severityNumber] of LOG_SEVERITY_NUMBER_BY_TEXT) {
        for (const written of [word, word.toLowerCase(), ` ${word} `]) {
          expect({ written, severity: normalizeLogSeverity(written) }).toEqual({
            written,
            severity: logSeverityFromNumber(severityNumber),
          });
        }
      }
    });
  });

  describe("LOG_SEVERITY_NUMBER_BY_TEXT, the one table of level words (issue #8425)", () => {
    test("is keyed upper-cased, and every number in it is a SeverityNumber from 1 to 24", () => {
      expect(LOG_SEVERITY_NUMBER_BY_TEXT.size).toBeGreaterThan(24);

      for (const [word, severityNumber] of LOG_SEVERITY_NUMBER_BY_TEXT) {
        expect(word).toBe(word.toUpperCase());
        expect(word).toBe(word.trim());
        expect(Number.isInteger(severityNumber)).toBe(true);
        expect(severityNumber).toBeGreaterThanOrEqual(1);
        expect(severityNumber).toBeLessThanOrEqual(24);
      }
    });

    test("has the spec's six short names and their three numbered steps each, at their own numbers", () => {
      const firsts: Array<[string, number]> = [
        ["TRACE", 1],
        ["DEBUG", 5],
        ["INFO", 9],
        ["WARN", 13],
        ["ERROR", 17],
        ["FATAL", 21],
      ];

      for (const [name, first] of firsts) {
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.get(name)).toBe(first);
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.get(`${name}2`)).toBe(first + 1);
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.get(`${name}3`)).toBe(first + 2);
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.get(`${name}4`)).toBe(first + 3);
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.has(`${name}1`)).toBe(false);
        expect(LOG_SEVERITY_NUMBER_BY_TEXT.has(`${name}5`)).toBe(false);
      }
    });

    /*
     * Appendix B of the OpenTelemetry Logs Data Model, row by row, for the
     * words it maps one way.
     */
    test.each([
      ["FINEST", 1, "java.util.logging"],
      ["VERBOSE", 5, "WinEvtLog, ETW"],
      ["FINER", 5, "java.util.logging"],
      ["FINE", 6, "java.util.logging"],
      ["CONFIG", 7, "java.util.logging"],
      ["INFORMATION", 9, "WinEvtLog"],
      ["INFORMATIONAL", 9, "syslog Informational (6)"],
      ["NOTICE", 10, "syslog Notice (5): INFO2"],
      ["WARNING", 13, "syslog Warning (4), WinEvtLog, ETW, java.util.logging"],
      ["ERR", 17, "syslog Error (3), keyword err"],
      ["SEVERE", 17, "java.util.logging"],
      ["CRIT", 18, "syslog Critical (2), keyword crit: ERROR2"],
      ["DPANIC", 18, "zap: ERROR2"],
      ["ALERT", 19, "syslog Alert (1): ERROR3"],
      ["EMERG", 21, "syslog Emergency (0), keyword emerg: FATAL"],
      ["EMERGENCY", 21, "syslog Emergency (0): FATAL"],
    ])("%s -> %i (%s)", (word: string, severityNumber: number) => {
      expect(LOG_SEVERITY_NUMBER_BY_TEXT.get(word)).toBe(severityNumber);
    });

    /*
     * Appendix B maps `critical` two ways (syslog and WinEvtLog: ERROR2;
     * ETW and .NET: FATAL). Spelled in full it is an application logger's
     * top level, and what Fluent ingest always stored it as; syslog's own
     * keyword, `crit`, stays ERROR2.
     */
    test("critical is FATAL (21), and crit is ERROR2 (18)", () => {
      expect(logSeverityNumberFromText("critical")).toBe(21);
      expect(logSeverityNumberFromText("CRITICAL")).toBe(21);
      expect(logSeverityFromNumber(21)).toBe(LogSeverity.Fatal);
      expect(logSeverityNumberFromText("crit")).toBe(18);
      expect(logSeverityFromNumber(18)).toBe(LogSeverity.Error);
    });

    /*
     * Issue #11228: a panic is a crash, the data model's FATAL - Go's runtime
     * panic, PostgreSQL's PANIC, logrus's and zerolog's top level, which
     * OpenTelemetry's own zap and logrus bridges send as FATAL2 and FATAL4.
     * Appendix B's zap example, ERROR3, would rank a logrus or zerolog panic
     * below its fatal. zap's DPanic, which panics only in development, stays
     * Appendix B's ERROR2.
     */
    test("panic is FATAL (21), and dpanic is ERROR2 (18)", () => {
      expect(logSeverityNumberFromText("panic")).toBe(21);
      expect(logSeverityNumberFromText("PANIC")).toBe(21);
      expect(normalizeLogSeverity("panic")).toBe(LogSeverity.Fatal);
      expect(logSeverityNumberFromText("dpanic")).toBe(18);
      expect(normalizeLogSeverity("DPanic")).toBe(LogSeverity.Error);
    });

    /*
     * Syslog's eight keywords keep RFC 5424's order as numbers, each step
     * more severe than the one below it: Appendix B's syslog column, which
     * the Collector's syslog parser follows.
     */
    test("syslog's keywords keep their order: emerg > alert > crit > err > warning > notice > info > debug", () => {
      const numbers: Array<number> = [
        "emerg",
        "alert",
        "crit",
        "err",
        "warning",
        "notice",
        "info",
        "debug",
      ].map((keyword: string): number => {
        return logSeverityNumberFromText(keyword);
      });

      expect(numbers).toEqual([21, 19, 18, 17, 13, 10, 9, 5]);
    });

    /*
     * The words issue #11228 found stored two ways: through the agents'
     * severity chain and through Fluent or OTLP ingest. Now one table, and
     * Tests/Ops/LogSeverityOneTable.test.js holds the agents to it.
     */
    test.each([
      ["critical", 21, LogSeverity.Fatal],
      ["alert", 19, LogSeverity.Error],
      ["panic", 21, LogSeverity.Fatal],
      ["crit", 18, LogSeverity.Error],
      ["notice", 10, LogSeverity.Information],
      ["emergency", 21, LogSeverity.Fatal],
    ])(
      "%s -> %i (%s), wherever the line comes from",
      (word: string, severityNumber: number, severity: LogSeverity) => {
        expect(logSeverityNumberFromText(word)).toBe(severityNumber);
        expect(logSeverityFromNumber(severityNumber)).toBe(severity);
      },
    );

    /*
     * Issue #8536: the short forms loggers write, at the level each
     * abbreviates. And the ones the agents read off a line (issue #11228):
     * .NET's console prefixes trce and fail, MySQL's Note, zerolog's PNC.
     */
    test.each([
      ["TRC", 1, LogSeverity.Trace],
      ["TRCE", 1, LogSeverity.Trace],
      ["VRB", 5, LogSeverity.Debug],
      ["DBG", 5, LogSeverity.Debug],
      ["DBUG", 5, LogSeverity.Debug],
      ["INF", 9, LogSeverity.Information],
      ["NOTE", 9, LogSeverity.Information],
      ["WRN", 13, LogSeverity.Warning],
      ["EROR", 17, LogSeverity.Error],
      ["FAIL", 17, LogSeverity.Error],
      ["FTL", 21, LogSeverity.Fatal],
      ["PNC", 21, LogSeverity.Fatal],
    ])(
      "the short form %s -> %i (%s)",
      (word: string, severityNumber: number, severity: LogSeverity) => {
        expect(logSeverityNumberFromText(word)).toBe(severityNumber);
        expect(logSeverityNumberFromText(word.toLowerCase())).toBe(
          severityNumber,
        );
        expect(normalizeLogSeverity(word)).toBe(severity);
      },
    );

    test("knows no word Datadog, Sentry or a console write that is no logger's level", () => {
      for (const word of ["ok", "success", "log", "unknown"]) {
        expect(logSeverityNumberFromText(word)).toBe(0);
      }
    });

    test("is a Map: a word named like an Object.prototype member names nothing", () => {
      for (const written of [
        "constructor",
        "CONSTRUCTOR",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "__proto__",
        "__PROTO__",
      ]) {
        expect({ written, n: logSeverityNumberFromText(written) }).toEqual({
          written,
          n: 0,
        });
      }
    });
  });

  describe("logSeverityNumberFromText", () => {
    test.each([
      ["info", 9],
      ["  Warn ", 13],
      ["eRrOr3", 19],
      ["Critical", 21],
      ["notice", 10],
    ])("%p -> %i", (written: string, severityNumber: number) => {
      expect(logSeverityNumberFromText(written)).toBe(severityNumber);
    });

    test("a word with a tab or a newline around it still names its level", () => {
      expect(logSeverityNumberFromText("\terror\n")).toBe(17);
    });

    test("anything that is not a word naming a level -> 0", () => {
      for (const value of [
        "",
        "   ",
        "DETAIL",
        "3",
        "ERROR: disk full",
        "SEVERITY_NUMBER_ERROR",
        "UNSPECIFIED",
        17,
        null,
        undefined,
        true,
        { value: "ERROR" },
        ["ERROR"],
      ]) {
        expect(logSeverityNumberFromText(value)).toBe(0);
      }
    });
  });

  describe("logSeverityFromNumber", () => {
    test("buckets each of the spec's six ranges, and anything else as Unspecified", () => {
      const expected: Array<[number, LogSeverity]> = [
        [0, LogSeverity.Unspecified],
        [1, LogSeverity.Trace],
        [4, LogSeverity.Trace],
        [5, LogSeverity.Debug],
        [8, LogSeverity.Debug],
        [9, LogSeverity.Information],
        [12, LogSeverity.Information],
        [13, LogSeverity.Warning],
        [16, LogSeverity.Warning],
        [17, LogSeverity.Error],
        [20, LogSeverity.Error],
        [21, LogSeverity.Fatal],
        [24, LogSeverity.Fatal],
        [25, LogSeverity.Unspecified],
        [-1, LogSeverity.Unspecified],
        [Number.NaN, LogSeverity.Unspecified],
      ];

      for (const [severityNumber, severity] of expected) {
        expect({
          severityNumber,
          severity: logSeverityFromNumber(severityNumber),
        }).toEqual({ severityNumber, severity });
      }
    });

    test("is the inverse of LogSeverityNumber", () => {
      for (const severity of Object.values(LogSeverity)) {
        expect(logSeverityFromNumber(LogSeverityNumber[severity])).toBe(
          severity,
        );
      }
    });
  });
});
