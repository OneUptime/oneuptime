import React, { FunctionComponent, ReactElement } from "react";

export interface InsightStatusBucket {
  label: string;
  value: string;
  dotClassName: string;
  // null while the counts are still loading or when the count request failed.
  count: number | null;
}

export interface ComponentProps {
  buckets: Array<InsightStatusBucket>;
  selectedValue: string;
  isLoading: boolean;
  onSelect: (value: string) => void;
}

/*
 * The triage strip: how many insights sit in each lifecycle state, and the
 * status filter itself. Two jobs in one control — a row of unlabeled filter
 * pills told you nothing about the backlog it was filtering.
 */
const InsightStatusSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      role="radiogroup"
      aria-label="Filter insights by status"
    >
      {props.buckets.map((bucket: InsightStatusBucket) => {
        const isSelected: boolean = props.selectedValue === bucket.value;

        return (
          <button
            key={bucket.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => {
              props.onSelect(bucket.value);
            }}
            className={`group flex flex-col rounded-xl border px-4 py-3 text-left shadow-sm transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isSelected
                ? "border-indigo-200 bg-indigo-50 ring-1 ring-inset ring-indigo-200"
                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <span
                className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${bucket.dotClassName}`}
              />
              <span className="truncate">{bucket.label}</span>
            </span>

            {props.isLoading ? (
              <span className="mt-1.5 h-6 w-10 animate-pulse rounded bg-gray-100" />
            ) : (
              <span className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-gray-900 tabular-nums">
                {bucket.count === null ? "—" : bucket.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default InsightStatusSummary;
