import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * Editing a user override, and its overlaps (issues #7630, #7631), in the
 * dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). What the change draws is
 * all classes: the notice under Ends when the times picked overlap another
 * override (red, with Edit that override), the note on an override of the
 * other scope (grey), the lists' Overlaps mark (amber), and Edit on the
 * lists and on a schedule's Active overrides card. They are held here to
 * what Theme.css remaps.
 */

// Relative to Common/UI, where the scan reads from.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  `${DASHBOARD}/Components/OnCallPolicy/UserOverrides/UserOverrideFormModal.tsx`,
  `${DASHBOARD}/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapNotice.tsx`,
  `${DASHBOARD}/Components/OnCallPolicy/UserOverrides/UserOverrideOverlapsMark.tsx`,
  `${DASHBOARD}/Components/OnCallPolicy/UserOverrides/UserOverrideTable.tsx`,
  `${DASHBOARD}/Components/OnCallPolicy/OnCallScheduleLayer/ActiveOverridesCard.tsx`,
];

describe("editing a user override, and its overlaps, in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    /*
     * The ping behind the Active overrides card's live dot: a mid-tone
     * behind no text, the same in both themes, as on the final schedule's
     * summary.
     */
    sameInBothThemes: ["bg-indigo-400"],
  });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found the colours the change draws with, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The times picked overlap another override of the same person.
        "bg-red-50",
        "text-red-800",
        "ring-red-200",
        // An override of the other scope, only noted.
        "text-gray-600",
        "text-gray-400",
        // The lists' Overlaps mark, on an overlap saved before the rule.
        "bg-amber-50",
        "text-amber-800",
        "ring-amber-200",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
