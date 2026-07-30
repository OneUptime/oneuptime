import React, { FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/Components/Input/Input";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
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

/*
 * The stat strip and the filter row, which are the same control twice over:
 * clicking a tile sets the status filter, and the tile shows as pressed while
 * that filter is active. Summary numbers you cannot act on are decoration, and
 * a filter dropdown you have to go looking for gets used by nobody.
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          title="Recommended"
          value={props.counts.total.toString()}
          className="shadow-none border border-gray-200 rounded-lg"
          onClick={() => {
            setStatus(RecommendationStatusFilter.All);
          }}
          isSelected={
            props.filterState.status === RecommendationStatusFilter.All
          }
          ariaLabel={`Show all ${props.counts.total} recommendations`}
        />
        <InfoCard
          title="Not set up yet"
          value={props.counts.available.toString()}
          className="shadow-none border border-gray-200 rounded-lg"
          onClick={() => {
            setStatus(RecommendationStatusFilter.Available);
          }}
          isSelected={
            props.filterState.status === RecommendationStatusFilter.Available
          }
          ariaLabel={`Show the ${props.counts.available} recommendations that are not set up yet`}
        />
        <InfoCard
          title="Already created"
          value={props.counts.created.toString()}
          className="shadow-none border border-gray-200 rounded-lg"
          onClick={() => {
            setStatus(RecommendationStatusFilter.Created);
          }}
          isSelected={
            props.filterState.status === RecommendationStatusFilter.Created
          }
          ariaLabel={`Show the ${props.counts.created} recommendations that are already created`}
        />
        <InfoCard
          title="Dismissed"
          value={props.counts.dismissed.toString()}
          className="shadow-none border border-gray-200 rounded-lg"
          onClick={() => {
            setStatus(RecommendationStatusFilter.Dismissed);
          }}
          isSelected={
            props.filterState.status === RecommendationStatusFilter.Dismissed
          }
          ariaLabel={`Show the ${props.counts.dismissed} dismissed recommendations`}
        />
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
