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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  counts: RecommendationCounts;
  filterState: RecommendationFilterState;
  onFilterStateChange: (filterState: RecommendationFilterState) => void;
  isDisabled?: boolean | undefined;
}

// The coverage bar's words after its "3 of 8".
export const RECOMMENDATION_COVERAGE_SUFFIX: string = translationKey(
  "recommended monitors created",
);

/*
 * The search box and the severity filter share a row from 42rem of the
 * toolbar's own width - a 320px box beside German's three filter buttons -
 * and stack below that.
 */
export const SEARCH_BESIDE_FILTERS_CLASS_NAME: string =
  "[@container(min-width:42rem)]:flex-row [@container(min-width:42rem)]:items-center [@container(min-width:42rem)]:justify-between";

export const SEARCH_BOX_BESIDE_FILTERS_CLASS_NAME: string =
  "[@container(min-width:42rem)]:max-w-xs [@container(min-width:42rem)]:flex-1";

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
  const translator: Translator = useTranslator();

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
  const tiles: Array<StatTileDefinition> = [
    {
      label: "Recommended",
      count: props.counts.total,
      status: RecommendationStatusFilter.All,
      dotClassName: "bg-gray-300",
      ariaLabel: translator.translatePlural(
        {
          one: "Show all {{count}} recommendation",
          other: "Show all {{count}} recommendations",
        },
        props.counts.total,
      ),
    },
    {
      label: "Not set up yet",
      count: props.counts.available,
      status: RecommendationStatusFilter.Available,
      dotClassName: "bg-amber-400",
      ariaLabel: translator.translatePlural(
        {
          one: "Show the {{count}} recommendation that is not set up yet",
          other: "Show the {{count}} recommendations that are not set up yet",
        },
        props.counts.available,
      ),
    },
    {
      label: "Already created",
      count: props.counts.created,
      status: RecommendationStatusFilter.Created,
      dotClassName: "bg-green-500",
      ariaLabel: translator.translatePlural(
        {
          one: "Show the {{count}} recommendation that is already created",
          other: "Show the {{count}} recommendations that are already created",
        },
        props.counts.created,
      ),
    },
    {
      label: "Dismissed",
      count: props.counts.dismissed,
      status: RecommendationStatusFilter.Dismissed,
      dotClassName: "bg-gray-400",
      ariaLabel: translator.translatePlural(
        {
          one: "Show the {{count}} dismissed recommendation",
          other: "Show the {{count}} dismissed recommendations",
        },
        props.counts.dismissed,
      ),
    },
  ];

  return (
    <div className="space-y-4 [container-type:inline-size]">
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
            /*
             * A key of its own, looked up by the bar: a bare string here
             * was never extracted, so every language read it in English.
             */
            suffix={RECOMMENDATION_COVERAGE_SUFFIX}
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
                  {translator.translateText(tile.label)}
                </span>
              </div>
              <p
                className={`mt-1 text-2xl font-semibold tabular-nums ${
                  isSelected ? "text-indigo-700" : "text-gray-900"
                }`}
              >
                {/*
                 * In the reader's digits, as the coverage bar above writes
                 * its "3 of 8": a Persian card read "۰ از ۱۶" over tiles
                 * of 16 and 0.
                 */}
                {translator.formatNumber(tile.count)}
              </p>
            </button>
          );
        })}
      </div>

      {/*
       * Search and the severity filter side by side once the card has room
       * for both, read from the toolbar's own width: a record page's card
       * is 430px wide at a 768px window (the side menu takes the rest), and
       * from the window's sm the search box was squeezed to "Search recom".
       */}
      <div
        className={`flex flex-col gap-3 ${SEARCH_BESIDE_FILTERS_CLASS_NAME}`}
      >
        <div className={SEARCH_BOX_BESIDE_FILTERS_CLASS_NAME}>
          <Input
            isSearchOrFilter={true}
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
