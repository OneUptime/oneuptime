import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import MetricView from "./MetricView";
import ExplorerLink from "./Utils/ExplorerLink";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
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
   * Frameless mode: no Card chrome — just the header controls row above
   * the charts (used inside pages that already provide a card).
   */
  hideCard?: boolean | undefined;
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
   * Chart drag-to-zoom: route the selected window through the same path
   * as the header picker, as a pinned Custom range — the picker then
   * shows "Custom" and the window narrows (or, in controlled modes, the
   * page is asked to narrow it).
   */
  const handleChartTimeRangeSelect: (startTime: Date, endTime: Date) => void =
    useCallback(
      (startTime: Date, endTime: Date): void => {
        handleTimeRangeChange({
          range: TimeRange.CUSTOM,
          startAndEndDate: new InBetween<Date>(startTime, endTime),
        });
      },
      [handleTimeRangeChange],
    );

  /*
   * Re-resolves a relative range ("Past 1 hour") to fresh dates, and
   * bumps the nonce so MetricView refetches (bypassing its result cache)
   * even when the resolved window is unchanged — a custom absolute range
   * resolves to the identical window, and without the nonce Refresh
   * would be a no-op there (including after a failed fetch, which would
   * otherwise have no retry path).
   */
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const handleRefresh: () => void = useCallback((): void => {
    setRefreshNonce((nonce: number) => {
      return nonce + 1;
    });
    if (props.startAndEndDate) {
      props.onTimeRangeChange?.(effectiveTimeRange);
      return;
    }
    setInternalDateRange(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(effectiveTimeRange),
    );
  }, [props.startAndEndDate, props.onTimeRangeChange, effectiveTimeRange]);

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
    <div className="flex items-center gap-2">
      {props.rightElement}
      <RangeStartAndEndDateView
        dashboardStartAndEndDate={effectiveTimeRange}
        onChange={handleTimeRangeChange}
      />
      <Tooltip text="Refresh">
        <button
          type="button"
          aria-label="Refresh"
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
            aria-label="Open in Metric Explorer"
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
    <div className="space-y-6">
      {props.children}
      {props.queryConfigs ? (
        <MetricView
          data={metricViewData}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={handleMetricViewChange}
          onTimeRangeSelect={handleChartTimeRangeSelect}
          refreshNonce={refreshNonce}
        />
      ) : null}
      {props.renderExtraCharts ? props.renderExtraCharts(dateRange) : null}
    </div>
  );

  if (props.hideCard) {
    return (
      <div>
        <div className="flex items-center justify-end mb-4">
          {headerControls}
        </div>
        {body}
      </div>
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

  return (
    <Card
      {...(truncatedTitle !== undefined ? { title: truncatedTitle } : {})}
      {...(props.description !== undefined
        ? { description: props.description }
        : {})}
      rightElement={headerControls}
    >
      {body}
    </Card>
  );
};

export default EmbeddedMetricCard;
