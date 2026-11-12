import {
  getPublicResourceGridClassNames,
  getPublicResourceGridMatrixVariant,
  getPublicResourceGridMatrixWidthInRem,
  getPublicResourceGridStackVariant,
  PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_COLUMN_WIDTH_IN_REM,
  PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_PARTS,
  PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
  PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
  PUBLIC_RESOURCE_GRID_SIZES,
  PUBLIC_RESOURCE_GRID_TILE_WIDTH_IN_REM,
  PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME,
  PublicResourceGridClassNames,
  PublicResourceGridParts,
} from "../../../../UI/Components/StatusPage/PublicResourceGridLayout";
import {
  getResourceGridClassNames,
  getResourceGridMatrixVariant,
  getResourceGridMatrixWidthInRem,
  getResourceGridPartClassName,
  getResourceGridStackVariant,
  RESOURCE_GRID_CLASS_NAME,
  RESOURCE_GRID_SIZES,
  ResourceGridPart,
} from "../../../../UI/Components/StatusPage/ResourceGridLayout";
import { describe, expect, test } from "@jest/globals";

/*
 * THE PUBLIC STATUS PAGE'S RESOURCE GRID: A MATRIX WHERE IT FITS, A STACK
 * WHERE IT WOULD SCROLL SIDEWAYS (#7238).
 *
 * The grid visitors see (the status page's Overview, getGridForGroup) was a
 * table of 160px for its rows' values and 140px a column in a box that
 * scrolls sideways: a three-column grid was 580px wide in the 332px a
 * phone's card leaves it, and visitors scrolled 248px to see its second and
 * third columns. Now, as the Dashboard's editor of the same grid does
 * (#7087), wherever the grid's box is narrower than its matrix needs the
 * same table is drawn as a stack: each row a section headed by its value,
 * each cell a tile naming its column, with its status at the tile's end -
 * one tile to a line on a phone, as many as fit on a wider box.
 *
 * These read the classes. jsdom applies no Tailwind and measures nothing:
 * the Tailwind the status page runs is read in
 * PublicResourceGridTailwind.test.ts, the real Overview page's markup in
 * Tests/App/StatusPage/StatusPageOverviewResourceGrid.test.tsx, and the
 * layout itself in Chromium at 390, 768 and 1280 pixels, in English,
 * Arabic and Persian (packages/E2E/StatusPageTheme/
 * StatusPageResourceGrid.spec.ts).
 */

const PART_NAMES: Array<keyof PublicResourceGridParts> = [
  "table",
  "head",
  "body",
  "row",
  "rowHeading",
  "cell",
  "cellLabel",
  "cellStatus",
  "cellEmpty",
];

// A class's tokens, split at its spaces.
const tokensOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(" ").filter(Boolean);
};

/*
 * The boxes the status page leaves a grid group's grid, measured in
 * Chromium on the real page (StatusPageTheme fixture): 332px on a 390px
 * phone, 678px at 768, 934px from 1280 (the page's widest column).
 */
const PHONE_BOX_IN_PX: number = 332;
const TABLET_BOX_IN_PX: number = 678;
const LAPTOP_BOX_IN_PX: number = 934;

// Whether a grid of this many columns is a stack in a box this wide.
const isStackIn: (data: {
  columns: number;
  boxInPx: number;
}) => boolean = (data: { columns: number; boxInPx: number }): boolean => {
  return (
    data.boxInPx / 16 <= getPublicResourceGridMatrixWidthInRem(data.columns)
  );
};

const COLOUR_PATTERN: RegExp =
  /^(?:[a-z-]+:)?(?:bg|text|border|ring|divide|outline|from|via|to)-(?:white|black|transparent|[a-z]+-\d{2,3})(?:\/\d+)?$/;

const CONTAINER_VARIANT_PATTERN: RegExp = /^\[@container[^\]]*\]:/;

// A min-w-[Nrem] class's width in rem, or null.
const MIN_WIDTH_PATTERN: RegExp = /^min-w-\[(\d+(?:\.\d+)?)rem\]$/;

