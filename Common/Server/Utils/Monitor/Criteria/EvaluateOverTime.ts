import Query from "../../../Types/AnalyticsDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../../Types/ObjectID";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import MonitorMetricTypeUtil from "../../../../Utils/Monitor/MonitorMetricType";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import MetricService from "../../../Services/MetricService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import CronTab from "../../CronTab";
import logger from "../../Logger";

/**
 * Outcome of trying to turn an "evaluate over time" filter into a value the
 * comparators can act on.
 */
export enum OverTimeEvaluationStatus {
  /** The filter is not configured to evaluate over time at all. */
  NotConfigured = "NotConfigured",
  /**
   * No metric series backs this CheckOn, so there is nothing to look back
   * over. Callers keep their historical behaviour (compare the value that
   * arrived with this check) rather than silently never firing.
   */
  Unsupported = "Unsupported",
  /**
   * The window is usable and `value` holds every sample in it (for
   * All Values / Any Value) or the aggregate (for Average / Sum / Min / Max).
   */
  Evaluated = "Evaluated",
  /**
   * The window is empty, still filling up, or could not be read. The filter
   * cannot be judged yet — what happens next is up to the no-data policy.
   */
  InsufficientData = "InsufficientData",
}

export interface OverTimeEvaluation {
  status: OverTimeEvaluationStatus;
  value: Array<number | boolean> | number | boolean | undefined;
  /** Number of samples the window returned. */
  sampleCount: number;
  /** Why the window was judged insufficient. Null otherwise. */
  noDataReason: string | null;
  /**
   * True when InsufficientData was caused by the metric read failing rather
   * than by a genuinely empty or partial window. A read failure must never
   * be reported as a breach, whatever the no-data policy says.
   */
  isReadError: boolean;
}

/**
 * What the calling criteria evaluator should do with an over-time filter.
 *
 * `earlyReturn` set means the filter has already been decided and the
 * evaluator must return that result verbatim - crucially WITHOUT falling
 * back to the value that arrived with this single check. That fallback was
 * the reason "All values over the last 5 minutes" fired off one bad probe.
 */
export interface OverTimeCriteriaValue {
  earlyReturn: { result: string | null } | null;
  value: Array<number | boolean> | number | boolean | undefined;
}

export default class EvaluateOverTime {
  /**
   * Multiple of the monitor's polling interval that either end of the window
   * is allowed to sit away from the nearest sample before the window counts
   * as "not covered yet".
   *
   * One whole interval is the theoretical minimum (a window that starts
   * mid-cycle legitimately has its first sample up to one interval in). The
   * extra half absorbs scheduling jitter - and the lag between a sample
   * being written and being readable - so a monitor does not flip between
   * "covered" and "not covered" on adjacent checks.
   */
  private static readonly WINDOW_COVERAGE_TOLERANCE_FACTOR: number = 1.5;

