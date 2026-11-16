import { AggregationTemporality } from "../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import { AggregationIntervalUtil } from "../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import Timezone from "../../Types/Timezone";
import { INGEST_BACKLOG_ALLOWANCE_MS } from "../Telemetry/ReceivingGaps";

/*
 * WHEN A FORMULA READS A QUERY WITH NO POINT IN A STEP AS 0 (issue #6761).
 *
 * A formula joins its queries step by step, and a step that one of them has
 * no point in used to draw nothing at all. Where nothing is drawn, the reader
 * - and a monitor - cannot tell "nothing happened" from "nothing is known".
 * Which one it is depends on what the query reads:
 *
 *   - A query that COUNTS what happened - the Sum or the Count of a counter
 *     or a histogram - has no point in a step where nothing happened: an
 *     OpenTelemetry SDK sends no delta point for a set of attributes that saw
 *     nothing since its last export, and no running total for one that has
 *     not seen anything since its process started. Its count there is 0.
 *     The failure share `$b / $a * 100` over two such queries is 0% in a
 *     step with requests and no failure, not "no data".
 *   - Anything else with no point in a step is UNKNOWN, and stays a gap: a
 *     gauge that was not sampled is not a gauge at 0 (a host's memory, a
 *     pod's replicas), an average, a percentile, a highest or a lowest of
 *     nothing has no value, an up-down counter's running total is a level,
 *     and a metric whose kind OneUptime was not told (no temporality in its
 *     MetricType) is never guessed at.
 *
 * Three more rules keep a 0 from standing in for data that is late:
 *
 *   - Only a step that some other variable of the formula has a point in is
 *     read so. A step none of them has a point in is silent - the pipeline,
 *     or the whole service, was quiet - and draws nothing, as before.
 *   - Only a step that has ended, and has been over for the ingest queue's
 *     normal lag (INGEST_BACKLOG_ALLOWANCE_MS, a minute - the allowance the
 *     availability charts and the telemetry checks give the trailing edge),
 *     is read so. Its last points may still be on their way: a 0 there would
 *     read a step whose failures are still in the queue as one that had
 *     none, resolve the alert they keep open, and open it again a minute
 *     later.
 *   - A grouped formula reads it only within the groups it is evaluated for
 *     (MetricFormulaEvaluator): a counting query grouped by the same
 *     attributes counts 0 in a group it has no series for, and one grouped
 *     by other attributes is never matched to them.
 *
 * The same rule draws the explorer's charts, the dashboards' widgets (on a
 * public dashboard too) and the monitors' formulas, so a monitor made from a
 * chart reads what the chart draws. React-free and server-safe.
 */

// What the metric catalog (MetricType) says of the points a metric sends.
export interface MetricPointSemantics {
  isMonotonic?: boolean | null | undefined;
  aggregationTemporality?: AggregationTemporality | string | null | undefined;
}

// A metric type as the catalog lists it: its name and the above.
export interface MetricPointSemanticsSource extends MetricPointSemantics {
  name?: string | null | undefined;
}

// What MetricFormulaEvaluator.evaluateFormula needs to read a missing count as 0.
export interface MetricZeroFillOptions {
  // MetricPointSemantics by metric name, lowercased.
  semanticsByMetricName: ReadonlyMap<string, MetricPointSemantics>;
  /*
   * Whether a step, by its start, is over and its points are in. Unset:
   * every step is (a read of the past, or a test).
   */
  isStepSettled?: ((stepStart: Date) => boolean) | undefined;
}

// The aggregations that count: a step with nothing in it is 0 of them.
const COUNTING_AGGREGATIONS: ReadonlyArray<string> = [
  AggregationType.Sum,
  AggregationType.Count,
];

export default class MetricZeroFill {
  /*
   * How long after a step ends its last points may still be in OneUptime's
   * ingest queue.
   */
  public static readonly SETTLE_MS: number = INGEST_BACKLOG_ALLOWANCE_MS;

  /*
   * Whether a metric's points count what happened since the point before
   * (a delta counter or histogram), or since the process started (a
   * cumulative counter or histogram) - and so whether a set of attributes
   * that saw nothing sends no point. A cumulative up-down counter
   * (isMonotonic false) holds a level, a gauge has no temporality, and a
   * metric the catalog says nothing of is unknown: none of them counts.
   */
  public static countsWhatHappened(
    semantics: MetricPointSemantics | null | undefined,
  ): boolean {
    const temporality: string = String(semantics?.aggregationTemporality || "");

    if (temporality === AggregationTemporality.Delta) {
      return true;
    }

    if (temporality === AggregationTemporality.Cumulative) {
      return semantics?.isMonotonic !== false;
    }

    return false;
  }

