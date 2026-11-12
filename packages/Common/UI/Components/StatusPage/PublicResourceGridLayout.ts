import {
  getResourceGridMatrixVariant,
  getResourceGridMatrixWidthInRem,
  getResourceGridPartClassName,
  getResourceGridStackVariant,
  RESOURCE_GRID_CLASS_NAME,
  ResourceGridPart,
  ResourceGridSizes,
} from "./ResourceGridLayout";

/*
 * THE PUBLIC STATUS PAGE'S RESOURCE GRID: A MATRIX WHERE IT FITS, A STACK
 * WHERE IT WOULD SCROLL SIDEWAYS (#7238).
 *
 * A status page group in grid view is drawn for visitors as a matrix: one
 * row per row axis value (Service: API, Dashboard), one column per column
 * axis value (Region: US, EU, Asia Pacific), and in each cell the status of
 * the resources with both values. The matrix needs 10rem for its rows'
 * values and 8.75rem a column, so a three-column grid was at least 580px
 * wide in the 332px a phone's card leaves it, and visitors scrolled 248px
 * sideways to see the second and third columns.
 *
 * Wherever the grid's box is narrower than its matrix needs (a container
 * query on the grid's own box, as the Dashboard's editor of the same grid
 * does: ResourceGridLayout), the same table is drawn as a stack: each row
 * a section headed by its value, and each of its cells a tile under it -
 * the column's name at the tile's start, the cell's status and uptime at
 * its end. As many tiles share a line as the box has room for, 16rem each:
 * one to a line on a phone, two beside each other on a tablet, three on a
 * laptop, whose box (934px, the page's widest) no matrix of six columns or
 * more fits in - so a wide grid is never a long list of lines with their
 * statuses 700px from their names. Nothing scrolls sideways. A grid that
 * fits keeps its matrix, drawn as it always was: a one-column grid is a
 * matrix on a phone, a three-column grid a matrix from a tablet, a
 * five-column one on a laptop.
 *
 * Where the matrix is kept but its words are wider than its least width (a
 * long status name, a long value), it still scrolls inside its card, with
 * the rows' values held at the start of the line: the start is the left on
 * an English page and the right on an Arabic or Persian one, so the row's
 * heading is placed, divided and aligned with logical classes (start-0,
 * border-e, text-start), which mean the same side in both.
 *
 * The cells' status colours are the cells' own (inline tints, and the
 * colour classes below, outside every query): no colour class is ever
 * under a container query, since dark mode remaps a colour's own class
 * (Theme.css), never one a variant names.
 */

// A column of the matrix: its heading is min-w-[8.75rem] (140px).
export const PUBLIC_RESOURCE_GRID_COLUMN_WIDTH_IN_REM: number = 8.75;

// The rows' values at the start of each row: min-w-[10rem] (160px).
export const PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM: number = 10;

/*
 * A tile of the stack, at least: its column's name (a word or two) beside a
 * status and its uptime ("100.00% Verfügbarkeit" is some 8rem), with room
 * between them. A box narrower than one tile (a sub group's grid on a
 * small phone) has one tile to a line, as wide as the box.
 */
export const PUBLIC_RESOURCE_GRID_TILE_WIDTH_IN_REM: number = 16;

// The stack's lines of tiles: as many as fit, each as wide as the others.
export const PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME: string = `grid-cols-[repeat(auto-fill,minmax(min(100%,${PUBLIC_RESOURCE_GRID_TILE_WIDTH_IN_REM}rem),1fr))]`;

export const PUBLIC_RESOURCE_GRID_SIZES: ResourceGridSizes = {
  rowHeadingWidthInRem: PUBLIC_RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
  columnWidthInRem: PUBLIC_RESOURCE_GRID_COLUMN_WIDTH_IN_REM,
};

// What a public grid of this many columns needs to be drawn as a matrix.
export const getPublicResourceGridMatrixWidthInRem: (
  columnCount: number,
) => number = (columnCount: number): number => {
  return getResourceGridMatrixWidthInRem(
    columnCount,
    PUBLIC_RESOURCE_GRID_SIZES,
  );
};

// The stack's variant: the grid's box is no wider than its matrix needs.
export const getPublicResourceGridStackVariant: (
  columnCount: number,
) => string = (columnCount: number): string => {
  return getResourceGridStackVariant(columnCount, PUBLIC_RESOURCE_GRID_SIZES);
};

