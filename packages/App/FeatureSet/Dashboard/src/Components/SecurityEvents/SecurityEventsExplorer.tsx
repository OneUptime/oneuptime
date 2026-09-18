import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import useHistogramZoom, {
  HistogramZoomState,
} from "Common/UI/Components/Charts/Utils/useHistogramZoom";
import Icon from "Common/UI/Components/Icon/Icon";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import SecurityEventsTable from "./SecurityEventsTable";
import SecurityEventsEmptyState from "./SecurityEventsEmptyState";
import SecurityEventsNoResults from "./SecurityEventsNoResults";
import SecurityEventsVolumeChart from "./SecurityEventsVolumeChart";
import {
  SecurityEventVolume,
  buildSecurityEventVolumeAggregateBy,
  buildSecurityEventVolumeFromResult,
  getSecurityEventVolumeZoomRange,
} from "./SecurityEventVolume";
import {
  getSecurityEventsTimeRangeParams,
  readSecurityEventsTimeRange,
} from "./SecurityEventsTimeRange";

export const SECURITY_EVENTS_REFRESH_TEST_ID: string =
  "security-events-refresh";

/*
 * What the project's newest event says about an empty table:
 *  - undefined: not asked yet, or the lookup failed
 *  - null:      the project has never received a security event
 *  - Date:      it has, and this is when the newest one arrived
 */
type LatestEventTime = Date | null | undefined;

/*
 * The window a query was built for. Read back off the query itself, so the
 * chart always buckets the window its counts came from even if the page has
 * moved on by the time they arrive.
 */
function getQueryWindow(
  query: Query<SecurityEvent>,
  fallback: InBetween<Date>,
): { startDate: Date; endDate: Date } {
  const time: unknown = (query as Record<string, unknown>)["time"];
  const range: InBetween<Date> =
    time instanceof InBetween ? (time as InBetween<Date>) : fallback;

  return {
    startDate: new Date(range.startValue),
    endDate: new Date(range.endValue),
  };
}

/*
 * Security Events: how many events arrived, when, and how severe - a volume
 * chart stacked by severity over the page's time window - above the events
 * themselves. The chart and the table share one query: the range picker sets
 * its window, the table's filters narrow it, and the table reports the result
 * back (onQueryChange) for the chart to count. So the chart never counts
 * events the table would not list, nor misses ones it would.
 */
