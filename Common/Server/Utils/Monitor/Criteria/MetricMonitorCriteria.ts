import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { JSONObject } from "../../../../Types/JSON";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MetricUnitUtil from "../../../../Utils/MetricUnitUtil";

export default class MetricMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
  }): Promise<string | null> {
    // Metric Monitoring Check

    if (
      input.criteriaFilter.metricMonitorOptions &&
      !input.criteriaFilter.metricMonitorOptions.metricAggregationType
    ) {
      input.criteriaFilter.metricMonitorOptions.metricAggregationType =
        EvaluateOverTimeType.AnyValue;
    }

    if (input.criteriaFilter.checkOn !== CheckOn.MetricValue) {
      return null;
    }

    const rawThreshold: number | null = CompareCriteria.convertToNumber(
      input.criteriaFilter.value,
    );

    const metricAlias: string =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || "";

    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;
    const metricAggregatedResult: Array<AggregatedResult> =
      metricResponse.metricResult || [];

    const queryConfigs: Array<MetricQueryConfigData> =
      input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs ||
      [];
    const formulaConfigs: Array<MetricFormulaConfigData> =
      input.monitorStep.data?.metricMonitor?.metricViewConfig?.formulaConfigs ||
      [];

    /*
     * Resolve which query/formula the alias refers to. Use explicit index
     * checks (not `findIndex() || -1`, which incorrectly falls back to -1
     * when the first element matches).
     */
    let matchedQuery: MetricQueryConfigData | null = null;
    let matchedFormula: MetricFormulaConfigData | null = null;
    let aliasIndex: number = -1;

    if (metricAlias) {
      const qIdx: number = queryConfigs.findIndex(
        (q: MetricQueryConfigData) => {
          return q.metricAliasData?.metricVariable === metricAlias;
        },
      );

      if (qIdx >= 0) {
        matchedQuery = queryConfigs[qIdx] || null;
        aliasIndex = qIdx;
      } else {
        const fIdx: number = formulaConfigs.findIndex(
          (f: MetricFormulaConfigData) => {
            return f.metricAliasData?.metricVariable === metricAlias;
          },
        );

        if (fIdx >= 0) {
          matchedFormula = formulaConfigs[fIdx] || null;
          aliasIndex = queryConfigs.length + fIdx;
        }
      }
    }

    /*
     * If no alias was configured or it didn't match anything, fall back to
     * the first aggregated result / query for a best-effort comparison.
     */
    const aggregatedResult: AggregatedResult | undefined =
      aliasIndex >= 0
        ? metricAggregatedResult[aliasIndex]
        : metricAggregatedResult[0];

    if (!matchedQuery && !matchedFormula && queryConfigs[0]) {
      matchedQuery = queryConfigs[0];
    }

    /*
     * Build the metric context regardless of whether the threshold breaches,
     * so the filter message can still reference the metric if needed.
     */
    const metricContext: MetricCriteriaContext =
      MetricMonitorCriteria.buildContext({
        matchedQuery,
        matchedFormula,
        metricAlias,
        criteriaFilter: input.criteriaFilter,
      });

    input.criteriaFilter.metricCriteriaContext = metricContext;

    if (rawThreshold === null) {
      return null;
    }

    /*
     * Determine the unit the user entered the threshold in (falls back to
     * the metric's native unit for backward-compatible rules). All sample
     * values and the threshold itself are normalized into this display
     * unit so both the comparison and every downstream message read in
     * the unit the user actually chose.
     */
    const nativeUnit: string | undefined = metricContext.unit || undefined;
    const thresholdUnit: string | undefined =
      input.criteriaFilter.metricMonitorOptions?.thresholdUnit || nativeUnit;

    const displayUnit: string | undefined = thresholdUnit;

    /*
     * Threshold is entered in thresholdUnit; keep the numeric value as-is
     * for comparison in that same unit.
     */
    const threshold: number = rawThreshold;

    const convertToDisplayUnit: (value: number) => number = (
      value: number,
    ): number => {
      if (!nativeUnit || !displayUnit || nativeUnit === displayUnit) {
        return value;
      }
      return MetricUnitUtil.convertToMetricUnit({
        value,
        fromUnit: nativeUnit,
        metricUnit: displayUnit,
      });
    };

    metricContext.unit = displayUnit || null;

    const samples: Array<AggregateModel> =
      (aggregatedResult && aggregatedResult.data) || [];

    /*
     * Respect the configured no-data policy. Without this guard, the
     * evaluator silently treats missing data as a value of 0 and can
     * trigger incidents for monitors that simply haven't received data.
     */
    if (samples.length === 0) {
      const policy: NoDataPolicy =
        input.criteriaFilter.metricMonitorOptions?.onNoDataPolicy ||
        NoDataPolicy.Ignore;

      if (policy === NoDataPolicy.Ignore) {
        return null;
      }

      if (policy === NoDataPolicy.Trigger) {
        return `No data received for ${metricContext.metricName} in the evaluation window — triggering per no-data policy.`;
      }

      // TreatAsZero: fall through to the comparator with value 0.
    }

    const numbersInDisplayUnit: Array<number> = samples.map(
      (d: AggregateModel) => {
        return convertToDisplayUnit(d.value);
      },
    );

    const comparisonMessage: string | null =
      CompareCriteria.compareCriteriaNumbers({
        value: numbersInDisplayUnit.length > 0 ? numbersInDisplayUnit : 0,
        threshold: threshold,
        criteriaFilter: input.criteriaFilter,
        metricDisplayName: metricContext.metricName,
        unit: displayUnit,
      });

    if (!comparisonMessage) {
      return null;
    }

    /*
     * Identify every sample that breached so the root cause can render a
     * timestamp/value table instead of a giant one-line list, and keep a
     * total count so we can say "N of M samples breached". Values are
     * stored in the display unit so they match the comparison message.
     */
    const breachingSamples: Array<{
      value: number;
      timestamp: Date;
      attributes: JSONObject;
    }> = [];

    for (const sample of samples) {
      const convertedValue: number = convertToDisplayUnit(sample.value);
      const breaches: boolean = MetricMonitorCriteria.sampleBreaches(
        convertedValue,
        threshold,
        input.criteriaFilter.filterType,
      );
      if (breaches) {
        breachingSamples.push({
          value: convertedValue,
          timestamp: sample.timestamp,
          attributes: MetricMonitorCriteria.extractLabelAttributes(sample),
        });
      }
    }

    metricContext.totalSamplesInWindow = samples.length;

    if (breachingSamples.length > 0) {
      metricContext.breachingSample = breachingSamples[0];
      metricContext.breachingSamples = breachingSamples;
    }

    return comparisonMessage;
  }

  private static sampleBreaches(
    value: number,
    threshold: number,
    filterType: FilterType | undefined,
  ): boolean {
    switch (filterType) {
      case FilterType.GreaterThan:
        return value > threshold;
      case FilterType.GreaterThanOrEqualTo:
        return value >= threshold;
      case FilterType.LessThan:
        return value < threshold;
      case FilterType.LessThanOrEqualTo:
        return value <= threshold;
      case FilterType.EqualTo:
        return value === threshold;
      case FilterType.NotEqualTo:
        return value !== threshold;
      default:
        return false;
    }
  }

  private static extractLabelAttributes(sample: AggregateModel): JSONObject {
    /*
     * AggregatedModel has a string index signature that holds group-by
     * attributes alongside `timestamp` and `value`. Strip the known keys
     * to get the label dictionary.
     */
    const labels: JSONObject = {};
    for (const key of Object.keys(sample)) {
      if (key === "timestamp" || key === "value") {
        continue;
      }
      const v: unknown = (sample as unknown as JSONObject)[key];
      if (v === undefined || v === null) {
        continue;
      }
      labels[key] = v as JSONObject[string];
    }
    return labels;
  }

  private static buildContext(input: {
    matchedQuery: MetricQueryConfigData | null;
    matchedFormula: MetricFormulaConfigData | null;
    metricAlias: string;
    criteriaFilter: CriteriaFilter;
  }): MetricCriteriaContext {
    const q: MetricQueryConfigData | null = input.matchedQuery;
    const f: MetricFormulaConfigData | null = input.matchedFormula;

    const metricName: string =
      (q?.metricQueryData?.filterData?.metricName as string | undefined) ||
      f?.metricFormulaData?.metricFormula ||
      q?.metricAliasData?.title ||
      f?.metricAliasData?.title ||
      "Metric";

    const unit: string | null =
      (q?.metricAliasData?.legendUnit as string | undefined) ||
      (f?.metricAliasData?.legendUnit as string | undefined) ||
      null;

    const aggregationType: MetricsAggregationType | null =
      (q?.metricQueryData?.filterData?.aggegationType as
        | MetricsAggregationType
        | undefined) || null;

    const filterAttributes: JSONObject =
      (q?.metricQueryData?.filterData?.attributes as JSONObject | undefined) ||
      {};

    const groupBy: Array<string> = q?.metricQueryData?.groupBy
      ? Object.keys(q.metricQueryData.groupBy as Record<string, unknown>)
      : [];

    return {
      metricName,
      alias: input.metricAlias,
      unit,
      aggregationType,
      isFormula: Boolean(f),
      formulaExpression: f?.metricFormulaData?.metricFormula,
      filterAttributes,
      groupBy,
      timeWindowMinutes:
        input.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes,
    };
  }
}
