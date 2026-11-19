/*
 * A cloud resource's More Metrics card, its Add dialog, a section's key
 * metrics not reported and the section heading that counts them (#9563,
 * #9569), in the dark theme.
 *
 * They are drawn with the app's Tailwind classes, and Theme.css re-colours
 * them under html.dark one rule per class and per variant: a class without a
 * rule keeps its light colour - near-black words on a slate panel - and
 * nothing fails (Tests/Helpers/DarkModeScan). So every colour class they use
 * is held to what Theme.css remaps.
 */

import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";

// Read as Common/UI's own files are: from Common/UI.
const DASHBOARD: string = "../../App/FeatureSet/Dashboard/src/Components";
const FILES: Array<string> = [
  `${DASHBOARD}/Cloud/ResourceMetrics/CloudResourceMoreMetrics.tsx`,
  `${DASHBOARD}/Cloud/ResourceMetrics/CloudAddMetricModal.tsx`,
  `${DASHBOARD}/Cloud/ResourceMetrics/CloudUnreportedKeyMetricsList.tsx`,
  `${DASHBOARD}/Metrics/MetricRowGroupHeading.tsx`,
];

describe("a cloud resource's more metrics and unreported key metrics in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("they use no dark: variant and build no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The words: names, descriptions, since when, reasons.
        "text-gray-900",
        "text-gray-700",
        "text-gray-600",
        "text-gray-500",
        // The fix links.
        "text-indigo-600",
        "hover:text-indigo-700",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
