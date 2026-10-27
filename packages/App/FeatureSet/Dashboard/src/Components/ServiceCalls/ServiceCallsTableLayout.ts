/*
 * How the services table of a database's or a queue's Overview is laid out
 * (ServiceCallsTable) - the React-free half, so the tests read the same
 * class names the table draws with.
 *
 * "A message queue's Consumers table header 'P95 PROCESSING' runs past its
 * card when the two cards share a row at 1280." The table was twelve equal
 * tracks, the figures two of them each: beside Producers the Consumers card
 * is some 425px wide, a two-track column 58px, and "P95 PROCESSING" in
 * capitals needs 118 - it ran past the card's edge, and on a phone "ERRORS"
 * and every duration did too.
 *
 * Now each figure's column is as wide as its values and its name need, the
 * service's name takes what they leave and is cut short with its whole name
 * under the pointer, and a column's name breaks between its words, never
 * inside one. The table lays itself out by its own width (a size
 * container), not the window's - beside its neighbour at 1280 a card is as
 * narrow as a tablet's:
 *
 * - from 34rem (a card of its own, or a row of two on a wide screen) every
 *   column name is on one line, and each figure's column is at least 6rem,
 *   so the figures do not huddle at the end of a wide table;
 * - from 26rem (two cards in a row at 1280) a long column name takes two
 *   lines rather than the service's name its room: a figure's column is no
 *   wider than 6rem unless one of its words needs it (fit-content);
 * - below 26rem (a phone) there is no room for a name beside three figures,
 *   so each service is two lines: its name across the table, then its three
 *   figures under the column names, which stay one row at the top.
 *
 * Whole two-digit rems, as CardGrid's steps: the Tailwind runtime writes its
 * container variants in the order of their names as text, and the wider
 * step must come last to win where both apply.
 */

/*
 * Where the table goes from two lines a service to one: room for a name of
 * some 100px beside the three figures in the widest language's words
 * (German's VERBRAUCHT, FEHLER and VERARBEITUNG). A card beside another at
 * 1280 (about 425px) has it; a phone's card (about 326px) has not.
 */
export const SERVICE_CALLS_ONE_LINE_FROM_IN_REM: number = 26;

// Where every column name has room for its whole name on one line.
export const SERVICE_CALLS_NAMES_ON_ONE_LINE_FROM_IN_REM: number = 34;

/*
 * Drawn to the card's edges, as the card's tables are: the card pads its
 * body 20px across on a phone and 24px from md up, and 24px under it.
 */
export const SERVICE_CALLS_TABLE_CLASS_NAME: string =
  "-mx-5 -mb-6 -mt-2 border-t border-gray-200 md:-mx-6 [container-type:inline-size]";

/*
 * One grid for the column names and every service, so the columns line up
 * from row to row (each row is a subgrid of its columns): three figures on
 * a phone - shared evenly, but never narrower than a column's longest word
 * or value (German's VEROEFFENTLICHT needs 115px of a phone's 87) - the
 * name before them from 26rem. The 16px between columns is the
 * grid's, and the rows keep it: browsers agree on a subgrid that keeps its
 * parent's gap, not on one that sets its own.
 */
export const SERVICE_CALLS_GRID_CLASS_NAME: string =
  "grid grid-cols-[repeat(3,minmax(min-content,1fr))] gap-x-4 divide-y divide-gray-100 [@container(min-width:26rem)]:grid-cols-[minmax(0,1fr)_repeat(3,fit-content(6rem))] [@container(min-width:34rem)]:grid-cols-[minmax(0,1fr)_repeat(3,minmax(6rem,auto))]";

// A row: the grid's columns, padded as a card's table rows are.
const ROW_CLASS_NAME: string = "col-span-full grid grid-cols-subgrid px-4";

export const SERVICE_CALLS_HEADER_CLASS_NAME: string = `${ROW_CLASS_NAME} bg-gray-50 py-2 text-xs font-medium uppercase tracking-wider text-gray-500`;

export const SERVICE_CALLS_ROW_CLASS_NAME: string = `${ROW_CLASS_NAME} gap-y-1 py-3 text-sm`;

/*
 * The column of names: said to a screen reader on a phone, where every
 * service's name is its own line, and drawn from 26rem. Column names sit at
 * the foot of their row, on the line above the values, when one of them
 * takes two lines.
 */
export const SERVICE_CALLS_NAME_HEADER_CLASS_NAME: string =
  "sr-only self-end [@container(min-width:26rem)]:not-sr-only";

/*
 * A figure's name: at the end of its column, as its values are, broken
 * between its words when the column is narrow, never inside one.
 */
export const SERVICE_CALLS_FIGURE_HEADER_CLASS_NAME: string =
  "self-end text-right [overflow-wrap:normal]";

/*
 * A service's name: its own line on a phone, the first column from 26rem.
 * Its width never asks for room (contain: inline-size): a long name across
 * the three columns on a phone would otherwise widen them past the table.
 */
export const SERVICE_CALLS_NAME_CELL_CLASS_NAME: string =
  "col-span-3 min-w-0 truncate [contain:inline-size] [@container(min-width:26rem)]:col-span-1";

// A figure: whole, at the end of its column, its digits lined up.
export const SERVICE_CALLS_FIGURE_CELL_CLASS_NAME: string =
  "whitespace-nowrap text-right tabular-nums text-gray-700";

export const SERVICE_CALLS_FOOTER_CLASS_NAME: string =
  "border-t border-gray-100 px-4 py-2 text-xs text-gray-500";
