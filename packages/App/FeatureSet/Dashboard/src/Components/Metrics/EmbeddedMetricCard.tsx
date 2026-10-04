import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import MetricView from "./MetricView";
import {
  EmbeddedMetricCardGroupContextValue,
  useEmbeddedMetricCardGroup,
} from "./EmbeddedMetricCardGroupContext";
import { MetricResultsState } from "./Utils/MetricResultsState";
import ExplorerLink from "./Utils/ExplorerLink";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import useEventTimeReferenceLines, {
  EventTimeReferenceLines,
} from "./Utils/UseEventTimeReferenceLines";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import {
  ChartTimeRangeZoomContextValue,
  TimeRangeZoomProvider,
  isTimeRangeZoomFor,
  useChartTimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { EmbeddedMetricCardRefreshContext } from "./EmbeddedMetricCardRefresh";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * The one card shell for every embedded (read-only) metric chart in the
 * dashboard: Card chrome + time-range picker + refresh + "Open in
 * Explorer" around a query-hidden MetricView. Sites keep their own
 * query building and pass the configs in; this component owns the
 * resolved time window unless the page shares one across cards.
 *
 * Time-range modes:
 * - Uncontrolled (default): the card owns the picked range and the
 *   resolved window. `defaultTimeRange` seeds the picker.
 * - Controlled range (`timeRange` + `onTimeRangeChange`): the page owns
 *   the picked range (shared across sibling cards); the card still
 *   resolves its own concrete window from it.
 * - Controlled window (+ `startAndEndDate`): the page also owns the
 *   resolved window (e.g. it feeds sibling non-MetricView charts or an
 *   auto-refresh loop slides it). Refresh then asks the page to
 *   re-resolve via `onTimeRangeChange` instead of resolving locally.
 *
 * Drag-to-zoom (issue #4105): a drag on any chart in the card narrows the
 * card's range, and a double-click on any of them (or "Reset zoom" beside
 * the picker) puts the range it had before back.
 * - A card whose range the page controls, inside a page that zooms
 *   (TimeRangeZoomScope) over that same range, zooms the PAGE: every card
 *   and chart sharing the range follows, and a double-click on any of
 *   them resets it.
 * - Otherwise the card keeps the zoom itself, over its own range, and
 *   hands it to everything it renders — the extra charts included.
 *
 * Empty charts: cards whose charts share one reason for being empty (a
 * scrape that is off) go in an EmbeddedMetricCardGroup, which says why once,
 * in their place, when every card has loaded and found nothing.
 */
export interface ComponentProps {
  title?: string | ReactElement | undefined;
  description?: string | ReactElement | undefined;
  queryConfigs?: Array<MetricQueryConfigData> | undefined;
  formulaConfigs?: Array<MetricFormulaConfigData> | undefined;
  defaultTimeRange?: RangeStartAndEndDateTime | undefined;
  timeRange?: RangeStartAndEndDateTime | undefined;
  onTimeRangeChange?:
    | ((newTimeRange: RangeStartAndEndDateTime) => void)
    | undefined;
  startAndEndDate?: InBetween<Date> | undefined;
  /*
   * Custom chart content rendered above the MetricView (or alone when no
   * queryConfigs are given) — e.g. client-side rate charts that have no
   * MetricViewData representation.
   */
  children?: ReactElement | undefined;
  /*
   * Extra charts rendered below the MetricView, sharing this card's
   * resolved window (e.g. a delta-based network throughput chart).
   */
  renderExtraCharts?:
    | ((dateRange: InBetween<Date>) => ReactElement)
    | undefined;
  rightElement?: ReactElement | undefined;
  /*
   * Called when the reader presses the card's Refresh, after the card has
   * re-resolved its window. A page that loads data for the card itself
   * (its children, tiles or tables beside it) reloads here: a Custom
   * window, and every zoom is one, re-resolves to the same instants, so
   * nothing keyed on the window changes. Charts the card renders reload
   * through useEmbeddedMetricCardRefreshNonce instead.
   */
  onRefresh?: (() => void) | undefined;
  /*
   * Frameless mode: no Card chrome — just the header controls row above
   * the charts (used inside pages that already provide a card).
   */
  hideCard?: boolean | undefined;
  /*
   * Told what the card's query charts have to show each time that changes
   * (see MetricView's onResultsStateChange). Inside an
   * EmbeddedMetricCardGroup the card also tells the group, which explains
   * an empty group once instead of drawing every card's empty charts.
   */
  onResultsStateChange?: ((state: MetricResultsState) => void) | undefined;
}

/*
 * Semantic identity of a picked range, so a parent re-rendering with a
 * structurally-identical (but referentially-new) timeRange object does
 * not re-resolve the window — which would produce fresh dates every
 * render and put MetricView in a refetch loop.
 */
function getTimeRangeKey(timeRange: RangeStartAndEndDateTime): string {
  return [
    timeRange.range,
    timeRange.startAndEndDate
      ? OneUptimeDate.toString(timeRange.startAndEndDate.startValue)
      : "",
    timeRange.startAndEndDate
      ? OneUptimeDate.toString(timeRange.startAndEndDate.endValue)
      : "",
  ].join("|");
}

const headerIconButtonClassName: string =
  "flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer border bg-gray-50 border-gray-200/60 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const EmbeddedMetricCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isControlledTimeRange: boolean = props.timeRange !== undefined;

  const [internalTimeRange, setInternalTimeRange] =
    useState<RangeStartAndEndDateTime>(
      props.defaultTimeRange || { range: TimeRange.PAST_ONE_HOUR },
    );

  const effectiveTimeRange: RangeStartAndEndDateTime =
    props.timeRange || internalTimeRange;

  const [internalDateRange, setInternalDateRange] = useState<InBetween<Date>>(
    () => {
      return RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        effectiveTimeRange,
      );
    },
  );

  const timeRangeKey: string = getTimeRangeKey(effectiveTimeRange);
  const lastTimeRangeKeyRef: React.MutableRefObject<string> =
    useRef<string>(timeRangeKey);

  useEffect(() => {
    if (lastTimeRangeKeyRef.current === timeRangeKey) {
      return;
    }
    lastTimeRangeKeyRef.current = timeRangeKey;
    setInternalDateRange(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(effectiveTimeRange),
    );
  }, [timeRangeKey]);

  const dateRange: InBetween<Date> = props.startAndEndDate || internalDateRange;

  const [ownRefreshNonce, setRefreshNonce] = useState<number>(0);

  /*
   * A card inside an EmbeddedMetricCardGroup reloads when the group checks
   * again, as it does on its own Refresh.
   */
  const group: EmbeddedMetricCardGroupContextValue | null =
    useEmbeddedMetricCardGroup();
  const refreshNonce: number = ownRefreshNonce + (group?.refreshNonce || 0);

  /*
   * Incident/alert/change-event markers for the charted window — the
   * card is the shared surface behind monitor metrics tabs,
   * infrastructure resource tabs, and companion signal tabs, so one
   * insertion covers them all. Only the query charts draw them, so a card
   * without queries (custom charts only, or a note such as a setup hint)
   * does not fetch them.
   */
  const { lines: eventReferenceLines }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: props.queryConfigs !== undefined,
      window: dateRange,
      queryConfigs: props.queryConfigs,
      refreshTick: refreshNonce,
    });

  /*
   * What the card's query charts have to show, for the page and for the
   * group around the card. The group cannot see into charts the card draws
   * itself (children, extra charts), so a card with any counts as having
   * something to show: a group never hides it as empty.
   */
  const memberId: string = useId();
  const hasOwnCharts: boolean = Boolean(
    props.children || props.renderExtraCharts,
  );
  const latestOnResultsStateChange: React.MutableRefObject<
    ((state: MetricResultsState) => void) | undefined
  > = useRef<((state: MetricResultsState) => void) | undefined>(
    props.onResultsStateChange,
  );
  latestOnResultsStateChange.current = props.onResultsStateChange;
  const latestHasOwnCharts: React.MutableRefObject<boolean> =
    useRef<boolean>(hasOwnCharts);
  latestHasOwnCharts.current = hasOwnCharts;

  const reportToGroup:
    | ((memberId: string, state: MetricResultsState) => void)
    | undefined = group?.report;
  const removeFromGroup: ((memberId: string) => void) | undefined =
    group?.remove;

  const handleResultsStateChange: (state: MetricResultsState) => void =
    useCallback(
      (state: MetricResultsState): void => {
        latestOnResultsStateChange.current?.(state);
        reportToGroup?.(
          memberId,
          latestHasOwnCharts.current && state !== MetricResultsState.Loading
            ? MetricResultsState.HasData
            : state,
        );
      },
      [reportToGroup, memberId],
    );

  /*
   * A card of custom charts only has no query state to report, but the
   * group must not hide it with the rest: it counts as having data. A card
   * with nothing to chart (a note, such as the group's own empty state)
   * takes no part.
   */
  const hasQueries: boolean = props.queryConfigs !== undefined;
  useEffect(() => {
    if (!hasQueries && hasOwnCharts) {
      reportToGroup?.(memberId, MetricResultsState.HasData);
    }
  }, [reportToGroup, memberId, hasQueries, hasOwnCharts]);

  useEffect(() => {
    return () => {
      removeFromGroup?.(memberId);
    };
  }, [removeFromGroup, memberId]);

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback(
    (newTimeRange: RangeStartAndEndDateTime): void => {
      if (props.onTimeRangeChange) {
        props.onTimeRangeChange(newTimeRange);
      }
      if (!isControlledTimeRange) {
        setInternalTimeRange(newTimeRange);
      }
    },
    [props.onTimeRangeChange, isControlledTimeRange],
  );

  /*
   * Chart drag-to-zoom. The zoomed window goes through the same path as
   * the header picker, as a pinned Custom range — the picker then shows
   * "Custom" and the window narrows (or, in controlled modes, the page is
   * asked to narrow it). A page that zooms owns the gesture for a card
   * whose range it controls; see the component comment.
   */
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const ownZoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: effectiveTimeRange,
    onTimeRangeChange: handleTimeRangeChange,
  });
  /*
   * Only a zoom over the range this card is showing: a card in a drawer
   * or tab with a range of its own keeps its own zoom even when the page
   * around it zooms.
   */
  const followsPageZoom: boolean =
    isControlledTimeRange && isTimeRangeZoomFor(pageZoom, effectiveTimeRange);
  const onChartTimeRangeSelect: (startTime: Date, endTime: Date) => void =
    followsPageZoom && pageZoom
      ? pageZoom.onTimeRangeSelect
      : ownZoom.zoomToTimeRange;
  const onChartTimeRangeReset: (() => void) | undefined =
    followsPageZoom && pageZoom
      ? pageZoom.onTimeRangeReset
      : ownZoom.isZoomed
        ? ownZoom.resetZoom
        : undefined;

  /*
   * Re-resolves a relative range ("Past 1 hour") to fresh dates, and
   * bumps the nonce so MetricView refetches (bypassing its result cache)
   * even when the resolved window is unchanged — a custom absolute range
   * resolves to the identical window, and without the nonce Refresh
   * would be a no-op there (including after a failed fetch, which would
   * otherwise have no retry path).
   */
  const handleRefresh: () => void = useCallback((): void => {
    setRefreshNonce((nonce: number) => {
      return nonce + 1;
    });
    if (props.startAndEndDate) {
      props.onTimeRangeChange?.(effectiveTimeRange);
    } else {
      setInternalDateRange(
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(effectiveTimeRange),
      );
    }
    props.onRefresh?.();
  }, [
    props.startAndEndDate,
    props.onTimeRangeChange,
    props.onRefresh,
    effectiveTimeRange,
  ]);

  /*
   * MetricView writes query-config changes back through onChange — e.g.
   * the per-chart Top-N picker and server-side "Show all" persist onto
   * the configs and refetch. The card holds those writes locally so the
   * controls work on this read-only surface; fresh configs from the page
   * reset the override.
   */
  const [queryConfigsOverride, setQueryConfigsOverride] =
    useState<Array<MetricQueryConfigData> | null>(null);

  useEffect(() => {
    setQueryConfigsOverride(null);
  }, [props.queryConfigs]);

  const effectiveQueryConfigs: Array<MetricQueryConfigData> =
    queryConfigsOverride ?? props.queryConfigs ?? [];

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      startAndEndDate: dateRange,
      queryConfigs: effectiveQueryConfigs,
      formulaConfigs: props.formulaConfigs || [],
    };
  }, [dateRange, effectiveQueryConfigs, props.formulaConfigs]);

  const handleMetricViewChange: (data: MetricViewData) => void = useCallback(
    (data: MetricViewData): void => {
      setQueryConfigsOverride(data.queryConfigs);
    },
    [],
  );

  /*
   * The explorer link needs queries or formulas to open — children-only
   * cards (custom client-side charts) have nothing to serialize.
   */
  const hasExplorerTarget: boolean =
    (props.queryConfigs?.length || 0) > 0 ||
    (props.formulaConfigs?.length || 0) > 0;

  const handleOpenInExplorer: () => void = useCallback((): void => {
    ExplorerLink.openInExplorer({
      startAndEndDate: dateRange,
      queryConfigs: effectiveQueryConfigs,
      formulaConfigs: props.formulaConfigs || [],
    });
  }, [dateRange, effectiveQueryConfigs, props.formulaConfigs]);

  const headerControls: ReactElement = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {props.rightElement}
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={effectiveTimeRange}
        onChange={handleTimeRangeChange}
      />
      <ResetTimeRangeZoomButton forTimeRange={effectiveTimeRange} />
      <Tooltip text="Refresh">
        <button
          type="button"
          aria-label={translator.translateText("Refresh")}
          className={headerIconButtonClassName}
          onClick={handleRefresh}
        >
          <Icon icon={IconProp.Refresh} className="h-4 w-4 text-gray-500" />
        </button>
      </Tooltip>
      {hasExplorerTarget && (
        <Tooltip text="Open in Metric Explorer">
          <button
            type="button"
            aria-label={translator.translateText("Open in Metric Explorer")}
            className={headerIconButtonClassName}
            onClick={handleOpenInExplorer}
          >
            <Icon
              icon={IconProp.ExternalLink}
              className="h-4 w-4 text-gray-500"
            />
          </button>
        </Tooltip>
      )}
    </div>
  );

  const body: ReactElement = (
    <EmbeddedMetricCardRefreshContext.Provider value={refreshNonce}>
      <div className="space-y-6">
        {props.children}
        {props.queryConfigs ? (
          <MetricView
            data={metricViewData}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            hideCardInCharts={true}
            onChange={handleMetricViewChange}
            onTimeRangeSelect={onChartTimeRangeSelect}
            onTimeRangeReset={onChartTimeRangeReset}
            refreshNonce={refreshNonce}
            timeReferenceLines={
              eventReferenceLines.length > 0 ? eventReferenceLines : undefined
            }
            onResultsStateChange={handleResultsStateChange}
          />
        ) : null}
        {props.renderExtraCharts ? props.renderExtraCharts(dateRange) : null}
      </div>
    </EmbeddedMetricCardRefreshContext.Provider>
  );

  /*
   * The card's own zoom reaches everything it renders: the MetricView,
   * the children and extra charts (which zoom through the context), and
   * the header's "Reset zoom". Under a page's zoom there is nothing to
   * add; the page's context is already here.
   */
  type WithZoomFunction = (content: ReactElement) => ReactElement;
  const withZoom: WithZoomFunction = (content: ReactElement): ReactElement => {
    if (followsPageZoom) {
      return content;
    }
    return (
      <TimeRangeZoomProvider zoom={ownZoom}>{content}</TimeRangeZoomProvider>
    );
  };

  if (props.hideCard) {
    return withZoom(
      <div>
        <div className="flex items-center justify-end mb-4">
          {headerControls}
        </div>
        {body}
      </div>,
    );
  }

  /*
   * Long titles truncate instead of pushing the action row onto the next
   * line — Card gives the title column min-w-0, so a block/truncate
   * wrapper is all that's needed.
   */
  const truncatedTitle: ReactElement | undefined =
    props.title !== undefined ? (
      <span className="block truncate">{props.title}</span>
    ) : undefined;

  return withZoom(
    <Card
      {...(truncatedTitle !== undefined ? { title: truncatedTitle } : {})}
      {...(props.description !== undefined
        ? { description: props.description }
        : {})}
      rightElement={headerControls}
    >
      {body}
    </Card>,
  );
};

export default EmbeddedMetricCard;