// The matrix's variant: the same query, negated.
export const getPublicResourceGridMatrixVariant: (
  columnCount: number,
) => string = (columnCount: number): string => {
  return getResourceGridMatrixVariant(columnCount, PUBLIC_RESOURCE_GRID_SIZES);
};

/*
 * The parts of the table that are drawn in both layouts: their classes in
 * the matrix (base), what the stack adds, and what only the matrix adds.
 */
export interface PublicResourceGridParts {
  table: ResourceGridPart;
  head: ResourceGridPart;
  body: ResourceGridPart;
  row: ResourceGridPart;
  rowHeading: ResourceGridPart;
  cell: ResourceGridPart;
  cellLabel: ResourceGridPart;
  cellStatus: ResourceGridPart;
  cellEmpty: ResourceGridPart;
}

export const PUBLIC_RESOURCE_GRID_PARTS: PublicResourceGridParts = {
  table: {
    base: "min-w-full border-separate border-spacing-0",
    stack: ["block"],
    matrix: [],
  },
  // Each cell names its column in the stack instead.
  head: { base: "", stack: ["hidden"], matrix: [] },
  body: { base: "", stack: ["block"], matrix: [] },
  /*
   * A row of the stack: a section of the card, ruled off from the next, its
   * heading over a grid of its cells' tiles. Its border's colour is a class
   * of its own, outside the query (dark mode); a row of a table whose
   * borders are separate draws no border, so it draws nothing in the
   * matrix.
   *
   * Each tile is ruled off at its start, from the tile before it on its
   * line. The first tile of a line has none before it, so the row starts
   * one pixel before the box (-ms-px), where the box's scroller clips that
   * rule: on the start side, which a box never scrolls to, so nothing
   * scrolls. What is left is a rule between tiles, never one doubling the
   * card's own edge - on any line, however many tiles it has room for.
   */
  row: {
    base: "group border-gray-200 transition-colors",
    stack: [
      "grid",
      PUBLIC_RESOURCE_GRID_TILES_CLASS_NAME,
      "-ms-px",
      "border-b",
      "last:border-b-0",
    ],
    matrix: [],
  },
  /*
   * The row's value: held at the start of a matrix that scrolls sideways,
   * and ruled off from its cells there; in the stack, the heading of its
   * section, across every column of tiles, its start rule clipped with
   * theirs, so it starts where their names do.
   */
  rowHeading: {
    base: "sticky start-0 z-10 min-w-[10rem] break-words border-e border-gray-200 bg-white px-4 py-3 text-start text-sm font-semibold text-gray-900 transition-colors group-hover:bg-gray-50/80",
    stack: [
      "static",
      "col-span-full",
      "border-b-0",
      "border-s",
      "border-e-0",
      "py-2.5",
    ],
    matrix: [],
  },
  /*
   * A cell: in the stack, a tile of its row's section, its column's name at
   * the start and its status at the end, ruled off above (from the heading,
   * or from the line of tiles before) and at its start (from the tile
   * before it).
   */
  cell: {
    base: "border-gray-100 text-center align-middle transition-colors",
    stack: [
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
    ],
    matrix: [],
  },
  /*
   * The cell's column, at the start of its tile in the stack; not drawn
   * (nor read) in the matrix, whose column heading names it. Drawn by
   * default and hidden under the matrix's query, never with a bare `hidden`
   * the stack's query shows again (ForeignHiddenRuleGuard).
   */
  cellLabel: {
    base: "min-w-0 break-words text-sm font-medium text-gray-700",
    stack: [],
    matrix: ["hidden"],
  },
  // The cell's status and uptime: centred in the matrix, at the tile's end in the stack.
  cellStatus: {
    base: "flex flex-shrink-0 flex-col items-center justify-center gap-1 px-2 py-3",
    stack: ["items-end", "px-0", "py-2.5"],
    matrix: [],
  },
  // A cell with nothing in it: a dash, at the tile's end in the stack.
  cellEmpty: {
    base: "flex flex-shrink-0 items-center justify-center py-3.5",
    stack: ["py-0"],
    matrix: [],
  },
};