const SecurityEventsExplorer: FunctionComponent = (): ReactElement => {
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return readSecurityEventsTimeRange(Navigation.getQueryString());
  });

  /*
   * A relative range ("Past 1 Day") is turned into dates once per pick, not
   * once per render: the dates are part of the table's query, and a query
   * that moved every render would refetch forever. Refresh re-reads it from
   * now by bumping windowVersion.
   */
  const [windowVersion, setWindowVersion] = useState<number>(0);

  /*
   * A custom window re-read from now is the same window, so the query does
   * not change and nothing would refetch. Refresh bumps this instead, which
   * the table and the chart both refetch on.
   */
  const [refreshVersion, setRefreshVersion] = useState<number>(0);

  const timeWindow: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
  }, [timeRange, windowVersion]);

  useEffect(() => {
    Navigation.setQueryString(getSecurityEventsTimeRangeParams(timeRange));
  }, [timeRange]);

  const tableQuery: Query<SecurityEvent> = useMemo(() => {
    return {
      projectId: projectId,
      time: new InBetween<Date>(timeWindow.startValue, timeWindow.endValue),
    };
  }, [projectId?.toString(), timeWindow]);

  // What the table last reported it is listing. null until it has mounted.
  const [volumeQuery, setVolumeQuery] = useState<Query<SecurityEvent> | null>(
    null,
  );
  const [volume, setVolume] = useState<SecurityEventVolume | null>(null);
  const [isVolumeLoading, setIsVolumeLoading] = useState<boolean>(true);
  const [volumeError, setVolumeError] = useState<string>("");

  /*
   * Counts for a window the page has since left must not land on the new one;
   * each fetch takes a ticket and only the newest may write.
   */
  const volumeRequestId: React.MutableRefObject<number> = useRef<number>(0);

  const fetchVolume: (query: Query<SecurityEvent>) => Promise<void> =
    useCallback(
      async (query: Query<SecurityEvent>): Promise<void> => {
        const requestId: number = ++volumeRequestId.current;
        const { startDate, endDate } = getQueryWindow(query, timeWindow);

        setIsVolumeLoading(true);
        setVolumeError("");

        try {
          const result: AggregatedResult =
            await AnalyticsModelAPI.aggregate<SecurityEvent>({
              modelType: SecurityEvent,
              aggregateBy: buildSecurityEventVolumeAggregateBy({
                query: query,
                startDate: startDate,
                endDate: endDate,
              }),
            });

          if (requestId !== volumeRequestId.current) {
            return;
          }

          setVolume(
            buildSecurityEventVolumeFromResult({
              result: result,
              startDate: startDate,
              endDate: endDate,
            }),
          );
        } catch (err) {
          if (requestId !== volumeRequestId.current) {
            return;
          }

          setVolumeError(API.getFriendlyMessage(err));
        }

        setIsVolumeLoading(false);
      },
      [timeWindow],
    );

  useEffect(() => {
    if (!volumeQuery) {
      return;
    }

    void fetchVolume(volumeQuery);
    // fetchVolume only reads timeWindow as a fallback; the query carries its own.
  }, [volumeQuery, refreshVersion]);

  const handleTableQueryChange: (query: Query<SecurityEvent>) => void =
    useCallback((query: Query<SecurityEvent>): void => {
      setVolumeQuery(query);
    }, []);

  /*
   * Only asked once the window turns out empty, to tell "nothing in this
   * window" apart from "nothing ever" - the two need different help. Every
   * recount (a refresh, a new window) passes through loading, so an empty
   * result asks again rather than trusting an answer from before it.
   */
  const [latestEventTime, setLatestEventTime] =
    useState<LatestEventTime>(undefined);
  const isWindowEmpty: boolean = Boolean(
    volume && volume.total === 0 && !isVolumeLoading && !volumeError,
  );

  useEffect(() => {
    if (!isWindowEmpty) {
      return undefined;
    }

    let isCancelled: boolean = false;

    AnalyticsModelAPI.getList<SecurityEvent>({
      modelType: SecurityEvent,
      query: { projectId: projectId },
      limit: 1,
      skip: 0,
      select: { time: true },
      sort: { time: SortOrder.Descending },
    })
      .then((result: ListResult<SecurityEvent>) => {
        if (isCancelled) {
          return;
        }

        const time: Date | undefined = result.data[0]?.time;
        setLatestEventTime(time ? new Date(time) : null);
      })
      .catch(() => {
        if (!isCancelled) {
          setLatestEventTime(undefined);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isWindowEmpty, projectId?.toString()]);

  const applyTimeRange: (nextTimeRange: RangeStartAndEndDateTime) => void =
    useCallback((nextTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(nextTimeRange);
    }, []);

  const handleHistogramTimeRangeSelect: (
    startDate: Date,
    endDate: Date,
  ) => void = useCallback(
    (startDate: Date, endDate: Date): void => {
      const zoomed: { startDate: Date; endDate: Date } =
        getSecurityEventVolumeZoomRange({
          startDate: startDate,
          endDate: endDate,
          intervalMs: volume?.intervalMs || 0,
          windowEndDate: new Date(timeWindow.endValue),
        });

      setTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(zoomed.startDate, zoomed.endDate),
      });
    },
    [volume?.intervalMs, timeWindow],
  );

  const histogramZoom: HistogramZoomState = useHistogramZoom({
    timeRange: timeRange,
    onTimeRangeSelect: handleHistogramTimeRangeSelect,
    onTimeRangeChange: applyTimeRange,
  });

  const refresh: () => void = (): void => {
    if (timeRange.range === TimeRange.CUSTOM) {
      setRefreshVersion((version: number) => {
        return version + 1;
      });
      return;
    }

    setWindowVersion((version: number) => {
      return version + 1;
    });
  };

  const noItemsMessage: ReactElement =
    latestEventTime === null ? (
      <SecurityEventsEmptyState />
    ) : (
      <SecurityEventsNoResults
        latestEventTime={latestEventTime}
        windowStartDate={new Date(timeWindow.startValue)}
        onShowTimeRange={histogramZoom.onTimeRangeChange || applyTimeRange}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <SecurityEventsVolumeChart
        volume={volume}
        isLoading={isVolumeLoading}
        error={volumeError}
        onRetry={() => {
          if (volumeQuery) {
            void fetchVolume(volumeQuery);
          }
        }}
        onTimeRangeSelect={histogramZoom.onTimeRangeSelect}
        onZoomOut={histogramZoom.onZoomOut}
        toolbar={
          <>
            <TelemetryTimeRangePicker
              value={timeRange}
              onChange={histogramZoom.onTimeRangeChange || applyTimeRange}
            />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
              onClick={refresh}
              title="Refresh"
              data-testid={SECURITY_EVENTS_REFRESH_TEST_ID}
            >
              <Icon icon={IconProp.Refresh} className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </>
        }
      />

      <SecurityEventsTable
        query={tableQuery}
        onQueryChange={handleTableQueryChange}
        refreshToggle={String(refreshVersion)}
        noItemsMessage={noItemsMessage}
      />
    </div>
  );
};

export default SecurityEventsExplorer;
