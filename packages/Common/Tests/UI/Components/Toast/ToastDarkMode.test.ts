/*
 * The toasts (#9120) in the dark theme.
 *
 * The card is drawn with the app's Tailwind classes, and Theme.css re-colours
 * them under html.dark one rule per class and per variant: a class without a
 * rule keeps its light colour - a white card on a slate page - and nothing
 * fails (Tests/Helpers/DarkModeScan). So every colour class a toast uses is
 * held to what Theme.css remaps: the card, its title and words, its icons,
 * its action and its close button.
 */

import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";

describe("the toasts in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: ["Components/Toast/ToastRegion.tsx"],
  });

  test("they use no dark: variant and build no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the toast's colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        "bg-white",
        "border-gray-200",
        "text-gray-900",
        "text-gray-500",
        "text-gray-400",
        "text-green-600",
        "text-red-600",
        "text-indigo-600",
        "hover:text-indigo-500",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
