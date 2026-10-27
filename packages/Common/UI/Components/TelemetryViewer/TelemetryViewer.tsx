import React, {
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import useTranslateValue from "../../Utils/Translation";
import { translatableTerm } from "../../Utils/TranslateTemplate";
import GenericObject from "../../../Types/GenericObject";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkUpdateBarLayout,
} from "../BulkUpdate/BulkUpdateForm";
import CheckboxElement from "../Checkbox/Checkbox";
import { TABLE_SELECTED_ROW_CLASS_NAME } from "../Table/TableLayout";
import {
  PageSelectionState,
  getPageSelectionState,
  isRowSelected,
  keepSelectedOnPage,
  setRowSelected,
} from "./TelemetryViewerSelection";
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
import ResultTotalUtil, {
  ResultTotal,
} from "../../Utils/Telemetry/ResultTotal";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import Icon from "../Icon/Icon";
import TelemetryLoadErrorMessage from "./components/TelemetryLoadErrorMessage";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
} from "../../Utils/Telemetry/TelemetryLoadError";
import IconProp from "../../../Types/Icon/IconProp";
import useViewerTimeRangeZoom, {
  ViewerTimeRangeZoom,
} from "./useViewerTimeRangeZoom";
import { TimeRangeZoomProvider } from "../Charts/TimeRangeZoom/TimeRangeZoomContext";

/*
 * Bulk Actions on a telemetry list's rows (an exception's Resolve, Reopen,
 * Archive, Unarchive): a box at the start of each row, one over the rows
 * for every row on the page, and the bar a table shows over its rows while
 * some are ticked (BulkUpdateForm), with its menu of actions and its
 * progress and result dialog. A list pages, so a selection is the page's
 * rows a person ticked (TelemetryViewerSelection).
 */
export interface TelemetryViewerBulk<T> {
  buttons: Array<BulkActionButtonSchema<T & GenericObject>>;
  // The rows' kind, in English: "Exception", "Exceptions".
  singularLabel: string;
  pluralLabel: string;
  // What makes a row the same row on the next read.
  getItemId: (item: T) => string;
  // How a row is named: its box's label, and the result dialog's lists.
  itemToString: (item: T) => string;
  // Told once an action ran: the list reads its rows again.
  onActionEnd?: (() => void) | undefined;
}

export const TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID: string =
  "telemetry-viewer-select-page";
export const TELEMETRY_VIEWER_SELECT_ROW_TEST_ID: string =
  "telemetry-viewer-select-row";
export const TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID: string =
  "telemetry-viewer-select-page-words";

/*
 * Where a row's box sits: at the row's start, level with the row's first
 * line. The row's own py-3 puts that 24px line 12px down, and the box
 * centres itself on a 24px line of its own, as a table's box does.
 */
export const TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME: string =
  "flex-none pl-4 pt-3";

/*
 * The list's header line for Bulk Actions: the page's box at the start,
 * level with the rows' boxes, then its words - or, once rows are ticked,
 * how many and Bulk Actions (BulkUpdateForm's Row), whose end lines up with
 * the rows' ⋯ menus (a row's actions sit pr-2, sm:pr-3 from its end, as
 * the exceptions list draws them). One height either way, as tall as Bulk
 * Actions needs, so ticking the first row moves nothing.
 */
export const TELEMETRY_VIEWER_BULK_ROW_CLASS_NAME: string =
  "flex min-h-[2.75rem] items-center gap-3 border-b border-gray-100 py-1.5 pl-4 pr-2 sm:pr-3";

export interface TelemetryViewerProps<T> {
  // -- Data --
  items: Array<T>;
  isLoading: boolean;
  /*
   * Why the list did not load, shown where the rows go with the toolbar and
   * filters left in place (issue #4707). A TelemetryLoadError tells a search
   * that took too long from any other failure; a plain message reads as a
   * failure.
   */
  error?: string | TelemetryLoadError | undefined;
  // Runs the list's read again from its error. Defaults to onRefresh.
  onRetry?: (() => void) | undefined;
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
  /*
   * The values of the `@key:` being typed could not be loaded (issue #4708):
   * the search bar's dropdown says so, with Try again.
   */
  searchValuesError?: TelemetryLoadError | undefined;
  onRetrySearchValues?: (() => void) | undefined;
  // The `@key:` lookup came back with no values: the dropdown says so.
  searchHasNoValues?: boolean | undefined;

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
  /*
   * Facets whose counts the server stopped at the query time limit (the
   * facets endpoints' timedOutFacets), and why the facets did not load at
   * all. The sidebar says so instead of "No values" or counts of 0.
   */
  timedOutFacets?: Array<string> | undefined;
  facetError?: TelemetryLoadError | undefined;
  onRetryFacets?: (() => void) | undefined;
  /*
   * A facet value that is not filtering was clicked: add its chip. Called
   * only for such a value - a click on a checked or excluded value takes its
   * chips off through onRemoveFilter instead - so an explorer only ever adds
   * here, and adding a chip it already has should change nothing.
   */
  onFacetInclude?: ((facetKey: string, value: string) => void) | undefined;
  /*
   * Leave a facet value's rows out, dropping an include of it. Only an
   * explorer whose list, chart and counts can all leave a value out passes
   * this: without it the facet rows carry no exclude button.
   */
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
  // Why the chart did not load; it says so in its own card.
  histogramError?: TelemetryLoadError | undefined;
  onRetryHistogram?: (() => void) | undefined;
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

