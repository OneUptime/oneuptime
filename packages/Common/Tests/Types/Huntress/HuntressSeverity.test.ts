import HuntressSeverity, {
  AllHuntressSeverities,
  HUNTRESS_SEVERITY_WHEN_UNKNOWN,
  getHuntressSeverityRank,
  getHuntressSeverityTitle,
  isHuntressSeverity,
  isHuntressSeverityAtOrAbove,
  parseHuntressSeverity,
} from "../../../Types/Huntress/HuntressSeverity";
import { describe, expect, test } from "@jest/globals";

/*
 * Huntress's three severities, as its API writes them, and how a
 * connection's "Page On-Call For" threshold reads them.
 */
describe("HuntressSeverity", () => {
  test("the three severities Huntress documents, most severe first", () => {
    expect(AllHuntressSeverities).toEqual(["critical", "high", "low"]);
  });

  test("ranks put critical above high above low", () => {
    expect(getHuntressSeverityRank(HuntressSeverity.Critical)).toBeGreaterThan(
      getHuntressSeverityRank(HuntressSeverity.High),
    );
    expect(getHuntressSeverityRank(HuntressSeverity.High)).toBeGreaterThan(
      getHuntressSeverityRank(HuntressSeverity.Low),
    );
  });

  test.each([
    // [report, threshold, pages]
    [HuntressSeverity.Critical, HuntressSeverity.Critical, true],
    [HuntressSeverity.High, HuntressSeverity.Critical, false],
    [HuntressSeverity.Low, HuntressSeverity.Critical, false],
    [HuntressSeverity.Critical, HuntressSeverity.High, true],
    [HuntressSeverity.High, HuntressSeverity.High, true],
    [HuntressSeverity.Low, HuntressSeverity.High, false],
    [HuntressSeverity.Critical, HuntressSeverity.Low, true],
    [HuntressSeverity.High, HuntressSeverity.Low, true],
    [HuntressSeverity.Low, HuntressSeverity.Low, true],
  ])(
    "a %s report with the threshold at %s pages: %s",
    (
      severity: HuntressSeverity,
      threshold: HuntressSeverity,
      pages: boolean,
    ) => {
      expect(isHuntressSeverityAtOrAbove(severity, threshold)).toBe(pages);
    },
  );

  test("parsing ignores case and white space, and refuses anything else", () => {
    expect(parseHuntressSeverity("critical")).toBe(HuntressSeverity.Critical);
    expect(parseHuntressSeverity(" High ")).toBe(HuntressSeverity.High);
    expect(parseHuntressSeverity("LOW")).toBe(HuntressSeverity.Low);
    expect(parseHuntressSeverity("medium")).toBeNull();
    expect(parseHuntressSeverity("")).toBeNull();
    expect(parseHuntressSeverity(3)).toBeNull();
    expect(parseHuntressSeverity(null)).toBeNull();
  });

  test("isHuntressSeverity accepts only the stored values", () => {
    expect(isHuntressSeverity("high")).toBe(true);
    expect(isHuntressSeverity("High")).toBe(false);
    expect(isHuntressSeverity(undefined)).toBe(false);
  });

  test("a report without a readable severity is handled as High, which pages by default", () => {
    expect(HUNTRESS_SEVERITY_WHEN_UNKNOWN).toBe(HuntressSeverity.High);
    expect(
      isHuntressSeverityAtOrAbove(
        HUNTRESS_SEVERITY_WHEN_UNKNOWN,
        HuntressSeverity.High,
      ),
    ).toBe(true);
  });

  test("titles are the words Huntress shows", () => {
    expect(AllHuntressSeverities.map(getHuntressSeverityTitle)).toEqual([
      "Critical",
      "High",
      "Low",
    ]);
  });
});
