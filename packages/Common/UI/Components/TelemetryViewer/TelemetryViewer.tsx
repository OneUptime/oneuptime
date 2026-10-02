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
import { hasLockedTelemetryScope } from "./FacetVisibility";
import TelemetryActiveFilterChips from "./components/TelemetryActiveFilterChips";
import { TelemetrySignal } from "../../../Utils/Telemetry/LockedFilterSearch";
import TelemetryHistogram from "./components/TelemetryHistogram";
import TelemetryPagination from "./components/TelemetryPagination";
import TelemetryResultTotal from "./components/TelemetryResultTotal";
import {
  ResultTotal,
  ResultTotalStatus,
} from "../../Utils/Telemetry/ResultTotal";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useViewerTimeRangeZoom, {
  ViewerTimeRangeZoom,
} from "./useViewerTimeRangeZoom";
import { TimeRangeZoomProvider } from "../Charts/TimeRangeZoom/TimeRangeZoomContext";

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
  /*
   * Whether the facet sidebar lists only values found in the viewer's scope
   * (see getFacetValuesInScope). Defaults to "whenever a locked chip is
   * showing": a page pinned to one database, service or trace wants its
   * sidebar to describe that slice, not the project's catalog.
   */
  onlyShowFacetValuesInScope?: boolean | undefined;

  // -- Histogram --
  showHistogram?: boolean;
  histogramBuckets?: Array<HistogramBucket> | undefined;
  histogramSeries?: Array<HistogramSeriesOption> | undefined;
  histogramTitle?: string | undefined;
  histogramLoading?: boolean;
  /*
   * How much time one histogram bar covers, as the query that drew the bars
   * bucketed them. It is what lets a click on a bar open that bar's rows.
   */
  histogramBucketIntervalMs?: number | undefined;
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
  /*
   * How many rows the query matches — or, for a list read from an analytics
   * endpoint, the lower bound that endpoint answers with (see `hasMore`).
   */
  totalCount: number;
  /*
   * Whether rows follow this page, for a list whose endpoint answers with
   * that instead of a total (the analytics list endpoints skip COUNT(*)).
   * Set, and with no exact `resultTotal`, the footer pages forward while
   * more rows follow and prints no "of N" and no page numbers.
   */
  hasMore?: boolean | undefined;
  /*
   * The size of the whole result set, worked out apart from the list (see
   * UseResultTotal). Set, the list opens with it — "712,345 spans",
   * "Counting spans…" — and the footer numbers its pages once it is exact.
   */
  resultTotal?: ResultTotal | undefined;
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

  const onlyShowFacetValuesInScope: boolean =
    props.onlyShowFacetValuesInScope ??
    hasLockedTelemetryScope(props.activeFilters);

  /*
   * Drag-zooming the histogram is a one-way trip on its own: it swaps the
   * window for a custom one and nothing remembers what the reader was
   * looking at. This keeps that window so a double-click on a chart, or
   * "Reset zoom" beside the picker, can hand it back. The same zoom is
   * offered to everything the viewer renders (see the provider below), so
   * a drag across the analytics chart retimes the viewer just like one
   * across the histogram. A viewer pinned to the window of a zoom offered
   * around it (a telemetry snapshot's primary explorer) follows that zoom
   * instead, so a drag here retimes everything that zoom does.
   */
  const viewerZoom: ViewerTimeRangeZoom = useViewerTimeRangeZoom({
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

  /*
   * The total the footer may number its pages by. A caller tracking the
   * result total supplies it once exact; one that only says "more follow"
   * has none; one that says neither passes an exact count (a Postgres-backed
   * list), as every explorer used to.
   */
  const exactTotalCount: number | undefined = props.resultTotal
    ? props.resultTotal.status === ResultTotalStatus.Exact
      ? props.resultTotal.count || 0
      : undefined
    : props.hasMore === undefined
      ? props.totalCount
      : undefined;

  const rowsThroughPage: number =
    (Math.max(props.page, 1) - 1) * props.pageSize + props.items.length;

  // Not over an empty list: its empty state already says there is nothing.
  const showResultTotal: boolean = Boolean(
    props.resultTotal && !props.error && props.items.length > 0,
  );

  const viewer: ReactElement = (
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
          onChange={viewerZoom.onTimeRangeChange || props.onTimeRangeChange}
          /*
           * A followed zoom's way back is shown by whoever offers it (the
           * snapshot's, beside its badge): one Reset zoom per zoom.
           */
          showResetZoom={!viewerZoom.followsEnclosingZoom}
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
            bucketIntervalMs={props.histogramBucketIntervalMs}
            onTimeRangeSelect={viewerZoom.onTimeRangeSelect}
            onZoomOut={viewerZoom.onZoomOut}
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
            onlyShowValuesInScope={onlyShowFacetValuesInScope}
          />
        )}

        <div
          className="flex min-w-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white"
          data-testid={TELEMETRY_VIEWER_LIST_TEST_ID}
        >
          {showResultTotal && props.resultTotal && (
            <div className="border-b border-gray-100 px-4 py-2">
              <TelemetryResultTotal
                total={props.resultTotal}
                rowsThroughPage={rowsThroughPage}
                itemLabel={props.itemLabel}
              />
            </div>
          )}

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

          {/*
           * An exact total numbers the pages. Without one the footer does not
           * print the endpoint's lower bound as if it were a total ("of 51"):
           * it pages forward while more rows follow.
           */}
          <TelemetryPagination
            currentPage={props.page}
            totalItems={
              exactTotalCount === undefined ? props.totalCount : exactTotalCount
            }
            hasMore={
              exactTotalCount === undefined
                ? props.hasMore ?? props.items.length >= props.pageSize
                : undefined
            }
            itemsOnCurrentPage={
              props.resultTotal || props.hasMore !== undefined
                ? props.items.length
                : undefined
            }
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

  /*
   * Every chart in the viewer zooms the viewer's own window: the histogram,
   * the analytics charts a host renders as mainContentOverride, and the
   * picker's "Reset zoom", which is how a keyboard user gets back out. It
   * also shadows any zoom a page around the viewer offers, since a drag
   * here is about this explorer's window, unless that zoom is over this
   * very window: the viewer then hands that zoom on (see
   * useViewerTimeRangeZoom). A host that cannot zoom (no select handler)
   * leaves whatever surrounds the viewer in place.
   */
  if (!viewerZoom.zoom) {
    return viewer;
  }

  return (
    <TimeRangeZoomProvider zoom={viewerZoom.zoom}>
      {viewer}
    </TimeRangeZoomProvider>
  );
}

// Generic functional component wrapper so TypeScript can infer <T>.
const TelemetryViewer: <T>(props: TelemetryViewerProps<T>) => ReactElement =
  TelemetryViewerInner as unknown as <T>(
    props: TelemetryViewerProps<T>,
  ) => ReactElement;

export default TelemetryViewer;
export type { TelemetrySearchBarRef } from "./components/TelemetrySearchBar";
