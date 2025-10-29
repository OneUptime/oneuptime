import React, { FunctionComponent, ReactElement } from "react";

export interface LogsPaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: Array<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isDisabled?: boolean;
}

const LogsPagination: FunctionComponent<LogsPaginationProps> = (
  props: LogsPaginationProps,
): ReactElement => {
  const totalPages: number = Math.max(
    1,
    Math.ceil(
      props.totalItems === 0 ? 1 : props.totalItems / Math.max(props.pageSize, 1),
    ),
  );

  const safeCurrentPage: number = Math.min(props.currentPage, totalPages);

  const firstItemIndex: number = props.totalItems === 0
    ? 0
    : (safeCurrentPage - 1) * props.pageSize + 1;
  const lastItemIndex: number = props.totalItems === 0
    ? 0
    : Math.min(props.totalItems, safeCurrentPage * props.pageSize);

  const disablePrev: boolean =
    props.isDisabled || props.totalItems === 0 || safeCurrentPage <= 1;
  const disableNext: boolean =
    props.isDisabled ||
    props.totalItems === 0 ||
    safeCurrentPage >= totalPages;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-400 md:flex-row md:items-center md:justify-between">
      <div>
        {props.totalItems === 0 ? (
          <span>No results to display.</span>
        ) : (
          <span>
            Showing {firstItemIndex.toLocaleString()}-
            {lastItemIndex.toLocaleString()} of {props.totalItems.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-slate-500">
          <span className="uppercase tracking-wide text-[10px]">Rows</span>
          <select
            className="rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            value={props.pageSize}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              const size: number = Number(event.target.value) || props.pageSize;
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

        <div className="inline-flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/70 p-0.5">
          <button
            type="button"
            className="rounded-full px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => {
              if (!disablePrev) {
                props.onPageChange(Math.max(1, safeCurrentPage - 1));
              }
            }}
            disabled={disablePrev}
          >
            Previous
          </button>
          <span className="px-3 text-[11px] uppercase tracking-wide text-slate-500">
            Page {safeCurrentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded-full px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
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

export default LogsPagination;
