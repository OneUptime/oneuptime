import React, { ReactElement, ReactNode } from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import {
  FacetData,
  FacetConfig,
  ActiveFilter,
  HistogramBucket,
  HistogramSeriesOption,
  LiveOptions,
  SearchHelpRow,
} from "./types";
import TelemetryTimeRangePicker from "./components/TelemetryTimeRangePicker";
import TelemetrySearchBar, {
  TelemetrySearchBarRef,
} from "./components/TelemetrySearchBar";
import TelemetryFacetSidebar from "./components/TelemetryFacetSidebar";
import TelemetryActiveFilterChips from "./components/TelemetryActiveFilterChips";
import TelemetryHistogram from "./components/TelemetryHistogram";
import TelemetryPagination from "./components/TelemetryPagination";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";

export interface TelemetryViewerProps<T> {
  // -- Data --
  items: Array<T>;
  isLoading: boolean;
  error?: string | undefined;
  onRefresh?: (() => void) | undefined;
  emptyMessage?: string | undefined;

  // -- Layout --
  /** Render one item row in the main list. */
  renderRow: (item: T, index: number) => ReactElement;
  /** Unique key accessor per row (used for React keys). */
  getRowKey: (item: T, index: number) => string;

  // -- Toolbar: search --
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  searchPlaceholder?: string | undefined;
  searchSuggestions?: Array<string> | undefined;
  searchValueSuggestions?: Record<string, Array<string>> | undefined;
  searchFieldAliasMap?: Record<string, string> | undefined;
  onSearchFieldValueSelect?:
    | ((fieldKey: string, value: string) => void)
    | undefined;
  searchHelpRows?: Array<SearchHelpRow> | undefined;
  searchHelpCombinedExample?: string | undefined;
  searchBarRef?: React.Ref<TelemetrySearchBarRef> | undefined;

  // -- Toolbar: time --
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (value: RangeStartAndEndDateTime) => void;

  // -- Toolbar: live + actions --
  live?: LiveOptions | undefined;
  toolbarLeadingActions?: ReactNode;
  toolbarTrailingActions?: ReactNode;

  // -- Sidebar facets --
  showFacetSidebar?: boolean;
  facetData?: FacetData | undefined;
  facetConfigs?: Array<FacetConfig> | undefined;
  facetLoading?: boolean;
  onFacetInclude?: ((facetKey: string, value: string) => void) | undefined;
  onFacetExclude?: ((facetKey: string, value: string) => void) | undefined;

