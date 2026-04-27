import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricCriteriaContext, {
  MetricComponent,
  MetricComponentValue,
} from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
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
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";

/**
 * Result of evaluating a single criteria filter against a single metric
 * series. `rootCause` is null when the filter did not match; otherwise
 * it's the human-readable comparison message. `context` always reflects
 * the metric identity for this series (used to render the metric
 * details + breaching samples section of the incident root cause).
 */
export interface MetricSeriesEvaluationResult {
  fingerprint: string | undefined;
  labels: JSONObject;
  rootCause: string | null;
  context: MetricCriteriaContext;
}

export default class MetricMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
  }): Promise<string | null> {
    const evaluations: Array<MetricSeriesEvaluationResult> =
      MetricMonitorCriteria.evaluateAllSeries(input);

    /*
     * Backwards-compat: the scalar entrypoint collapses per-series
     * evaluation down to the first matching series so existing callers
     * (single-incident path) keep working. The per-series code path uses
     * `evaluateAllSeries` directly.
     */
    const match: MetricSeriesEvaluationResult | undefined = evaluations.find(
      (e: MetricSeriesEvaluationResult) => {
        return e.rootCause !== null;
      },
    );

    /*
     * Always populate the legacy single-context field so the root-cause
     * renderer can still read metric identity from the criteria filter
     * even when nothing matched. Pick the first evaluation's context.
     */
    if (evaluations.length > 0) {
      input.criteriaFilter.metricCriteriaContext = (
        match || evaluations[0]!
      ).context;
    }

    return match ? match.rootCause : null;
  }

  /**
   * Evaluate a single criteria filter against every series produced by
   * the monitor. For monitors without group-by, this returns a single
   * evaluation covering all aggregated results (legacy behavior). For
   * monitors with group-by attributes set, it returns one evaluation
   * per unique series fingerprint — each with its own
   * `MetricCriteriaContext` carrying that series' breaching samples
   * and labels. The caller fans this out into one incident per
   * breaching series.
   */
  public static evaluateAllSeries(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
  }): Array<MetricSeriesEvaluationResult> {
    if (
      input.criteriaFilter.metricMonitorOptions &&
      !input.criteriaFilter.metricMonitorOptions.metricAggregationType
    ) {
      input.criteriaFilter.metricMonitorOptions.metricAggregationType =
        EvaluateOverTimeType.AnyValue;
    }

    if (input.criteriaFilter.checkOn !== CheckOn.MetricValue) {
      return [];
    }

    const metricResponse: MetricMonitorResponse =
      input.dataToProcess as MetricMonitorResponse;

    const seriesBreakdown: Array<MetricSeriesResult> | undefined =
      metricResponse.seriesBreakdown;

    const queryConfigs: Array<MetricQueryConfigData> =
      input.monitorStep.data?.metricMonitor?.metricViewConfig?.queryConfigs ||
      [];
    const formulaConfigs: Array<MetricFormulaConfigData> =
      input.monitorStep.data?.metricMonitor?.metricViewConfig?.formulaConfigs ||
      [];

    /*
     * Series-less path: one synthetic "all-series" evaluation over the
     * flat metricResult. Preserves the pre-group-by behavior exactly.
     */
    if (!seriesBreakdown || seriesBreakdown.length === 0) {
      const result: MetricSeriesEvaluationResult =
        MetricMonitorCriteria.evaluateOneSeries({
          criteriaFilter: input.criteriaFilter,
          aggregatedResults: metricResponse.metricResult || [],
          queryConfigs,
          formulaConfigs,
          seriesFingerprint: undefined,
          seriesLabels: {},
        });
      return [result];
    }

    return seriesBreakdown.map((series: MetricSeriesResult) => {
      return MetricMonitorCriteria.evaluateOneSeries({
        criteriaFilter: input.criteriaFilter,
        aggregatedResults: series.aggregatedResults,
        queryConfigs,
        formulaConfigs,
        seriesFingerprint: series.fingerprint,
        seriesLabels: series.labels,
      });
    });
  }

  /**
   * Core evaluation loop: compare the samples for one metric series
   * against the criteria threshold. Builds the metric identity context,
   * identifies breaching samples, and assembles the human-readable
   * root-cause message. Factored out so `evaluateAllSeries` can invoke
   * it once per series without duplicating logic.
   */
  private static evaluateOneSeries(input: {
    criteriaFilter: CriteriaFilter;
    aggregatedResults: Array<AggregatedResult>;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    seriesFingerprint: string | undefined;
    seriesLabels: JSONObject;
  }): MetricSeriesEvaluationResult {
    const rawThreshold: number | null = CompareCriteria.convertToNumber(
      input.criteriaFilter.value,
    );

    const metricAlias: string =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || "";

    const metricAggregatedResult: Array<AggregatedResult> =
      input.aggregatedResults;

    /*
     * Resolve which query/formula the alias refers to. Use explicit index
     * checks (not `findIndex() || -1`, which incorrectly falls back to -1
     * when the first element matches).
     */
    let matchedQuery: MetricQueryConfigData | null = null;
    let matchedFormula: MetricFormulaConfigData | null = null;
    let aliasIndex: number = -1;

    if (metricAlias) {
      const qIdx: number = input.queryConfigs.findIndex(
        (q: MetricQueryConfigData) => {
          return q.metricAliasData?.metricVariable === metricAlias;
        },
      );

      if (qIdx >= 0) {
        matchedQuery = input.queryConfigs[qIdx] || null;
        aliasIndex = qIdx;
      } else {
        const fIdx: number = input.formulaConfigs.findIndex(
          (f: MetricFormulaConfigData) => {
            return f.metricAliasData?.metricVariable === metricAlias;
          },
        );

        if (fIdx >= 0) {
          matchedFormula = input.formulaConfigs[fIdx] || null;
          aliasIndex = input.queryConfigs.length + fIdx;
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

    if (!matchedQuery && !matchedFormula && input.queryConfigs[0]) {
      matchedQuery = input.queryConfigs[0];
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
        queryConfigs: input.queryConfigs,
        formulaConfigs: input.formulaConfigs,
      });

    if (input.seriesFingerprint) {
      metricContext.seriesFingerprint = input.seriesFingerprint;
    }
    if (input.seriesLabels && Object.keys(input.seriesLabels).length > 0) {
      metricContext.seriesLabels = input.seriesLabels;
    }

    if (rawThreshold === null) {
      return {
        fingerprint: input.seriesFingerprint,
        labels: input.seriesLabels,
        rootCause: null,
        context: metricContext,
      };
    }

    /*
     * Sample values arrive already converted into the query's configured
     * display unit (legendUnit) — the upstream fetch step uses
     * MetricResultUnitConverter to normalize OpenTelemetry's native unit
     * into whatever the user picked. So `sampleUnit` here is that
     * legendUnit, and `thresholdUnit` is what the user typed into the
     * criteria threshold. When they differ we convert sample values from
     * legendUnit → thresholdUnit before comparing, so the alert message
     * reads in the unit the user actually chose for the threshold.
     */
    const sampleUnit: string | undefined = metricContext.unit || undefined;
    const thresholdUnit: string | undefined =
      input.criteriaFilter.metricMonitorOptions?.thresholdUnit || sampleUnit;

    const displayUnit: string | undefined = thresholdUnit;

    /*
     * Threshold is entered in thresholdUnit; keep the numeric value as-is
     * for comparison in that same unit.
     */
    const threshold: number = rawThreshold;

    const convertToDisplayUnit: (value: number) => number = (
      value: number,
    ): number => {
      if (!sampleUnit || !displayUnit || sampleUnit === displayUnit) {
        return value;
      }
      return MetricUnitUtil.convertToMetricUnit({
        value,
        fromUnit: sampleUnit,
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
        return {
          fingerprint: input.seriesFingerprint,
          labels: input.seriesLabels,
          rootCause: null,
          context: metricContext,
        };
      }

      if (policy === NoDataPolicy.Trigger) {
        return {
          fingerprint: input.seriesFingerprint,
          labels: input.seriesLabels,
          rootCause: `No data received for ${metricContext.metricName} in the evaluation window — triggering per no-data policy.`,
          context: metricContext,
        };
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
      return {
        fingerprint: input.seriesFingerprint,
        labels: input.seriesLabels,
        rootCause: null,
        context: metricContext,
      };
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
      componentValues?: Array<MetricComponentValue>;
    }> = [];

    /*
     * For formulas, precompute an index from ISO-timestamp → value for
     * every component series so we can show what `a` and `b` were at
     * the moment the formula breached, without re-walking the arrays
     * inside the per-sample loop.
     */
    const componentValueLookup: Map<string, Map<string, number>> | null =
      matchedFormula
        ? MetricMonitorCriteria.buildComponentValueLookup({
            components: metricContext.components || [],
            queryConfigs: input.queryConfigs,
            formulaConfigs: input.formulaConfigs,
            metricAggregatedResult,
          })
        : null;

    for (const sample of samples) {
      const convertedValue: number = convertToDisplayUnit(sample.value);
      const breaches: boolean = MetricMonitorCriteria.sampleBreaches(
        convertedValue,
        threshold,
        input.criteriaFilter.filterType,
      );
      if (breaches) {
        const entry: {
          value: number;
          timestamp: Date;
          attributes: JSONObject;
          componentValues?: Array<MetricComponentValue>;
        } = {
          value: convertedValue,
          timestamp: sample.timestamp,
          attributes: MetricMonitorCriteria.extractLabelAttributes(sample),
        };

        if (componentValueLookup && metricContext.components) {
          entry.componentValues = MetricMonitorCriteria.resolveComponentValues({
            timestamp: sample.timestamp,
            components: metricContext.components,
            lookup: componentValueLookup,
          });
        }

        breachingSamples.push(entry);
      }
    }

    metricContext.totalSamplesInWindow = samples.length;

    if (breachingSamples.length > 0) {
      metricContext.breachingSample = breachingSamples[0];
      metricContext.breachingSamples = breachingSamples;
    }

    return {
      fingerprint: input.seriesFingerprint,
      labels: input.seriesLabels,
      rootCause: comparisonMessage,
      context: metricContext,
    };
  }

  private static buildComponentValueLookup(input: {
    components: Array<MetricComponent>;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    metricAggregatedResult: Array<AggregatedResult>;
  }): Map<string, Map<string, number>> {
    // Map of alias -> (isoTimestamp -> value)
    const lookup: Map<string, Map<string, number>> = new Map();

    for (const component of input.components) {
      const queryIdx: number = input.queryConfigs.findIndex(
        (q: MetricQueryConfigData) => {
          return (
            (q.metricAliasData?.metricVariable || "").toLowerCase() ===
            component.alias
          );
        },
      );

      let resultIndex: number = -1;
      if (queryIdx >= 0) {
        resultIndex = queryIdx;
      } else {
        const formulaIdx: number = input.formulaConfigs.findIndex(
          (fc: MetricFormulaConfigData) => {
            return (
              (fc.metricAliasData?.metricVariable || "").toLowerCase() ===
              component.alias
            );
          },
        );
        if (formulaIdx >= 0) {
          resultIndex = input.queryConfigs.length + formulaIdx;
        }
      }

      if (resultIndex < 0) {
        continue;
      }

      const series: AggregatedResult | undefined =
        input.metricAggregatedResult[resultIndex];
      if (!series) {
        continue;
      }

      const timestampMap: Map<string, number> = new Map();
      for (const row of series.data) {
        const iso: string = MetricMonitorCriteria.toIsoTimestamp(row.timestamp);
        timestampMap.set(iso, row.value);
      }
      lookup.set(component.alias, timestampMap);
    }

    return lookup;
  }

  private static resolveComponentValues(input: {
    timestamp: Date | string;
    components: Array<MetricComponent>;
    lookup: Map<string, Map<string, number>>;
  }): Array<MetricComponentValue> {
    const iso: string = MetricMonitorCriteria.toIsoTimestamp(input.timestamp);
    return input.components.map((component: MetricComponent) => {
      const series: Map<string, number> | undefined = input.lookup.get(
        component.alias,
      );
      const value: number | undefined = series ? series.get(iso) : undefined;
      return {
        alias: component.alias,
        value: typeof value === "number" ? value : null,
      };
    });
  }

  private static toIsoTimestamp(value: Date | string): string {
    const date: Date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toISOString();
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
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
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

    /*
     * Include user-selected attribute keys as part of the groupBy view
     * so the root-cause block shows "Grouped By: host.name" not just the
     * raw columns ClickHouse was asked to partition on.
     */
    const groupByAttributeKeys: Array<string> =
      q?.metricQueryData?.groupByAttributeKeys || [];
    const allGroupBy: Array<string> = Array.from(
      new Set([...groupBy, ...groupByAttributeKeys]),
    );

    const components: Array<MetricComponent> | undefined = f
      ? MetricMonitorCriteria.buildFormulaComponents({
          formulaConfig: f,
          queryConfigs: input.queryConfigs,
          formulaConfigs: input.formulaConfigs,
        })
      : undefined;

    return {
      metricName,
      alias: input.metricAlias,
      unit,
      aggregationType,
      isFormula: Boolean(f),
      formulaExpression: f?.metricFormulaData?.metricFormula,
      filterAttributes,
      groupBy: allGroupBy,
      timeWindowMinutes:
        input.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes,
      ...(components && components.length > 0 ? { components } : {}),
    };
  }

  /**
   * Resolve the variables the formula references to their source
   * query/formula definitions so the root cause can label each
   * component column with its metric name and native unit.
   */
  private static buildFormulaComponents(input: {
    formulaConfig: MetricFormulaConfigData;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  }): Array<MetricComponent> {
    const formula: string =
      input.formulaConfig.metricFormulaData?.metricFormula || "";
    const referenced: Array<string> =
      MetricFormulaEvaluator.getReferencedVariables(formula);

    const components: Array<MetricComponent> = [];
    const seen: Set<string> = new Set<string>();

    for (const alias of referenced) {
      const normalizedAlias: string = alias.toLowerCase();
      if (seen.has(normalizedAlias)) {
        continue;
      }
      seen.add(normalizedAlias);

      const queryMatch: MetricQueryConfigData | undefined =
        input.queryConfigs.find((q: MetricQueryConfigData) => {
          return (
            (q.metricAliasData?.metricVariable || "").toLowerCase() ===
            normalizedAlias
          );
        });

      if (queryMatch) {
        const name: string =
          (queryMatch.metricQueryData?.filterData?.metricName as
            | string
            | undefined) ||
          queryMatch.metricAliasData?.title ||
          normalizedAlias;
        components.push({
          alias: normalizedAlias,
          name,
          unit: queryMatch.metricAliasData?.legendUnit || null,
          isFormula: false,
        });
        continue;
      }

      const formulaMatch: MetricFormulaConfigData | undefined =
        input.formulaConfigs.find((fc: MetricFormulaConfigData) => {
          return (
            (fc.metricAliasData?.metricVariable || "").toLowerCase() ===
            normalizedAlias
          );
        });

      if (formulaMatch) {
        const name: string =
          formulaMatch.metricAliasData?.title ||
          formulaMatch.metricFormulaData?.metricFormula ||
          normalizedAlias;
        components.push({
          alias: normalizedAlias,
          name,
          unit: formulaMatch.metricAliasData?.legendUnit || null,
          isFormula: true,
        });
      }
    }

    return components;
  }
}
