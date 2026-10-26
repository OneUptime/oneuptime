/*
 * The showcase an empty resource list shows under its table
 * (Components/ResourceShowcase), in the dark theme.
 *
 * It is drawn with the app's Tailwind classes, and Theme.css re-colours them
 * under html.dark one rule per class and per variant: a class without a rule
 * keeps its light colour - a white example on a slate page - and nothing
 * fails (Tests/Helpers/DarkModeScan). So every colour class it uses is held
 * to what Theme.css remaps: the card and its glow, the eyebrow, the words,
 * the example's frame, tiles, chart, rows and status pills, the alert in
 * each of its colours, and the feature grid.
 *
 * Its two backgrounds that are not classes - the glow behind the pitch and
 * the dots behind the example - are drawn with the theme's own variables,
 * so they follow the theme without a rule.
 */

import { DarkModeScan, scanDarkMode } from "../../Helpers/DarkModeScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

// Read as Common/UI's own files are: from Common/UI.
const CARD: string =
  "../../App/FeatureSet/Dashboard/src/Components/ResourceShowcase/ResourceShowcaseCard.tsx";

describe("the resource showcase in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: [CARD] });

  test("it uses no dark: variant and builds no colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class it uses is remapped for dark mode", () => {
    // The scan found its colours at all, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The card, the example's frame and the feature grid.
        "bg-white",
        "border-gray-200",
        "border-gray-100",
        "bg-gray-50",
        "bg-gray-50/50",
        "ring-black/5",
        // The words.
        "text-gray-900",
        "text-gray-600",
        "text-gray-500",
        "text-gray-400",
        // The eyebrow and the icons.
        "bg-indigo-50",
        "border-indigo-100",
        "text-indigo-700",
        "text-indigo-600",
        // The status pills and the alert.
        "bg-emerald-50",
        "text-emerald-700",
        "ring-emerald-200",
        "bg-amber-50",
        "text-amber-800",
        "bg-red-50",
        "text-red-700",
        "border-red-200",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });

  test("the glow and the dots are drawn with the theme's variables", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", CARD),
      "utf8",
    );

    expect(source).toContain("var(--ou-accent-soft, #eef2ff)");
    expect(source).toContain("var(--ou-border-default, #e5e7eb)");
  });
});
