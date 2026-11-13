import { describe, expect, test } from "@jest/globals";
import {
  getNumberSpacingClassName,
  PROPORTIONAL_NUMBERS_CLASS_NAME,
  TABULAR_NUMBERS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetDigits";

/*
 * THE ROOM A WIDGET'S NUMBER GIVES EACH OF ITS DIGITS.
 *
 * Latin digits keep one width (tabular-nums), so a Gauge's centre or a
 * clock that changes in place keeps its place. Persian's digits, and
 * Arabic's own, are drawn by Vazirmatn, whose digits of one width are each
 * as wide as its widest - "۱ ۱:۲ ۹" for "۱۱:۲۹" - so a number written in
 * them takes each digit's own width (proportional-nums).
 */
describe("getNumberSpacingClassName", () => {
  test.each([
    ["Persian digits", "۶۷٫۹۰", PROPORTIONAL_NUMBERS_CLASS_NAME],
    ["a Persian time", "۱۱:۲۹", PROPORTIONAL_NUMBERS_CLASS_NAME],
    [
      "a Persian count with its word",
      "۱۲ میزبان",
      PROPORTIONAL_NUMBERS_CLASS_NAME,
    ],
    ["Arabic's own digits", "٦٧٫٩٠", PROPORTIONAL_NUMBERS_CLASS_NAME],
    ["Latin digits", "67.90", TABULAR_NUMBERS_CLASS_NAME],
    ["a German number", "67,90", TABULAR_NUMBERS_CLASS_NAME],
    ["a Latin rate with its unit", "1.96 MB/s", TABULAR_NUMBERS_CLASS_NAME],
    ["Persian words with no digit", "سالم", TABULAR_NUMBERS_CLASS_NAME],
  ])("%s: %s", (_case: string, text: string, expected: string) => {
    expect(getNumberSpacingClassName(text)).toBe(expected);
  });

  test("nothing to draw keeps the one width every number had", () => {
    expect(getNumberSpacingClassName("")).toBe(TABULAR_NUMBERS_CLASS_NAME);
    expect(getNumberSpacingClassName(null)).toBe(TABULAR_NUMBERS_CLASS_NAME);
    expect(getNumberSpacingClassName(undefined)).toBe(
      TABULAR_NUMBERS_CLASS_NAME,
    );
  });

  test("the classes are Tailwind's own", () => {
    expect(TABULAR_NUMBERS_CLASS_NAME).toBe("tabular-nums");
    expect(PROPORTIONAL_NUMBERS_CLASS_NAME).toBe("proportional-nums");
  });
});