const minWidthInRemOf: (className: string) => number | null = (
  className: string,
): number | null => {
  for (const token of tokensOf(className)) {
    const match: RegExpExecArray | null = MIN_WIDTH_PATTERN.exec(token);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
};

describe("the public grid's matrix: 10rem for its rows' values and 8.75rem a column", () => {
  test("what a grid of 1 to 6 columns needs to be a matrix", () => {
    expect(PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM).toBe(10);
    expect(PUBLIC_RESOURCE_GRID_COLUMN_WIDTH_IN_REM).toBe(8.75);
    expect(PUBLIC_RESOURCE_GRID_SIZES).toEqual({
      rowHeadingWidthInRem: 10,
      columnWidthInRem: 8.75,
    });

    expect(getPublicResourceGridMatrixWidthInRem(1)).toBe(18.75);
    expect(getPublicResourceGridMatrixWidthInRem(2)).toBe(27.5);
    // 580px: the width the issue measured.
    expect(getPublicResourceGridMatrixWidthInRem(3)).toBe(36.25);
    expect(getPublicResourceGridMatrixWidthInRem(3) * 16).toBe(580);
    expect(getPublicResourceGridMatrixWidthInRem(4)).toBe(45);
    expect(getPublicResourceGridMatrixWidthInRem(5)).toBe(53.75);
    expect(getPublicResourceGridMatrixWidthInRem(6)).toBe(62.5);
    // A grid always has a column to lay out.
    expect(getPublicResourceGridMatrixWidthInRem(0)).toBe(18.75);
  });

  test("the widths the query counts are the widths the table's headings are drawn at", () => {
    expect(minWidthInRemOf(PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME)).toBe(
      PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
    );
    expect(minWidthInRemOf(PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME)).toBe(
      PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
    );
    expect(minWidthInRemOf(PUBLIC_RESOURCE_GRID_PARTS.rowHeading.base)).toBe(
      PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
    );
    expect(
      minWidthInRemOf(PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME),
    ).toBe(PUBLIC_RESOURCE_GRID_COLUMN_WIDTH_IN_REM);
  });

  test("the query names this grid's own width: the stack at or below it, the matrix (the same query, negated) above it", () => {
    expect(getPublicResourceGridStackVariant(3)).toBe(
      "[@container(max-width:36.25rem)]:",
    );
    // Tailwind reads "_" as a space.
    expect(getPublicResourceGridMatrixVariant(3)).toBe(
      "[@container_not_(max-width:36.25rem)]:",
    );
    expect(getPublicResourceGridStackVariant(1)).toBe(
      "[@container(max-width:18.75rem)]:",
    );
    expect(getPublicResourceGridMatrixVariant(4)).toBe(
      "[@container_not_(max-width:45rem)]:",
    );
  });

  test("at the widths visitors use: a grid stacks where its matrix would scroll, and keeps its matrix where it fits", () => {
    // A phone: a one-column grid fits; two columns or more are a stack.
    expect(isStackIn({ columns: 1, boxInPx: PHONE_BOX_IN_PX })).toBe(false);
    expect(isStackIn({ columns: 2, boxInPx: PHONE_BOX_IN_PX })).toBe(true);
    expect(isStackIn({ columns: 3, boxInPx: PHONE_BOX_IN_PX })).toBe(true);

    // A tablet: three columns fit, four are a stack.
    expect(isStackIn({ columns: 3, boxInPx: TABLET_BOX_IN_PX })).toBe(false);
    expect(isStackIn({ columns: 4, boxInPx: TABLET_BOX_IN_PX })).toBe(true);

    // A laptop: five columns fit, six are a stack.
    expect(isStackIn({ columns: 5, boxInPx: LAPTOP_BOX_IN_PX })).toBe(false);
    expect(isStackIn({ columns: 6, boxInPx: LAPTOP_BOX_IN_PX })).toBe(true);

    // At its matrix's own width, a grid is a stack: no pixel scrolls.
    expect(isStackIn({ columns: 3, boxInPx: 580 })).toBe(true);
    expect(isStackIn({ columns: 3, boxInPx: 581 })).toBe(false);
  });

  test("the editor's grid keeps its own widths: 6rem and 13rem a column (#7087)", () => {
    expect(RESOURCE_GRID_SIZES).toEqual({
      rowHeadingWidthInRem: 6,
      columnWidthInRem: 13,
    });
    expect(getResourceGridMatrixWidthInRem(3)).toBe(45);
    expect(getResourceGridMatrixWidthInRem(3, RESOURCE_GRID_SIZES)).toBe(45);
    expect(getResourceGridStackVariant(3)).toBe(
      "[@container(max-width:45rem)]:",
    );
    expect(getResourceGridMatrixVariant(3)).toBe(
      "[@container_not_(max-width:45rem)]:",
    );
    // The same function, given the public grid's widths.
    expect(getResourceGridMatrixWidthInRem(3, PUBLIC_RESOURCE_GRID_SIZES)).toBe(
      36.25,
    );
    expect(getResourceGridClassNames(3).table).toContain(
      "[@container(max-width:45rem)]:block",
    );
  });
});

describe("the public grid's parts in the stack and in the matrix", () => {
  test("the grid's box is what the query measures, as the editor's is", () => {
    expect(getPublicResourceGridClassNames(3).grid).toBe(
      RESOURCE_GRID_CLASS_NAME,
    );
    expect(RESOURCE_GRID_CLASS_NAME).toBe("[container-type:inline-size]");
  });

  test.each([1, 2, 3, 4, 5, 6])(
    "a %s-column grid: each part is its own classes, then the stack's under its query, then the matrix's under its",
    (columnCount: number) => {
      const layout: PublicResourceGridClassNames =
        getPublicResourceGridClassNames(columnCount);
      const stack: string = getPublicResourceGridStackVariant(columnCount);
      const matrix: string = getPublicResourceGridMatrixVariant(columnCount);
      const drawn: Record<keyof PublicResourceGridParts, string> = {
        table: layout.table,
        head: layout.head,
        body: layout.body,
        row: layout.row,
        rowHeading: layout.getRowHeading({ isLastRow: true }),
        cell: layout.getCell({
          isLastRow: true,
          isLastColumn: true,
          isEmpty: false,
        }),
        cellLabel: layout.cellLabel,
        cellStatus: layout.cellStatus,
        cellEmpty: layout.cellEmpty,
      };

      for (const name of PART_NAMES) {
        const part: ResourceGridPart = PUBLIC_RESOURCE_GRID_PARTS[name];
        const expected: string = [
          part.base,
          ...part.stack.map((token: string): string => {
            return `${stack}${token}`;
          }),
          ...part.matrix.map((token: string): string => {
            return `${matrix}${token}`;
          }),
        ]
          .filter(Boolean)
          .join(" ");

        expect(`${name}: ${drawn[name]}`).toBe(`${name}: ${expected}`);
        expect(
          getResourceGridPartClassName({
            part: part,
            stackVariant: stack,
            matrixVariant: matrix,
          }),
        ).toBe(expected);
      }

      // Its own query, which is this grid's width.
      const width: number = getPublicResourceGridMatrixWidthInRem(columnCount);

      expect(tokensOf(layout.table)).toContain(
        `[@container(max-width:${width}rem)]:block`,
      );
      expect(tokensOf(layout.head)).toContain(
        `[@container(max-width:${width}rem)]:hidden`,
      );
      expect(tokensOf(layout.cellLabel)).toContain(
        `[@container_not_(max-width:${width}rem)]:hidden`,
      );
    },
  );

  test("in the stack: no column headings, each row a section ruled off from the next, its value a heading over a grid of its cells' tiles", () => {
    expect(PUBLIC_RESOURCE_GRID_PARTS.table.stack).toEqual(["block"]);
    // Each cell names its column instead.
    expect(PUBLIC_RESOURCE_GRID_PARTS.head.stack).toEqual(["hidden"]);
    expect(PUBLIC_RESOURCE_GRID_PARTS.body.stack).toEqual(["block"]);
    expect(PUBLIC_RESOURCE_GRID_PARTS.row.stack).toEqual([
      "grid",
      PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME,
      "-ms-px",
      "border-b",
      "last:border-b-0",
    ]);
    // Held at the start of a matrix that scrolls; a heading across the tiles in the stack.
    expect(PUBLIC_RESOURCE_GRID_PARTS.rowHeading.stack).toEqual([
      "static",
      "col-span-full",
      "border-b-0",
      "border-s",
      "border-e-0",
      "py-2.5",
    ]);
  });

  test("in the stack: each cell a tile of its row - its column's name at the start, its status at the end", () => {
    expect(PUBLIC_RESOURCE_GRID_PARTS.cell.stack).toEqual([
      "flex",
      "items-center",
      "justify-between",
      "gap-3",
      "min-h-[2.75rem]",
      "border-t",
      "border-b-0",
      "border-s",
      "border-e-0",
      "px-4",
      "text-start",
    ]);
    // Drawn by default, so nothing to add in the stack.
    expect(PUBLIC_RESOURCE_GRID_PARTS.cellLabel.stack).toEqual([]);
    // A long name wraps rather than pushing the status out of the line.
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cellLabel.base)).toEqual(
      expect.arrayContaining(["min-w-0", "break-words"]),
    );
    // The status and its uptime keep their width, at the line's end.
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cellStatus.base)).toContain(
      "flex-shrink-0",
    );
    expect(PUBLIC_RESOURCE_GRID_PARTS.cellStatus.stack).toEqual([
      "items-end",
      "px-0",
      "py-2.5",
    ]);
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cellEmpty.base)).toContain(
      "flex-shrink-0",
    );
    expect(PUBLIC_RESOURCE_GRID_PARTS.cellEmpty.stack).toEqual(["py-0"]);
  });

  test("where it fits, the matrix keeps the look it had: only the cell's column name is told apart", () => {
    expect(PUBLIC_RESOURCE_GRID_PARTS.table.base).toBe(
      "min-w-full border-separate border-spacing-0",
    );
    expect(PUBLIC_RESOURCE_GRID_PARTS.head.base).toBe("");
    expect(PUBLIC_RESOURCE_GRID_PARTS.body.base).toBe("");
    // The status, centred under its column's heading, as it was.
    expect(PUBLIC_RESOURCE_GRID_PARTS.cellStatus.base).toContain(
      "flex-col items-center justify-center gap-1 px-2 py-3",
    );
    expect(PUBLIC_RESOURCE_GRID_PARTS.cellEmpty.base).toContain(
      "items-center justify-center py-3.5",
    );
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cell.base)).toEqual(
      expect.arrayContaining(["text-center", "align-middle"]),
    );

    for (const name of PART_NAMES) {
      expect(
        `${name}: ${PUBLIC_RESOURCE_GRID_PARTS[name].matrix.join(" ")}`,
      ).toBe(`${name}: ${name === "cellLabel" ? "hidden" : ""}`);
    }
  });

  /*
   * ...where it is hidden under the negated query, never written with a
   * bare `hidden` that the stack's query shows again: a foreign
   * .hidden{display:none !important} (Bootstrap 3, a browser extension)
   * would keep such a label hidden in the stack too (ForeignHiddenRuleGuard).
   */
  test("nothing is hidden by a bare `hidden` that a query shows again", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(3);

    for (const [name, className] of Object.entries({
      table: layout.table,
      head: layout.head,
      body: layout.body,
      row: layout.row,
      rowHeading: layout.getRowHeading({ isLastRow: false }),
      cell: layout.getCell({
        isLastRow: false,
        isLastColumn: false,
        isEmpty: true,
      }),
      cellLabel: layout.cellLabel,
      cellStatus: layout.cellStatus,
      cellEmpty: layout.cellEmpty,
    })) {
      expect(`${name}: ${tokensOf(className).includes("hidden")}`).toBe(
        `${name}: false`,
      );
    }
  });

  test("one query, and no colour under it: dark mode remaps a colour's own class, never one a variant names", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(3);
    const stack: string = getPublicResourceGridStackVariant(3);
    const matrix: string = getPublicResourceGridMatrixVariant(3);
    const drawn: Array<string> = [
      layout.table,
      layout.head,
      layout.body,
      layout.row,
      layout.getRowHeading({ isLastRow: false }),
      layout.getRowHeading({ isLastRow: true }),
      layout.getCell({ isLastRow: false, isLastColumn: false, isEmpty: true }),
      layout.getCell({ isLastRow: true, isLastColumn: true, isEmpty: false }),
      layout.cellLabel,
      layout.cellStatus,
      layout.cellEmpty,
    ];

    for (const className of drawn) {
      for (const token of tokensOf(className)) {
        if (!token.includes("@container")) {
          continue;
        }

        expect(
          `${token}: ${token.startsWith(stack) || token.startsWith(matrix)}`,
        ).toBe(`${token}: true`);
        expect(CONTAINER_VARIANT_PATTERN.test(token)).toBe(true);
        expect(
          `${token}: ${COLOUR_PATTERN.test(token.slice(token.indexOf("]:") + 2))}`,
        ).toBe(`${token}: false`);
      }
    }

    for (const name of PART_NAMES) {
      for (const added of [
        ...PUBLIC_RESOURCE_GRID_PARTS[name].stack,
        ...PUBLIC_RESOURCE_GRID_PARTS[name].matrix,
      ]) {
        expect(`${name}: ${added} ${COLOUR_PATTERN.test(added)}`).toBe(
          `${name}: ${added} false`,
        );
      }
    }

    // The pattern does tell a colour apart.
    expect(COLOUR_PATTERN.test("bg-gray-50")).toBe(true);
    expect(COLOUR_PATTERN.test("border-gray-200")).toBe(true);
    expect(COLOUR_PATTERN.test("from-gray-50")).toBe(true);
    expect(COLOUR_PATTERN.test("text-gray-700")).toBe(true);
    expect(COLOUR_PATTERN.test("border-e-0")).toBe(false);
    expect(COLOUR_PATTERN.test("text-start")).toBe(false);
  });

  /*
   * A colour each part keeps in both layouts is its own class, outside the
   * query, which dark mode remaps: a row's and a heading's rule, a cell's.
   */
  test("the colours each part draws are classes of their own, outside the query", () => {
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.row.base)).toContain(
      "border-gray-200",
    );
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.rowHeading.base)).toEqual(
      expect.arrayContaining([
        "border-gray-200",
        "bg-white",
        "text-gray-900",
        "group-hover:bg-gray-50/80",
      ]),
    );
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cell.base)).toContain(
      "border-gray-100",
    );
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.cellLabel.base)).toContain(
      "text-gray-700",
    );
  });
});