  /*
   * Whether a query has no point in a step where nothing happened, so a
   * formula reads it as 0 there: it is read as a Sum or a Count, of a
   * metric that counts what happened.
   */
  public static isCountingQuery(input: {
    queryConfig: MetricQueryConfigData | null | undefined;
    semanticsByMetricName: ReadonlyMap<string, MetricPointSemantics>;
  }): boolean {
    const filterData:
      | MetricQueryConfigData["metricQueryData"]["filterData"]
      | undefined = input.queryConfig?.metricQueryData?.filterData;

    const aggregation: string = String(filterData?.aggegationType || "");

    if (!COUNTING_AGGREGATIONS.includes(aggregation)) {
      return false;
    }

    const metricName: string = String(filterData?.metricName || "")
      .trim()
      .toLowerCase();

    if (!metricName) {
      return false;
    }

    return MetricZeroFill.countsWhatHappened(
      input.semanticsByMetricName.get(metricName),
    );
  }

  // The catalog's semantics by lowercased metric name.
  public static getSemanticsByMetricName(
    metricTypes: ReadonlyArray<MetricPointSemanticsSource | null | undefined>,
  ): Map<string, MetricPointSemantics> {
    const semanticsByMetricName: Map<string, MetricPointSemantics> = new Map();

    for (const metricType of metricTypes) {
      const name: string = String(metricType?.name || "")
        .trim()
        .toLowerCase();

      if (!name || !metricType) {
        continue;
      }

      semanticsByMetricName.set(name, {
        isMonotonic:
          typeof metricType.isMonotonic === "boolean"
            ? metricType.isMonotonic
            : null,
        aggregationTemporality: metricType.aggregationTemporality || null,
      });
    }

    return semanticsByMetricName;
  }

  /*
   * Whether a step of a read over `window`, by its start, has ended - at
   * the read's end at the latest - and been over for SETTLE_MS by `readAt`.
   * Its end is its bucket's (AggregationIntervalUtil.getBucketEnd, in the
   * zone the read cut its days in); a read with no buckets (Total) is one
   * step, the whole window, stamped wherever its reader stamps it.
   */
  public static isStepSettled(input: {
    stepStart: Date;
    window: { startDate: Date; endDate: Date };
    aggregationInterval: AggregationInterval;
    timezone?: Timezone | undefined;
    readAt: Date;
  }): boolean {
    const windowEndMs: number = new Date(input.window.endDate).getTime();

    let stepEndMs: number = windowEndMs;

    if (input.aggregationInterval !== AggregationInterval.Total) {
      stepEndMs = Math.min(
        windowEndMs,
        AggregationIntervalUtil.getBucketEnd({
          bucketStart: input.stepStart,
          interval: input.aggregationInterval,
          timezone: input.timezone,
        }).getTime(),
      );
    }

    if (!Number.isFinite(stepEndMs)) {
      return false;
    }

    return (
      stepEndMs <= new Date(input.readAt).getTime() - MetricZeroFill.SETTLE_MS
    );
  }

  /*
   * The options a read over `window`, made at `readAt`, evaluates its
   * formulas with: the catalog's semantics of its metrics, and which of its
   * steps are settled. Its interval is the one the aggregate API cuts the
   * window into (AggregationIntervalUtil.getAggregationIntervalForWindow),
   * the one the read pinned, or none at all for a read of the whole window
   * as one value (`readsWholeWindow`, AggregationInterval.Total).
   */
  public static getOptions(input: {
    metricTypes: ReadonlyArray<MetricPointSemanticsSource | null | undefined>;
    window: { startDate: Date; endDate: Date };
    aggregationInterval?: AggregationInterval | undefined;
    readsWholeWindow?: boolean | undefined;
    timezone?: Timezone | undefined;
    readAt: Date;
  }): MetricZeroFillOptions {
    const window: { startDate: Date; endDate: Date } = {
      startDate: new Date(input.window.startDate),
      endDate: new Date(input.window.endDate),
    };

    let aggregationInterval: AggregationInterval = AggregationInterval.Minute;

    try {
      aggregationInterval =
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: window.startDate,
          endDate: window.endDate,
          aggregationInterval: input.readsWholeWindow
            ? AggregationInterval.Total
            : input.aggregationInterval,
        });
    } catch {
      /*
       * No window to read an interval from: no step has an end it can be
       * placed by, and isStepSettled says none is settled.
       */
    }

    return {
      semanticsByMetricName: MetricZeroFill.getSemanticsByMetricName(
        input.metricTypes,
      ),
      isStepSettled: (stepStart: Date): boolean => {
        return MetricZeroFill.isStepSettled({
          stepStart: stepStart,
          window: window,
          aggregationInterval: aggregationInterval,
          timezone: input.timezone,
          readAt: input.readAt,
        });
      },
    };
  }
}
