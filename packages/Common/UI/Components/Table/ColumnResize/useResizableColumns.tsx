import {
  COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  ColumnWidthKind,
  ColumnWidths,
  getColumnWidthsScope,
  getSizedColumnsCss,
  hasDrawnColumnWidths,
} from "./ColumnWidths";
import useColumnWidths, { UseColumnWidthsResult } from "./useColumnWidths";
import { useColumnWidthsValue } from "./ColumnWidthsStore";
import SizedColumnsStyle, { SizedColumn } from "./SizedColumnsStyle";
import {
  RESET_COLUMN_WIDTHS_ICON,
  RESET_COLUMN_WIDTHS_MENU_KEY,
  RESET_COLUMN_WIDTHS_TEST_ID,
  RESET_COLUMN_WIDTHS_TEXT,
} from "./ResetColumnWidthsButton";
import {
  CardMenuExtraItem,
  CardMenuExtras,
  useCardMenuExtras,
} from "../../Card/CardMenuExtras";
import React, { ReactElement, useId, useLayoutEffect, useRef } from "react";

/*
 * Everything a table a page draws itself needs to let a person size its
 * columns, as the shared Table does (a logs list, a dashboard widget's
 * table, a monitor's readings):
 *
 *   - the widths, remembered per person under the table's key
 *     (useColumnWidths);
 *   - the attribute that names the table in the rules that let a sized
 *     column's values use its width, and those rules (SizedColumnsStyle);
 *   - whether any column is sized, and whether every one is - a table that
 *     fills its box draws as wide as its columns once every one is sized
 *     (w-max), or the room they left would go back to them and a column
 *     made narrower would not narrow - each read alone, so a width kept
 *     never draws the table's rows again;
 *   - Reset column widths in the ⋯ of the card the table is in, while a
 *     column is sized, as the shared Table puts it (CardMenuExtras) - or,
 *     with no ⋯ to keep it in, at the header row's end: beside the last
 *     column's name (resetColumnId), as the shared Table draws it in its
 *     last header cell;
 *   - and what a column's edge tells the table as it is dragged.
 *
 * Each header cell then draws itself with ResizableHeaderCell.
 */

export interface ResizableColumns {
  columnWidths: UseColumnWidthsResult;
  // Spread on the <table>.
  tableAttributes: Record<string, string>;
  // Drawn before the <table>: the rules of the sized columns.
  styles: ReactElement;
  // Whether any of the table's columns is sized now.
  hasColumnWidths: boolean;
  // Whether every one of them is: the table is then as wide as its columns.
  areAllColumnsSized: boolean;
  // Whether the card the table is in keeps its Reset column widths in its ⋯.
  isResetInCardMenu: boolean;
  /*
   * The column whose header cell draws Reset column widths - the row's
   * last - while a column is sized and there is no ⋯ to keep it in; else
   * none.
   */
  resetColumnId: string | undefined;
  onResizeStart: (
    columnId: string,
    headerCell: HTMLTableCellElement,
    kind: ColumnWidthKind,
  ) => void;
  onResizeEnd: (columnId: string) => void;
  /*
   * What a header cell (ResizableHeaderCell) takes to draw a column's edge:
   * the column's id, its name as the header says it, and how its values
   * may be cut short (a line of text, unless it says otherwise).
   */
  getResize: (
    columnId: string,
    columnTitle: string,
    kind?: ColumnWidthKind | undefined,
  ) => ResizableHeaderCellResize;
  /*
   * The table's width: as wide as its box, or - once every column is
   * sized - as its columns ("w-max"), so a column made narrower narrows.
   */
  getTableWidthClassName: (fillClassName: string) => string;
}

/*
 * ResizableHeaderCell's resize (its ColumnResize), here so the two files do
 * not read each other.
 */
export interface ResizableHeaderCellResize {
  columns: ResizableColumns;
  columnId: string;
  columnTitle: string;
  kind: ColumnWidthKind;
}

