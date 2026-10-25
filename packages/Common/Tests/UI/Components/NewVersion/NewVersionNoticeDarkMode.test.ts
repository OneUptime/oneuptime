/*
 * "OneUptime has been updated", the corner card on the Dashboard and the
 * Admin Dashboard, in the dark theme.
 *
 * The card is drawn with the app's Tailwind classes, and Theme.css re-colours
 * them under html.dark one rule per class and per variant: a class without a
 * rule keeps its light colour - a white card on a slate page - and nothing
 * fails (Tests/Helpers/DarkModeScan). So every colour class the card uses is
 * held to what Theme.css remaps: the card, its title and words, the circle
 * behind its icon, Reload, Reload anyway and Cancel, and the close button.
 *
 * The screens a page shows while it moves onto the new version
 * (ChunkLoadRecovery) carry a stylesheet of their own with its own dark
 * values (ErrorScreenStyle), so they are not part of this scan.
 */

import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";

describe("the new-version notice in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({
    files: ["Components/NewVersion/NewVersionNotice.tsx"],
  });

  test("it uses no dark: variant and builds no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found the card's colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The card.
        "bg-white",
        "border-gray-200",
        // Its title, its words and the close button.
        "text-gray-900",
        "text-gray-500",
        "text-gray-400",
        "hover:text-gray-500",
        // The circle behind the icon.
        "bg-indigo-50",
        "text-indigo-600",
        // Reload and Reload anyway.
        "bg-indigo-600",
        "hover:bg-indigo-700",
        // Cancel.
        "border-gray-300",
        "text-gray-700",
        "hover:bg-gray-50",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });
});
