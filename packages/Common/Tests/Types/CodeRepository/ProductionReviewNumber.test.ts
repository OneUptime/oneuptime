import { describe, expect, test } from "@jest/globals";
import {
  PRODUCTION_REVIEW_LIMITS,
  ProductionReviewUtil,
} from "../../../Types/CodeRepository/ProductionReview";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A pull request's number as a person gives it to Review a pull request -
 * 12, "12", "#12", or GitLab's "!12" - read the same in the Dashboard's
 * dialog and on the server: a whole number from 1 up, of at most nine
 * digits, or none. Read character by character, never with a pattern. Its
 * digits may be the ones a Persian keyboard types ("۱۲"), Arabic-Indic
 * ones, or the full-width ones a Japanese or Chinese input method may
 * ("＃１２").
 */

describe("ProductionReviewUtil.readPullRequestNumber", () => {
  test.each([
    [12, 12],
    ["12", 12],
    ["#12", 12],
    ["!12", 12],
    ["  # 12  ", 12],
    ["007", 7],
    ["999999999", 999999999],
    // A Persian keyboard's digits, and Arabic-Indic ones.
    ["۱۲", 12],
    ["#۴۲", 42],
    ["!۱۵", 15],
    ["١٢", 12],
    ["1۲", 12],
    // A Japanese or Chinese input method's full-width digits and marks.
    ["１２", 12],
    ["＃１２", 12],
    ["！１５", 15],
    ["#１２", 12],
  ] as Array<[unknown, number]>)("%j is %i", (raw: unknown, number: number) => {
    expect(ProductionReviewUtil.readPullRequestNumber(raw)).toBe(number);
  });

  test.each([
    [0],
    [-4],
    [1.5],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER + 2],
    [""],
    ["#"],
    ["!"],
    ["##12"],
    ["!#12"],
    ["12!"],
    ["1 2"],
    ["۱۲a"],
    ["＃"],
    ["＃＃１２"],
    ["٫١٢"],
    ["۰"],
    ["1e3"],
    ["0x1F"],
    ["-12"],
    ["+12"],
    ["0"],
    ["1234567890"],
    [null],
    [undefined],
    [{}],
    [[12]],
  ] as Array<[unknown]>)("%j is none", (raw: unknown) => {
    expect(ProductionReviewUtil.readPullRequestNumber(raw)).toBeNull();
  });

  test("a number is at most the digits the limit says", () => {
    expect(PRODUCTION_REVIEW_LIMITS.maxPullRequestNumberDigits).toBe(9);
    expect(
      ProductionReviewUtil.readPullRequestNumber(
        "9".repeat(PRODUCTION_REVIEW_LIMITS.maxPullRequestNumberDigits + 1),
      ),
    ).toBeNull();
  });

  test("a long text is refused at once, in time in line with nothing", () => {
    const text: string = "1".repeat(400000);

    const timed: FastestRun<number | null> = fastestRun({
      run: (): number | null => {
        return ProductionReviewUtil.readPullRequestNumber(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result).toBeNull();
  });
});
