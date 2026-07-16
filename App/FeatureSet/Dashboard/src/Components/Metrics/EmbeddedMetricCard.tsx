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
  "flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer border bg-gray-50 border-gray-200/60 hover:bg-gray-100";

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
   * Re-resolves a relative range ("Past 1 hour") to fresh dates — the new
   * end time changes MetricView's fetch snapshot, which triggers a
   * refetch. A custom absolute range resolves to the same window and is
   * a no-op by design.
   */
  const handleRefresh: () => void = useCallback((): void => {
    if (props.startAndEndDate) {
      props.onTimeRangeChange?.(effectiveTimeRange);
      return;
    }
    setInternalDateRange(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(effectiveTimeRange),
    );
  }, [props.startAndEndDate, props.onTimeRangeChange, effectiveTimeRange]);

  const metricViewData: MetricViewData = useMemo(() => {
    return {
      startAndEndDate: dateRange,
      queryConfigs: props.queryConfigs || [],
      formulaConfigs: props.formulaConfigs || [],
    };
  }, [dateRange, props.queryConfigs, props.formulaConfigs]);

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
      queryConfigs: props.queryConfigs || [],
      formulaConfigs: props.formulaConfigs || [],
    });
  }, [dateRange, props.queryConfigs, props.formulaConfigs]);

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
          <Icon icon={IconProp.Refresh} className="w-3.5 h-3.5 text-gray-500" />
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
              className="w-3.5 h-3.5 text-gray-500"
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
          onChange={() => {}}
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

  return (
    <Card
      {...(props.title !== undefined ? { title: props.title } : {})}
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
