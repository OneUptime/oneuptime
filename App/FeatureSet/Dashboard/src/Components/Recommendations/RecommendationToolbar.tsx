import React, { FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/Components/Input/Input";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import FilterButtons, {
  FilterButtonOption,
} from "Common/UI/Components/FilterButtons/FilterButtons";
import {
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatusFilter,
} from "./RecommendationViewModel";

export interface ComponentProps {
  counts: RecommendationCounts;
  filterState: RecommendationFilterState;
  onFilterStateChange: (filterState: RecommendationFilterState) => void;
  isDisabled?: boolean | undefined;
}

interface StatTileDefinition {
  label: string;
  count: number;
  status: RecommendationStatusFilter;
  // The dot beside the label. Colour is the only thing separating the tiles.
  dotClassName: string;
  ariaLabel: string;
}

/*
 * The coverage bar, the stat strip and the filter row.
 *
 * The tiles are the same control twice over: clicking one sets the status
 * filter, and it shows as pressed while that filter is active. Summary numbers
 * you cannot act on are decoration, and a filter dropdown you have to go
 * looking for gets used by nobody.
 *
 * The counts come from the unfiltered list — see
 * `RecommendationFilterUtil.getCounts` — so the tiles keep reading the same
 * totals while you narrow the list underneath them.
 */
const RecommendationToolbar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type SetStatusFunction = (status: RecommendationStatusFilter) => void;

  const setStatus: SetStatusFunction = (
    status: RecommendationStatusFilter,
  ): void => {
    /*
     * Clicking the already-active tile clears the filter rather than doing
     * nothing. A pressed toggle that ignores a press looks broken, and "show
     * me everything again" is otherwise a two-step trip through the filter
     * row.
     */
    props.onFilterStateChange({
      ...props.filterState,
      status:
        props.filterState.status === status
          ? RecommendationStatusFilter.All
          : status,
    });
  };

  const severityOptions: Array<FilterButtonOption> = [
    {
      label: "All severities",
      value: RecommendationSeverityFilter.All,
    },
    {
      label: "Critical",
      value: RecommendationSeverityFilter.Critical,
      badge: props.counts.availableCritical,
    },
    {
      label: "Warning",
      value: RecommendationSeverityFilter.Warning,
      badge: props.counts.availableWarning,
    },
  ];

  /*
   * The tile label is a number and two or three words; the accessible name has
   * to be the whole sentence, and a count of one is common on these tiles — a
   * hardcoded plural announces "Show the 1 dismissed recommendations".
   */
  type RecommendationWordFunction = (count: number) => string;

  const recommendationWord: RecommendationWordFunction = (
    count: number,
  ): string => {
    return count === 1 ? "recommendation" : "recommendations";
  };

  const tiles: Array<StatTileDefinition> = [
    {
      label: "Recommended",
      count: props.counts.total,
      status: RecommendationStatusFilter.All,
      dotClassName: "bg-gray-300",
      ariaLabel: `Show all ${props.counts.total} ${recommendationWord(
        props.counts.total,
      )}`,
    },
    {
      label: "Not set up yet",
      count: props.counts.available,
      status: RecommendationStatusFilter.Available,
      dotClassName: "bg-amber-400",
      ariaLabel: `Show the ${props.counts.available} ${recommendationWord(
        props.counts.available,
      )} that ${props.counts.available === 1 ? "is" : "are"} not set up yet`,
    },
    {
      label: "Already created",
      count: props.counts.created,
      status: RecommendationStatusFilter.Created,
      dotClassName: "bg-green-500",
      ariaLabel: `Show the ${props.counts.created} ${recommendationWord(
        props.counts.created,
      )} that ${props.counts.created === 1 ? "is" : "are"} already created`,
    },
    {
      label: "Dismissed",
      count: props.counts.dismissed,
      status: RecommendationStatusFilter.Dismissed,
      dotClassName: "bg-gray-400",
      ariaLabel: `Show the ${props.counts.dismissed} dismissed ${recommendationWord(
        props.counts.dismissed,
      )}`,
    },
  ];

  return (
    <div className="space-y-4">
      {/*
       * How much of the recommended set is actually watched, on one line.
       *
       * The four tiles below have always carried the numbers, but reading
       * "17 / 17 / 0 / 0" and working out that nothing is set up is arithmetic
       * the page can do for you. Guarded on a non-zero total: ProgressBar
       * divides by totalCount and renders a NaN width at zero.
       */}
      {props.counts.total > 0 ? (
        <div
          className="rounded-lg border border-gray-200 bg-white p-4"
          data-testid="recommendation-coverage"
        >
          <ProgressBar
            count={props.counts.created}
            totalCount={props.counts.total}
            suffix="recommended monitors created"
            size={ProgressBarSize.Small}
          />
        </div>
      ) : (
        <></>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((tile: StatTileDefinition) => {
          const isSelected: boolean = props.filterState.status === tile.status;

          return (
            <button
              key={tile.status}
              type="button"
              aria-pressed={isSelected}
              aria-label={tile.ariaLabel}
              data-testid={`recommendation-stat-${tile.status}`}
              onClick={() => {
                setStatus(tile.status);
              }}
              className={`rounded-lg border px-4 py-3 text-left transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${tile.dotClassName}`}
                  aria-hidden="true"
                />
                <span
                  className={`truncate text-xs font-medium ${
                    isSelected ? "text-indigo-700" : "text-gray-500"
                  }`}
                >
                  {tile.label}
                </span>
              </div>
              <p
                className={`mt-1 text-2xl font-semibold tabular-nums ${
                  isSelected ? "text-indigo-700" : "text-gray-900"
                }`}
              >
                {tile.count}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="sm:max-w-xs sm:flex-1">
          <Input
            value={props.filterState.searchText}
            placeholder="Search recommendations..."
            disabled={props.isDisabled}
            dataTestId="recommendation-search"
            onChange={(value: string) => {
              props.onFilterStateChange({
                ...props.filterState,
                searchText: value,
              });
            }}
          />
        </div>

        <FilterButtons
          options={severityOptions}
          selectedValue={props.filterState.severity}
          onSelect={(value: string) => {
            props.onFilterStateChange({
              ...props.filterState,
              severity: value as RecommendationSeverityFilter,
            });
          }}
        />
      </div>
    </div>
  );
};

export default RecommendationToolbar;
