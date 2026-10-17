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