/*
 * The head's own cells, drawn only in the matrix (the head is not drawn in
 * the stack). The corner over the rows' values and the row axis's name are
 * held at the start of the line with the rows' values, so the head does not
 * scroll away from them. Their gradient fades to gray-50/80, which a column
 * heading scrolled under them showed through: they are drawn over white
 * (the card's own ground, and its dark surface in the dark theme), so they
 * look as the other headings do and nothing shows through.
 */
export const PUBLIC_RESOURCE_GRID_CORNER_CLASS_NAME: string =
  "sticky start-0 z-10 min-w-[10rem] border-e border-gray-200 bg-white bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 pb-1.5 pt-3";

export const PUBLIC_RESOURCE_GRID_COLUMN_AXIS_CLASS_NAME: string =
  "bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 pb-1.5 pt-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400";

export const PUBLIC_RESOURCE_GRID_ROW_AXIS_CLASS_NAME: string =
  "sticky start-0 z-10 min-w-[10rem] border-b border-e border-gray-200 bg-white bg-gradient-to-b from-gray-50 to-gray-50/80 px-4 py-3 text-start text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400";

export const PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME: string =
  "min-w-[8.75rem] border-b border-gray-200 bg-gradient-to-b from-gray-50 to-gray-50/80 px-3 py-3 text-center text-sm font-semibold text-gray-900";

export interface PublicResourceGridClassNames {
  // The grid's box: what the query measures.
  grid: string;
  table: string;
  head: string;
  body: string;
  row: string;
  cellLabel: string;
  cellStatus: string;
  cellEmpty: string;
  // The row's value, in a row that is or is not the last.
  getRowHeading: (data: { isLastRow: boolean }) => string;
  // A cell, by where it is in the matrix and whether it holds anything.
  getCell: (data: {
    isLastRow: boolean;
    isLastColumn: boolean;
    isEmpty: boolean;
  }) => string;
  // A column's heading, by whether it is the last.
  getColumnHeading: (data: { isLastColumn: boolean }) => string;
}

// Every part's classes, for a public grid of this many columns.
export const getPublicResourceGridClassNames: (
  columnCount: number,
) => PublicResourceGridClassNames = (
  columnCount: number,
): PublicResourceGridClassNames => {
  const stackVariant: string = getPublicResourceGridStackVariant(columnCount);
  const matrixVariant: string = getPublicResourceGridMatrixVariant(columnCount);
  const classNameOf: (part: ResourceGridPart) => string = (
    part: ResourceGridPart,
  ): string => {
    return getResourceGridPartClassName({
      part: part,
      stackVariant: stackVariant,
      matrixVariant: matrixVariant,
    });
  };

  const rowHeading: string = classNameOf(PUBLIC_RESOURCE_GRID_PARTS.rowHeading);
  const cell: string = classNameOf(PUBLIC_RESOURCE_GRID_PARTS.cell);

  return {
    grid: RESOURCE_GRID_CLASS_NAME,
    table: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.table),
    head: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.head),
    body: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.body),
    row: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.row),
    cellLabel: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.cellLabel),
    cellStatus: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.cellStatus),
    cellEmpty: classNameOf(PUBLIC_RESOURCE_GRID_PARTS.cellEmpty),
    /*
     * Ruled off from the next row's value in the matrix; the last row's
     * value is ruled off from its cells only in the stack (border-b above).
     */
    getRowHeading: (data: { isLastRow: boolean }): string => {
      return data.isLastRow ? rowHeading : `${rowHeading} border-b`;
    },
    /*
     * In the matrix, a line under each cell but the last row's and after
     * each but the last column's; an empty one lights up with its row.
     */
    getCell: (data: {
      isLastRow: boolean;
      isLastColumn: boolean;
      isEmpty: boolean;
    }): string => {
      return [
        cell,
        data.isLastRow ? "" : "border-b",
        data.isLastColumn ? "" : "border-e",
        data.isEmpty ? "group-hover:bg-gray-50/40" : "",
      ]
        .filter(Boolean)
        .join(" ");
    },
    getColumnHeading: (data: { isLastColumn: boolean }): string => {
      return data.isLastColumn
        ? PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME
        : `${PUBLIC_RESOURCE_GRID_COLUMN_HEADING_CLASS_NAME} border-e`;
    },
  };
};
