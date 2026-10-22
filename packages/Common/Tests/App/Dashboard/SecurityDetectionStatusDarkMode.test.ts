import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * What the Threat Intel and Detection Rules tables draw for a feed's or a
 * rule's health, in the dark theme: the View Error dialog's message boxes
 * and headings, and the Indicators table's muted "Not scored". The pills
 * are the shared Pill's, whose colours carry their own dark shade.
 *
 * The dark theme re-colours light utility classes in Theme.css, one rule per
 * class, and a class without one keeps its light colour with nothing failing
 * (Tests/Helpers/DarkModeScan), so every colour class these files draw with
 * is held to what Theme.css re-colours.
 */

// Relative to Common/UI, where the scan reads from.
const COMPONENTS: string =
  "../../App/FeatureSet/Dashboard/src/Components/SecurityEvents";

const FILES: Array<string> = [
  `${COMPONENTS}/SecurityDetectionErrorModal.tsx`,
  `${COMPONENTS}/SecurityDetectionStatus.ts`,
  `${COMPONENTS}/ThreatIntelIndicatorCells.tsx`,
];

describe("a feed's and a rule's health in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("reads the colour classes the dialog and the cells draw with", () => {
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        "bg-gray-50",
        "text-gray-800",
        "text-gray-900",
        "text-gray-500",
      ]),
    );
  });

  test("Theme.css re-colours every one of them", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("no dark: variants, and no colour built from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });
});
