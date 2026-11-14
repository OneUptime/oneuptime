/*
 * STATUS PAGE > RESOURCES' GRID: A MATRIX WHERE IT FITS, A STACK WHERE IT
 * WOULD SCROLL SIDEWAYS (#7087).
 *
 * A grid group is edited as the matrix it renders as on the public status
 * page (ResourceGrid): one column per column axis value, at least 13rem
 * wide, and the row's value at the start of each row. When the grid's box
 * is narrower than that, the matrix scrolled sideways: a three-column grid
 * was 694px wide in the 316px a phone's Resources card leaves it (378px of
 * scroll), and some 720px in the 584px the card leaves it beside a 1280px
 * window's side menu (110px of scroll).
 *
 * Wherever the matrix would not fit its box (a container query on the
 * grid's box, which is what is narrow, whatever the window) the same table
 * is drawn as a stack: each row a box of its own, headed by its value, and
 * each of its cells under the name of its column, one under the other, as
 * wide as the box. Nothing scrolls sideways, and a chip's name has the
 * box's width. The table's own column headings are not drawn there: each
 * cell names its column instead (cellLabel), and is read with it.
 *
 * Where the matrix fits, nothing changes: every class below that is not
 * under the container query is the class the grid had. So the query's width
 * is what this grid's matrix needs - the row's value and 13rem a column -
 * and a grid of more columns is a stack up to a wider box: a one-column grid
 * is a matrix on a phone, a three-column grid a stack beside a 1280px
 * window's side menu and a matrix from 1440px.
 */

// A column of the matrix: its heading is min-w-[13rem] (ResourceGrid).
export const RESOURCE_GRID_COLUMN_WIDTH_IN_REM: number = 13;

/*
 * Room for the rows' values at the start of each row: the row axis's name
 * ("REGION") over values that wrap a word to a line ("EU / West"). Some 5rem
 * in English; a little more is kept, so a grid at the edge of the query is
 * a stack rather than a matrix that scrolls a few pixels.
 */
export const RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM: number = 6;

/*
 * What a grid's matrix needs: room for its rows' values, and room for each
 * column. The editor's are the two above. The public status page's grid
 * (PublicResourceGridLayout) draws a status and an uptime in a cell rather
 * than chips with names, so it names narrower columns of its own.
 */
export interface ResourceGridSizes {
  rowHeadingWidthInRem: number;
  columnWidthInRem: number;
}

export const RESOURCE_GRID_SIZES: ResourceGridSizes = {
  rowHeadingWidthInRem: RESOURCE_GRID_ROW_HEADING_WIDTH_IN_REM,
  columnWidthInRem: RESOURCE_GRID_COLUMN_WIDTH_IN_REM,
};

type ColumnCountFunction<T> = (
  columnCount: number,
  sizes?: ResourceGridSizes,
) => T;

/*
 * What a grid of this many columns needs to be drawn as a matrix: the
 * editor's widths, unless a grid names its own.
 */
export const getResourceGridMatrixWidthInRem: ColumnCountFunction<number> = (
  columnCount: number,
  sizes: ResourceGridSizes = RESOURCE_GRID_SIZES,
): number => {
  return (
    sizes.rowHeadingWidthInRem +
    sizes.columnWidthInRem * Math.max(1, Math.floor(columnCount))
  );
};

// The stack: the grid's box is no wider than its matrix needs.
export const getResourceGridStackVariant: ColumnCountFunction<string> = (
  columnCount: number,
  sizes: ResourceGridSizes = RESOURCE_GRID_SIZES,
): string => {
  return `[@container(max-width:${getResourceGridMatrixWidthInRem(columnCount, sizes)}rem)]:`;
};

/*
 * The same query, negated: the matrix. What only the stack draws is drawn
 * by default and hidden here, never written with a bare `hidden` a query
 * shows again - a foreign .hidden{display:none !important} (Bootstrap,
 * a browser extension) would keep that hidden at every width
 * (ForeignHiddenRuleGuard).
 */
export const getResourceGridMatrixVariant: ColumnCountFunction<string> = (
  columnCount: number,
  sizes: ResourceGridSizes = RESOURCE_GRID_SIZES,
): string => {
  return `[@container_not_(max-width:${getResourceGridMatrixWidthInRem(columnCount, sizes)}rem)]:`;
};

/*
 * Each part of the table: the classes it has in both layouts (the matrix's
 * own), what the stack adds, and what only the matrix adds. No colour is
 * ever under either query: dark mode remaps a colour's own class
 * (Theme.css), never one a variant names.
 */
export interface ResourceGridPart {
  base: string;
  stack: Array<string>;
  matrix: Array<string>;
}

export interface ResourceGridParts {
  table: ResourceGridPart;
  head: ResourceGridPart;
  body: ResourceGridPart;
  row: ResourceGridPart;
  rowHeading: ResourceGridPart;
  cell: ResourceGridPart;
  cellLabel: ResourceGridPart;
}

