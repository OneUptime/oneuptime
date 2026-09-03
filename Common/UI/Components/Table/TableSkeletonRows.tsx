import Skeleton from "../Skeleton/Skeleton";
import Column from "./Types/Column";
import { getTableCellClassName } from "./CellClassName";
import Columns from "./Types/Columns";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";

export interface ComponentProps<T extends GenericObject> {
  columns: Columns<T>;
  /*
   * The same feature flags TableHeader renders leading cells for. The
   * skeleton must mirror them exactly or its cells sit misaligned under the
   * header while loading.
   */
  enableDragAndDrop?: undefined | boolean;
  isBulkActionsEnabled?: undefined | boolean;
  itemsOnPage: number;
  /*
   * Mobile renders card-shaped placeholders inside the table's mobile <div>
   * wrapper - <tbody> markup is invalid there - and drops hideOnMobile
   * columns, same as TableHeader and TableRow do.
   */
  isMobile: boolean;
}

type TableSkeletonRowsFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

/*
 * Layout-preserving placeholder rows for the table's first load: one pulsing
 * cell per visible column (plus the drag-handle / bulk-select extras) so the
 * page keeps the table's shape instead of collapsing to a centered spinner.
 */
const TableSkeletonRows: TableSkeletonRowsFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  // Enough rows to look like a page of data without painting offscreen ones.
  const rowCount: number = Math.max(1, Math.min(props.itemsOnPage || 0, 10));
  const rowIndexes: Array<number> = Array.from(Array(rowCount).keys());

  // Same filter as TableHeader / TableRow so cell counts always agree.
  const visibleColumns: Columns<T> = props.columns.filter(
    (column: Column<T>) => {
      return !(column.hideOnMobile && props.isMobile);
    },
  );

  if (props.isMobile) {
    return (
      <div
        data-testid="table-skeleton-loader"
        role="status"
        aria-live="polite"
        className="divide-y divide-gray-200 bg-white"
      >
        <span className="sr-only">Loading...</span>
        {rowIndexes.map((rowIndex: number) => {
          return (
            <div
              key={rowIndex}
              className="p-4 bg-white border-b border-gray-200"
            >
              <div className="space-y-3">
                {visibleColumns.map(
                  (_column: Column<T>, columnIndex: number) => {
                    return (
                      <div
                        key={columnIndex}
                        className="flex flex-col space-y-1"
                      >
                        <Skeleton className="h-3 w-24" />
                        <Skeleton
                          className="h-4"
                          widthVariantIndex={rowIndex + columnIndex}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <tbody
      data-testid="table-skeleton-loader"
      role="status"
      aria-live="polite"
      className="divide-y divide-gray-200 bg-white"
    >
      {rowIndexes.map((rowIndex: number) => {
        return (
          <tr key={rowIndex}>
            {props.enableDragAndDrop && (
              <td className="ml-5 py-4 w-10 align-top">
                <Skeleton className="ml-6 h-5 w-5" />
              </td>
            )}
            {props.isBulkActionsEnabled && (
              <td className="w-10 py-3.5  align-top">
                <div className="ml-5">
                  <Skeleton className="h-4 w-4" />
                </div>
              </td>
            )}
            {visibleColumns.map((column: Column<T>, columnIndex: number) => {
              /*
               * The same classes TableRow gives its real cells, from the same
               * helper, so the skeleton's rhythm and padding match the rows
               * that replace it - and cannot drift from them again.
               */
              const className: string = getTableCellClassName<T>({
                column: column,
                isLastRenderedColumn: columnIndex === visibleColumns.length - 1,
              });

              return (
                <td key={columnIndex} className={className}>
                  {rowIndex === 0 && columnIndex === 0 && (
                    <span className="sr-only">Loading...</span>
                  )}
                  <Skeleton
                    className="h-4"
                    widthVariantIndex={rowIndex + columnIndex}
                  />
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
};

export default TableSkeletonRows;
