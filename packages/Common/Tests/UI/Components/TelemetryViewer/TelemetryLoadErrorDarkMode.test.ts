/*
 * What the telemetry explorers show when a read did not come back (issue
 * #4707), in the dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). So every colour class these
 * draw with is held to what Theme.css remaps: the message where the rows go
 * (its amber clock for a search that took too long, its red sign for any
 * other failure, the Try again button), the chart card's two lines, the
 * sidebar's tinted note, and a facet's "Not counted" line and its "—" in
 * place of a count.
 */

import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";

const FILES: Array<string> = [
  "Components/TelemetryViewer/components/TelemetryLoadErrorMessage.tsx",
  "Components/TelemetryViewer/components/TelemetryFacetSection.tsx",
  "Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx",
  "Components/LogsViewer/components/FacetSection.tsx",
];

describe("the explorers' load errors in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found their colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // A search that took too long: the amber clock, and the sidebar note.
        "bg-amber-50",
        "text-amber-600",
        "text-amber-800",
        // Any other failure: the red sign, and the sidebar note.
        "bg-red-50",
        "text-red-600",
        "text-red-700",
        // The title and the advice.
        "text-gray-900",
        "text-gray-500",
        // Try again.
        "border-gray-200",
        "bg-white",
        "text-gray-700",
        "hover:border-gray-300",
        "hover:bg-gray-50",
        // A facet's count that was not taken: "—".
        "text-gray-300",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
