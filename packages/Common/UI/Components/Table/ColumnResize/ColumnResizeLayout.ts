/*
 * How a column's edge looks (ColumnResizeHandle) - the shared Table's
 * header, a logs list's, a dashboard widget's and every table a page draws
 * itself, alike.
 *
 * Quiet until it is wanted: no rule between the header's names - a table's
 * header row is one calm band (TableLayout) - until the pointer is over the
 * header row, when every edge a column can be dragged by shows as a faint
 * line; over an edge, the line turns the product's indigo and the pointer
 * the resize cursor, as it does on the keyboard's focus and while the edge
 * is dragged. A tablet has no pointer to hover with, so its edges show
 * faintly all the time, and take a fingertip (24px).
 *
 * The edge sits at its column's end: the right on a page that reads left to
 * right, the left on one that reads right to left (right-0 and justify-end
 * follow the reading direction: TailwindReadingDirection).
 *
 * React-free, for the guards that read it.
 */

/*
 * The edge's hit area: the last 12px of its header cell - the room between
 * two columns' words - over the cell's sort button, so a press there sizes
 * the column rather than sorting it.
 */
export const COLUMN_RESIZE_HANDLE_CLASS_NAME: string =
  "group/edge absolute inset-y-0 right-0 z-[1] w-3 cursor-col-resize touch-none select-none focus:outline-none [@media(pointer:coarse)]:w-6";

/*
 * The line at the column's end: unseen until the pointer is over the
 * header row (and always on a tablet), then a faint 1px rule.
 */
export const COLUMN_RESIZE_LINE_CLASS_NAME: string = [
  "pointer-events-none absolute inset-y-0 right-0 w-px bg-transparent transition-colors duration-150",
  "[thead:hover_&]:bg-gray-300 [@media(pointer:coarse)]:bg-gray-300",
].join(" ");

/*
 * Over it, indigo and 2px, while the edge is pointed at, has the focus or
 * is dragged: a line of its own drawn over the faint one, so the dark
 * theme's faint line (Theme.css) never covers it.
 */
export const COLUMN_RESIZE_ACTIVE_LINE_CLASS_NAME: string = [
  "pointer-events-none absolute inset-y-0 right-0 w-0.5 bg-indigo-500 opacity-0 transition-opacity duration-150",
  "group-hover/edge:opacity-100 group-focus-visible/edge:opacity-100 group-data-[resizing=true]/edge:opacity-100",
].join(" ");

/*
 * While an edge is dragged, its line runs on down the rows, so the column's
 * new end can be read against every row it passes - softer than the edge
 * itself.
 */
export const COLUMN_RESIZE_GUIDE_CLASS_NAME: string =
  "pointer-events-none absolute top-full right-0 w-0.5 bg-indigo-500 opacity-40";

// The test ids an edge carries, for the suites that drive it.
export const COLUMN_RESIZE_HANDLE_TEST_ID: string = "table-column-resize-handle";
export const COLUMN_RESIZE_GUIDE_TEST_ID: string = "table-column-resize-guide";
