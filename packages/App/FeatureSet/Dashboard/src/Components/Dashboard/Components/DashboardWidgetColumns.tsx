import React, { useContext } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import { ColumnResize } from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";

/*
 * A dashboard widget's table, its columns as wide as each person makes them
 * (Common/UI/Components/Table/ColumnResize): the metrics table, a data
 * source's table, the traces table and every resource list. Each widget
 * keeps its own widths for each person - two lists of hosts on two
 * dashboards are sized apart - on a public dashboard for whoever reads it.
 * A widget has no ⋯ to keep a Reset column widths in: while a column is
 * sized, it is beside the last column's name (ResizableHeaderCell), and a
 * column's edge fits it on a double-click and gives it back to the widget
 * on Delete.
 */

// Which widget is drawn: the id its dashboard gives it (DashboardBaseComponent).
export const DashboardWidgetIdContext: React.Context<string | null> =
  React.createContext<string | null>(null);

export const useDashboardWidgetId: () => string | null = (): string | null => {
  return useContext(DashboardWidgetIdContext);
};

// Where a widget's column widths are remembered, per person.
export const getDashboardWidgetColumnWidthsKey: (
  widgetId: string | null,
) => string | null = (widgetId: string | null): string | null => {
  return widgetId ? `dashboard-widget.${widgetId}` : null;
};

export interface DashboardWidgetColumn {
  id: string;
  kind: ColumnWidthKind;
}

export interface DashboardWidgetColumns {
  resizable: ResizableColumns;
  // A column's edge, for its DashboardSortableColumnHeader.
  getResize: (columnId: string) => Omit<ColumnResize, "columnTitle">;
  /*
   * The table's width: the widget's, or - once every column is sized - its
   * columns' own, so the room they leave is the widget's and a column made
   * narrower narrows.
   */
  tableWidthClassName: string;
}

const useDashboardWidgetColumns: (
  columns: ReadonlyArray<DashboardWidgetColumn>,
  // The cells a row draws before these columns: a row's number.
  leadingCellCount?: number | undefined,
) => DashboardWidgetColumns = (
  columns: ReadonlyArray<DashboardWidgetColumn>,
  leadingCellCount?: number | undefined,
): DashboardWidgetColumns => {
  const widgetId: string | null = useDashboardWidgetId();
  const resizable: ResizableColumns = useResizableColumns({
    tableKey: getDashboardWidgetColumnWidthsKey(widgetId),
    columns: columns.map(
      (
        column: DashboardWidgetColumn,
        index: number,
      ): { id: string; cellNumber: number } => {
        return {
          id: column.id,
          cellNumber: (leadingCellCount || 0) + index + 1,
        };
      },
    ),
  });

  return {
    resizable: resizable,
    getResize: (columnId: string): Omit<ColumnResize, "columnTitle"> => {
      const column: DashboardWidgetColumn | undefined = columns.find(
        (candidate: DashboardWidgetColumn): boolean => {
          return candidate.id === columnId;
        },
      );

      return {
        columns: resizable,
        columnId: columnId,
        kind: column?.kind || ColumnWidthKind.Text,
      };
    },
    tableWidthClassName: resizable.areAllColumnsSized ? "w-max" : "w-full",
  };
};

export default useDashboardWidgetColumns;
