/*
 * STATUS PAGE > RESOURCES' GRID, AS A STACK WHEN ITS BOX IS NARROW (#7087).
 *
 * A grid group is edited as the matrix it renders as on the public status
 * page (ResourceGrid): one column per column axis value, at least 13rem
 * wide, and the row's value at the start of each row. On a phone the
 * Resources card leaves the grid some 316px, and beside a window's side
 * menu (768 to 1100 pixels) some 314 to 390px: a three-column grid was
 * 694px wide in 316, so it scrolled 378px sideways, and each chip's name
 * had 56px - "oneupti..." - beside the room its hidden Edit and ⋯ keep.
 *
 * Below 30rem of its own width (a container query on the grid's box, which
 * is what is narrow, whatever the window) the same table is drawn as a
 * stack: each row a box of its own, headed by its value, and each of its
 * cells under the name of its column, one under the other, as wide as the
 * box. Nothing scrolls sideways, and a chip's name has the box's width
 * less its box and its buttons (162px at 390 pixels, not 56). The table's
 * own column headings are not drawn there: each cell names its column
 * instead (RESOURCE_GRID_CELL_LABEL_CLASS_NAME), and is read with it.
 *
 * From 30rem up nothing changes: every class below that is not under the
 * container query is the class the grid had (two columns of 13rem and a
 * row's value no longer fit in less, so a wider stack would only take the
 * matrix away from a grid that fits).
 */
export const RESOURCE_GRID_STACK_VARIANT: string =
  "[@container(max-width:30rem)]:";

// The grid's box: what the query measures.
export const RESOURCE_GRID_CLASS_NAME: string = "[container-type:inline-size]";

export const RESOURCE_GRID_TABLE_CLASS_NAME: string =
  "min-w-full border-separate border-spacing-0 [@container(max-width:30rem)]:block";

// Each cell names its column in the stack instead.
export const RESOURCE_GRID_HEAD_CLASS_NAME: string =
  "[@container(max-width:30rem)]:hidden";

export const RESOURCE_GRID_BODY_CLASS_NAME: string =
  "[@container(max-width:30rem)]:flex [@container(max-width:30rem)]:flex-col [@container(max-width:30rem)]:gap-3";

/*
 * A row of the stack: a box of its own. Its colours are never under the
 * query: dark mode remaps a colour's own class (Theme.css), never one a
 * variant names, so a border's colour is a class of its own here - which
 * draws nothing in the matrix, where a row has no border.
 */
export const RESOURCE_GRID_ROW_CLASS_NAME: string =
  "border-gray-200 [@container(max-width:30rem)]:block [@container(max-width:30rem)]:rounded-lg [@container(max-width:30rem)]:border";

/*
 * The row's value: held at the start of a matrix that scrolls sideways, and
 * the heading of its box in the stack, over a line.
 */
export const RESOURCE_GRID_ROW_HEADING_CLASS_NAME: string =
  "sticky left-0 z-10 border-b border-r border-gray-200 bg-white px-3 py-3 text-left align-top text-xs font-semibold text-gray-800 [@container(max-width:30rem)]:static [@container(max-width:30rem)]:block [@container(max-width:30rem)]:rounded-t-lg [@container(max-width:30rem)]:border-r-0 [@container(max-width:30rem)]:py-2";

export const RESOURCE_GRID_CELL_CLASS_NAME: string =
  "border-b border-gray-200 px-2 py-2 align-top [@container(max-width:30rem)]:block [@container(max-width:30rem)]:last:border-b-0";

/*
 * The cell's column, drawn as the column's heading is, over the cell's
 * chips in the stack; not drawn (nor read) in the matrix, whose column
 * heading names it.
 */
export const RESOURCE_GRID_CELL_LABEL_CLASS_NAME: string =
  "hidden px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 [@container(max-width:30rem)]:block";

/*
 * A chip's Edit and ⋯ fade in on hover and on keyboard focus, so a cell
 * full of monitors reads as names rather than as a column of icons.
 * Neither of those holds while the ⋯ menu is open, though: the menu is
 * drawn in the body, so the pointer leaves the chip to reach it and focus
 * moves into it - and the trigger the menu hangs from would fade out from
 * under it. The trigger says it is expanded for as long as the menu is
 * open, so that is what keeps it shown.
 *
 * A phone or a tablet has no hover (hover: none): there the buttons were
 * not seen until one was focused, though their room was kept. There they
 * are always drawn, as a list's row draws them (#7087).
 */
export const RESOURCE_GRID_CHIP_ACTIONS_CLASS_NAME: string =
  "flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100";