  // -- Active filters --
  activeFilters?: Array<ActiveFilter> | undefined;
  onRemoveFilter?: ((facetKey: string, value: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;

  // -- Histogram --
  showHistogram?: boolean;
  histogramBuckets?: Array<HistogramBucket> | undefined;
  histogramSeries?: Array<HistogramSeriesOption> | undefined;
  histogramTitle?: string | undefined;
  histogramLoading?: boolean;
  onHistogramTimeRangeSelect?:
    | ((startTime: Date, endTime: Date) => void)
    | undefined;

  // -- Pagination --
  page: number;
  pageSize: number;
  totalCount: number;
  pageSizeOptions?: Array<number> | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  itemLabel?: string | undefined;

  // -- Detail panel overlay (rendered by caller above everything) --
  detailPanel?: ReactNode;
}

const DEFAULT_PAGE_SIZE_OPTIONS: Array<number> = [25, 50, 100, 200];

function TelemetryViewerInner<T>(props: TelemetryViewerProps<T>): ReactElement {
  const showFacets: boolean =
    (props.showFacetSidebar ?? true) &&
    props.facetConfigs !== undefined &&
    props.facetConfigs.length > 0;

  const showHistogram: boolean = props.showHistogram ?? true;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <TelemetrySearchBar
            ref={props.searchBarRef}
            value={props.searchValue}
            onChange={props.onSearchChange}
            onSubmit={props.onSearchSubmit}
            placeholder={props.searchPlaceholder}
            suggestions={props.searchSuggestions}
            valueSuggestions={props.searchValueSuggestions}
            fieldAliasMap={props.searchFieldAliasMap}
            onFieldValueSelect={props.onSearchFieldValueSelect}
            helpRows={props.searchHelpRows}
            helpCombinedExample={props.searchHelpCombinedExample}
          />
        </div>

        {props.toolbarLeadingActions}

        <TelemetryTimeRangePicker
          value={props.timeRange}
          onChange={props.onTimeRangeChange}
        />

        {props.live && (
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
              props.live.isLive
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            } ${props.live.isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
            disabled={props.live.isDisabled}
            onClick={() => {
              props.live?.onToggle(!props.live.isLive);
            }}
            title={
              props.live.isLive ? "Pause live updates" : "Enable live updates"
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                props.live.isLive
                  ? "animate-pulse bg-emerald-500"
                  : "bg-gray-300"
              }`}
            />
            <span>{props.live.isLive ? "Live" : "Paused"}</span>
          </button>
        )}

        {props.onRefresh && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
            onClick={props.onRefresh}
            title="Refresh"
          >
            <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
        )}

        {props.toolbarTrailingActions}
      </div>

      {/* Active filter chips */}
      {props.activeFilters && props.activeFilters.length > 0 && (
        <TelemetryActiveFilterChips
          filters={props.activeFilters}
          onRemove={(key: string, value: string) => {
            props.onRemoveFilter?.(key, value);
          }}
          onClearAll={() => {
            props.onClearAllFilters?.();
          }}
        />
      )}

      {/* Histogram */}
      {showHistogram && props.histogramBuckets && props.histogramSeries && (
        <TelemetryHistogram
          buckets={props.histogramBuckets}
          isLoading={props.histogramLoading || false}
          series={props.histogramSeries}
          title={props.histogramTitle}
          onTimeRangeSelect={props.onHistogramTimeRangeSelect}
        />
      )}

      {/* Main area: facets + list */}
      <div className="flex min-h-0 flex-1 gap-3">
        {showFacets && (
          <TelemetryFacetSidebar
            facetData={props.facetData || {}}
            isLoading={props.facetLoading || false}
            facetConfigs={props.facetConfigs || []}
            activeFilters={props.activeFilters}
            onIncludeFilter={(key: string, value: string) => {
              props.onFacetInclude?.(key, value);
            }}
            onExcludeFilter={(key: string, value: string) => {
              props.onFacetExclude?.(key, value);
            }}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white">
          {props.error && (
            <div className="p-4">
              <ErrorMessage message={props.error} />
            </div>
          )}

          {!props.error && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {props.isLoading && props.items.length === 0 ? (
                <div className="flex h-48 items-center justify-center">
                  <ComponentLoader />
                </div>
              ) : props.items.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
                  <Icon
                    icon={IconProp.Search}
                    className="h-8 w-8 text-gray-300"
                  />
                  <p className="text-sm font-medium text-gray-500">
                    {props.emptyMessage || "No results"}
                  </p>
                  <p className="text-xs text-gray-400">
                    Try adjusting filters or time range.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {props.items.map((item: T, index: number) => {
                    return (
                      <li key={props.getRowKey(item, index)}>
                        {props.renderRow(item, index)}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <TelemetryPagination
            currentPage={props.page}
            totalItems={props.totalCount}
            pageSize={props.pageSize}
            pageSizeOptions={props.pageSizeOptions || DEFAULT_PAGE_SIZE_OPTIONS}
            onPageChange={props.onPageChange}
            onPageSizeChange={props.onPageSizeChange}
            isDisabled={props.isLoading}
            itemLabel={props.itemLabel}
          />
        </div>
      </div>

      {/* Detail panel overlay */}
      {props.detailPanel}
    </div>
  );
}

// Generic functional component wrapper so TypeScript can infer <T>.
const TelemetryViewer: <T>(props: TelemetryViewerProps<T>) => ReactElement =
  TelemetryViewerInner as unknown as <T>(
    props: TelemetryViewerProps<T>,
  ) => ReactElement;

export default TelemetryViewer;
export type { TelemetrySearchBarRef } from "./components/TelemetrySearchBar";
