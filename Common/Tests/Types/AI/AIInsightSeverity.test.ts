import AIInsightSeverity, {
  AIInsightSeverityHelper,
} from "../../../Types/AI/AIInsightSeverity";

/*
 * The severity order gates PAGING decisions (the insight → alert escalation
 * floor), so it must be an explicit rank table — "High" < "Low"
 * alphabetically, and a lexical compare would invert the floor and page for
 * Low findings while suppressing High ones.
 */
describe("AIInsightSeverityHelper", () => {
  describe("getRank — the explicit urgency order", () => {
    test("Low < Medium < High", () => {
      expect(
        AIInsightSeverityHelper.getRank(AIInsightSeverity.Low),
      ).toBeLessThan(AIInsightSeverityHelper.getRank(AIInsightSeverity.Medium));
      expect(
        AIInsightSeverityHelper.getRank(AIInsightSeverity.Medium),
      ).toBeLessThan(AIInsightSeverityHelper.getRank(AIInsightSeverity.High));
    });

    test("every severity in the enum is ranked", () => {
      for (const severity of Object.values(AIInsightSeverity)) {
        expect(typeof AIInsightSeverityHelper.getRank(severity)).toBe("number");
      }
    });
  });

  describe("isAtLeast — the floor comparison", () => {
    // The full matrix: [severity, floor, qualifies].
    test.each([
      [AIInsightSeverity.High, AIInsightSeverity.High, true],
      [AIInsightSeverity.High, AIInsightSeverity.Medium, true],
      [AIInsightSeverity.High, AIInsightSeverity.Low, true],
      [AIInsightSeverity.Medium, AIInsightSeverity.High, false],
      [AIInsightSeverity.Medium, AIInsightSeverity.Medium, true],
      [AIInsightSeverity.Medium, AIInsightSeverity.Low, true],
      [AIInsightSeverity.Low, AIInsightSeverity.High, false],
      [AIInsightSeverity.Low, AIInsightSeverity.Medium, false],
      [AIInsightSeverity.Low, AIInsightSeverity.Low, true],
    ])(
      "severity %s against floor %s → %s",
      (
        severity: AIInsightSeverity,
        floor: AIInsightSeverity,
        qualifies: boolean,
      ) => {
        expect(AIInsightSeverityHelper.isAtLeast(severity, floor)).toBe(
          qualifies,
        );
      },
    );

    /*
     * The proof the helper exists: under a lexical string compare
     * "High" >= "Low" is FALSE ("H" sorts before "L"), which would suppress
     * the most urgent findings while a Low floor paged for everything.
     */
    test("High meets a Low floor even though 'High' < 'Low' as strings", () => {
      expect("High" >= "Low").toBe(false);
      expect(
        AIInsightSeverityHelper.isAtLeast(
          AIInsightSeverity.High,
          AIInsightSeverity.Low,
        ),
      ).toBe(true);
    });
  });

  describe("fromString — parsing stored configuration", () => {
    test.each([
      ["High", AIInsightSeverity.High],
      ["Medium", AIInsightSeverity.Medium],
      ["Low", AIInsightSeverity.Low],
    ])("parses %s", (value: string, expected: AIInsightSeverity) => {
      expect(AIInsightSeverityHelper.fromString(value)).toBe(expected);
    });

    test.each([["high"], ["HIGH"], ["Critical"], [""], ["  High "]])(
      "unknown value %j returns undefined so the caller applies its fail-safe default",
      (value: string) => {
        expect(AIInsightSeverityHelper.fromString(value)).toBeUndefined();
      },
    );

    test("null and undefined return undefined", () => {
      expect(AIInsightSeverityHelper.fromString(null)).toBeUndefined();
      expect(AIInsightSeverityHelper.fromString(undefined)).toBeUndefined();
    });
  });
});