/*
 * A wide box's stack (#7238, UI review): six regions need 1,000px of
 * matrix, more than the 934px the page's widest column leaves, so a
 * laptop draws a six-column grid as a stack too - and a stack of one line
 * per cell put each status some 700px from its column's name, eighteen
 * lines for three rows. The cells are tiles instead, as many to a line as
 * the box has room for.
 */
describe("the stack's tiles: as many to a line as the box has room for", () => {
  // How many tiles of 16rem share a line of a box this wide (its row starts a pixel before it).
  const tilesPerLineIn: (boxInPx: number) => number = (
    boxInPx: number,
  ): number => {
    return Math.max(
      1,
      Math.floor((boxInPx + 1) / (PUBLIC_RESOURCE_GRID_TILE_WIDTH_IN_REM * 16)),
    );
  };

  test("a tile is at least 16rem, and never wider than the box: a box narrower than one has one to a line", () => {
    expect(PUBLIC_RESOURCE_GRID_TILE_WIDTH_IN_REM).toBe(16);
    expect(PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME).toBe(
      "grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]",
    );
    // No space in the class: Tailwind would read it as two.
    expect(PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME).not.toContain(" ");
  });

  test("one tile to a line on a phone, two on a tablet, three on a laptop", () => {
    expect(tilesPerLineIn(PHONE_BOX_IN_PX)).toBe(1);
    expect(tilesPerLineIn(TABLET_BOX_IN_PX)).toBe(2);
    expect(tilesPerLineIn(LAPTOP_BOX_IN_PX)).toBe(3);
    // A six-column grid is a stack on a laptop: two lines of three.
    expect(isStackIn({ columns: 6, boxInPx: LAPTOP_BOX_IN_PX })).toBe(true);
    expect(6 / tilesPerLineIn(LAPTOP_BOX_IN_PX)).toBe(2);
    // A four-column grid on a tablet: two lines of two.
    expect(isStackIn({ columns: 4, boxInPx: TABLET_BOX_IN_PX })).toBe(true);
    expect(4 / tilesPerLineIn(TABLET_BOX_IN_PX)).toBe(2);
  });

  test("a stacked row lays its cells out as tiles, its value across all of them", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(6);
    const stack: string = getPublicResourceGridStackVariant(6);

    expect(tokensOf(layout.row)).toEqual(
      expect.arrayContaining([
        `${stack}grid`,
        `${stack}${PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME}`,
      ]),
    );
    expect(tokensOf(layout.getRowHeading({ isLastRow: false }))).toContain(
      `${stack}col-span-full`,
    );
    // A tile is a line of its own: its name at the start, its status at the end.
    expect(
      tokensOf(
        layout.getCell({
          isLastRow: false,
          isLastColumn: false,
          isEmpty: false,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([`${stack}flex`, `${stack}justify-between`]),
    );
  });

  /*
   * A tile is ruled off at its start, from the tile before it. The first
   * tile of each line has nothing before it - and which tile that is
   * depends on the box's width - so the row starts a pixel before the box
   * (-ms-px), where the scroller clips the first tile's rule: on the start
   * side, which a box never scrolls to. The row's value has the same rule,
   * so it starts where the tiles' names do.
   */
  test("each tile is ruled off from the one before it, and the first of a line from nothing: its rule is a pixel before the box", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(6);
    const stack: string = getPublicResourceGridStackVariant(6);
    const heading: Array<string> = tokensOf(
      layout.getRowHeading({ isLastRow: false }),
    );

    expect(tokensOf(layout.row)).toContain(`${stack}-ms-px`);
    expect(heading).toEqual(
      expect.arrayContaining([`${stack}border-s`, `${stack}border-e-0`]),
    );

    for (const isLastRow of [false, true]) {
      for (const isLastColumn of [false, true]) {
        const cell: Array<string> = tokensOf(
          layout.getCell({
            isLastRow: isLastRow,
            isLastColumn: isLastColumn,
            isEmpty: false,
          }),
        );

        // Ruled off at its start, never at its end (the card's own edge).
        expect(cell).toEqual(
          expect.arrayContaining([`${stack}border-s`, `${stack}border-e-0`]),
        );
        /*
         * Ruled off above - from the heading, or the line before - and
         * never below, where the next row's own rule is: the matrix's rule
         * under a cell would draw twice under the last line of tiles.
         */
        expect(cell).toEqual(
          expect.arrayContaining([`${stack}border-t`, `${stack}border-b-0`]),
        );
      }
    }

    // So the heading does not rule itself off: the first line's tiles do.
    expect(heading).toContain(`${stack}border-b-0`);
  });
});

describe("the rows' values, held at the start of the line in every reading direction", () => {
  /*
   * In a right-to-left page (Arabic, Persian: dir="rtl") a table's first
   * column is at the right, and scrolling moves it further right: a
   * physical left-0 would not hold it, and a border-r would rule its outer
   * side, not the side its cells are on. start-0, border-e and text-start
   * mean the start and the end of the line, whichever side that is, with or
   * without the status page's reading-direction config
   * (Common/UI/Styles/TailwindReadingDirection.js).
   */
  const PHYSICAL_SIDE_PATTERN: RegExp =
    /^(?:[a-z-]+:)*-?(?:left-|right-|border-l\b|border-r\b|border-l-|border-r-|text-left$|text-right$|pl-|pr-|ml-|mr-|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)/;

  const LOGICAL_HEADINGS: Record<string, string> = {
    rowHeading: PUBLIC_RESOURCE_GRID_PARTS.rowHeading.base,
    rowAxis: PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
    corner: PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
  };

  test.each(Object.keys(LOGICAL_HEADINGS))(
    "%s: held at the line's start, ruled off at its end",
    (name: string) => {
      const tokens: Array<string> = tokensOf(LOGICAL_HEADINGS[name]!);

      expect(tokens).toEqual(
        expect.arrayContaining(["sticky", "start-0", "z-10", "border-e"]),
      );
      /*
       * Over the cells it is held above as they scroll under it, on a
       * ground nothing shows through (white, the card's: a gradient that
       * fades to gray-50/80 showed the column heading under it).
       */
      expect(tokens).toContain("bg-white");
    },
  );

  test("the row's value and the row axis's name start where the line does", () => {
    expect(tokensOf(PUBLIC_RESOURCE_GRID_PARTS.rowHeading.base)).toContain(
      "text-start",
    );
    expect(tokensOf(PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME)).toContain(
      "text-start",
    );
  });

  test("no part of the grid names a physical side", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(3);
    const drawn: Record<string, string> = {
      corner: PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME,
      columnAxis: PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME,
      rowAxis: PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME,
      columnHeading: layout.getColumnHeading({ isLastColumn: false }),
      lastColumnHeading: layout.getColumnHeading({ isLastColumn: true }),
      table: layout.table,
      head: layout.head,
      body: layout.body,
      row: layout.row,
      rowHeading: layout.getRowHeading({ isLastRow: false }),
      cell: layout.getCell({
        isLastRow: false,
        isLastColumn: false,
        isEmpty: true,
      }),
      cellLabel: layout.cellLabel,
      cellStatus: layout.cellStatus,
      cellEmpty: layout.cellEmpty,
    };

    for (const [name, className] of Object.entries(drawn)) {
      for (const token of tokensOf(className)) {
        const bare: string = token.replace(CONTAINER_VARIANT_PATTERN, "");

        expect(`${name}: ${bare} ${PHYSICAL_SIDE_PATTERN.test(bare)}`).toBe(
          `${name}: ${bare} false`,
        );
      }
    }

    // The pattern does tell a physical side apart.
    for (const physical of [
      "left-0",
      "border-r",
      "border-r-0",
      "text-left",
      "pl-4",
      "group-hover:mr-2",
      "-ml-px",
    ]) {
      expect(`${physical} ${PHYSICAL_SIDE_PATTERN.test(physical)}`).toBe(
        `${physical} true`,
      );
    }

    for (const logical of [
      "start-0",
      "border-e",
      "border-e-0",
      "text-start",
      "-ms-px",
      "border-s",
    ]) {
      expect(`${logical} ${PHYSICAL_SIDE_PATTERN.test(logical)}`).toBe(
        `${logical} false`,
      );
    }
  });

  test("the stack lets go of the start and of the rule at the end", () => {
    const layout: PublicResourceGridClassNames =
      getPublicResourceGridClassNames(3);
    const stack: string = getPublicResourceGridStackVariant(3);
    const heading: Array<string> = tokensOf(
      layout.getRowHeading({ isLastRow: false }),
    );
    const cell: Array<string> = tokensOf(
      layout.getCell({ isLastRow: false, isLastColumn: false, isEmpty: false }),
    );

    expect(heading).toEqual(
      expect.arrayContaining([
        `${stack}static`,
        `${stack}col-span-full`,
        `${stack}border-e-0`,
      ]),
    );
    expect(cell).toEqual(
      expect.arrayContaining([`${stack}border-e-0`, `${stack}text-start`]),
    );
  });
});

