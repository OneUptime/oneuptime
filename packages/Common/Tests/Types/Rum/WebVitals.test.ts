import { describe, expect, test } from "@jest/globals";
import {
  describeWebVitalThresholds,
  formatWebVitalThreshold,
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../Types/Rum/WebVitals";

/*
 * The web-vital definitions carry the plain-language description the RUM
 * overview shows in each vital's (i) tooltip, and the thresholds its
 * Good / Needs work / Poor chip is judged against. The tooltip's limits are
 * derived from the thresholds rather than typed into the description, so a
 * threshold change cannot leave the tooltip quoting the old number.
 */

function definition(key: string): WebVitalDefinition {
  const found: WebVitalDefinition | undefined = WebVitalDefinitions.find(
    (d: WebVitalDefinition): boolean => {
      return d.key === key;
    },
  );

  if (!found) {
    throw new Error(`No web vital "${key}"`);
  }

  return found;
}

describe("WebVitalDefinitions descriptions", () => {
  test("every vital has a description", () => {
    for (const d of WebVitalDefinitions) {
      expect(typeof d.description).toBe("string");
      expect(d.description.trim().length).toBeGreaterThan(20);
    }
  });

  test.each(
    WebVitalDefinitions.map(
      (d: WebVitalDefinition): [string, WebVitalDefinition] => {
        return [d.key, d];
      },
    ),
  )(
    "%s: the description is one or two short sentences a tooltip can hold",
    (_: string, d: WebVitalDefinition) => {
      expect(d.description.length).toBeLessThanOrEqual(220);
      expect(d.description).toMatch(/[.]$/);
      expect(d.description).toBe(d.description.trim());
      expect(d.description).not.toMatch(/\s{2,}/);
    },
  );

  test.each(
    WebVitalDefinitions.map(
      (d: WebVitalDefinition): [string, WebVitalDefinition] => {
        return [d.key, d];
      },
    ),
  )(
    "%s: the description does not quote a threshold (those are derived)",
    (_: string, d: WebVitalDefinition) => {
      /* No "2.5 s", "200 ms", "0.1" style numbers typed into the prose. */
      expect(d.description).not.toMatch(/\d+(\.\d+)?\s?(ms|s)\b/);
      expect(d.description).not.toMatch(/\b0\.\d+/);
    },
  );

  test("the descriptions are distinct - no vital borrows another's text", () => {
    const texts: Set<string> = new Set(
      WebVitalDefinitions.map((d: WebVitalDefinition) => {
        return d.description;
      }),
    );

    expect(texts.size).toBe(WebVitalDefinitions.length);
  });

  test("each description explains its own vital in plain words", () => {
    expect(definition("lcp").description).toMatch(/biggest|largest/i);
    expect(definition("inp").description).toMatch(/click|tap|key/i);
    expect(definition("cls").description).toMatch(/jump|shift|mov/i);
    expect(definition("cls").description).toMatch(/lower is better/i);
    expect(definition("fcp").description).toMatch(/first/i);
    expect(definition("ttfb").description).toMatch(/first byte/i);
    expect(definition("ttfb").description).toMatch(/server/i);
  });

  test("CLS says it is a score, not a time", () => {
    expect(definition("cls").unit).toBe("score");
    expect(definition("cls").description).toMatch(/score/i);
    expect(definition("cls").description).toMatch(/not a time/i);
  });
});

describe("formatWebVitalThreshold", () => {
  test.each([
    [200, "200 ms"],
    [500, "500 ms"],
    [800, "800 ms"],
    [999, "999 ms"],
    [1000, "1 s"],
    [1800, "1.8 s"],
    [2500, "2.5 s"],
    [3000, "3 s"],
    [4000, "4 s"],
    [1234, "1.23 s"],
    [0, "0 ms"],
  ])("%d ms reads as %s", (value: number, expected: string) => {
    expect(formatWebVitalThreshold(value, "ms")).toBe(expected);
  });

  test.each([
    [0.1, "0.1"],
    [0.25, "0.25"],
    [0, "0"],
    [1, "1"],
  ])(
    "a score of %d reads as %s, with no unit",
    (value: number, expected: string) => {
      expect(formatWebVitalThreshold(value, "score")).toBe(expected);
    },
  );
});

describe("describeWebVitalThresholds", () => {
  test("words the published limits for each vital", () => {
    expect(describeWebVitalThresholds(definition("lcp"))).toBe(
      "Good below 2.5 s; poor at 4 s or more.",
    );
    expect(describeWebVitalThresholds(definition("inp"))).toBe(
      "Good below 200 ms; poor at 500 ms or more.",
    );
    expect(describeWebVitalThresholds(definition("cls"))).toBe(
      "Good below 0.1; poor at 0.25 or more.",
    );
    expect(describeWebVitalThresholds(definition("fcp"))).toBe(
      "Good below 1.8 s; poor at 3 s or more.",
    );
    expect(describeWebVitalThresholds(definition("ttfb"))).toBe(
      "Good below 800 ms; poor at 1.8 s or more.",
    );
  });

  test("follows the thresholds, so a changed limit changes the words", () => {
    expect(
      describeWebVitalThresholds({
        unit: "ms",
        thresholds: { warn: 1200, danger: 2600 },
      }),
    ).toBe("Good below 1.2 s; poor at 2.6 s or more.");

    expect(
      describeWebVitalThresholds({
        unit: "score",
        thresholds: { warn: 0.05, danger: 0.5 },
      }),
    ).toBe("Good below 0.05; poor at 0.5 or more.");
  });

  test("the wording matches how the overview rates a value (strict below warn is Good, at danger is Poor)", () => {
    /*
     * WebVitalsCard: value < warn -> Good, value < danger -> Needs work,
     * otherwise Poor. "Good below X" and "poor at Y or more" are exactly
     * those two comparisons.
     */
    const words: string = describeWebVitalThresholds(definition("lcp"));

    expect(words).toContain("below");
    expect(words).toContain("or more");
  });
});
