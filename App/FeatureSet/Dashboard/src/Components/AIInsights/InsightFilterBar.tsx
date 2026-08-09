import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import React, { FunctionComponent, ReactElement } from "react";

export interface InsightFilterOption {
  label: string;
  value: string;
}

export interface ComponentProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  typeOptions: Array<InsightFilterOption>;
  typeValue: string;
  onTypeChange: (value: string) => void;
  severityOptions: Array<InsightFilterOption>;
  severityValue: string;
  onSeverityChange: (value: string) => void;
  // The sentinel value a select carries when it is not filtering anything.
  unfilteredValue: string;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

type GetSelectClassNameFunction = (isFiltering: boolean) => string;

/*
 * A filtering select tints itself when it is actually narrowing the list —
 * otherwise "Latency Regression" hides in a toolbar that looks idle and the
 * empty list reads as "nothing found" rather than "nothing matches".
 */
const getSelectClassName: GetSelectClassNameFunction = (
  isFiltering: boolean,
): string => {
  const base: string =
    "h-9 w-full appearance-none rounded-lg border py-0 pl-3 pr-8 text-sm font-medium shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-auto";

  if (isFiltering) {
    return `${base} border-indigo-200 bg-indigo-50 text-indigo-700`;
  }

  return `${base} border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50`;
};

/*
 * Search, type and severity in one bar. The status filter is not here — it
 * lives on the count tiles above, which is what let this collapse from three
 * wrapping rows of pills into a single row.
 */
const InsightFilterBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isFilteringByType: boolean = props.typeValue !== props.unfilteredValue;
  const isFilteringBySeverity: boolean =
    props.severityValue !== props.unfilteredValue;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <label htmlFor="ai-insight-search" className="sr-only">
          Search insights
        </label>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <Icon icon={IconProp.Search} className="h-4 w-4" />
        </span>
        <Input
          id="ai-insight-search"
          placeholder="Search insights by title..."
          value={props.searchText}
          onChange={props.onSearchTextChange}
          outerDivClassName="relative w-full"
          className="block w-full rounded-lg border border-transparent bg-transparent py-2 pl-9 pr-9 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {props.searchText ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              props.onSearchTextChange("");
            }}
            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        ) : (
          <></>
        )}
      </div>

      <div className="hidden h-6 w-px flex-shrink-0 bg-gray-200 sm:block" />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative">
          <select
            aria-label="Filter by insight type"
            value={props.typeValue}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onTypeChange(event.target.value);
            }}
            className={getSelectClassName(isFilteringByType)}
          >
            {props.typeOptions.map((option: InsightFilterOption) => {
              return (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              );
            })}
          </select>
          <span
            className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${
              isFilteringByType ? "text-indigo-400" : "text-gray-400"
            }`}
          >
            <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
          </span>
        </div>

        <div className="relative">
          <select
            aria-label="Filter by severity"
            value={props.severityValue}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              props.onSeverityChange(event.target.value);
            }}
            className={getSelectClassName(isFilteringBySeverity)}
          >
            {props.severityOptions.map((option: InsightFilterOption) => {
              return (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              );
            })}
          </select>
          <span
            className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 ${
              isFilteringBySeverity ? "text-indigo-400" : "text-gray-400"
            }`}
          >
            <Icon icon={IconProp.ChevronDown} className="h-4 w-4" />
          </span>
        </div>

        {props.hasActiveFilters ? (
          <button
            type="button"
            onClick={props.onClearFilters}
            className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1 rounded-lg px-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
            Clear
          </button>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default InsightFilterBar;