describe("where each heading and cell is in the matrix", () => {
  const layout: PublicResourceGridClassNames =
    getPublicResourceGridClassNames(3);

  test("a row's value is ruled off from the next row's in the matrix; in the stack, by its first line of tiles", () => {
    const notLast: Array<string> = tokensOf(
      layout.getRowHeading({ isLastRow: false }),
    );
    const last: Array<string> = tokensOf(
      layout.getRowHeading({ isLastRow: true }),
    );

    expect(notLast).toContain("border-b");
    expect(last).not.toContain("border-b");
    // In the stack, its tiles rule it off from them (border-t), so it draws none of its own.
    expect(notLast).toContain(
      `${getPublicResourceGridStackVariant(3)}border-b-0`,
    );
    expect(last).toContain(`${getPublicResourceGridStackVariant(3)}border-b-0`);
  });

  test("a cell is ruled off below unless in the last row, and after unless in the last column", () => {
    const tokens: (data: {
      isLastRow: boolean;
      isLastColumn: boolean;
      isEmpty: boolean;
    }) => Array<string> = (data: {
      isLastRow: boolean;
      isLastColumn: boolean;
      isEmpty: boolean;
    }): Array<string> => {
      return tokensOf(layout.getCell(data));
    };

    expect(
      tokens({ isLastRow: false, isLastColumn: false, isEmpty: false }),
    ).toEqual(expect.arrayContaining(["border-b", "border-e"]));
    expect(
      tokens({ isLastRow: true, isLastColumn: false, isEmpty: false }),
    ).not.toContain("border-b");
    expect(
      tokens({ isLastRow: false, isLastColumn: true, isEmpty: false }),
    ).not.toContain("border-e");
    // An empty cell lights up with its row; a cell with a status keeps its tint.
    expect(
      tokens({ isLastRow: false, isLastColumn: false, isEmpty: true }),
    ).toContain("group-hover:bg-gray-50/40");
    expect(
      tokens({ isLastRow: false, isLastColumn: false, isEmpty: false }),
    ).not.toContain("group-hover:bg-gray-50/40");
  });

  test("a column's heading is ruled off from the next column's, the last one is not", () => {
    expect(tokensOf(layout.getColumnHeading({ isLastColumn: false }))).toEqual(
      expect.arrayContaining(["border-b", "border-e"]),
    );
    expect(
      tokensOf(layout.getColumnHeading({ isLastColumn: true })),
    ).not.toContain("border-e");
    expect(layout.getColumnHeading({ isLastColumn: true })).toBe(
      PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME,
    );
  });
});