  /**
   * Resolve an "evaluate over time" criteria filter into the value its
   * comparator should use, applying the filter's no-data policy.
   *
   * This is the single entry point every monitor-type criteria evaluator
   * uses. It exists so the "window has no usable data" decision is made in
   * exactly one place: previously each evaluator did
   * `overTimeValue || <value from this check>`, which quietly turned every
   * over-time filter into an instantaneous one whenever the window came back
   * empty.
   *
   * Deliberately not span-decorated: this runs for every criteria filter on
   * every check and the vast majority return at the guard below without
   * doing any work. evaluateOverTime, which issues the metric read, carries
   * the span instead.
   */
  public static async getOverTimeValueForCriteriaFilter(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    criteriaFilter: CriteriaFilter;
    miscData?: JSONObject | undefined;
    /** Monitor's monitoringInterval cron. Used to size the expected window. */
    monitoringInterval?: string | undefined;
  }): Promise<OverTimeCriteriaValue> {
    /*
     * Every criteria evaluator calls this for every filter, so the common
     * case - a filter that does not evaluate over time - returns before any
     * of the machinery below runs.
     */
    if (
      !data.criteriaFilter.evaluateOverTime ||
      !data.criteriaFilter.evaluateOverTimeOptions
    ) {
      return {
        earlyReturn: null,
        value: undefined,
      };
    }

    const evaluation: OverTimeEvaluation = await this.evaluateOverTime({
      projectId: data.projectId,
      monitorId: data.monitorId,
      criteriaFilter: data.criteriaFilter,
      miscData: data.miscData,
      monitoringInterval: data.monitoringInterval,
    });

    if (
      evaluation.status === OverTimeEvaluationStatus.NotConfigured ||
      evaluation.status === OverTimeEvaluationStatus.Unsupported
    ) {
      // Historical behaviour: the caller compares this check's own value.
      return {
        earlyReturn: null,
        value: undefined,
      };
    }

    if (evaluation.status === OverTimeEvaluationStatus.Evaluated) {
      return {
        earlyReturn: null,
        value: evaluation.value,
      };
    }

    // InsufficientData - the no-data policy decides.
    const policy: NoDataPolicy = evaluation.isReadError
      ? NoDataPolicy.Ignore
      : data.criteriaFilter.evaluateOverTimeOptions?.onNoDataPolicy ||
        NoDataPolicy.Ignore;

    if (policy === NoDataPolicy.Trigger) {
      return {
        earlyReturn: {
          result:
            `${data.criteriaFilter.checkOn} has no data over the last ${data.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes} minutes. ${evaluation.noDataReason || ""}`.trim(),
        },
        value: undefined,
      };
    }

    if (policy === NoDataPolicy.TreatAsZero) {
      /*
       * Zero for numeric series, and its boolean equivalent (false) for the
       * online/timeout series, which EvaluateOverTime already maps 1 -> true.
       */
      const isBooleanSeries: boolean =
        data.criteriaFilter.checkOn === CheckOn.IsOnline ||
        data.criteriaFilter.checkOn === CheckOn.IsRequestTimeout ||
        data.criteriaFilter.checkOn === CheckOn.DnsIsOnline ||
        data.criteriaFilter.checkOn === CheckOn.SnmpIsOnline ||
        data.criteriaFilter.checkOn === CheckOn.ExternalStatusPageIsOnline;

      return {
        earlyReturn: null,
        value: isBooleanSeries ? [false] : [0],
      };
    }

    // NoDataPolicy.Ignore - the filter simply does not fire yet.
    logger.debug(
      `Over time filter for ${data.criteriaFilter.checkOn} not evaluated: ${evaluation.noDataReason}`,
    );

    return {
      earlyReturn: { result: null },
      value: undefined,
    };
  }

  /**
   * Read the evaluation window and decide whether it can back the filter.
   */
  @CaptureSpan()
  public static async evaluateOverTime(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    criteriaFilter: CriteriaFilter;
    miscData?: JSONObject | undefined;
    monitoringInterval?: string | undefined;
  }): Promise<OverTimeEvaluation> {
    const evaluateOverTimeOptions: EvaluateOverTimeOptions | undefined =
      data.criteriaFilter.evaluateOverTimeOptions;

    if (!data.criteriaFilter.evaluateOverTime || !evaluateOverTimeOptions) {
      return {
        status: OverTimeEvaluationStatus.NotConfigured,
        value: undefined,
        sampleCount: 0,
        noDataReason: null,
        isReadError: false,
      };
    }

    const metricName: MonitorMetricType | null =
      MonitorMetricTypeUtil.getMonitorMetricTypeByCheckOnOrNull(
        data.criteriaFilter.checkOn,
      );

    if (!metricName) {
      /*
       * Nothing writes a series for this CheckOn, so there is no history to
       * look back over. Say so instead of throwing - the callers used to
       * swallow that throw and silently compare the instantaneous value.
       */
      return {
        status: OverTimeEvaluationStatus.Unsupported,
        value: undefined,
        sampleCount: 0,
        noDataReason: `${data.criteriaFilter.checkOn} is not recorded as a metric, so it cannot be evaluated over time.`,
        isReadError: false,
      };
    }

    /*
     * The dashboard persists the dropdown's string value while Terraform and
     * the API send a number, so coerce before doing arithmetic with it.
     */
    const windowInMinutes: number =
      Number(evaluateOverTimeOptions.timeValueInMinutes) || 0;

    if (windowInMinutes <= 0) {
      return {
        status: OverTimeEvaluationStatus.InsufficientData,
        value: undefined,
        sampleCount: 0,
        noDataReason: "No evaluation window configured.",
        isReadError: false,
      };
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.getSomeMinutesAgo(windowInMinutes);

    let metricItems: Array<Metric> = [];

    try {
      const query: Query<Metric> = {
        projectId: data.projectId,
        time: new InBetween(windowStart, now),
        primaryEntityId: data.monitorId,
        name: metricName,
      };

      if (data.miscData) {
        query.attributes = data.miscData;
      }

      metricItems = await MetricService.findBy({
        query: query,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          value: true,
          time: true,
        },
      });
    } catch (err) {
      logger.error(
        `Error in getting over time value for ${data.criteriaFilter.checkOn}`,
      );
      logger.error(err);

      return {
        status: OverTimeEvaluationStatus.InsufficientData,
        value: undefined,
        sampleCount: 0,
        noDataReason: "The metric store could not be read.",
        isReadError: true,
      };
    }

    const sampleTimes: Array<Date> = [];

    const values: Array<number | boolean> = [];

    for (const item of metricItems) {
      if (item.value === undefined || item.value === null) {
        continue;
      }

      if (
        data.criteriaFilter.checkOn === CheckOn.IsOnline ||
        data.criteriaFilter.checkOn === CheckOn.IsRequestTimeout ||
        data.criteriaFilter.checkOn === CheckOn.DnsIsOnline ||
        data.criteriaFilter.checkOn === CheckOn.SnmpIsOnline ||
        data.criteriaFilter.checkOn === CheckOn.ExternalStatusPageIsOnline
      ) {
        values.push(item.value === 1);
      } else {
        values.push(item.value);
      }

      if (item.time) {
        sampleTimes.push(OneUptimeDate.fromString(item.time));
      }
    }

    if (values.length === 0) {
      return {
        status: OverTimeEvaluationStatus.InsufficientData,
        value: undefined,
        sampleCount: 0,
        noDataReason: `No data was recorded for ${data.criteriaFilter.checkOn} in the last ${windowInMinutes} minutes.`,
        isReadError: false,
      };
    }

    /*
     * "All Values" is the only evaluation type that claims something about
     * the WHOLE window, so it is the only one that needs the whole window to
     * be there. Array.every() is trivially true on a single sample, which is
     * exactly how one bad probe used to satisfy
     * "all values over the last 5 minutes".
     *
     * "Any Value" fires on a single breaching sample by design, and the
     * aggregates (Average / Sum / Min / Max) are meaningful over a partial
     * window, so they are left alone.
     */
    if (
      evaluateOverTimeOptions.evaluateOverTimeType ===
      EvaluateOverTimeType.AllValues
    ) {
      const isCovered: boolean = this.isWindowCovered({
        windowStart: windowStart,
        windowEnd: now,
        sampleTimes: sampleTimes,
        monitoringInterval: data.monitoringInterval,
      });

      if (!isCovered) {
        return {
          status: OverTimeEvaluationStatus.InsufficientData,
          value: undefined,
          sampleCount: values.length,
          noDataReason: `Only ${values.length} data point(s) recorded so far - not enough to cover the last ${windowInMinutes} minutes.`,
          isReadError: false,
        };
      }
    }

    if (
      evaluateOverTimeOptions.evaluateOverTimeType ===
        EvaluateOverTimeType.AnyValue ||
      evaluateOverTimeOptions.evaluateOverTimeType ===
        EvaluateOverTimeType.AllValues
    ) {
      // if its any or all then return the values. Otherwise compute the value based on the type
      return {
        status: OverTimeEvaluationStatus.Evaluated,
        value: values,
        sampleCount: values.length,
        noDataReason: null,
        isReadError: false,
      };
    }

    return {
      status: OverTimeEvaluationStatus.Evaluated,
      value: this.getValueByEvaluationType({
        values: values as Array<number>,
        evaluateOverTimeType: evaluateOverTimeOptions.evaluateOverTimeType!,
      }),
      sampleCount: values.length,
      noDataReason: null,
      isReadError: false,
    };
  }

  /**
   * Whether the samples actually reach back to the start of the window.
   *
   * A monitor that has only been running for a minute has one sample in a
   * five minute window. That sample says nothing about the other four
   * minutes, so "all values over the last 5 minutes" must not be considered
   * satisfied by it.
   *
   * The check is expressed in time rather than in sample count so it is
   * immune to a probe skipping a beat, to several probes writing into the
   * same series, and to a sample landing a fraction of a second outside the
   * window.
   */
  private static isWindowCovered(data: {
    windowStart: Date;
    windowEnd: Date;
    sampleTimes: Array<Date>;
    monitoringInterval?: string | undefined;
  }): boolean {
    if (data.sampleTimes.length === 0) {
      return false;
    }

    const sortedTimes: Array<number> = data.sampleTimes
      .map((time: Date) => {
        return time.getTime();
      })
      .filter((time: number) => {
        return !isNaN(time);
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    if (sortedTimes.length === 0) {
      /*
       * Timestamps were unreadable. Fall back to requiring more than one
       * sample so a brand new monitor still cannot satisfy the window off a
       * single reading.
       */
      return data.sampleTimes.length > 1;
    }

    const intervalInSeconds: number | null = this.getSamplingIntervalInSeconds({
      monitoringInterval: data.monitoringInterval,
      sortedSampleTimes: sortedTimes,
    });

    if (intervalInSeconds === null) {
      /*
       * A single sample and no configured interval - there is no way to tell
       * whether the monitor is polled once an hour or once a second, so the
       * window cannot be called covered.
       */
      return false;
    }

    const oldestSampleMs: number = sortedTimes[0]!;
    const newestSampleMs: number = sortedTimes[sortedTimes.length - 1]!;

    const allowedGapMs: number =
      intervalInSeconds * 1000 * this.WINDOW_COVERAGE_TOLERANCE_FACTOR;

    const leadingGapMs: number = oldestSampleMs - data.windowStart.getTime();

    /*
     * The trailing edge matters as much as the leading one: samples that
     * stop part way through the window say nothing about the minutes since,
     * so "all values over the last N minutes" must not be satisfied by
     * stale data either.
     */
    const trailingGapMs: number = data.windowEnd.getTime() - newestSampleMs;

    return leadingGapMs <= allowedGapMs && trailingGapMs <= allowedGapMs;
  }

  /**
   * How far apart consecutive samples are expected to be, in seconds.
   *
   * The monitor's own schedule is authoritative when we have it. Otherwise
   * infer it from the data: the widest gap actually observed between
   * consecutive samples is the longest wait the window has demonstrated, so
   * it is the safest estimate of the cadence.
   */
  private static getSamplingIntervalInSeconds(data: {
    monitoringInterval?: string | undefined;
    sortedSampleTimes: Array<number>;
  }): number | null {
    const configuredIntervalInSeconds: number | null =
      CronTab.getIntervalInSeconds(data.monitoringInterval);

    if (configuredIntervalInSeconds !== null) {
      return configuredIntervalInSeconds;
    }

    if (data.sortedSampleTimes.length < 2) {
      return null;
    }

    let widestGapInSeconds: number = 0;

    for (let i: number = 1; i < data.sortedSampleTimes.length; i++) {
      const gapInSeconds: number =
        (data.sortedSampleTimes[i]! - data.sortedSampleTimes[i - 1]!) / 1000;

      if (gapInSeconds > widestGapInSeconds) {
        widestGapInSeconds = gapInSeconds;
      }
    }

    if (widestGapInSeconds <= 0) {
      return null;
    }

    return widestGapInSeconds;
  }

  private static getValueByEvaluationType(data: {
    values: Array<number>;
    evaluateOverTimeType: EvaluateOverTimeType;
  }): number {
    switch (data.evaluateOverTimeType) {
      case EvaluateOverTimeType.Average:
        return this.getAverage(data.values);
      case EvaluateOverTimeType.MaximumValue:
        return this.getMax(data.values);
      case EvaluateOverTimeType.MunimumValue:
        return this.getMin(data.values);
      case EvaluateOverTimeType.Sum:
        return this.getSum(data.values);
      default:
        return 0;
    }
  }

  private static getSum(values: number[]): number {
    // get sum of all values
    return values.reduce((a: number, b: number) => {
      return a + b;
    }, 0);
  }

  private static getMin(values: number[]): number {
    // get min value
    return Math.min(...values);
  }

  private static getMax(values: number[]): number {
    // get max value
    return Math.max(...values);
  }

  private static getAverage(values: number[]): number {
    // get average value
    return this.getSum(values) / values.length;
  }
}
