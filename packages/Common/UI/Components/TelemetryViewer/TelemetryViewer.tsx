import React, { ReactElement, ReactNode, useId, useState } from "react";
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
import { TelemetrySignal } from "../../../Utils/Telemetry/LockedFilterSearch";
import TelemetryHistogram from "./components/TelemetryHistogram";
import TelemetryPagination from "./components/TelemetryPagination";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useHistogramZoom, {
  HistogramZoomState,
} from "../Charts/Utils/useHistogramZoom";

export interface TelemetryViewerProps<T> {
  // -- Data --
  items: Array<T>;
  isLoading: boolean;
  error?: string | undefined;
  onRefresh?: (() => void) | undefined;
  emptyMessage?: string | undefined;
  /*
   * Replaces the default "No results / try adjusting filters" block when the
   * list comes back empty.
   *
   * For most signals the default is right: an empty list means the filters
   * are too narrow. For a signal that a project may not be SENDING at all,
   * it is usually wrong — the reader needs the setup guide, not an
   * invitation to widen a time range over data that does not exist. Takes
   * precedence over `emptyMessage`; nothing is rendered around it, so the
   * caller owns the whole empty area.
   */
  emptyContent?: ReactNode;

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
  searchAttributeSuggestions?: Array<string> | undefined;
  searchValueSuggestions?: Record<string, Array<string>> | undefined;
  searchFieldAliasMap?: Record<string, string> | undefined;
  /*
   * Return `false` when the field is filtered via the raw search string
   * rather than a chip — the search bar then keeps the token in the input
   * and submits the search instead of clearing the token.
   */
  onSearchFieldValueSelect?:
    | ((fieldKey: string, value: string) => boolean | void)
    | undefined;
  searchHelpRows?: Array<SearchHelpRow> | undefined;
  searchHelpCombinedExample?: string | undefined;
  searchBarRef?: React.Ref<TelemetrySearchBarRef> | undefined;
  searchAttributesLoading?: boolean | undefined;
  searchValuesLoading?: boolean | undefined;

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
  /*
   * Called (debounced) when the user types in a server-searchable facet's
   * search box. Parent typically updates state and refetches facetData.
   */
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;

