import { describe, expect, test } from "@jest/globals";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DETECTION_RULE_NAME_MAX_LENGTH,
  fitDetectionRuleName,
} from "../../../Types/SecurityEvent/DetectionRuleName";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * THE NAME ONEUPTIME GIVES A DETECTION RULE FROM ITS SIGMA TITLE.
 *
 * A rule is named after its Sigma title - by the Rule Library, by the rule
 * form as the YAML is typed or drafted, by the server when a create names
 * none - and Sigma allows a title of 256 characters. The name holds 100
 * (every other name in OneUptime does, and so does a Microsoft Sentinel
 * rule's). A title that fits is the name as written; a longer one is cut to
 * fit, so a name nobody typed never fails a save.
 */

const ELLIPSIS: string = "…";

// SigmaHQ's two longest titles (release r2026-07-01): 103 and 102 characters.
const SIGMAHQ_LONGEST: Array<string> = [
  "CVE-2023-1389 Potential Exploitation Attempt - Unauthenticated Command Injection In TP-Link Archer AX21",
  "CVE-2023-4966 Potential Exploitation Attempt - Citrix ADC Sensitive Information Disclosure - Webserver",
];

describe("fitDetectionRuleName", () => {
  test("the width is the name column's, as every create checks it", () => {
    expect(DETECTION_RULE_NAME_MAX_LENGTH).toBe(
      getMaxLengthFromTableColumnType(
        new DetectionRule().getTableColumnMetadata("name").type,
      ),
    );
  });

  test("a title that fits is the name as written, trimmed", () => {
    expect(fitDetectionRuleName("Brute force from one IP address")).toBe(
      "Brute force from one IP address",
    );
    expect(fitDetectionRuleName("  Port scan \n")).toBe("Port scan");
    expect(fitDetectionRuleName("")).toBe("");
  });

  test("every library title is its own name, as written", () => {
    for (const entry of DETECTION_RULE_LIBRARY) {
      expect(fitDetectionRuleName(entry.title)).toBe(entry.title);
    }

    expect(
      DETECTION_RULE_LIBRARY.some((entry: DetectionRuleLibraryEntry) => {
        return entry.title.length > 50;
      }),
    ).toBe(true);
  });

  test("a title exactly as wide as a name is kept whole", () => {
    const title: string = "x".repeat(DETECTION_RULE_NAME_MAX_LENGTH);

    expect(fitDetectionRuleName(title)).toBe(title);
  });

  test("a longer title is cut at the last word that fits, and says it was cut", () => {
    const name: string = fitDetectionRuleName(SIGMAHQ_LONGEST[0]!);

    expect(name).toBe(
      "CVE-2023-1389 Potential Exploitation Attempt - Unauthenticated Command Injection In TP-Link Archer…",
    );
    expect(name.length).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);
  });

  test("a cut never ends on a dash or a comma before its ellipsis", () => {
    for (const title of SIGMAHQ_LONGEST) {
      const name: string = fitDetectionRuleName(title);

      expect(name.endsWith(ELLIPSIS)).toBe(true);
      expect(name.length).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);

      const beforeEllipsis: string = name.slice(0, -1);
      expect(beforeEllipsis).toBe(beforeEllipsis.trimEnd());
      expect(["-", ",", ";", ":"]).not.toContain(beforeEllipsis.slice(-1));
    }

    const dashed: string = `${"word ".repeat(18)}- ${"tail ".repeat(10)}`;
    const name: string = fitDetectionRuleName(dashed);
    expect(name.slice(-2, -1)).not.toBe("-");
    expect(name.slice(-2, -1)).not.toBe(" ");
  });

  test("one long word, or a space far back, is cut inside the word rather than losing most of the name", () => {
    const word: string = "a".repeat(300);
    expect(fitDetectionRuleName(word)).toBe(
      `${"a".repeat(DETECTION_RULE_NAME_MAX_LENGTH - 1)}${ELLIPSIS}`,
    );

    const farBack: string = `Short ${"b".repeat(250)}`;
    const name: string = fitDetectionRuleName(farBack);
    expect(name.length).toBe(DETECTION_RULE_NAME_MAX_LENGTH);
    expect(name.startsWith("Short bbb")).toBe(true);
  });

  test("a title as long as Sigma allows fits, and so does any title at all", () => {
    expect(
      fitDetectionRuleName("Title ".repeat(43).slice(0, 256)).length,
    ).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);

    const titles: Array<string> = generatedTexts(
      3000,
      5303,
      ["Failed", " ", "sign-in", "-", ",", "—", "x", "  ", "CVE-2024"],
      120,
    );

    for (const title of titles) {
      const name: string = fitDetectionRuleName(title);
      const trimmed: string = title.trim();

      expect(name.length).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);

      if (trimmed.length <= DETECTION_RULE_NAME_MAX_LENGTH) {
        expect(name).toBe(trimmed);
      } else {
        // A cut name is the start of the title, then the ellipsis.
        expect(name.endsWith(ELLIPSIS)).toBe(true);
        expect(trimmed.startsWith(name.slice(0, -1))).toBe(true);
        expect(name.length).toBeGreaterThan(1);
      }
    }
  });

  test("reads a title of a megabyte in no time: no regular expression walks it", () => {
    const huge: string = "word ".repeat(400000);
    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return fitDetectionRuleName(huge);
      },
      limitInMs: 2000,
    });
    const name: string = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(name.length).toBeLessThanOrEqual(DETECTION_RULE_NAME_MAX_LENGTH);
  });
});
