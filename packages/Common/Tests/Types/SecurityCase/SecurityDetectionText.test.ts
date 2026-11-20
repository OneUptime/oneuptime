import {
  SECURITY_DETECTION_TEXT_LIMIT,
  cutShortDetectionText,
  getCutShortDetectionTextStart,
} from "../../../Types/SecurityCase/SecurityDetectionText";
import { describe, expect, test } from "@jest/globals";

/*
 * How much of a text a detection keeps: a text longer than its columns
 * keep is recorded cut short, ending in an ellipsis, and what reads a
 * recorded value back as a match (a case reading its detection's events
 * again by its group, #9939) tells it was cut and matches by its start.
 */

describe("how much of a text a detection keeps", () => {
  test("keeps a text within the limit whole", () => {
    expect(SECURITY_DETECTION_TEXT_LIMIT).toBe(480);
    expect(cutShortDetectionText("203.0.113.7")).toBe("203.0.113.7");
    expect(cutShortDetectionText("x".repeat(480))).toBe("x".repeat(480));
    expect(cutShortDetectionText("")).toBe("");
  });

  test("cuts a longer text to the limit, ending in an ellipsis", () => {
    const route: string = `/api/search?q=${"a".repeat(600)}`;
    const recorded: string = cutShortDetectionText(route);

    expect(recorded).toHaveLength(SECURITY_DETECTION_TEXT_LIMIT);
    expect(recorded.endsWith("…")).toBe(true);
    expect(route.startsWith(recorded.slice(0, -1))).toBe(true);
  });
});

describe("a recorded text read back", () => {
  test("cut short, it is matched by all of it but the ellipsis: the start of the value it was", () => {
    const value: string = `alice / ${"b".repeat(700)}`;
    const start: string | null = getCutShortDetectionTextStart(
      cutShortDetectionText(value),
    );

    expect(start).not.toBeNull();
    expect(start).toHaveLength(SECURITY_DETECTION_TEXT_LIMIT - 1);
    expect(value.startsWith(start!)).toBe(true);
  });

  test("whole, it is no start of anything", () => {
    expect(getCutShortDetectionTextStart("203.0.113.7")).toBeNull();
    expect(getCutShortDetectionTextStart("")).toBeNull();
    // As long as the limit, but kept whole: no ellipsis at its end.
    expect(getCutShortDetectionTextStart("x".repeat(480))).toBeNull();
    // An ellipsis of its own, in a shorter text.
    expect(getCutShortDetectionTextStart("Loading…")).toBeNull();
  });
});
