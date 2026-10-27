import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";

/*
 * The rules the table redesign (model-table-ui) set, held on the source of
 * the shared table so a later change cannot quietly undo one of them:
 *
 *   - every colour a table draws with has its dark rule in Theme.css;
 *   - a table's rules are its cells' own borders (border-separate): a row's
 *     divide-y is not drawn at all in the separate model, and a collapsed
 *     border stays behind when a sticky cell moves;
 *   - nothing between the header row and the page hides its overflow (the
 *     header could not stick), and the scroll box is the containing block of
 *     what is positioned in it (a cell's sr-only words widened the page);
 *   - the header never shouts (no capitals, no tracking, no bold);
 *   - a one-line value's cap is written in one place, with its clip;
 *   - the row's own look comes from TableLayout, not from literals copied
 *     into the components.
 */

const UI_DIR: string = path.join(__dirname, "..", "..", "..", "..", "UI");

const TABLE_FILES: Array<string> = [
  "Components/Table/Table.tsx",
  "Components/Table/TableHeader.tsx",
  "Components/Table/TableBody.tsx",
  "Components/Table/TableRow.tsx",
  "Components/Table/TableSkeletonRows.tsx",
  "Components/Table/TableLayout.ts",
  "Components/Table/TableEmptyValue.tsx",
  "Components/Table/CellClassName.ts",
  "Components/Label/Labels.tsx",
  "Components/TableColumnList/TableColumnListComponent.tsx",
  "Components/StatusBubble/StatusBubble.tsx",
];

type ReadFunction = (file: string) => string;

