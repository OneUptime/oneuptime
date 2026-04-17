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
} from "../../../../Types/Monitor/CriteriaFilter";
import CaptureSpan from "../../Telemetry/CaptureSpan";

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

    const threshold: number | null = CompareCriteria.convertToNumber(
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

    // Resolve which query/formula the alias refers to. Use explicit index
    // checks (not `findIndex() || -1`, which incorrectly falls back to -1
    // when the first element matches).
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

    // If no alias was configured or it didn't match anything, fall back to
    // the first aggregated result / query for a best-effort comparison.
    const aggregatedResult: AggregatedResult | undefined =
      aliasIndex >= 0
        ? metricAggregatedResult[aliasIndex]
        : metricAggregatedResult[0];

    if (!matchedQuery && !matchedFormula && queryConfigs[0]) {
      matchedQuery = queryConfigs[0];
    }

    // Build the metric context regardless of whether the threshold breaches,
    // so the filter message can still reference the metric if needed.
    const metricContext: MetricCriteriaContext =
      MetricMonitorCriteria.buildContext({
        matchedQuery,
        matchedFormula,
        metricAlias,
        criteriaFilter: input.criteriaFilter,
      });

    input.criteriaFilter.metricCriteriaContext = metricContext;

    if (!aggregatedResult) {
      return null;
    }

    if (threshold === null) {
      return null;
    }

    const samples: Array<AggregateModel> = aggregatedResult.data || [];
    const numbers: Array<number> = samples.map((d: AggregateModel) => {
      return d.value;
    });

    const comparisonMessage: string | null =
      CompareCriteria.compareCriteriaNumbers({
        value: numbers.length > 0 ? numbers : 0,
        threshold: threshold,
        criteriaFilter: input.criteriaFilter,
        metricDisplayName: metricContext.metricName,
        unit: metricContext.unit || undefined,
      });

    if (!comparisonMessage) {
      return null;
    }

    // Identify which specific sample breached so we can surface its
    // attributes (pod/host/etc.) and timestamp in the root cause.
    const breaching: AggregateModel | undefined = samples.find(
      (s: AggregateModel) => {
        return MetricMonitorCriteria.sampleBreaches(
          s.value,
          threshold,
          input.criteriaFilter.filterType,
        );
      },
    );

    if (breaching) {
      metricContext.breachingSample = {
        value: breaching.value,
        timestamp: breaching.timestamp,
        attributes: MetricMonitorCriteria.extractLabelAttributes(breaching),
      };
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
    // AggregatedModel has a string index signature that holds group-by
    // attributes alongside `timestamp` and `value`. Strip the known keys
    // to get the label dictionary.
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
      ? Object.keys(q.metricQueryData.groupBy as object)
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