  // -- Active filters --
  activeFilters?: Array<ActiveFilter> | undefined;
  onRemoveFilter?: ((facetKey: string, value: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  /*
   * Which explorer this is — names the explorer in the locked chips'
   * tooltips. Forwarded to the chip list.
   */
  lockedFilterSignal?: TelemetrySignal | undefined;

  // -- Histogram --
  showHistogram?: boolean;
  histogramBuckets?: Array<HistogramBucket> | undefined;
  histogramSeries?: Array<HistogramSeriesOption> | undefined;
  histogramTitle?: string | undefined;
  histogramLoading?: boolean;
  onHistogramTimeRangeSelect?:
    | ((startTime: Date, endTime: Date) => void)
    | undefined;
  // Extra controls in the histogram header (e.g. a chart-metric selector).
  histogramHeaderActions?: ReactNode;
  // Y-axis / tooltip value formatting (e.g. latency metrics in ms).
  histogramValueFormatter?: ((value: number) => string) | undefined;

  /*
   * When set, replaces the histogram + facet sidebar + list with the given
   * content (e.g. an analytics view). The toolbar, search bar, and active
   * filter chips stay, so the override content can consume the same filters.
   */
  mainContentOverride?: ReactNode;

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

export const TELEMETRY_VIEWER_SEARCH_TEST_ID: string =
  "telemetry-viewer-search";
export const TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID: string =
  "telemetry-viewer-filters-toggle";
export const TELEMETRY_VIEWER_MAIN_AREA_TEST_ID: string =
  "telemetry-viewer-main-area";
export const TELEMETRY_VIEWER_LIST_TEST_ID: string = "telemetry-viewer-list";

function TelemetryViewerInner<T>(props: TelemetryViewerProps<T>): ReactElement {
  const showFacets: boolean =
    (props.showFacetSidebar ?? true) &&
    props.facetConfigs !== undefined &&
    props.facetConfigs.length > 0;

  const showHistogram: boolean = props.showHistogram ?? true;

  /*
   * Drag-zooming the histogram is a one-way trip on its own: it swaps the
   * window for a custom one and nothing remembers what the reader was
   * looking at. This keeps that window so a double-click on the chart can
   * hand it back.
   */
  const histogramZoom: HistogramZoomState = useHistogramZoom({
    timeRange: props.timeRange,
    onTimeRangeSelect: props.onHistogramTimeRangeSelect,
    onTimeRangeChange: props.onTimeRangeChange,
  });

  /*
   * Below md there is no room for the facet sidebar beside the list: at phone
   * width it squeezed the list card to ~110px. There the sidebar stacks above
   * the list instead, folded behind a "Filters" toggle so the list stays the
   * first thing on screen. From md up the sidebar always shows and the toggle
   * is hidden, so this state only matters on small screens.
   */
  const [isFacetPanelOpen, setIsFacetPanelOpen] = useState<boolean>(false);
  const facetPanelId: string = useId();

  const showFacetToggle: boolean = showFacets && !props.mainContentOverride;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
         * Below md the search holds a 12rem basis, so the wrapping toolbar
         * gives it its own row (shared with the Filters toggle at most) and
         * does not squeeze it between the buttons. From md up it is flex-1
         * again and takes whatever the buttons leave.
         */}
        <div
          className="min-w-0 flex-[1_1_12rem] md:flex-1"
          data-testid={TELEMETRY_VIEWER_SEARCH_TEST_ID}
        >
          <TelemetrySearchBar
            ref={props.searchBarRef}
            value={props.searchValue}
            onChange={props.onSearchChange}
            onSubmit={props.onSearchSubmit}
            placeholder={props.searchPlaceholder}
            suggestions={props.searchSuggestions}
            attributeSuggestions={props.searchAttributeSuggestions}
            valueSuggestions={props.searchValueSuggestions}
            fieldAliasMap={props.searchFieldAliasMap}
            onFieldValueSelect={props.onSearchFieldValueSelect}
            helpRows={props.searchHelpRows}
            helpCombinedExample={props.searchHelpCombinedExample}
            isAttributesLoading={props.searchAttributesLoading}
            isValuesLoading={props.searchValuesLoading}
            isLoading={props.isLoading}
          />
        </div>

        {showFacetToggle && (
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors md:hidden ${
              isFacetPanelOpen
                ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
            aria-expanded={isFacetPanelOpen}
            aria-controls={facetPanelId}
            data-testid={TELEMETRY_VIEWER_FILTERS_TOGGLE_TEST_ID}
            onClick={() => {
              setIsFacetPanelOpen(!isFacetPanelOpen);
            }}
          >
            <Icon icon={IconProp.Filter} className="h-3.5 w-3.5" />
            <span>Filters</span>
          </button>
        )}

        {props.toolbarLeadingActions}

        <TelemetryTimeRangePicker
          value={props.timeRange}
          onChange={histogramZoom.onTimeRangeChange || props.onTimeRangeChange}
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
          signal={props.lockedFilterSignal}
        />
      )}

      {/* Main content override (e.g. analytics view) */}
      {props.mainContentOverride}

      {/* Histogram */}
      {!props.mainContentOverride &&
        showHistogram &&
        props.histogramBuckets &&
        props.histogramSeries && (
          <TelemetryHistogram
            buckets={props.histogramBuckets}
            isLoading={props.histogramLoading || false}
            series={props.histogramSeries}
            title={props.histogramTitle}
            onTimeRangeSelect={histogramZoom.onTimeRangeSelect}
            onZoomOut={histogramZoom.onZoomOut}
            headerActions={props.histogramHeaderActions}
            valueFormatter={props.histogramValueFormatter}
          />
        )}

      {/*
       * Main area: facets + list. A column below md (the sidebar, when
       * opened, stacks above the list); side by side from md up.
       */}
      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 md:flex-row ${
          props.mainContentOverride ? "hidden" : ""
        }`}
        data-testid={TELEMETRY_VIEWER_MAIN_AREA_TEST_ID}
      >
        {showFacets && (
          <TelemetryFacetSidebar
            id={facetPanelId}
            isCollapsedOnSmallScreens={!isFacetPanelOpen}
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
            onFacetSearchChange={props.onFacetSearchChange}
          />
        )}

        <div
          className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white"
          data-testid={TELEMETRY_VIEWER_LIST_TEST_ID}
        >
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
                props.emptyContent !== undefined ? (
                  <>{props.emptyContent}</>
                ) : (
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
                )
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
