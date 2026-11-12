import { describe, expect, test } from "@jest/globals";
import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel, isDashboardLabel } from "./DocsDashboardLabels";

/*
 * THE CHECKS PAGE NAMES EACH ALERT CONDITION AS THE DASHBOARD DRAWS IT
 * (#6976).
 *
 * A check's Alert When dropdown offered Unusually High and Unusually Low in
 * English in every language - its labels were the conditions' English
 * values, which no locale file held - so every translation of the Data
 * Observability Checks page quoted them in English too. The dropdown now
 * draws each condition in the reader's language
 * (DataCheckAlertConditionWords), and the page quotes it as that
 * language's Dashboard draws it, on the line that says what each condition
 * compares with.
 */

const PAGE: string = "data-observability/checks";

const CONDITIONS: ReadonlyArray<[string, string]> = [
  ["Unusually High", "Unusually Low"],
  ["Above", "Below"],
];

// The page's lines that quote a pair of conditions, "**A** or **B**".
function lineQuoting(page: string, first: string, second: string): string {
  return (
    page.split("\n").find((line: string): boolean => {
      return line.includes(`**${first}**`) && line.includes(`**${second}**`);
    }) || ""
  );
}

describe("the Alert When conditions the checks page quotes", () => {
  test("are each a Dashboard label", () => {
    for (const pair of CONDITIONS) {
      for (const label of pair) {
        expect({ label, isLabel: isDashboardLabel(label) }).toEqual({
          label,
          isLabel: true,
        });
      }
    }
  });

  test("the English page quotes them, each pair on a line of its own", () => {
    const page: string = readPage("en", PAGE);

    for (const [first, second] of CONDITIONS) {
      expect(lineQuoting(page, first!, second!)).toMatch(/^- /);
    }
  });

  test.each(
    DOCS_LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )("the %s page quotes each as its Dashboard draws it", (language: string) => {
    const page: string = readPage(language, PAGE);

    for (const [first, second] of CONDITIONS) {
      const drawnFirst: string = drawnDashboardLabel(language, first!);
      const drawnSecond: string = drawnDashboardLabel(language, second!);

      // The Dashboard draws the label in the language's own words.
      expect({ language, label: first, drawn: drawnFirst }).not.toEqual({
        language,
        label: first,
        drawn: first,
      });
      expect({
        language,
        pair: [first, second],
        quoted: lineQuoting(page, drawnFirst, drawnSecond) !== "",
      }).toEqual({ language, pair: [first, second], quoted: true });
    }

    // And never in English any more.
    expect(page).not.toContain("**Unusually High**");
    expect(page).not.toContain("**Unusually Low**");
  });
});
