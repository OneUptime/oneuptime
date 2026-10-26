import React, { useContext } from "react";

/*
 * Whether what is being drawn is a table's cell - a value in a row of a
 * list - rather than a detail card's field or anything else.
 *
 * Some elements a page hands a column are shared with detail cards and
 * other places, and a table's row has to stay short and calm: a record's
 * labels on the row's one line, the first two and "+N"; an empty list as a
 * quiet dash, not "No labels attached." on every row. TableBody tells those
 * elements where they are (Labels, TableColumnListComponent), and anything
 * that opens over the table - a dialog, a side panel - starts afresh.
 */
export const TableCellContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// Whether an element is drawn in a table's cell.
export const useIsTableCell: () => boolean = (): boolean => {
  return useContext(TableCellContext);
};

/*
 * Whether that cell is a field of a phone's card: on a phone, TableBody
 * draws each row as a card, its column names over their values
 * (TableLayout's TABLE_MOBILE_* classes).
 *
 * A card's value has the screen's width to itself and no pointer to show a
 * value cut short in full, so a list in it lets a long name run onto the
 * next line rather than end in "..." (TableColumnListComponent). The alerts
 * list names an alert's monitor only in its Affected Resources list: cut
 * short on a phone, "oneuptime-test - High Node Memory Utili..." was all of
 * it anyone could read.
 *
 * Read together with TableCellContext, so a dialog or a side panel opened
 * from a card - which starts afresh as no cell at all - is no card either.
 */
export const TableCardContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// Whether an element is drawn in a field of a phone's card.
export const useIsTableCard: () => boolean = (): boolean => {
  const isTableCell: boolean = useContext(TableCellContext);
  const isTableCard: boolean = useContext(TableCardContext);

  return isTableCell && isTableCard;
};

/*
 * Whether the table leaves out a column here that a cell is to show the
 * value of in its own place (Column.hideBelowLargeScreen): below lg, on a
 * tablet's rows and a phone's cards alike, when the table has such a
 * column. A cell reads it to draw that value - and draws it nowhere else,
 * so a value is never in a row twice.
 */
export const TableFoldedColumnsContext: React.Context<boolean> =
  React.createContext<boolean>(false);

// Whether an element is drawn in a cell of a row whose table folds a column.
export const useAreTableColumnsFolded: () => boolean = (): boolean => {
  const isTableCell: boolean = useContext(TableCellContext);
  const areColumnsFolded: boolean = useContext(TableFoldedColumnsContext);

  return isTableCell && areColumnsFolded;
};
