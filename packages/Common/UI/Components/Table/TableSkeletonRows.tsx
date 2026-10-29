import Skeleton from "../Skeleton/Skeleton";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import { getTableCellClassName } from "./CellClassName";
import {
  TABLE_DRAG_HANDLE_CELL_CLASS_NAME,
  TABLE_END_FILLER_BODY_CELL_CLASS_NAME,
  TABLE_MOBILE_ROW_CLASS_NAME,
  TABLE_ROW_RULE_CLASS_NAME,
  TABLE_SELECT_CELL_CLASS_NAME,
  TABLE_STICKY_END_BODY_CELL_CLASS_NAME,
  TABLE_STUCK_END_CELL_CLASS_NAME,
  getTableCellPaddingClassName,
} from "./TableLayout";
import Columns from "./Types/Columns";
import { COLUMN_MEASURE_SKIP_ATTRIBUTE } from "./ColumnResize/ColumnWidthMeasure";
import GenericObject from "../../../Types/GenericObject";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
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
  /*
   * The table is wider than its card: the Actions column's placeholder
   * sticks at the card's edge, ruled off, as the real one will and as the
   * header's Actions cell above it already does.
   */
  isOverflowing?: boolean | undefined;
  // A cell after the columns, as the header draws one (TableLayout).
  hasEndFiller?: boolean | undefined;
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
  const translator: Translator = useTranslator();
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
        className="divide-y divide-gray-100 bg-white"
      >
        <span className="sr-only">
          {translator.translateText("Loading...")}
        </span>
        {rowIndexes.map((rowIndex: number) => {
          return (
            <div key={rowIndex} className={TABLE_MOBILE_ROW_CLASS_NAME}>
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

  // The cells a row draws before its columns: a grip, then a select box.
  const leadingCellCount: number =
    (props.enableDragAndDrop ? 1 : 0) + (props.isBulkActionsEnabled ? 1 : 0);

  return (
    <tbody
      data-testid="table-skeleton-loader"
      role="status"
      aria-live="polite"
      /*
       * Placeholders say nothing of the values: a column's edge reads its
       * widths from the rows that land, never from these.
       */
      {...{ [COLUMN_MEASURE_SKIP_ATTRIBUTE]: "true" }}
    >
      {rowIndexes.map((rowIndex: number) => {
        const isLastRow: boolean = rowIndex === rowIndexes.length - 1;
        const ruleClassName: string = isLastRow
          ? ""
          : ` ${TABLE_ROW_RULE_CLASS_NAME}`;

        return (
          <tr key={rowIndex} className="bg-white">
            {props.enableDragAndDrop && (
              <td
                className={`${TABLE_DRAG_HANDLE_CELL_CLASS_NAME} ${getTableCellPaddingClassName(
                  { isFirst: true, isLast: false },
                )}${ruleClassName}`}
              >
                <div className="flex h-7 w-6 items-center justify-center">
                  <Skeleton className="h-5 w-4" />
                </div>
              </td>
            )}
            {props.isBulkActionsEnabled && (
              <td
                className={`${TABLE_SELECT_CELL_CLASS_NAME} ${getTableCellPaddingClassName(
                  { isFirst: !props.enableDragAndDrop, isLast: false },
                )}${ruleClassName}`}
              >
                <div className="flex h-6 items-center">
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
                isFirstRenderedCell:
                  leadingCellCount === 0 && columnIndex === 0,
                isLastRow: isLastRow,
                isPrimaryColumn: columnIndex === 0,
              });

              /*
               * The Actions placeholder sticks at the card's edge as the real
               * Actions cell does (TableRow), so the header's stuck cell has
               * the rows' under it while the first page loads.
               */
              const stickyClassName: string =
                column.type === FieldType.Actions
                  ? ` ${TABLE_STICKY_END_BODY_CELL_CLASS_NAME}${
                      props.isOverflowing
                        ? ` ${TABLE_STUCK_END_CELL_CLASS_NAME}`
                        : ""
                    }`
                  : "";

              return (
                <td
                  key={columnIndex}
                  className={`${className}${stickyClassName}`}
                >
                  {rowIndex === 0 && columnIndex === 0 && (
                    <span className="sr-only">
                      {translator.translateText("Loading...")}
                    </span>
                  )}
                  {/*
                   * On the row's 24px line, as the value it stands in for
                   * will be, so the rows keep their height when they land.
                   * The Actions column holds a button's shape, so the
                   * column keeps the width its View and ⋯ will take.
                   */}
                  {column.type === FieldType.Actions ? (
                    <div className="flex h-6 items-center justify-end gap-2">
                      <Skeleton className="h-6 w-24 rounded-md" />
                      <Skeleton className="h-4 w-5" />
                    </div>
                  ) : (
                    <div className="flex h-6 items-center">
                      <Skeleton
                        className="h-4"
                        widthVariantIndex={rowIndex + columnIndex}
                      />
                    </div>
                  )}
                </td>
              );
            })}
            {props.hasEndFiller && (
              <td
                aria-hidden="true"
                className={`${TABLE_END_FILLER_BODY_CELL_CLASS_NAME}${ruleClassName}`}
              />
            )}
          </tr>
        );
      })}
    </tbody>
  );
};

export default TableSkeletonRows;
