import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The dashboard Value widget in the dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). The widget's threshold wash
 * used to be an inline gradient of light pinks and yellows, which no rule can
 * reach: on the dark card it drew a grey-pink box that washed out the
 * title. It is a class now, and so is every colour the trend chip, its
 * tooltip, the hover read-out and the sparkline's end labels draw with - all
 * held here to what Theme.css remaps.
 */

// Relative to Common/UI, where the scan reads from.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src";

const FILES: Array<string> = [
  `${DASHBOARD}/Components/Dashboard/Components/ValueWidgetView.tsx`,
];

describe("the Value widget in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    /*
     * The setup prompt's chart icon: a light indigo drawn on the indigo
     * disc, which Theme.css turns dark indigo - light on dark, it reads in
     * both themes.
     */
    sameInBothThemes: ["text-indigo-300"],
  });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found its colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The threshold washes and the numbers they colour.
        "bg-red-50/50",
        "bg-amber-50/50",
        "text-red-600",
        "text-amber-600",
        // The trend chip: good, bad and about the same.
        "text-emerald-700",
        "text-gray-500",
        // The tooltip's sentence and numbers.
        "text-gray-900",
        "text-gray-600",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
