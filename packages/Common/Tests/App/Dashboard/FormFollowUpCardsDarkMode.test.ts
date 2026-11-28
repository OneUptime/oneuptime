import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";

/*
 * A form's follow-up cards in the dark theme: the Follow-Ups switch on the
 * On Submit page, and the card on a record's page - who follows the
 * request, the conversation, the badges and the reply box.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan).
 */

// Relative to Common/UI, where the scan reads from.
const FILES: Array<string> = [
  "../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormFollowUpsCard.tsx",
  "../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FollowUp/FormFollowUpRecordCard.tsx",
];

describe("a form's follow-up cards in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: FILES,
    sameInBothThemes: [],
  });

  test("they use no dark: variant and build no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the record card's colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        "text-gray-900",
        "text-gray-500",
        "bg-indigo-50",
        "border-gray-200",
        "bg-white",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
