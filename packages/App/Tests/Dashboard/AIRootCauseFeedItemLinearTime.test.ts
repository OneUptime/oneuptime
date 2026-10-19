import { describe, expect, test } from "@jest/globals";
import { stripCitationMarkers } from "../../FeatureSet/Dashboard/src/Utils/AIRootCauseFeedItem";

/*
 * The feed takes the citation markers out of an AI report in the viewer's
 * browser, leaving fenced code alone - so it reads every line for a fence.
 * A line of the report can be of any length, and can hold a line separator
 * other than "\n" (the report is split at "\n" only), which "." does not
 * match: on such a line the fence pattern tried every shorter fence run, each
 * reading the rest of the line again. The run is now taken whole, so a line
 * is read once, and the markers come out as they did.
 */

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("citation markers come out of a report in time in line with its length", () => {
  test.each([
    ["a backtick fence line", "```" + repeat("`", LENGTH) + LINE_SEPARATOR],
    ["a tilde fence line", "~~~" + repeat("~", LENGTH) + LINE_SEPARATOR],
  ])("%s", (_label: string, line: string) => {
    const report: string = `The pool was cut [C1].\n${line}\nA release [C2].`;
    const startedAt: number = Date.now();

    const stripped: string = stripCitationMarkers(report);

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(stripped).toBe(`The pool was cut.\n${line}\nA release.`);
  });

  test("a marker inside a fence is still left alone", () => {
    expect(
      stripCitationMarkers("Cut [C1].\n```\nlog [C2]\n```\nDone [C3]."),
    ).toBe("Cut.\n```\nlog [C2]\n```\nDone.");
  });
});
