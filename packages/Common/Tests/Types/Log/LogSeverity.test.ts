import LogSeverity, {
  LogSeverityNumber,
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

    test.each([[""], ["   "], ["nonsense"], ["INFORMATIONAL"], ["3"]])(
      "%s -> null rather than a guess",
      (input: string) => {
        expect(normalizeLogSeverity(input)).toBeNull();
      },
    );
  });
});