export const RESOURCE_GRID_PARTS: ResourceGridParts = {
  table: {
    base: "min-w-full border-separate border-spacing-0",
    stack: ["block"],
    matrix: [],
  },
  // Each cell names its column in the stack instead.
  head: { base: "", stack: ["hidden"], matrix: [] },
  body: { base: "", stack: ["flex", "flex-col", "gap-3"], matrix: [] },
  /*
   * A row of the stack: a box of its own. Its border's colour is a class of
   * its own, outside the query (dark mode), which draws nothing in the
   * matrix, where a row has no border.
   */
  row: {
    base: "border-gray-200",
    stack: ["block", "rounded-lg", "border"],
    matrix: [],
  },
  /*
   * The row's value: held at the start of a matrix that scrolls sideways,
   * and the heading of its box in the stack, over a line.
   */
  rowHeading: {
    base: "sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-3 text-left align-top text-xs font-semibold text-gray-800",
    stack: ["static", "block", "rounded-t-lg", "border-r-0", "py-2"],
    matrix: [],
  },
  cell: {
    base: "border-b border-gray-200 px-2 py-2 align-top",
    stack: ["block", "last:border-b-0"],
    matrix: [],
  },
  /*
   * The cell's column, drawn as the column's heading is, over the cell's
   * chips in the stack; not drawn (nor read) in the matrix, whose column
   * heading names it.
   */
  cellLabel: {
    base: "px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500",
    stack: [],
    matrix: ["hidden"],
  },
};

export interface ResourceGridClassNames {
  // The grid's box: what the query measures.
  grid: string;
  table: string;
  head: string;
  body: string;
  row: string;
  rowHeading: string;
  cell: string;
  cellLabel: string;
}

// The grid's box: what the query measures.
export const RESOURCE_GRID_CLASS_NAME: string = "[container-type:inline-size]";

type PartClassNameFunction = (data: {
  part: ResourceGridPart;
  stackVariant: string;
  matrixVariant: string;
}) => string;

/*
 * A part's classes: its own, then what the stack adds under the stack's
 * query, then what only the matrix adds under the negated one.
 */
export const getResourceGridPartClassName: PartClassNameFunction = (data: {
  part: ResourceGridPart;
  stackVariant: string;
  matrixVariant: string;
}): string => {
  return [
    data.part.base,
    ...data.part.stack.map((token: string): string => {
      return `${data.stackVariant}${token}`;
    }),
    ...data.part.matrix.map((token: string): string => {
      return `${data.matrixVariant}${token}`;
    }),
  ]
    .filter(Boolean)
    .join(" ");
};

// Every part's classes, for a grid of this many columns.
export const getResourceGridClassNames: ColumnCountFunction<
  ResourceGridClassNames
> = (columnCount: number): ResourceGridClassNames => {
  const stackVariant: string = getResourceGridStackVariant(columnCount);
  const matrixVariant: string = getResourceGridMatrixVariant(columnCount);
  const classNameOf: (part: ResourceGridPart) => string = (
    part: ResourceGridPart,
  ): string => {
    return getResourceGridPartClassName({
      part: part,
      stackVariant: stackVariant,
      matrixVariant: matrixVariant,
    });
  };

  return {
    grid: RESOURCE_GRID_CLASS_NAME,
    table: classNameOf(RESOURCE_GRID_PARTS.table),
    head: classNameOf(RESOURCE_GRID_PARTS.head),
    body: classNameOf(RESOURCE_GRID_PARTS.body),
    row: classNameOf(RESOURCE_GRID_PARTS.row),
    rowHeading: classNameOf(RESOURCE_GRID_PARTS.rowHeading),
    cell: classNameOf(RESOURCE_GRID_PARTS.cell),
    cellLabel: classNameOf(RESOURCE_GRID_PARTS.cellLabel),
  };
};

/*
 * A chip: where a pointer can hover, its actions below wait at its end, out
 * of its row, until they are shown, so it is the box they are placed in. It
 * keeps the height its buttons give it (3.125rem: their 36px, its padding
 * and its border) while they are out of its
 * row, so showing them moves nothing up or down.
 */
export const RESOURCE_GRID_CHIP_CLASS_NAME: string =
  "group relative flex min-h-[3.125rem] items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs shadow-sm transition-shadow hover:shadow";

/*
 * A chip's Edit and ⋯ fade in on hover and on keyboard focus, so a cell
 * full of monitors reads as names rather than as a column of icons.
 * Neither of those holds while the ⋯ menu is open, though: the menu is
 * drawn in the body, so the pointer leaves the chip to reach it and focus
 * moves into it - and the trigger the menu hangs from would fade out from
 * under it. The trigger says it is expanded for as long as the menu is
 * open, so that is what keeps it shown.
 *
 * Where a pointer can hover (hover: hover) they take no room while they
 * are not shown (absolute, at the chip's end, where nothing can reach them
 * without hovering the chip): a name in a 13rem column had 56px -
 * "Check..." - beside 74px of nothing, and now has the chip's width (#7087).
 * Shown - hovered, focused, or its menu open - they take their room again
 * (static), and the name gives way to them, ending in "..." at its own end
 * whichever way it reads. Laid over the name instead, they would hide an
 * English name's start on an Arabic page, where a chip ends on the left.
 * They come and go at once, as the name gives way at once: a fade would
 * draw them over the name for its length as they leave.
 *
 * A phone or a tablet has no hover (hover: none): there the buttons are
 * always drawn, in their own room, as a list's row draws them (#7087).
 * Before, they were not seen until one was focused, though their room was
 * kept.
 */
export const RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME: string =
  "flex flex-shrink-0 items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-2 focus-within:static group-hover:static has-[[aria-expanded=true]]:static";
