import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DarkModeScan, scanDarkMode } from "../../../../Helpers/DarkModeScan";

/*
 * A column's edge in the dark theme.
 *
 * The dark theme does not use Tailwind's dark: variants: Theme.css
 * re-colours the light utility classes under html.dark, one rule per class
 * and per variant. The edge's faint line shows while the pointer is over the
 * header row ("[thead:hover_&]:bg-gray-300") and always on a touch screen
 * ("[@media(pointer:coarse)]:bg-gray-300") - variants of the light grey that
 * would keep it near-white on a slate header. These are the files the edge,
 * its line, its guide and a table's reset are drawn with, and every colour
 * class in them must be one Theme.css re-colours.
 */

const COLUMN_RESIZE_FILES: Array<string> = [
  "Components/Table/ColumnResize/ColumnResizeLayout.ts",
  "Components/Table/ColumnResize/ColumnResizeHandle.tsx",
  "Components/Table/ColumnResize/ResizableHeaderCell.tsx",
  "Components/Table/ColumnResize/ResetColumnWidthsButton.tsx",
  "Components/Table/ColumnResize/SizedColumnsStyle.tsx",
  "Components/Table/ColumnResize/useResizableColumns.tsx",
  "Components/Table/TableLayout.ts",
  "Components/Card/CardMenuExtras.ts",
];

const THEME_CSS: string = fs.readFileSync(
  path.join(__dirname, "../../../../../UI/Styles/Theme.css"),
  "utf8",
);

describe("a column's edge in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: COLUMN_RESIZE_FILES });

  test("reads the classes it means to", () => {
    // The faint line, the line under the pointer and the drag's guide.
    for (const token of [
      "[thead:hover_&]:bg-gray-300",
      "[@media(pointer:coarse)]:bg-gray-300",
      "bg-indigo-500",
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

  test("the faint line takes the dark theme's border colour, under the pointer and on a touch screen", () => {
    expect(THEME_CSS).toContain(
      'html.dark thead:hover [class~="[thead:hover_&]:bg-gray-300"]',
    );
    expect(THEME_CSS).toContain(
      'html.dark [class~="[@media(pointer:coarse)]:bg-gray-300"]',
    );
  });
});
