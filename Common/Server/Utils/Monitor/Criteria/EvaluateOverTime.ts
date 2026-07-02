import Query from "../../../Types/AnalyticsDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../../Types/ObjectID";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import MonitorMetricTypeUtil from "../../../../Utils/Monitor/MonitorMetricType";
import MetricService from "../../../Services/MetricService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import CronTab from "../../CronTab";
import logger from "../../Logger";

interface OverTimeSample {
  value: number | boolean;
  time: Date;
}

/*
 * Outcome of resolving an evaluate-over-time filter:
 * - "compare": there is enough data; `value` should be compared to the threshold.
 * - "not-met": the filter does not fire. Either the configured NoDataPolicy says
 *   a data-less window does not fire, or (for windowed types) the window is not
 *   yet covered by enough observations to assert the condition. `reason` explains
 *   which, and is surfaced in the evaluation summary.
 * - "trigger": the configured NoDataPolicy says a data-less window is itself a breach.
 */
export type EvaluateOverTimeResult =
  | {
      decision: "compare";
      value: number | boolean | Array<number | boolean>;
    }
  | { decision: "not-met"; reason: string }
  | { decision: "trigger"; reason: string };

export default class EvaluateOverTime {
  /*
   * Resolve an evaluate-over-time filter into a decision, honoring the
   * configured NoDataPolicy. It refuses to report a match for windowed types
   * ("All Values" and the aggregates average/sum/min/max) unless the window is
   * actually covered by data — so a single fresh sample cannot satisfy `.every()`
   * or become an "average/max over N minutes" all by itself (see issue #2321) —
   * and it never falls back to the instantaneous probe value. "Any Value" is
   * exempt: one observed breach is a legitimate match regardless of coverage.
   */
  @CaptureSpan()
  public static async resolveFilterOverTime(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    evaluateOverTimeOptions: EvaluateOverTimeOptions;
    metricType: CheckOn;
    monitoringInterval?: string | undefined;
    miscData?: JSONObject | undefined;
  }): Promise<EvaluateOverTimeResult> {
    let samples: Array<OverTimeSample> = [];

    try {
      samples = await this.getSamples(data);
    } catch (err) {
      logger.error(`Error getting over-time samples for ${data.metricType}`);
      logger.error(err);

      // Treat an evaluation error as "no data" so we never fire on a failed query.
      return this.applyNoDataPolicy({
        evaluateOverTimeOptions: data.evaluateOverTimeOptions,
        reason: `No usable data for ${data.metricType} in the evaluation window (query failed).`,
      });
    }

    const evaluateOverTimeType: EvaluateOverTimeType | undefined =
      data.evaluateOverTimeOptions.evaluateOverTimeType;

    // No data at all in the window -> honor the configured NoDataPolicy.
    if (samples.length === 0) {
      return this.applyNoDataPolicy({
        evaluateOverTimeOptions: data.evaluateOverTimeOptions,
        reason: `No data was received for ${data.metricType} in the last ${data.evaluateOverTimeOptions.timeValueInMinutes} minutes.`,
      });
    }

    /*
     * Windowed types ("All Values" and the aggregates) claim something about the
     * ENTIRE window, which we can only assert when the window is actually covered
     * by observations. Otherwise a single fresh sample would make `.every()`
     * trivially true (or an average/max equal to that one spike) and the criteria
     * would fire on the first failed probe. "Any Value" is exempt — one observed
     * breach is a legitimate match.
     *
     * Unlike genuine no-data, "not enough history yet" is never itself a breach,
     * so it ALWAYS resolves to not-met regardless of NoDataPolicy: a warming-up
     * or just-restarted monitor must not trigger an incident just because its
     * window has not filled yet.
     */
    if (
      evaluateOverTimeType !== EvaluateOverTimeType.AnyValue &&
      !this.hasSufficientWindowCoverage({
        sampleTimes: samples.map((sample: OverTimeSample) => {
          return sample.time;
        }),
        timeValueInMinutes: Number(
          data.evaluateOverTimeOptions.timeValueInMinutes,
        ),
        monitoringInterval: data.monitoringInterval,
      })
    ) {
      return {
        decision: "not-met",
        reason: `Not enough data yet to evaluate ${data.metricType} across the full ${data.evaluateOverTimeOptions.timeValueInMinutes}-minute window.`,
      };
    }

    return {
      decision: "compare",
      value: this.computeValue({
        values: samples.map((sample: OverTimeSample) => {
          return sample.value;
        }),
        evaluateOverTimeType: evaluateOverTimeType,
      }),
    };
  }

  /*
   * True when the observed samples plausibly cover the whole evaluation window.
   * When the probe interval is known (from the monitor's cron) we require
   * roughly the expected number of samples; otherwise we fall back to requiring
   * at least two observations whose oldest reaches back to (almost) the start of
   * the window. Either way a single sample can never cover a multi-sample window.
   *
   * Public so it can be unit-tested directly without a database.
   */
  public static hasSufficientWindowCoverage(data: {
    sampleTimes: Array<Date>;
    timeValueInMinutes: number;
    monitoringInterval?: string | undefined;
  }): boolean {
    if (data.sampleTimes.length === 0) {
      return false;
    }

    if (!data.timeValueInMinutes || data.timeValueInMinutes <= 0) {
      // No meaningful window configured — any data counts.
      return true;
    }

    // Preferred: derive the expected sample count from the probe interval.
    if (data.monitoringInterval) {
      const intervalInMinutes: number | null = CronTab.getIntervalInMinutes(
        data.monitoringInterval,
      );

      if (intervalInMinutes && intervalInMinutes > 0) {
        const expectedSamples: number = Math.floor(
          data.timeValueInMinutes / intervalInMinutes,
        );
        /*
         * When two or more samples fit in the window we must observe at least
         * two — a single sample can never represent a sliding window (#2321).
         * For larger windows we still tolerate one missing sample for scheduling
         * jitter. When the interval is as coarse as the window (expected <= 1),
         * a single sample legitimately IS the whole window.
         */
        const requiredSamples: number =
          expectedSamples <= 1 ? 1 : Math.max(2, expectedSamples - 1);
        return data.sampleTimes.length >= requiredSamples;
      }
    }

    /*
     * Fallback (unknown/irregular interval): require at least two samples AND the
     * oldest one to reach back to (almost) the window start, so neither a single
     * recent sample nor a single stale sample counts as full coverage.
     */
    if (data.sampleTimes.length < 2) {
      return false;
    }

    const earliestSampleTime: Date | undefined = data.sampleTimes.reduce(
      (earliest: Date | undefined, current: Date) => {
        return !earliest || OneUptimeDate.isBefore(current, earliest)
          ? current
          : earliest;
      },
      undefined as Date | undefined,
    );

    if (!earliestSampleTime) {
      return false;
    }

    const requiredOldestSampleTime: Date = OneUptimeDate.getSomeMinutesAgo(
      Math.max(0, data.timeValueInMinutes - 1),
    );

    return !OneUptimeDate.isAfter(earliestSampleTime, requiredOldestSampleTime);
  }

  private static applyNoDataPolicy(data: {
    evaluateOverTimeOptions: EvaluateOverTimeOptions;
    reason: string;
  }): EvaluateOverTimeResult {
    const policy: NoDataPolicy =
      data.evaluateOverTimeOptions.onNoDataPolicy || NoDataPolicy.Ignore;

    if (policy === NoDataPolicy.Trigger) {
      return { decision: "trigger", reason: data.reason };
    }

    /*
     * Ignore (default) and TreatAsZero both resolve to "do not fire" here.
     * TreatAsZero is a counter-oriented policy with no meaningful
     * interpretation for boolean/status over-time checks, so we treat it as
     * Ignore rather than inventing a value.
     */
    return { decision: "not-met", reason: data.reason };
  }

  private static async getSamples(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    evaluateOverTimeOptions: EvaluateOverTimeOptions;
    metricType: CheckOn;
    miscData?: JSONObject | undefined;
  }): Promise<Array<OverTimeSample>> {
    // get values over time

    const lastMinutesDate: Date = OneUptimeDate.getSomeMinutesAgo(
      data.evaluateOverTimeOptions.timeValueInMinutes!,
    );

    // TODO: Query over miscData

    const now: Date = OneUptimeDate.getCurrentDate();

    const query: Query<Metric> = {
      projectId: data.projectId,
      time: new InBetween(lastMinutesDate, now),
      primaryEntityId: data.monitorId,
      name: MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(data.metricType),
    };

    if (data.miscData) {
      query.attributes = data.miscData;
    }

    const monitorMetricsItems: Array<Metric> = await MetricService.findBy({
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

    const samples: Array<OverTimeSample> = [];

    for (const item of monitorMetricsItems) {
      if (item.value === undefined) {
        continue;
      }

      const value: number | boolean =
        data.metricType === CheckOn.IsOnline ||
        data.metricType === CheckOn.IsRequestTimeout
          ? item.value === 1
          : item.value;

      samples.push({ value: value, time: item.time || now });
    }

    return samples;
  }

  private static computeValue(data: {
    values: Array<number | boolean>;
    evaluateOverTimeType: EvaluateOverTimeType | undefined;
  }): number | boolean | Array<number | boolean> {
    if (
      data.evaluateOverTimeType === EvaluateOverTimeType.AnyValue ||
      data.evaluateOverTimeType === EvaluateOverTimeType.AllValues
    ) {
      // For any/all, hand back the raw values; the comparator applies some/every.
      return data.values;
    }

    return this.getValueByEvaluationType({
      values: data.values as Array<number>,
      evaluateOverTimeType: data.evaluateOverTimeType!,
    });
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
