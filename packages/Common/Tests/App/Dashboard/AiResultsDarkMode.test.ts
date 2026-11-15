import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * Project Settings → AI → AI Results in the dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). The page's cards, the
 * partial-count note, the weekly bars and the colours of each breakdown's
 * parts are all classes, held here to what Theme.css remaps.
 */

// Relative to Common/UI, where the scan reads from.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  `${DASHBOARD}/Components/AI/Results/AiResultsData.ts`,
  `${DASHBOARD}/Components/AI/Results/AiResultsView.tsx`,
  `${DASHBOARD}/Components/AI/Results/AiResultsPage.tsx`,
  `${DASHBOARD}/Pages/Settings/AIResults.tsx`,
];

describe("the AI Results page in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    /*
     * The fills of the breakdowns' parts that Theme.css has no rule for,
     * drawn as bar segments and legend dots, never behind text: the
     * mid-tones (a partly right root cause or a page handed off, a fix being
     * checked, a page a person handled) read the same on both themes, as on
     * the AI Insights pages (App's AiInsightsPagesDarkMode). The quiet parts
     * (a fix waiting for a deploy, a page that recovered on its own) are a
     * mid-tone at half strength: pale on a light card, dim on a dark one,
     * so they stay quiet on both.
     */
    sameInBothThemes: [
      "bg-amber-400",
      "bg-sky-400",
      "bg-indigo-400",
      "bg-sky-500/50",
      "bg-teal-500/50",
    ],
  });

  /*
   * A light tint (bg-sky-200, bg-teal-300) has no dark rule either, and on
   * a dark card it is the brightest thing there: the quiet part of a bar
   * would outshine the parts that matter.
   */
  test("no part is a light tint left light on a dark card", () => {
    for (const token of scan.colorTokens) {
      const match: RegExpMatchArray | null = token.match(
        /^bg-(?!gray-|slate-)[a-z]+-(\d{2,3})(?:\/\d+)?$/,
      );

      if (match && parseInt(match[1]!, 10) < 400) {
        // Only the faint backgrounds Theme.css re-colours (the partial note's).
        expect({ token, unmapped: scan.unmapped.includes(token) }).toEqual({
          token,
          unmapped: false,
        });
        expect({
          token,
          faint: [50, 100].includes(parseInt(match[1]!, 10)),
        }).toEqual({ token, faint: true });
      }
    }
  });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found its colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The note that the counts stopped at the scan limit.
        "bg-amber-50",
        "border-amber-200",
        "text-amber-800",
        // A week's bar: the part that counts, on its track.
        "bg-emerald-500",
        "bg-gray-200",
        // The breakdowns' parts.
        "bg-rose-500",
        "bg-sky-400",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
