import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import MetricAliasData from "../../../../Types/Metrics/MetricAliasData";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricCriteriaContext, {
  MetricAnomalyBaseline,
  MetricComponent,
  MetricComponentValue,
  MetricWindowAggregate,
  MetricWindowAggregation,
  MetricWindowShortfall,
} from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import SeriesLabelDisplay from "../../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import { JSONObject } from "../../../../Types/JSON";
import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import MetricWindowCoverage, {
  MetricEvaluationWindow,
  MetricWindowCoverageResult,
} from "./MetricWindowCoverage";
import { WindowCoverageShortfall } from "./WindowCoverage";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MetricUnitUtil from "../../../../Utils/MetricUnitUtil";
import MetricValueFormatter from "../../../../Utils/Monitor/MetricValueFormatter";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricBaselineService, {
  BaselineSummary,
  MetricBaselineService as MetricBaselineServiceClass,
} from "../../../Services/MetricBaselineService";

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

/*
 * Whether the criteria being evaluated is already in effect for a series
 * (undefined: the whole monitor) - an alert or incident it opened for that
 * series is still open, or the monitor already has its status
 * (CriteriaInEffect). Such a series is judged on its data points alone, as
 * it always was; only a series the criteria has not acted on yet must wait
 * for its data to cover the window.
 */
export type IsCriteriaInEffect = (
  seriesFingerprint: string | undefined,
) => Promise<boolean>;

// The query or formula a criteria's metric alias names.
interface ResolvedMetricAlias {
  matchedQuery: MetricQueryConfigData | null;
  matchedFormula: MetricFormulaConfigData | null;
  /*
   * Where its results sit among a series' results - the queries', then the
   * formulas' - or -1 when the alias names neither (the first query's
   * results are read then).
   */
  aliasIndex: number;
}