// Code without its comments: prose may say "uppercase" or "divide-y".
const readCode: ReadFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(UI_DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

const readRaw: ReadFunction = (file: string): string => {
  return fs.readFileSync(path.join(UI_DIR, file), "utf8");
};

describe("a table in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: TABLE_FILES });

  test("reads the classes it means to", () => {
    for (const token of [
      "bg-gray-50",
      "bg-white",
      "bg-indigo-50",
      "border-gray-100",
      "border-gray-200",
      "text-gray-400",
      "text-gray-500",
      "text-gray-700",
      "text-gray-900",
      "hover:bg-gray-50",
      "hover:text-gray-900",
    ]) {
      expect([token, scan.colorTokens.includes(token)]).toEqual([token, true]);
    }
  });

  test("every colour class has its dark rule in Theme.css", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("no dark: variant, which the theme does not go by, and no colour built from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("a ticked row's wash is opaque in the dark theme, so the stuck Actions cell that takes it hides the cells passing under it", () => {
    const theme: string = readRaw("Styles/Theme.css");
    const start: number = theme.indexOf(
      'html.dark tr[data-selected="true"].bg-indigo-50 {',
    );

    expect(start).toBeGreaterThan(-1);

    const rule: string = theme.slice(start, theme.indexOf("}", start));

    // Mixed over the card's surface: no alpha left in it.
    expect(rule).toContain("color-mix(");
    expect(rule).toContain("var(--ou-surface-primary)");
    // The row the rule names is the one TableRow marks as ticked.
    expect(readCode("Components/Table/TableRow.tsx")).toContain(
      'data-selected={props.isItemSelected ? "true" : undefined}',
    );
    expect(readCode("Components/Table/TableLayout.ts")).toContain(
      '"bg-indigo-50 transition-colors duration-150"',
    );
  });

  test("the shadow the Actions column casts over passing cells is darkened for a dark row", () => {
    const layout: string = readCode("Components/Table/TableLayout.ts");
    const theme: string = readRaw("Styles/Theme.css");
    // The shadow falling left, as a left-to-right page draws it.
    const shadowToken: string | undefined = (layout.match(
      /(?<![:\w])shadow-\[-[^\]"\s]+\]/,
    ) || [])[0];

    expect(shadowToken).toBeDefined();
    expect(theme).toContain(`html.dark [class~="${shadowToken}"]`);
    /*
     * Right to left the column stands at the left and its shadow falls
     * right, the dark theme's too: the dark rule above would otherwise win
     * over the right-to-left class and turn the shadow back.
     */
    expect(layout).toContain(
      "[&:dir(rtl)]:shadow-[8px_0_12px_-10px_rgba(15,23,42,0.18)]",
    );
    expect(theme).toContain(
      `html.dark [class~="${shadowToken}"]:dir(rtl) {\n  --tw-shadow: 8px 0 12px -10px rgb(0 0 0 / 70%);\n}`,
    );
  });
});

describe("the table's rules are its cells' own", () => {
  test("the table is drawn with separate borders", () => {
    expect(readCode("Components/Table/TableLayout.ts")).toContain(
      '"min-w-full border-separate border-spacing-0"',
    );
    expect(readCode("Components/Table/Table.tsx")).toContain(
      "className={TABLE_CLASS_NAME}",
    );
  });

  test("no <table>, <thead> or <tbody> divides its rows (divide-y is not drawn on rows in the separate model)", () => {
    for (const file of TABLE_FILES) {
      const code: string = readCode(file);
      const sections: Array<string> = Array.from(
        code.matchAll(/<(?:table|thead|tbody)\b[^>]*>/g),
        (match: RegExpMatchArray): string => {
          return match[0];
        },
      );

      for (const section of sections) {
        expect([file, section.includes("divide-")]).toEqual([file, false]);
      }
    }
  });
});

describe("the header can stick, and nothing escapes the scroll box", () => {
  test("the scroll box is relative and hides nothing", () => {
    const table: string = readCode("Components/Table/Table.tsx");
    const layout: string = readCode("Components/Table/TableLayout.ts");

    expect(table).toContain('data-testid="table-scroll"');
    // Relative, reaching the card's edges at every width (TableLayout).
    expect(table).toContain("TABLE_SCROLL_BOX_CLASS_NAME,");
    expect(layout).toContain(
      'TABLE_SCROLL_BOX_CLASS_NAME: string = "relative -mx-5 md:-mx-6"',
    );
    // Its sideways scroll comes only when the rows are wider than the card.
    expect(table).toContain(
      'scrollState.isOverflowing ? "overflow-x-auto" : ""',
    );
    expect(table).not.toContain("overflow-hidden border-t border-gray-200");
  });

  test("no table component hides its overflow (overflow-hidden would pin the header in place)", () => {
    for (const file of [
      "Components/Table/Table.tsx",
      "Components/Table/TableHeader.tsx",
      "Components/Table/TableBody.tsx",
      "Components/Table/TableRow.tsx",
      "Components/Table/TableLayout.ts",
    ]) {
      expect([file, readCode(file).includes("overflow-hidden")]).toEqual([
        file,
        file === "Components/Table/Table.tsx",
      ]);
    }

    /*
     * The one overflow-hidden left in Table.tsx is the footer's, which clips
     * the pagination bar to the card's rounded corner, under the table.
     */
    const table: string = readCode("Components/Table/Table.tsx");
    const uses: number = table.split("overflow-hidden").length - 1;

    expect(uses).toBe(1);
    expect(table).toContain(
      "bg-gray-50 text-right ${TABLE_FOOTER_BLEED_CLASS_NAME} overflow-hidden",
    );
  });

  test("ModelTable's frame for a table without a card clips without scrolling", () => {
    const baseModelTable: string = readCode(
      "Components/ModelTable/BaseModelTable.tsx",
    );

    expect(baseModelTable).toContain(
      '"overflow-clip rounded-xl border border-gray-200 bg-white px-5 pb-6 shadow-sm md:px-6"',
    );
    expect(baseModelTable).not.toContain('"overflow-hidden rounded"');
  });
});

describe("the header never shouts", () => {
  test("no capitals, no tracking and no bold in a table's header", () => {
    for (const file of [
      "Components/Table/TableHeader.tsx",
      "Components/Table/TableLayout.ts",
    ]) {
      const code: string = readCode(file);

      for (const loud of [
        "uppercase",
        "tracking-",
        "font-semibold",
        "font-bold",
      ]) {
        expect([file, loud, code.includes(loud)]).toEqual([file, loud, false]);
      }
    }
  });
});

describe("a value's cap is written once, with its clip", () => {
  test("only TableLayout names the cap's width, and only CellClassName writes it on a cell", () => {
    const writers: Array<string> = TABLE_FILES.filter(
      (file: string): boolean => {
        return readCode(file).includes("max-w-[20rem]");
      },
    );

    expect(writers).toEqual(["Components/Table/TableLayout.ts"]);

    const users: Array<string> = TABLE_FILES.filter((file: string): boolean => {
      return readCode(file).includes("TABLE_CELL_MAX_WIDTH_CLASS_NAME");
    });

    expect(users.sort()).toEqual([
      "Components/Table/CellClassName.ts",
      "Components/Table/TableLayout.ts",
    ]);
  });

  test("CellClassName pushes the cap and the clip together", () => {
    const code: string = readCode("Components/Table/CellClassName.ts");
    const cap: number = code.indexOf(
      "classNames.push(TABLE_CELL_MAX_WIDTH_CLASS_NAME)",
    );
    const clip: number = code.indexOf(
      "classNames.push(TABLE_CELL_TRUNCATE_CLASS_NAMES)",
    );

    expect(cap).toBeGreaterThan(-1);
    expect(clip).toBeGreaterThan(cap);
    // In the same branch: nothing but the closing of the if in between.
    expect(code.slice(cap, clip)).not.toContain("else");
  });
});

describe("the row's look comes from TableLayout", () => {
  test("the old cell literal is gone from every renderer", () => {
    for (const file of TABLE_FILES) {
      const code: string = readCode(file);

      for (const old of [
        "py-4 pl-4",
        "text-sm font-medium text-gray-500 sm:pl-6",
        "divide-y divide-gray-200 bg-white",
        "font-semibold text-gray-900",
      ]) {
        expect([file, old, code.includes(old)]).toEqual([file, old, false]);
      }
    }
  });

  test("the header, the rows and the skeleton read their classes from TableLayout", () => {
    for (const file of [
      "Components/Table/TableHeader.tsx",
      "Components/Table/TableRow.tsx",
      "Components/Table/TableSkeletonRows.tsx",
      "Components/Table/CellClassName.ts",
    ]) {
      expect([file, readCode(file).includes('from "./TableLayout"')]).toEqual([
        file,
        true,
      ]);
    }
  });

  test("an empty value in a table is TableEmptyValue, never a column's words as a line of their own", () => {
    expect(readCode("Components/Label/Labels.tsx")).toContain(
      "<TableEmptyValue screenReaderText={noItemsMessage} />",
    );
    expect(
      readCode("Components/TableColumnList/TableColumnListComponent.tsx"),
    ).toContain("<TableEmptyValue screenReaderText={props.noItemsMessage} />");
    expect(readCode("Components/Table/TableRow.tsx")).toContain(
      "isDashPlaceholder(element) ? <TableEmptyValue /> : element",
    );
  });
});
