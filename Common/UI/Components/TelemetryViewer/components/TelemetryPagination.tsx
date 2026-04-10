import React, { FunctionComponent, ReactElement } from "react";

export interface TelemetryPaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: Array<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isDisabled?: boolean;
  itemLabel?: string | undefined;
}

const TelemetryPagination: FunctionComponent<TelemetryPaginationProps> = (
  props: TelemetryPaginationProps,
): ReactElement => {
  const totalPages: number = Math.max(
    1,
    Math.ceil(
      props.totalItems === 0
        ? 1
        : props.totalItems / Math.max(props.pageSize, 1),
    ),
  );

  const safeCurrentPage: number = Math.min(props.currentPage, totalPages);

  const firstItemIndex: number =
    props.totalItems === 0 ? 0 : (safeCurrentPage - 1) * props.pageSize + 1;
  const lastItemIndex: number =
    props.totalItems === 0
      ? 0
      : Math.min(props.totalItems, safeCurrentPage * props.pageSize);

  const disablePrev: boolean =
    props.isDisabled || props.totalItems === 0 || safeCurrentPage <= 1;
  const disableNext: boolean =
    props.isDisabled || props.totalItems === 0 || safeCurrentPage >= totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50/50 px-4 py-2.5 text-xs text-gray-500 md:flex-row md:items-center md:justify-between">
      <div>
        {props.totalItems === 0 ? (
          <span className="text-gray-500">
            No {props.itemLabel || "results"} to display.
          </span>
        ) : (
          <span className="text-gray-500">
            Showing {firstItemIndex.toLocaleString()}-
            {lastItemIndex.toLocaleString()} of{" "}
            {props.totalItems.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">
            Rows
          </span>
          <select
            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
            value={props.pageSize}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const size: number =
                Number(event.target.value) || props.pageSize;
              props.onPageSizeChange(size);
            }}
            disabled={props.isDisabled}
          >
            {props.pageSizeOptions.map((option: number) => {
              return (
                <option key={option} value={option}>
                  {option}
                </option>
              );
            })}
          </select>
        </label>

        <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
          <button
            type="button"
            className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (!disablePrev) {
                props.onPageChange(Math.max(1, safeCurrentPage - 1));
              }
            }}
            disabled={disablePrev}
          >
            Previous
          </button>
          <span className="px-3 text-[11px] text-gray-400">
            Page {safeCurrentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (!disableNext) {
                props.onPageChange(Math.min(totalPages, safeCurrentPage + 1));
              }
            }}
            disabled={disableNext}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default TelemetryPagination;
