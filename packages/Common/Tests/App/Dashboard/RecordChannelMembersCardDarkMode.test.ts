import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * The channel card of a record's page in the dark theme: the channel's name
 * and what kind of channel it is, the people and the viewer's You tag, Join
 * channel and Add people, what it says after a join, and the boxes of a
 * channel that can take nobody.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan).
 */

// Relative to Common/UI, where the scan reads from.
const FILES: Array<string> = [
  "../../App/FeatureSet/Dashboard/src/Components/Workspace/RecordChannelMembersCard.tsx",
];

/*
 * The join button's own colours: indigo-600 with white text reads the same
 * on a light page and a dark one, as the rest of the Dashboard's primary
 * buttons do.
 */
const SAME_IN_BOTH_THEMES: Array<string> = [
  "bg-indigo-600",
  "hover:bg-indigo-500",
  "text-white",
];

describe("a record's channel card in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    sameInBothThemes: SAME_IN_BOTH_THEMES,
  });

  test("it uses no dark: variant and builds no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found its colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The channel's name, the people, and the lines under them.
        "text-gray-900",
        "text-gray-600",
        "text-gray-500",
        // The You tag.
        "bg-indigo-50",
        "text-indigo-700",
        // Add people, and the boxes of a channel that takes nobody.
        "border-gray-300",
        "bg-white",
        "border-gray-200",
        "bg-gray-50",
        // What a join says.
        "text-green-700",
        "text-red-600",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
