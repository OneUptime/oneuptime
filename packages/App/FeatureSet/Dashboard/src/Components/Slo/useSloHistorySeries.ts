import SloHistory from "Common/Models/AnalyticsModels/SloHistory";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import SloHistoryMetricName from "Common/Types/ServiceLevelObjective/SloHistoryMetricName";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { getSloChartAggregationInterval } from "Common/Utils/Slo/SloWidgetFormat";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";

export interface SloHistorySeriesRequest {
  projectId: ObjectID;
  sloId: ObjectID;
  metricName: SloHistoryMetricName;
  startDate: Date;
  endDate: Date;
  aggregationInterval: AggregationInterval;
}

/*
 * One SloHistory series, read through the `/aggregate` endpoint rather than
 * `getList`.
 *
 * The worker writes one row per series every evaluation (288 a day), and
 * `getList` does not paginate: a 90-day window capped at LIMIT_PER_PROJECT
 * returned only the OLDEST ~35 days while the x-axis still spanned 90, so
 * the line stopped a third of the way across and read as "history stopped".
 * Aggregating server-side bounds the response by the window, not the row
 * count, and its GROUP BY on the bucket also collapses the rare duplicate
 * row a ReplacingMergeTree can show before it merges.
 */
export type FetchSloHistorySeriesFunction = (
  request: SloHistorySeriesRequest,
) => Promise<Array<DataPoint>>;

export const fetchSloHistorySeries: FetchSloHistorySeriesFunction = async (
  request: SloHistorySeriesRequest,
): Promise<Array<DataPoint>> => {
  const result: AggregatedResult =
    await AnalyticsModelAPI.aggregate<SloHistory>({
      modelType: SloHistory,
      aggregateBy: {
        query: {
          projectId: request.projectId,
          sloId: request.sloId,
          metricName: request.metricName,
          bucketStart: new InBetween(request.startDate, request.endDate),
        },
        /*
         * SLI %, remaining budget % and burn rate are all instantaneous
         * gauges, so averaging the rows inside one bucket is the right
         * roll-up (a sum would scale with the evaluation cadence).
         */
        aggregationType: AggregationType.Avg,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "bucketStart",
        aggregationInterval: request.aggregationInterval,
        startTimestamp: request.startDate,
        endTimestamp: request.endDate,
        // Oldest first so the line draws left to right; the server defaults to DESC.
        sort: {
          bucketStart: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      },
    });

  const points: Array<DataPoint> = [];

  for (const row of result.data) {
    /*
     * `SloHistory.value` is a ClickHouse Decimal, which can arrive as a
     * string; coerce it, and drop anything that is not a real number rather
     * than plotting NaN at zero.
     */
    const value: number = Number(row.value);

    if (!row.timestamp || !isFinite(value)) {
      continue;
    }

    points.push({
      x: OneUptimeDate.fromString(row.timestamp),
      y: value,
    });
  }

  return points;
};

export interface UseSloHistorySeriesOptions {
  sloId: ObjectID;
  metricName: SloHistoryMetricName;
  /*
   * MUST be referentially stable between renders — keep it in state or a
   * useMemo. A relative range resolves against "now", so the window is
   * resolved inside a memo keyed on this object's identity; a new object on
   * every render would hand the fetch a new window every render, which is
   * an unbounded render/fetch loop.
   */
  timeRange: RangeStartAndEndDateTime;
  /*
   * Change it to slide a relative window forward and fetch again — e.g. the
   * SLO's lastEvaluatedAt, which changes exactly when new history can exist.
   */
  refreshToken?: string | number | undefined;
  // Holds the fetch while the caller cannot describe the window yet.
  isDisabled?: boolean | undefined;
}

export interface UseSloHistorySeriesResult {
  points: Array<DataPoint>;
  startDate: Date;
  endDate: Date;
  aggregationInterval: AggregationInterval;
  // True while a fetch is in flight, including a background refresh.
  isLoading: boolean;
  // True once this series has loaded at least once, so a refresh keeps the line on screen.
  hasLoaded: boolean;
  error: string;
  retry: () => void;
}

interface ResolvedWindow {
  startDate: Date;
  endDate: Date;
  aggregationInterval: AggregationInterval;
}

/*
 * The SloHistory read shared by the SLO overview's burn-down and any other
 * SLO chart: one memoised window, one Avg aggregate sorted oldest first, and
 * Decimal coercion — the pattern the Charts page established, lifted out so
 * a second copy cannot quietly drop one of those three details.
 *
 * The fetch effect is keyed on the SAME inputs as the window memo, never on
 * the resolved timestamps: re-applying a custom range (or retrying after an
 * error) resolves to identical timestamps and would otherwise silently skip
 * the reload and strand whatever error is on screen.
 */
const useSloHistorySeries: (
  options: UseSloHistorySeriesOptions,
) => UseSloHistorySeriesResult = (
  options: UseSloHistorySeriesOptions,
): UseSloHistorySeriesResult => {
  const sloIdString: string = options.sloId.toString();
  const seriesKey: string = `${sloIdString}:${options.metricName}`;
  const isDisabled: boolean = Boolean(options.isDisabled);

  const [retryTick, setRetryTick] = useState<number>(0);
  const [points, setPoints] = useState<Array<DataPoint>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(!isDisabled);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Which series the points on screen belong to.
  const loadedSeriesKeyRef: MutableRefObject<string> =
    useRef<string>(seriesKey);

  const resolvedWindow: ResolvedWindow = useMemo((): ResolvedWindow => {
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(options.timeRange);

    const startDate: Date = range.startValue as Date;
    const endDate: Date = range.endValue as Date;

    return {
      startDate: startDate,
      endDate: endDate,
      aggregationInterval: getSloChartAggregationInterval(
        (endDate.getTime() - startDate.getTime()) / (60 * 1000),
      ),
    };
  }, [options.timeRange, options.refreshToken, retryTick]);

  useEffect(() => {
    /*
     * A different SLO or series must not keep drawing the previous one's
     * line while its own loads.
     */
    if (loadedSeriesKeyRef.current !== seriesKey) {
      loadedSeriesKeyRef.current = seriesKey;
      setPoints([]);
      setHasLoaded(false);
    }

    if (isDisabled) {
      setIsLoading(false);
      return undefined;
    }

    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        setError("Select a project to see this SLO's history.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const newPoints: Array<DataPoint> = await fetchSloHistorySeries({
          projectId: projectId,
          sloId: options.sloId,
          metricName: options.metricName,
          startDate: resolvedWindow.startDate,
          endDate: resolvedWindow.endDate,
          aggregationInterval: resolvedWindow.aggregationInterval,
        });

        if (cancelled) {
          return;
        }

        setPoints(newPoints);
        setHasLoaded(true);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (!cancelled) {
        setIsLoading(false);
      }
    };

    load().catch((err: Error) => {
      if (!cancelled) {
        setError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    seriesKey,
    options.timeRange,
    options.refreshToken,
    retryTick,
    isDisabled,
  ]);

  return {
    points: points,
    startDate: resolvedWindow.startDate,
    endDate: resolvedWindow.endDate,
    aggregationInterval: resolvedWindow.aggregationInterval,
    isLoading: isLoading,
    hasLoaded: hasLoaded,
    error: error,
    retry: (): void => {
      setRetryTick((tick: number) => {
        return tick + 1;
      });
    },
  };
};

export default useSloHistorySeries;
