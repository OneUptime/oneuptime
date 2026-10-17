import { describe, expect, test } from "@jest/globals";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";

/*
 * A detail card in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant. A class without a rule keeps its light colour - a white
 * rule or a near-black name on a slate card - and nothing else fails. These
 * are the files a detail card is drawn with, and every colour class in them
 * must be one Theme.css re-colours.
 */

const DETAIL_CARD_FILES: Array<string> = [
  "Components/Detail/Detail.tsx",
  "Components/Detail/DetailFieldLabel.tsx",
  "Components/Detail/DetailGridLayout.ts",
  "Components/Detail/DetailSkeleton.tsx",
  "Components/Detail/EmptyValue.tsx",
  "Components/Detail/PlaceholderText.tsx",
  "Components/Detail/DetailRecordLine.tsx",
  "Components/Detail/DetailIdLine.tsx",
  "Components/ModelDetail/CardModelDetail.tsx",
  "Components/ModelDetail/ModelDetail.tsx",
  "Components/Card/CardMoreMenu.tsx",
  "Components/Card/CardSurface.ts",
  "Components/CopyableButton/CopyableButton.tsx",
];

describe("a detail card in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: DETAIL_CARD_FILES });

  test("reads the classes it means to", () => {
    // The rules, the names, the values, the skeleton's bars, the ⋯.
    for (const token of [
      "border-gray-100",
      "border-gray-200",
      "text-gray-500",
      "text-gray-900",
      "text-gray-400",
      "bg-gray-100",
      "border-gray-300",
      "bg-white",
    ]) {
      expect([token, scan.colorTokens.includes(token)]).toEqual([token, true]);
    }
  });

  test("every colour class has its dark rule in Theme.css", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("no dark: variant, which the theme does not go by", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
  });
});