  // -- Bulk Actions on the page's rows; left out, the rows have no boxes --
  bulk?: TelemetryViewerBulk<T> | undefined;
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
  const { translateString, translateTemplate } = useTranslateValue();

  /*
   * The rows ticked for Bulk Actions, kept to the page as it is read again
   * (TelemetryViewerSelection): a row read again carries its new state - so
   * the menu offers what it can take now - and one that left the page
   * leaves the selection, on the read that took it away. While an action
   * runs the selection stands still: the run and its dialog hold the rows
   * it started with, whatever is read meanwhile.
   */
  const [selectedItems, setSelectedItems] = useState<Array<T>>([]);
  const [isBulkActionRunning, setIsBulkActionRunning] =
    useState<boolean>(false);
  const bulk: TelemetryViewerBulk<T> | undefined = props.bulk;

  const shownSelection: Array<T> =
    bulk && !isBulkActionRunning
      ? keepSelectedOnPage(selectedItems, props.items, bulk.getItemId)
      : selectedItems;

  useEffect(() => {
    if (!bulk || isBulkActionRunning) {
      return;
    }

    setSelectedItems((selected: Array<T>): Array<T> => {
      return keepSelectedOnPage(selected, props.items, bulk.getItemId);
    });
  }, [props.items, isBulkActionRunning]);

  const pageSelection: PageSelectionState = bulk
    ? getPageSelectionState(shownSelection, props.items, bulk.getItemId)
    : PageSelectionState.None;

  // The page's box: "Select all exceptions on this page".
  const pageBoxWords: string = bulk
    ? translateTemplate("Select all {{itemsName}} on this page", {
        itemsName: translatableTerm(bulk.pluralLabel, { inSentence: true }),
      })
    : "";
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

  const rowsBeforePage: number = (Math.max(props.page, 1) - 1) * props.pageSize;
  const rowsThroughPage: number = rowsBeforePage + props.items.length;

  // The total the footer may number its pages by (see getPagingTotal).
  const exactTotalCount: number | undefined = ResultTotalUtil.getPagingTotal({
    resultTotal: props.resultTotal,
    hasMore: props.hasMore,
    totalCount: props.totalCount,
    rowCount: props.items.length,
    skip: rowsBeforePage,
  });

  const listError: TelemetryLoadError | undefined =
    typeof props.error === "string"
      ? props.error
        ? TelemetryLoadErrorUtil.fromMessage(props.error)
        : undefined
      : props.error;

