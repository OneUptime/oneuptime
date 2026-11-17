import SkeletonStatus, { SKELETON_BAR_CLASS_NAME } from "./SkeletonStatus";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a card shows while the rows of a table it draws by hand load: a
 * header line and rows, each the height of the shared table's (a 24px line
 * between py-3), so the card opens at the height its first rows will take.
 * A ModelTable or Table draws its own (TableSkeletonRows); this is for the
 * cards that build a <table> themselves (#9220).
 *
 * On a phone the third column on is left out, as the narrow tables drop
 * theirs, so the bars never run off the card.
 */

export const TABLE_SKELETON_TEST_ID: string = "table-skeleton";

export const DEFAULT_TABLE_SKELETON_ROWS: number = 5;
export const DEFAULT_TABLE_SKELETON_COLUMNS: number = 4;

// The most rows a skeleton draws: enough to look like a page, not more.
export const MAX_TABLE_SKELETON_ROWS: number = 10;

// Each column's bar a little different, so the rows read as rows of text.
const CELL_WIDTH_CLASS_NAMES: ReadonlyArray<string> = [
  "w-3/4",
  "w-1/2",
  "w-2/3",
  "w-1/3",
];

export interface BarsProps {
  rows?: number | undefined;
  columns?: number | undefined;
  // Leave out the header line, for a table the card already titles.
  hasHeader?: boolean | undefined;
}

export interface ComponentProps extends BarsProps {
  className?: string | undefined;
}

const getCellClassName: (columnIndex: number) => string = (
  columnIndex: number,
): string => {
  return `min-w-0 flex-1 items-center${columnIndex >= 2 ? " flex max-sm:hidden" : " flex"}`;
};

export const TableSkeletonBars: FunctionComponent<BarsProps> = (
  props: BarsProps,
): ReactElement => {
  const rowCount: number = Math.max(
    1,
    Math.min(
      props.rows ?? DEFAULT_TABLE_SKELETON_ROWS,
      MAX_TABLE_SKELETON_ROWS,
    ),
  );
  const columnCount: number = Math.max(
    1,
    props.columns ?? DEFAULT_TABLE_SKELETON_COLUMNS,
  );
  const columnIndexes: Array<number> = Array.from(Array(columnCount).keys());

  return (
    <div className="w-full min-w-0">
      {props.hasHeader !== false && (
        <div
          className="flex h-10 items-center gap-6 border-b border-gray-200 px-3"
          data-testid={`${TABLE_SKELETON_TEST_ID}-header`}
        >
          {columnIndexes.map((columnIndex: number) => {
            return (
              <div key={columnIndex} className={getCellClassName(columnIndex)}>
                <div className={`h-3 w-16 ${SKELETON_BAR_CLASS_NAME}`} />
              </div>
            );
          })}
        </div>
      )}
      {Array.from(Array(rowCount).keys()).map((rowIndex: number) => {
        return (
          <div
            key={rowIndex}
            className="flex items-center gap-6 border-b border-gray-100 px-3 py-3 last:border-b-0"
            data-testid={`${TABLE_SKELETON_TEST_ID}-row`}
          >
            {columnIndexes.map((columnIndex: number) => {
              return (
                <div
                  key={columnIndex}
                  className={`h-6 ${getCellClassName(columnIndex)}`}
                >
                  <div
                    className={`h-4 ${
                      CELL_WIDTH_CLASS_NAMES[
                        (rowIndex + columnIndex) % CELL_WIDTH_CLASS_NAMES.length
                      ]
                    } ${SKELETON_BAR_CLASS_NAME}`}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

const TableSkeleton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <SkeletonStatus
      dataTestId={TABLE_SKELETON_TEST_ID}
      className={props.className}
    >
      <TableSkeletonBars {...props} />
    </SkeletonStatus>
  );
};

export default TableSkeleton;