export default class MetricMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
    isInEffect?: IsCriteriaInEffect | undefined;
  }): Promise<string | null> {
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries(input);

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
     * even when nothing matched. Pick the first evaluation's context -
     * or, when series are waiting for a full window, the one closest to
     * it, so the evaluation log can say why nothing fired yet.
     */
    if (evaluations.length > 0) {
      input.criteriaFilter.metricCriteriaContext = (
        match ||
        MetricMonitorCriteria.getClosestWaitingEvaluation(evaluations) ||
        evaluations[0]!
      ).context;
    }

    return match ? match.rootCause : null;
  }

  /*
   * The waiting series nearest to a full window, with its message saying
   * how many series wait. Undefined when none waits.
   */
  private static getClosestWaitingEvaluation(
    evaluations: Array<MetricSeriesEvaluationResult>,
  ): MetricSeriesEvaluationResult | undefined {
    const waiting: Array<MetricSeriesEvaluationResult> = evaluations.filter(
      (evaluation: MetricSeriesEvaluationResult) => {
        return Boolean(evaluation.context.windowWait);
      },
    );

    if (waiting.length === 0) {
      return undefined;
    }

    let closest: MetricSeriesEvaluationResult = waiting[0]!;

    for (const evaluation of waiting) {
      if (
        evaluation.context.windowWait!.coveredMs >
        closest.context.windowWait!.coveredMs
      ) {
        closest = evaluation;
      }
    }

    if (waiting.length > 1) {
      closest.context.windowWait = {
        ...closest.context.windowWait!,
        waitingSeriesCount: waiting.length,
        message: `${waiting.length} series are waiting for a full window of data. Closest: ${closest.context.windowWait!.message}`,
      };
    }

    return closest;
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
  public static async evaluateAllSeries(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    monitorStep: MonitorStep;
    /*
     * Absent: nothing is in effect, so every series that has not covered
     * the window waits.
     */
    isInEffect?: IsCriteriaInEffect | undefined;
  }): Promise<Array<MetricSeriesEvaluationResult>> {
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

    const metricViewConfig: MetricsViewConfig | undefined =
      MonitorStep.getMetricsViewConfig(input.monitorStep);

    const queryConfigs: Array<MetricQueryConfigData> =
      metricViewConfig?.queryConfigs || [];
    const formulaConfigs: Array<MetricFormulaConfigData> =
      metricViewConfig?.formulaConfigs || [];

    const nativeUnitsByMetricName: { [key: string]: string } | undefined =
      metricResponse.nativeUnitsByMetricName;

    // What "All Values" judges each series' data against.
    const window: MetricEvaluationWindow | null =
      MetricWindowCoverage.getWindow(metricResponse);

    const hasSeries: boolean = Boolean(
      seriesBreakdown && seriesBreakdown.length > 0,
    );

    /*
     * The data points this criteria compares - its query's or formula's -
     * in every series. Only "All Values" judges a window's coverage.
     */
    const comparedSamplesOfEverySeries: Array<Array<AggregateModel>> | null =
      window && MetricMonitorCriteria.isAllValues(input.criteriaFilter)
        ? MetricMonitorCriteria.getComparedSamplesOfEverySeries({
            criteriaFilter: input.criteriaFilter,
            queryConfigs,
            formulaConfigs,
            resultsOfEverySeries: hasSeries
              ? seriesBreakdown!.map((series: MetricSeriesResult) => {
                  return series.aggregatedResults;
                })
              : [metricResponse.metricResult || []],
          })
        : null;

    /*
     * How often the monitor's series report, across all of them: what a
     * series with too few data points to show its own cadence is judged by
     * (MetricWindowCoverage).
     */
    const monitorIntervalMs: number | null | undefined =
      comparedSamplesOfEverySeries
        ? MetricWindowCoverage.getMonitorIntervalMs(
            comparedSamplesOfEverySeries,
          )
        : undefined;

    /*
     * As far as the monitor's data reaches, for a monitor whose data may
     * all arrive late (judgesFreshnessByNewestData): a series is then stale
     * only when its data stopped well before the others' did.
     */
    const monitorNewestDataPointMs: number | null | undefined =
      comparedSamplesOfEverySeries &&
      MetricMonitorCriteria.judgesFreshnessByNewestData(input.monitorStep)
        ? MetricWindowCoverage.getNewestDataPointMs(
            comparedSamplesOfEverySeries,
          )
        : undefined;

    /*
     * Series-less path: one synthetic "all-series" evaluation over the
     * flat metricResult. Preserves the pre-group-by behavior exactly.
     */
    if (!hasSeries) {
      const result: MetricSeriesEvaluationResult =
        await MetricMonitorCriteria.evaluateOneSeries({
          criteriaFilter: input.criteriaFilter,
          aggregatedResults: metricResponse.metricResult || [],
          queryConfigs,
          formulaConfigs,
          seriesFingerprint: undefined,
          seriesLabels: {},
          projectId: metricResponse.projectId,
          nativeUnitsByMetricName,
          window,
          monitorIntervalMs,
          monitorNewestDataPointMs,
          isInEffect: input.isInEffect,
        });
      return [result];
    }

    return await Promise.all(
      seriesBreakdown!.map((series: MetricSeriesResult) => {
        return MetricMonitorCriteria.evaluateOneSeries({
          criteriaFilter: input.criteriaFilter,
          aggregatedResults: series.aggregatedResults,
          queryConfigs,
          formulaConfigs,
          seriesFingerprint: series.fingerprint,
          seriesLabels: series.labels,
          projectId: metricResponse.projectId,
          nativeUnitsByMetricName,
          window,
          monitorIntervalMs,
          monitorNewestDataPointMs,
          isInEffect: input.isInEffect,
        });
      }),
    );
  }

  /*
   * The query or formula a criteria's metric alias names. Explicit index
   * checks - not `findIndex() || -1`, which falls back to -1 when the first
   * one matches.
   */
  private static resolveAlias(input: {
    metricAlias: string;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  }): ResolvedMetricAlias {
    if (!input.metricAlias) {
      return { matchedQuery: null, matchedFormula: null, aliasIndex: -1 };
    }

    const queryIndex: number = input.queryConfigs.findIndex(
      (query: MetricQueryConfigData) => {
        return query.metricAliasData?.metricVariable === input.metricAlias;
      },
    );

    if (queryIndex >= 0) {
      return {
        matchedQuery: input.queryConfigs[queryIndex] || null,
        matchedFormula: null,
        aliasIndex: queryIndex,
      };
    }

    const formulaIndex: number = input.formulaConfigs.findIndex(
      (formula: MetricFormulaConfigData) => {
        return formula.metricAliasData?.metricVariable === input.metricAlias;
      },
    );

    if (formulaIndex >= 0) {
      return {
        matchedQuery: null,
        matchedFormula: input.formulaConfigs[formulaIndex] || null,
        aliasIndex: input.queryConfigs.length + formulaIndex,
      };
    }

    return { matchedQuery: null, matchedFormula: null, aliasIndex: -1 };
  }

  /*
   * The data points a criteria compares, in every series: its alias's
   * results in each - or the first query's, when it names none.
   */
  private static getComparedSamplesOfEverySeries(input: {
    criteriaFilter: CriteriaFilter;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    resultsOfEverySeries: Array<Array<AggregatedResult>>;
  }): Array<Array<AggregateModel>> {
    const aliasIndex: number = MetricMonitorCriteria.resolveAlias({
      metricAlias: input.criteriaFilter.metricMonitorOptions?.metricAlias || "",
      queryConfigs: input.queryConfigs,
      formulaConfigs: input.formulaConfigs,
    }).aliasIndex;

    return input.resultsOfEverySeries.map(
      (results: Array<AggregatedResult>) => {
        return results[aliasIndex >= 0 ? aliasIndex : 0]?.data || [];
      },
    );
  }

  /*
   * The evaluation type the window is judged with - the same precedence
   * CompareCriteria compares with.
   */
  /*
   * Has No Data (Is Empty) and Has Data (Is Not Empty) on a metric: they
   * ask whether the window holds any data, not how large it is.
   */
  public static isDataPresenceFilter(
    filterType: FilterType | undefined,
  ): boolean {
    return (
      filterType === FilterType.IsEmpty || filterType === FilterType.IsNotEmpty
    );
  }

  private static isAllValues(criteriaFilter: CriteriaFilter): boolean {
    return (
      (criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
        criteriaFilter.metricMonitorOptions?.metricAggregationType) ===
      EvaluateOverTimeType.AllValues
    );
  }

  /*
   * Whether a series' newest data point must be close to the monitor's
   * newest data point, rather than to now, to count as fresh.
   *
   * A Metrics monitor reads any metric, and some sources deliver theirs
   * minutes late by design: CloudWatch's polling receiver stamps each point
   * with its period's start and reads periods 10 minutes old, so its newest
   * point is 11 to 17 minutes old; Cloud Monitoring's arrives up to 9
   * minutes late (MessageQueueAlertTemplates, WINDOWS AND LATE SOURCES).
   * Measured against now, every series of such a monitor would look as if
   * it had stopped, and "All Values" would never match again. Measured
   * against the monitor's own newest data, a series that stopped while the
   * others kept reporting still waits.
   *
   * The infrastructure monitors (Kubernetes, Docker, Host and the rest)
   * read OneUptime's own collectors, which send what they read as they read
   * it. There a series whose data stopped coming has stopped - even every
   * series at once, when the agent went away - so they are measured
   * against now.
   */
  private static judgesFreshnessByNewestData(
    monitorStep: MonitorStep,
  ): boolean {
    return Boolean(monitorStep.data?.metricMonitor);
  }

  private static async isCriteriaInEffectFor(data: {
    isInEffect: IsCriteriaInEffect | undefined;
    seriesFingerprint: string | undefined;
  }): Promise<boolean> {
    if (!data.isInEffect) {
      return false;
    }

    return await data.isInEffect(data.seriesFingerprint);
  }

  /*
   * Why a series must wait, or null when it need not: its data covers the
   * window, or none of its data points carries a time to judge by (it is
   * then judged on its values, as before).
   */
  private static toWindowShortfall(
    shortfall: WindowCoverageShortfall | null,
  ): MetricWindowShortfall | null {
    switch (shortfall) {
      case WindowCoverageShortfall.StartsLate:
        return "StartsLate";
      case WindowCoverageShortfall.Hole:
        return "Hole";
      case WindowCoverageShortfall.Stale:
        return "Stale";
      default:
        return null;
    }
  }

  /*
   * "Namespace: payments | Deployment: api - " before a grouped series'
   * message, so the evaluation log says which series it is about. Empty for
   * an ungrouped monitor.
   */
  private static getSeriesPrefix(seriesLabels: JSONObject): string {
    const summary: string = SeriesLabelDisplay.buildInlineSummary(seriesLabels);

    return summary ? `${summary} - ` : "";
  }

  /**
   * Core evaluation loop: compare the samples for one metric series
   * against the criteria threshold. Builds the metric identity context,
   * identifies breaching samples, and assembles the human-readable
   * root-cause message. Factored out so `evaluateAllSeries` can invoke
   * it once per series without duplicating logic.
   */
  private static async evaluateOneSeries(input: {
    criteriaFilter: CriteriaFilter;
    aggregatedResults: Array<AggregatedResult>;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    seriesFingerprint: string | undefined;
    seriesLabels: JSONObject;
    projectId: { toString(): string } | undefined;
    nativeUnitsByMetricName?: { [key: string]: string } | undefined;
    // Null when the response does not say what window it read.
    window?: MetricEvaluationWindow | null | undefined;
    /*
     * How often the monitor's series report, for a series with too few data
     * points to show its own cadence (MetricWindowCoverage
     * .getMonitorIntervalMs); null when none shows one.
     */
    monitorIntervalMs?: number | null | undefined;
    /*
     * The newest data point of any of the monitor's series, when a series'
     * freshness is measured against it (judgesFreshnessByNewestData).
     */
    monitorNewestDataPointMs?: number | null | undefined;
    isInEffect?: IsCriteriaInEffect | undefined;
  }): Promise<MetricSeriesEvaluationResult> {
    const rawThreshold: number | null =
      CompareCriteria.convertMetricThresholdToNumber(
        input.criteriaFilter.value,
      );

    const metricAlias: string =
      input.criteriaFilter.metricMonitorOptions?.metricAlias || "";

    const metricAggregatedResult: Array<AggregatedResult> =
      input.aggregatedResults;

    // Resolve which query/formula the alias refers to.
    const resolvedAlias: ResolvedMetricAlias =
      MetricMonitorCriteria.resolveAlias({
        metricAlias,
        queryConfigs: input.queryConfigs,
        formulaConfigs: input.formulaConfigs,
      });

    let matchedQuery: MetricQueryConfigData | null = resolvedAlias.matchedQuery;
    const matchedFormula: MetricFormulaConfigData | null =
      resolvedAlias.matchedFormula;
    const aliasIndex: number = resolvedAlias.aliasIndex;

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
        nativeUnitsByMetricName: input.nativeUnitsByMetricName,
      });

    if (input.seriesFingerprint) {
      metricContext.seriesFingerprint = input.seriesFingerprint;
    }
    if (input.seriesLabels && Object.keys(input.seriesLabels).length > 0) {
      metricContext.seriesLabels = input.seriesLabels;
    }

    /*
     * Anomaly-detection branch. Skips the static threshold path entirely
     * and instead compares each sample to the rolling baseline for its
     * hour-of-week. Returns Learning state (no breach) when the baseline
     * is missing or unreliable — never raises an alert from a thin
     * baseline.
     */
    if (
      CriteriaFilterUtil.isAnomalyFilterType(input.criteriaFilter.filterType)
    ) {
      return await MetricMonitorCriteria.evaluateAnomaly({
        criteriaFilter: input.criteriaFilter,
        metricContext,
        aggregatedResult,
        seriesFingerprint: input.seriesFingerprint,
        seriesLabels: input.seriesLabels,
        projectId: input.projectId,
        nativeUnitsByMetricName: input.nativeUnitsByMetricName,
      });
    }

    /*
     * Has No Data / Has Data: whether the query sent anything in the
     * window at all - no threshold, no unit. An infrastructure monitor's
     * out-of-the-box criteria are these two (offline while its agent sends
     * nothing, online while it sends), so a value of 0 - no restarts, an
     * idle CPU - is data, and never reads as "offline".
     */
    if (
      MetricMonitorCriteria.isDataPresenceFilter(
        input.criteriaFilter.filterType,
      )
    ) {
      const sampleCount: number = (aggregatedResult?.data || []).length;
      const isMet: boolean =
        input.criteriaFilter.filterType === FilterType.IsEmpty
          ? sampleCount === 0
          : sampleCount > 0;

      metricContext.totalSamplesInWindow = sampleCount;

      let rootCause: string | null = null;

      if (isMet) {
        rootCause =
          sampleCount === 0
            ? `${MetricMonitorCriteria.getSeriesPrefix(input.seriesLabels)}No data received for ${metricContext.metricName} in the evaluation window.`
            : `${MetricMonitorCriteria.getSeriesPrefix(input.seriesLabels)}${metricContext.metricName} sent ${sampleCount} ${sampleCount === 1 ? "value" : "values"} in the evaluation window.`;
      }

      return {
        fingerprint: input.seriesFingerprint,
        labels: input.seriesLabels,
        rootCause: rootCause,
        context: metricContext,
      };
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

    const finiteNumbers: Array<number> = numbersInDisplayUnit.filter(
      (n: number) => {
        return Number.isFinite(n);
      },
    );

    if (finiteNumbers.length > 0) {
      metricContext.sampleValueRange = {
        min: Math.min(...finiteNumbers),
        max: Math.max(...finiteNumbers),
      };
    }

    /*
     * A criteria that judges the window as ONE value - its Average, Sum,
     * Maximum or Minimum - compares that value with the threshold, never a
     * sample. Keep it, taken exactly as the comparison below takes it, so
     * what a reader is shown for this series is what was judged: the
     * restarts summed over 15 minutes, not the worst minute of them.
     */
    const windowAggregate: MetricWindowAggregate | undefined =
      MetricMonitorCriteria.getWindowAggregate({
        values: numbersInDisplayUnit,
        criteriaFilter: input.criteriaFilter,
      });

    if (windowAggregate) {
      metricContext.windowAggregate = windowAggregate;
    }

    const comparisonMessage: string | null =
      CompareCriteria.compareCriteriaNumbers({
        value: numbersInDisplayUnit.length > 0 ? numbersInDisplayUnit : 0,
        threshold: threshold,
        criteriaFilter: input.criteriaFilter,
        metricDisplayName:
          matchedQuery?.metricAliasData?.title?.trim() ||
          matchedFormula?.metricAliasData?.title?.trim() ||
          metricContext.metricName,
        unit: displayUnit,
        /*
         * Only a plain metric criteria has a real metric NAME —
         * metricContext.metricName is the formula expression when the
         * criteria targets a formula, and a formula ending in `_ratio`
         * would trip the fraction heuristic into a 100× render.
         */
        metricName: metricContext.isFormula
          ? undefined
          : metricContext.metricName,
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
     * "All Values over the past 15 minutes" says the condition held for
     * the whole 15 minutes, and Array.every() is true of a single data
     * point: a deployment that had existed for a minute matched "replica
     * shortfall for 15 minutes" off its first reading (issue #4793). So
     * every data point meeting the condition is not enough - they must
     * cover the window too. Until they do, the series waits: a brand-new
     * series, one that was gone and came back, one with a hole of more than
     * one missing data point, and one whose data went stale (on a Metrics
     * monitor: stopped while the monitor's other data kept coming - see
     * judgesFreshnessByNewestData). (A time range too short to hold two data
     * points of any series shows none of that: a lone data point inside it
     * is then taken for the window, as MetricWindowCoverage explains.)
     *
     * Only the first match waits. A series the criteria is already in
     * effect for (its alert or incident is open, or the monitor already has
     * its status) is judged on its data points as before, so a short gap in
     * a firing series' data neither resolves its alert nor opens it again a
     * window later; a reading that misses the condition still resolves it,
     * and a series whose data leaves the window entirely still goes away.
     *
     * If No Data keeps its documented meaning - a window with no data
     * points at all - so a window with some does not reach it.
     */
    if (
      input.window &&
      samples.length > 0 &&
      MetricMonitorCriteria.isAllValues(input.criteriaFilter)
    ) {
      const coverage: MetricWindowCoverageResult = MetricWindowCoverage.judge({
        window: input.window,
        samples: samples,
        monitorIntervalMs: input.monitorIntervalMs,
        monitorNewestDataPointMs: input.monitorNewestDataPointMs,
      });

      const shortfall: MetricWindowShortfall | null =
        MetricMonitorCriteria.toWindowShortfall(coverage.shortfall);

      if (
        shortfall &&
        !(await MetricMonitorCriteria.isCriteriaInEffectFor({
          isInEffect: input.isInEffect,
          seriesFingerprint: input.seriesFingerprint,
        }))
      ) {
        metricContext.totalSamplesInWindow = samples.length;
        metricContext.windowWait = {
          message: `${MetricMonitorCriteria.getSeriesPrefix(input.seriesLabels)}${comparisonMessage.trim()} ${MetricWindowCoverage.describeWait(coverage)}`,
          waitingSeriesCount: 1,
          shortfall: shortfall,
          windowMs: coverage.windowEndMs - coverage.windowStartMs,
          coveredMs:
            coverage.runStartMs !== null && coverage.runEndMs !== null
              ? Math.max(0, coverage.runEndMs - coverage.runStartMs)
              : 0,
        };

        return {
          fingerprint: input.seriesFingerprint,
          labels: input.seriesLabels,
          rootCause: null,
          context: metricContext,
        };
      }
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
      /*
       * A Sum criteria compares the window's total, so no sample breaches
       * its threshold on its own - a crash loop's five restarts in five
       * minutes have no sample above 1. Its samples are the ones that
       * added to the total: every one that is not 0.
       */
      const breaches: boolean =
        windowAggregate?.aggregation === "sum"
          ? Number.isFinite(convertedValue) && convertedValue !== 0
          : MetricMonitorCriteria.sampleBreaches(
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
          attributes: MetricMonitorCriteria.extractLabelAttributes(
            sample,
            input.seriesLabels,
          ),
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

  /*
   * The words a sentence names each window aggregate by. Any Value and All
   * Values judge every sample, so they have none.
   */
  private static readonly WINDOW_AGGREGATIONS: Partial<
    Record<EvaluateOverTimeType, MetricWindowAggregation>
  > = {
    [EvaluateOverTimeType.Average]: "average",
    [EvaluateOverTimeType.Sum]: "sum",
    [EvaluateOverTimeType.MaximumValue]: "maximum",
    [EvaluateOverTimeType.MunimumValue]: "minimum",
  };

  /*
   * The one value a criteria compares with its threshold when it judges
   * the window at once, or undefined when it judges each sample (Any
   * Value, All Values). The same evaluation type, with the same
   * precedence, and the same reduction as
   * CompareCriteria.compareCriteriaNumbers, over the same display-unit
   * values; an empty window is compared as 0 (the Treat as Zero no-data
   * policy). Undefined too when that value is not a number, which no
   * comparison passes.
   */
  public static getWindowAggregate(input: {
    values: Array<number>;
    criteriaFilter: CriteriaFilter;
  }): MetricWindowAggregate | undefined {
    const evaluationType: EvaluateOverTimeType | undefined =
      input.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
      input.criteriaFilter.metricMonitorOptions?.metricAggregationType;
    const aggregation: MetricWindowAggregation | undefined = evaluationType
      ? MetricMonitorCriteria.WINDOW_AGGREGATIONS[evaluationType]
      : undefined;

    if (!aggregation) {
      return undefined;
    }

    const reduced: Array<number> = CompareCriteria.reduceWindow({
      values: input.values.length > 0 ? input.values : [0],
      evaluationType: evaluationType,
    });
    const value: number | undefined = reduced[0];

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }

    return {
      aggregation: aggregation,
      value: value,
      sampleCount: input.values.length,
    };
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

  private static extractLabelAttributes(
    sample: AggregateModel,
    seriesLabels?: JSONObject | undefined,
  ): JSONObject {
    /*
     * AggregatedModel has a string index signature that holds group-by
     * attributes alongside `timestamp` and `value`. Strip the known keys
     * to get the label dictionary.
     */
    const labels: JSONObject = {};
    for (const key of Object.keys(sample)) {
      if (key === "timestamp" || key === "value" || key === "attributes") {
        continue;
      }
      const v: unknown = (sample as unknown as JSONObject)[key];
      if (v === undefined || v === null) {
        continue;
      }
      labels[key] = v as JSONObject[string];
    }

    /*
     * Grouped rows carry their labels NESTED under `attributes` — both
     * MetricService.aggregateBy with groupByAttributeKeys and the
     * infrastructure monitors' raw-scan path return them that way. The
     * map used to be copied through as a single `attributes` label, which
     * the Breaching Samples list rendered as "`attributes`:
     * `[object Object]`".
     *
     * The raw scan nests EVERY datapoint attribute of the bucket's first
     * row, not just the grouped ones, so when the series labels are known
     * only those keys are lifted out: they are what identifies the series.
     * A formula's rows carry no attributes at all, so each key falls back
     * to the series' own label — every sample of a series belongs to it.
     */
    const nested: unknown = (sample as unknown as JSONObject)["attributes"];
    const nestedAttributes: JSONObject =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as JSONObject)
        : {};

    if (nested !== undefined && nested !== null && typeof nested !== "object") {
      // A flat label that happens to be called `attributes`.
      labels["attributes"] = nested as JSONObject[string];
    }

    const labelKeys: Array<string> = Object.keys(seriesLabels || {});
    const keys: Array<string> =
      labelKeys.length > 0 ? labelKeys : Object.keys(nestedAttributes);

    for (const key of keys) {
      if (key in labels) {
        continue;
      }

      const v: unknown = nestedAttributes[key] ?? seriesLabels?.[key];

      if (v === undefined || v === null || v === "" || typeof v === "object") {
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
    nativeUnitsByMetricName?: { [key: string]: string } | undefined;
  }): MetricCriteriaContext {
    const q: MetricQueryConfigData | null = input.matchedQuery;
    const f: MetricFormulaConfigData | null = input.matchedFormula;

    const metricName: string =
      (q?.metricQueryData?.filterData?.metricName as string | undefined) ||
      f?.metricFormulaData?.metricFormula ||
      q?.metricAliasData?.title ||
      f?.metricAliasData?.title ||
      "Metric";

    /*
     * Prefer the legendUnit the user picked, but fall back to the
     * metric's native unit (loaded from MetricType by the worker). The
     * fallback matters for ratio metrics like system.filesystem.utilization,
     * whose native unit is OTel's dimensionless "1" — without it, a "%"
     * threshold can't be compared against the raw [0, 1] samples.
     */
    const rawMetricName: string | undefined =
      (q?.metricQueryData?.filterData?.metricName as string | undefined) ||
      undefined;
    const nativeUnitFromMap: string | undefined = rawMetricName
      ? input.nativeUnitsByMetricName?.[rawMetricName.toLowerCase()]
      : undefined;

    const unit: string | null =
      (q?.metricAliasData?.legendUnit as string | undefined) ||
      (f?.metricAliasData?.legendUnit as string | undefined) ||
      nativeUnitFromMap ||
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
          nativeUnitsByMetricName: input.nativeUnitsByMetricName,
        })
      : undefined;

    const displayName: string | undefined =
      MetricMonitorCriteria.getAliasDisplayName({
        aliasData: q?.metricAliasData || f?.metricAliasData,
        metricAlias: input.metricAlias,
      });

    return {
      metricName,
      alias: input.metricAlias,
      ...(displayName ? { displayName } : {}),
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
   * The human legend of a query or formula, or undefined when it is empty
   * or just repeats the alias. The shipped templates title every single
   * query with its own alias ("container_restarts"), which is not a name
   * worth promoting over the metric name; the ratio templates give their
   * formula a real legend ("Node Memory Utilization (%)").
   */
  public static getAliasDisplayName(input: {
    aliasData: MetricAliasData | undefined;
    metricAlias: string;
  }): string | undefined {
    const candidates: Array<string | undefined> = [
      input.aliasData?.legend,
      input.aliasData?.title,
    ];

    for (const candidate of candidates) {
      const trimmed: string = (candidate || "").trim();

      if (
        trimmed &&
        trimmed.toLowerCase() !== input.metricAlias.trim().toLowerCase()
      ) {
        return trimmed;
      }
    }

    return undefined;
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
    nativeUnitsByMetricName?: { [key: string]: string } | undefined;
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
        /*
         * A component's values are in its legendUnit when it has one (the
         * worker converted them), and in the metric's own unit when it
         * does not — the ratio templates leave both sides unconverted, so
         * `used_mem` and `alloc_mem` are bytes. Without the fallback those
         * printed as bare 12-digit numbers under a formula that read
         * "88.82%".
         */
        const rawMetricName: string | undefined =
          (queryMatch.metricQueryData?.filterData?.metricName as
            | string
            | undefined) || undefined;
        const nativeUnit: string | undefined = rawMetricName
          ? input.nativeUnitsByMetricName?.[rawMetricName.toLowerCase()]
          : undefined;
        components.push({
          alias: normalizedAlias,
          name,
          unit: queryMatch.metricAliasData?.legendUnit || nativeUnit || null,
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

  /**
   * Evaluate one series against an anomaly criterion. For each sample
   * in the eval window we look up the baseline for its hour-of-week,
   * compute σ from the baseline (mean+stddev or median+MAD path), and
   * mark the sample as breaching when it falls outside the configured
   * direction.
   *
   * Returns no breach when:
   *   - The criterion has no metric name (formulas are not supported in
   *     v1 — we'd need to baseline the formula's output series too).
   *   - The projectId is missing (defensive — should never happen for
   *     metric monitors).
   *   - The baseline is missing or unreliable (cold-start). The
   *     metricContext.anomalyBaseline.state surfaces "Learning" so the
   *     UI can explain why nothing fired.
   */
  private static async evaluateAnomaly(input: {
    criteriaFilter: CriteriaFilter;
    metricContext: MetricCriteriaContext;
    aggregatedResult: AggregatedResult | undefined;
    seriesFingerprint: string | undefined;
    seriesLabels: JSONObject;
    projectId: { toString(): string } | undefined;
    nativeUnitsByMetricName?: { [key: string]: string } | undefined;
  }): Promise<MetricSeriesEvaluationResult> {
    const { criteriaFilter, metricContext } = input;

    const noBreach: () => MetricSeriesEvaluationResult = () => {
      return {
        fingerprint: input.seriesFingerprint,
        labels: input.seriesLabels,
        rootCause: null,
        context: metricContext,
      };
    };

    /*
     * Formulas don't carry a baselined metric name (the formula itself
     * is the "metric") — skip rather than misattribute. A future phase
     * can baseline formula output series.
     */
    if (metricContext.isFormula) {
      metricContext.anomalyBaseline = {
        state: "Learning",
        mean: 0,
        stddev: 0,
        expectedHigh: 0,
        expectedLow: 0,
        sigmaCount: 0,
        sampleCount: 0,
        hourOfWeek: -1,
        windowDays: 0,
      };
      return noBreach();
    }

    if (!input.projectId) {
      return noBreach();
    }

    const samples: Array<AggregateModel> =
      (input.aggregatedResult && input.aggregatedResult.data) || [];
    if (samples.length === 0) {
      const policy: NoDataPolicy =
        criteriaFilter.metricMonitorOptions?.onNoDataPolicy ||
        NoDataPolicy.Ignore;
      if (policy === NoDataPolicy.Trigger) {
        return {
          fingerprint: input.seriesFingerprint,
          labels: input.seriesLabels,
          rootCause: `No data received for ${metricContext.metricName} in the evaluation window — triggering per no-data policy.`,
          context: metricContext,
        };
      }
      return noBreach();
    }

    const sensitivity: AnomalyDetectionSensitivity =
      (criteriaFilter.metricMonitorOptions?.anomalyDetection?.sensitivity as
        | AnomalyDetectionSensitivity
        | undefined) || AnomalyDetectionSensitivity.Medium;
    const sigmaCount: number =
      MetricBaselineServiceClass.sigmaForSensitivity(sensitivity);
    const windowDays: number | undefined =
      criteriaFilter.metricMonitorOptions?.anomalyDetection?.windowDays;
    const minSamples: number | undefined =
      criteriaFilter.metricMonitorOptions?.anomalyDetection?.minSamples;

    /*
     * Look up baselines per distinct hour-of-week present in the eval
     * window. A 5-min window almost always covers a single hour, but
     * windows that straddle the hour boundary need both baselines.
     */
    const hoursInWindow: Set<number> = new Set<number>();
    for (const sample of samples) {
      const ts: Date =
        sample.timestamp instanceof Date
          ? sample.timestamp
          : new Date(sample.timestamp);
      if (!isNaN(ts.getTime())) {
        hoursInWindow.add(MetricBaselineServiceClass.computeHourOfWeek(ts));
      }
    }

    if (hoursInWindow.size === 0) {
      return noBreach();
    }

    /*
     * The baseline is aggregated from the raw stored values, so it is in
     * the metric's NATIVE unit — but the samples were already converted
     * into the query's legendUnit by the worker. Rescale the baseline
     * into the sample unit before anything compares against it or
     * renders it; otherwise a "By" baseline read as "MB" puts the mean a
     * million times too high — AnomalouslyHigh can never fire,
     * AnomalouslyLow fires on every sample, and the root cause prints
     * the mean in TB.
     */
    const baselineUnit: string | undefined =
      input.nativeUnitsByMetricName?.[metricContext.metricName.toLowerCase()];

    const baselineByHour: Map<number, BaselineSummary> = new Map();
    for (const hour of hoursInWindow) {
      const baseline: BaselineSummary | null =
        await MetricBaselineService.getBaseline({
          projectId: input.projectId.toString(),
          metricName: metricContext.metricName,
          hourOfWeek: hour,
          windowDays,
          minSamples,
        });
      if (baseline && baseline.isReliable) {
        baselineByHour.set(
          hour,
          MetricMonitorCriteria.convertBaselineToUnit({
            baseline,
            fromUnit: baselineUnit,
            toUnit: metricContext.unit || undefined,
          }),
        );
      }
    }

    if (baselineByHour.size === 0) {
      // Cold-start: surface state but don't fire.
      const firstHour: number = Array.from(hoursInWindow)[0]!;
      metricContext.anomalyBaseline = {
        state: "Learning",
        mean: 0,
        stddev: 0,
        expectedHigh: 0,
        expectedLow: 0,
        sigmaCount,
        sampleCount: 0,
        hourOfWeek: firstHour,
        windowDays:
          windowDays || MetricBaselineServiceClass.DEFAULT_WINDOW_DAYS,
      };
      return noBreach();
    }

    /*
     * Walk every sample, compare to its hour's baseline. The first
     * breaching sample produces the root-cause string and seeds
     * metricContext.anomalyBaseline; remaining breaches accumulate
     * into breachingSamples for the incident render.
     */
    const breachingSamples: Array<{
      value: number;
      timestamp: Date;
      attributes: JSONObject;
    }> = [];

    let firstBreach: {
      sample: AggregateModel;
      baseline: BaselineSummary;
      sigma: number;
    } | null = null;

    for (const sample of samples) {
      const ts: Date =
        sample.timestamp instanceof Date
          ? sample.timestamp
          : new Date(sample.timestamp);
      if (isNaN(ts.getTime())) {
        continue;
      }
      const hour: number = MetricBaselineServiceClass.computeHourOfWeek(ts);
      const baseline: BaselineSummary | undefined = baselineByHour.get(hour);
      if (!baseline) {
        continue;
      }

      const stddevForSigma: number = baseline.stddev;
      if (!Number.isFinite(stddevForSigma) || stddevForSigma === 0) {
        // Zero-variance baseline → we'd alert on every sample. Skip.
        continue;
      }

      const expectedHigh: number = baseline.mean + sigmaCount * stddevForSigma;
      const expectedLow: number = baseline.mean - sigmaCount * stddevForSigma;
      const observedSigma: number =
        (sample.value - baseline.mean) / stddevForSigma;

      const breaches: boolean = MetricMonitorCriteria.anomalyBreaches(
        sample.value,
        expectedHigh,
        expectedLow,
        criteriaFilter.filterType,
      );

      if (breaches) {
        breachingSamples.push({
          value: sample.value,
          timestamp: ts,
          attributes: MetricMonitorCriteria.extractLabelAttributes(
            sample,
            input.seriesLabels,
          ),
        });
        if (!firstBreach) {
          firstBreach = { sample, baseline, sigma: observedSigma };
        }
      }
    }

    metricContext.totalSamplesInWindow = samples.length;

    if (!firstBreach) {
      // No breach. Mark Normal so the UI can show "baseline ready".
      const firstHour: number = Array.from(baselineByHour.keys())[0]!;
      const firstBaseline: BaselineSummary = baselineByHour.get(firstHour)!;
      metricContext.anomalyBaseline = {
        state: "Normal",
        mean: firstBaseline.mean,
        stddev: firstBaseline.stddev,
        expectedHigh: firstBaseline.mean + sigmaCount * firstBaseline.stddev,
        expectedLow: firstBaseline.mean - sigmaCount * firstBaseline.stddev,
        sigmaCount,
        sampleCount: firstBaseline.sampleCount,
        hourOfWeek: firstHour,
        windowDays: firstBaseline.windowDays,
      };
      return noBreach();
    }

    const baseline: BaselineSummary = firstBreach.baseline;
    const anomaly: MetricAnomalyBaseline = {
      state: "Anomalous",
      mean: baseline.mean,
      stddev: baseline.stddev,
      expectedHigh: baseline.mean + sigmaCount * baseline.stddev,
      expectedLow: baseline.mean - sigmaCount * baseline.stddev,
      sigmaCount,
      sampleCount: baseline.sampleCount,
      hourOfWeek: baseline.hourOfWeek,
      windowDays: baseline.windowDays,
      observedValue: firstBreach.sample.value,
      observedSigma: firstBreach.sigma,
    };
    metricContext.anomalyBaseline = anomaly;

    metricContext.breachingSample = breachingSamples[0];
    metricContext.breachingSamples = breachingSamples;

    const direction: string =
      criteriaFilter.filterType === FilterType.AnomalouslyHigh
        ? "above"
        : criteriaFilter.filterType === FilterType.AnomalouslyLow
          ? "below"
          : firstBreach.sigma >= 0
            ? "above"
            : "below";

    const sigmaAbs: number = Math.abs(firstBreach.sigma);

    /*
     * Same rendering as the breaching-samples list and the comparison
     * sentence — an anomaly on a memory metric reads "1.07 GB", not
     * "1073741824.000 By". σ is a count of standard deviations, not a
     * quantity in the metric's unit, so it stays a bare number; the
     * standard deviation itself is in the metric's unit and does not.
     */
    const inMetricUnit: (value: number) => string = (value: number): string => {
      return MetricValueFormatter.format({
        value: value,
        unit: metricContext.unit,
        // Formula expressions are not metric names — see the guard above.
        metricName: metricContext.isFormula
          ? undefined
          : metricContext.metricName,
      });
    };

    const rootCause: string =
      `${metricContext.metricName} value ${inMetricUnit(firstBreach.sample.value)} ` +
      `is ${sigmaAbs.toFixed(2)}σ ${direction} the same-hour baseline ` +
      `(mean ${inMetricUnit(baseline.mean)}, σ ${inMetricUnit(baseline.stddev)}, ` +
      `${baseline.sampleCount} samples over ${baseline.windowDays} days, sensitivity ${sensitivity}).`;

    return {
      fingerprint: input.seriesFingerprint,
      labels: input.seriesLabels,
      rootCause,
      context: metricContext,
    };
  }

  /**
   * Rescale every quantity in a baseline from one unit into another.
   * Every supported unit family converts by a pure multiplier (no
   * offsets), so the spread terms (stddev, MAD) scale by the same
   * factor as the location terms. When the units match, either is
   * missing, or they aren't convertible, the baseline is returned
   * unchanged — the same pass-through the worker applies to samples.
   */
  private static convertBaselineToUnit(input: {
    baseline: BaselineSummary;
    fromUnit: string | undefined;
    toUnit: string | undefined;
  }): BaselineSummary {
    const { baseline, fromUnit, toUnit } = input;

    if (!fromUnit || !toUnit || fromUnit === toUnit) {
      return baseline;
    }

    const convert: (value: number) => number = (value: number): number => {
      return MetricUnitUtil.convertToMetricUnit({
        value,
        fromUnit,
        metricUnit: toUnit,
      });
    };

    return {
      ...baseline,
      mean: convert(baseline.mean),
      stddev: convert(baseline.stddev),
      median: convert(baseline.median),
      p95: convert(baseline.p95),
      minObserved: convert(baseline.minObserved),
      maxObserved: convert(baseline.maxObserved),
      ...(baseline.mad !== undefined ? { mad: convert(baseline.mad) } : {}),
    };
  }

  private static anomalyBreaches(
    value: number,
    expectedHigh: number,
    expectedLow: number,
    filterType: FilterType | undefined,
  ): boolean {
    switch (filterType) {
      case FilterType.AnomalouslyHigh:
        return value > expectedHigh;
      case FilterType.AnomalouslyLow:
        return value < expectedLow;
      case FilterType.Anomalous:
        return value > expectedHigh || value < expectedLow;
      default:
        return false;
    }
  }
}