  // Not over an empty list: its empty state already says there is nothing.
  const showResultTotal: boolean = Boolean(
    props.resultTotal && !listError && props.items.length > 0,
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
            valuesError={props.searchValuesError}
            onRetryValues={props.onRetrySearchValues}
            hasNoValues={props.searchHasNoValues}
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
            <span>{translateString("Filters")}</span>
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
            title={translateString(
              props.live.isLive ? "Pause live updates" : "Enable live updates",
            )}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                props.live.isLive
                  ? "animate-pulse bg-emerald-500"
                  : "bg-gray-300"
              }`}
            />
            <span>
              {translateString(props.live.isLive ? "Live" : "Paused")}
            </span>
          </button>
        )}

        {props.onRefresh && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
            onClick={props.onRefresh}
            title={translateString("Refresh")}
          >
            <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
            <span>{translateString("Refresh")}</span>
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
      {/*
       * When the list says the search could not finish, a chart that could
       * not either steps aside rather than say it again: one message, one
       * Try again.
       */}
      {!props.mainContentOverride &&
        showHistogram &&
        props.histogramBuckets &&
        props.histogramSeries &&
        !(listError && props.histogramError) && (
          <TelemetryHistogram
            buckets={props.histogramBuckets}
            isLoading={props.histogramLoading || false}
            error={props.histogramError}
            onRetry={props.onRetryHistogram}
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
            timedOutFacets={props.timedOutFacets}
            facetError={props.facetError}
            onRetryFacets={props.onRetryFacets}
            showCountsNotice={!listError}
            facetConfigs={props.facetConfigs || []}
            activeFilters={props.activeFilters}
            onIncludeFilter={(key: string, value: string) => {
              props.onFacetInclude?.(key, value);
            }}
            onExcludeFilter={props.onFacetExclude}
            onRemoveFilter={(key: string, value: string) => {
              props.onRemoveFilter?.(key, value);
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

          {listError && (
            <TelemetryLoadErrorMessage
              error={listError}
              subject="search"
              onRetry={props.onRetry || props.onRefresh}
            />
          )}

          {/*
           * Bulk Actions: one line over the rows. The page's box at its
           * start, level with the rows' boxes, and its words; once rows are
           * ticked, the rest of the line says how many, with a × to let go
           * of them, and offers Bulk Actions at its end (BulkUpdateForm's
           * Row) - the same menu, progress and result as a table's bar. A
           * list pages, so the page is all a selection holds: the page's
           * box is its Select All.
           */}
          {bulk && !listError && props.items.length > 0 ? (
            <div
              className={TELEMETRY_VIEWER_BULK_ROW_CLASS_NAME}
              data-testid="telemetry-viewer-bulk"
            >
              {/*
               * The box's words are its label, in the quiet type of the
               * list's own small print: a press on them ticks it too. Once
               * rows are ticked the count takes their place, and the box
               * keeps its name for a screen reader.
               */}
              <CheckboxElement
                dataTestId={TELEMETRY_VIEWER_SELECT_PAGE_TEST_ID}
                value={pageSelection === PageSelectionState.All}
                isIndeterminate={pageSelection === PageSelectionState.Some}
                ariaLabel={pageBoxWords}
                title={
                  shownSelection.length > 0 ? undefined : (
                    <span
                      className="cursor-pointer select-none text-xs font-normal text-gray-500"
                      data-testid={TELEMETRY_VIEWER_SELECT_PAGE_WORDS_TEST_ID}
                    >
                      {pageBoxWords}
                    </span>
                  )
                }
                outerDivClassName={
                  shownSelection.length > 0
                    ? "[&>div:last-child]:ml-0"
                    : undefined
                }
                onChange={(value: boolean) => {
                  setSelectedItems(value ? [...props.items] : []);
                }}
              />
              <BulkUpdateForm<T & GenericObject>
                layout={BulkUpdateBarLayout.Row}
                buttons={bulk.buttons}
                selectedItems={shownSelection as Array<T & GenericObject>}
                isAllItemsSelected={true}
                onSelectAllClick={() => {
                  setSelectedItems([...props.items]);
                }}
                singularLabel={bulk.singularLabel}
                pluralLabel={bulk.pluralLabel}
                onClearSelectionClick={() => {
                  setSelectedItems([]);
                }}
                onActionStart={() => {
                  setIsBulkActionRunning(true);
                }}
                onActionEnd={() => {
                  setIsBulkActionRunning(false);
                  setSelectedItems([]);
                  bulk.onActionEnd?.();
                }}
                itemToString={(item: T & GenericObject): string => {
                  return bulk.itemToString(item);
                }}
              />
            </div>
          ) : (
            <></>
          )}

          {!listError && (
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
                      {translateString(props.emptyMessage || "No results")}
                    </p>
                    <p className="text-xs text-gray-400">
                      {translateString("Try adjusting filters or time range.")}
                    </p>
                  </div>
                )
              ) : (
                <ul className="divide-y divide-gray-100">
                  {props.items.map((item: T, index: number) => {
                    if (!bulk) {
                      return (
                        <li key={props.getRowKey(item, index)}>
                          {props.renderRow(item, index)}
                        </li>
                      );
                    }

                    /*
                     * The row's box at its start, level with its first
                     * line; the row itself, as the list draws it, beside.
                     * A ticked row keeps a table's ticked row's wash.
                     */
                    const isSelected: boolean = isRowSelected(
                      shownSelection,
                      item,
                      bulk.getItemId,
                    );

                    return (
                      <li
                        key={props.getRowKey(item, index)}
                        className={`flex items-start${
                          isSelected ? ` ${TABLE_SELECTED_ROW_CLASS_NAME}` : ""
                        }`}
                        data-selected={isSelected ? "true" : "false"}
                      >
                        <div className={TELEMETRY_VIEWER_ROW_BOX_CLASS_NAME}>
                          <CheckboxElement
                            dataTestId={TELEMETRY_VIEWER_SELECT_ROW_TEST_ID}
                            value={isSelected}
                            ariaLabel={translateTemplate("Select {{name}}", {
                              name: bulk.itemToString(item),
                            })}
                            outerDivClassName="[&>div:last-child]:ml-0"
                            onChange={(value: boolean) => {
                              setSelectedItems(
                                (selected: Array<T>): Array<T> => {
                                  return setRowSelected(
                                    selected,
                                    item,
                                    value,
                                    bulk.getItemId,
                                  );
                                },
                              );
                            }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          {props.renderRow(item, index)}
                        </div>
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
           * it pages forward while more rows follow. Not under an error: there
           * are no rows to page through.
           */}
          {!listError && (
            <TelemetryPagination
              currentPage={props.page}
              totalItems={
                exactTotalCount === undefined
                  ? props.totalCount
                  : exactTotalCount
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
              pageSizeOptions={
                props.pageSizeOptions || DEFAULT_PAGE_SIZE_OPTIONS
              }
              onPageChange={props.onPageChange}
              onPageSizeChange={props.onPageSizeChange}
              isDisabled={props.isLoading}
              isLoading={props.isLoading && props.items.length === 0}
              itemLabel={props.itemLabel}
            />
          )}
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