const useResizableColumns: (data: {
  /*
   * Which table this is, the same wherever it is drawn: its widths are
   * remembered under it. Null: only while the page is open.
   */
  tableKey: string | null;
  // The columns a person may size, each with its place among its row's cells.
  columns: ReadonlyArray<SizedColumn>;
  /*
   * The table draws Reset column widths itself, at its header row's end
   * (the logs list, in the cell that ends its rows): no header cell does.
   */
  hasOwnReset?: boolean | undefined;
}) => ResizableColumns = (data: {
  tableKey: string | null;
  columns: ReadonlyArray<SizedColumn>;
  hasOwnReset?: boolean | undefined;
}): ResizableColumns => {
  const columnWidths: UseColumnWidthsResult = useColumnWidths({
    tableKey: data.tableKey,
  });
  const scope: string = getColumnWidthsScope(useId());
  const dragStyleRef: React.RefObject<HTMLStyleElement> =
    useRef<HTMLStyleElement>(null);
  // Each column's kind, as its header cell names it (getResize).
  const kindsRef: React.MutableRefObject<Map<string, ColumnWidthKind>> = useRef<
    Map<string, ColumnWidthKind>
  >(new Map<string, ColumnWidthKind>());

  const columnIds: Array<string> = data.columns.map(
    (column: SizedColumn): string => {
      return column.id;
    },
  );

  const hasColumnWidths: boolean = useColumnWidthsValue(
    columnWidths.store,
    (widths: ColumnWidths): boolean => {
      return hasDrawnColumnWidths(widths, columnIds);
    },
  );

  const areAllColumnsSized: boolean = useColumnWidthsValue(
    columnWidths.store,
    (widths: ColumnWidths): boolean => {
      return (
        columnIds.length > 0 &&
        columnIds.every((columnId: string): boolean => {
          return widths[columnId] !== undefined;
        })
      );
    },
  );

  // Reset column widths in the ⋯ of the card the table is in.
  const cardMenuExtras: CardMenuExtras | null = useCardMenuExtras();
  const setCardMenuItem:
    | ((ownerId: string, item: CardMenuExtraItem | null) => void)
    | undefined = cardMenuExtras?.setItem;
  const resetRef: React.MutableRefObject<() => void> = useRef<() => void>(
    columnWidths.resetColumnWidths,
  );
  resetRef.current = columnWidths.resetColumnWidths;

  useLayoutEffect(() => {
    if (!setCardMenuItem || !hasColumnWidths) {
      return undefined;
    }

    setCardMenuItem(scope, {
      key: RESET_COLUMN_WIDTHS_MENU_KEY,
      text: RESET_COLUMN_WIDTHS_TEXT,
      icon: RESET_COLUMN_WIDTHS_ICON,
      dataTestId: RESET_COLUMN_WIDTHS_TEST_ID,
      onClick: (): void => {
        resetRef.current();
      },
    });

    return () => {
      setCardMenuItem(scope, null);
    };
  }, [setCardMenuItem, hasColumnWidths, scope]);

  const isResetInCardMenu: boolean = Boolean(
    cardMenuExtras && cardMenuExtras.menuCount > 0,
  );

  // The row's last column: the one at the header row's end.
  const lastColumn: SizedColumn | undefined = data.columns.reduce(
    (last: SizedColumn | undefined, column: SizedColumn) => {
      return !last || column.cellNumber > last.cellNumber ? column : last;
    },
    undefined,
  );

  const resizableColumns: ResizableColumns = {
    columnWidths: columnWidths,
    tableAttributes: { [COLUMN_WIDTHS_SCOPE_ATTRIBUTE]: scope },
    styles: (
      <>
        <SizedColumnsStyle
          store={columnWidths.store}
          scope={scope}
          columns={data.columns}
          getKind={(columnId: string): ColumnWidthKind | undefined => {
            return kindsRef.current.get(columnId);
          }}
        />
        <style ref={dragStyleRef} data-column-resize-drag-style={scope} />
      </>
    ),
    hasColumnWidths: hasColumnWidths,
    areAllColumnsSized: areAllColumnsSized,
    isResetInCardMenu: isResetInCardMenu,
    resetColumnId:
      !data.hasOwnReset && hasColumnWidths && !isResetInCardMenu
        ? lastColumn?.id
        : undefined,
    onResizeStart: (
      _columnId: string,
      headerCell: HTMLTableCellElement,
      kind: ColumnWidthKind,
    ): void => {
      // The dragged column's values use its width from the first move.
      if (dragStyleRef.current) {
        const cellNumber: number = headerCell.cellIndex + 1;

        dragStyleRef.current.textContent = getSizedColumnsCss({
          scope: scope,
          cellNumbers: [cellNumber],
          wholeCellNumbers: kind === ColumnWidthKind.Whole ? [cellNumber] : [],
        });
      }
    },
    onResizeEnd: (): void => {
      if (dragStyleRef.current) {
        dragStyleRef.current.textContent = "";
      }
    },
    getResize: (
      columnId: string,
      columnTitle: string,
      kind?: ColumnWidthKind | undefined,
    ): ResizableHeaderCellResize => {
      kindsRef.current.set(columnId, kind || ColumnWidthKind.Text);

      return {
        columns: resizableColumns,
        columnId: columnId,
        columnTitle: columnTitle,
        kind: kind || ColumnWidthKind.Text,
      };
    },
    getTableWidthClassName: (fillClassName: string): string => {
      return areAllColumnsSized ? "w-max" : fillClassName;
    },
  };

  return resizableColumns;
};

export default useResizableColumns;
