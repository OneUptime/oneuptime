import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import MetricFormulaConfigData from "../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance, {
  MonitorCriteriaInstanceType,
} from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorType from "../../Types/Monitor/MonitorType";
import RollingTime from "../../Types/RollingTime/RollingTime";
import MetricFormulaEvaluator from "../Metrics/MetricFormulaEvaluator";
import MonitorStepMetricQueries, {
  MonitorStepMetricReads,
} from "./MonitorStepMetricQueries";

/*
 * THE VALUES A METRIC-BACKED MONITOR COMPARES ITS METRICS WITH (issues #5759
 * and #6250), so a chart of those metrics can draw them: "CPU above 90" is a
 * line at 90 on the CPU chart, and the side of it that matches is shaded.
 *
 * Read from the step's criteria the way the evaluator reads them
 * (MetricMonitorCriteria): a criteria's filter compares the query or formula
 * its alias names - the first query when it names none - in the unit it was
 * typed in. Only what a line can say honestly is kept:
 *
 * - criteria that do something when they match: open an incident or an
 *   alert, or move the monitor away from its default status. A recovery
 *   ("back to Operational at or below 85") is left out, so the chart shows
 *   where the monitor alerts, not where it calms down again;
 * - a metric value compared with a number. Anomaly conditions have no
 *   number, and a "fires when nothing arrives" heartbeat ("fewer than 0
 *   samples") has an unreachable one;
 * - a value on the scale the chart draws. A window's sum is not one of its
 *   minutes, and a rate drawn of a counter is not the counter the monitor
 *   compares. A sum or a count grows with how long each point covers, so its
 *   line holds only where the chart's points cover what the monitor reads
 *   (onlyAtInterval); a share of two counts, an average or a gauge holds at
 *   any range.
 *
 * Pure and safe in the browser.
 */

export enum MonitorMetricThresholdOutcome {
  Incident = "incident",
  Alert = "alert",
  // It only moves the monitor to a status other than its default one.
  StatusChange = "status-change",
}

export enum MonitorMetricThresholdSide {
  Above = "above",
  Below = "below",
}

export interface MonitorMetricThreshold {
  criteriaId: string;
  // As the person named it; "" when they did not.
  criteriaName: string;
  // The query's or formula's variable whose chart the line is drawn on.
  metricVariable: string;
  // The number the criteria compares with, as typed.
  value: number;
  // The unit it was typed in, when the criteria says (thresholdUnit).
  unit: string | undefined;
  filterType: FilterType;
  // The side of the line the criteria matches; null for Equal / Not Equal.
  breachSide: MonitorMetricThresholdSide | null;
  // Compares where the metric's trend is headed, not the metric.
  isForecast: boolean;
  // What happens when it matches.
  outcome: MonitorMetricThresholdOutcome;
  /*
   * The stretch each point of a chart must cover for the line to hold, for
   * a series that grows with it (a sum or a count): what the monitor reads
   * each value over. Null when the line holds on a chart of any range.
   */
  onlyAtInterval: AggregationInterval | null;
}

// The comparisons a line can draw, and the side of it each matches.
const COMPARISON_SIDES: Partial<
  Record<FilterType, MonitorMetricThresholdSide | null>
> = {
  [FilterType.GreaterThan]: MonitorMetricThresholdSide.Above,
  [FilterType.GreaterThanOrEqualTo]: MonitorMetricThresholdSide.Above,
  [FilterType.LessThan]: MonitorMetricThresholdSide.Below,
  [FilterType.LessThanOrEqualTo]: MonitorMetricThresholdSide.Below,
  [FilterType.EqualTo]: null,
  [FilterType.NotEqualTo]: null,
  [FilterType.ForecastAbove]: MonitorMetricThresholdSide.Above,
  [FilterType.ForecastBelow]: MonitorMetricThresholdSide.Below,
};

// The evaluator's default when a criteria names no evaluation type.
const DEFAULT_EVALUATION_TYPE: EvaluateOverTimeType =
  EvaluateOverTimeType.AnyValue;

// Read as a sum: its value grows with how long it is read over.
const SCALING_AGGREGATIONS: ReadonlyArray<string> = [
  AggregationType.Sum,
  AggregationType.Count,
];

const OUTCOME_RANK: Record<MonitorMetricThresholdOutcome, number> = {
  [MonitorMetricThresholdOutcome.Incident]: 0,
  [MonitorMetricThresholdOutcome.Alert]: 1,
  [MonitorMetricThresholdOutcome.StatusChange]: 2,
};

type ToNumberFunction = (value: unknown) => number | null;

// As CompareCriteria.convertMetricThresholdToNumber reads a threshold.
const toNumber: ToNumberFunction = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed: number = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

type IdOfFunction = (value: unknown) => string;

const idOf: IdOfFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

export default class MonitorStepMetricThresholds {
  /*
   * The lines a chart of the step's metrics draws, in the order they are
   * drawn: the ones that open incidents first. A line two criteria share
   * (the same metric, number and side) is drawn once, for the one that does
   * the most.
   */
  public static getThresholds(input: {
    monitorType: MonitorType | undefined | null;
    monitorStep: MonitorStep | undefined | null;
    // The status the monitor shows when no criteria matches.
    defaultMonitorStatusId?: unknown;
    /*
     * Only these criteria, whatever they do: the one that opened an
     * incident or an alert. Left out, every criteria that alerts.
     */
    criteriaIds?: Array<string> | undefined;
  }): Array<MonitorMetricThreshold> {
    const reads: MonitorStepMetricReads | null =
      MonitorStepMetricQueries.getReads({
        monitorType: input.monitorType,
        monitorStep: input.monitorStep,
      });

    if (!reads || reads.queryConfigs.length === 0) {
      return [];
    }

    const instances: Array<MonitorCriteriaInstance> =
      input.monitorStep?.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    const onlyCriteriaIds: Array<string> | null = input.criteriaIds
      ? input.criteriaIds.map(idOf).filter(Boolean)
      : null;

    const thresholds: Array<MonitorMetricThreshold> = [];

    for (const instance of instances) {
      const criteria: MonitorCriteriaInstanceType | undefined = instance?.data;

      if (!criteria || criteria.isEnabled === false) {
        continue;
      }

      if (onlyCriteriaIds) {
        if (!onlyCriteriaIds.includes(idOf(criteria.id))) {
          continue;
        }
      } else if (
        !MonitorStepMetricThresholds.isAlertingCriteria(
          criteria,
          input.defaultMonitorStatusId,
        )
      ) {
        continue;
      }

      for (const filter of criteria.filters || []) {
        const threshold: MonitorMetricThreshold | null =
          MonitorStepMetricThresholds.getFilterThreshold({
            criteria: criteria,
            filter: filter,
            reads: reads,
          });

        if (threshold) {
          thresholds.push(threshold);
        }
      }
    }

    return MonitorStepMetricThresholds.dedupe(thresholds);
  }

  /*
   * Whether a criteria does something when it matches: opens an incident
   * or an alert, or moves the monitor to a status other than its default
   * one. A criteria that only sets the default status is a recovery; with
   * no default status known, a status change alone cannot be told from one.
   */
  public static isAlertingCriteria(
    criteria: MonitorCriteriaInstanceType,
    defaultMonitorStatusId: unknown,
  ): boolean {
    if (MonitorCriteriaInstance.opensRecords(criteria)) {
      return true;
    }

    const statusId: string = idOf(criteria.monitorStatusId);
    const defaultStatusId: string = idOf(defaultMonitorStatusId);

    return Boolean(
      criteria.changeMonitorStatus &&
        statusId &&
        defaultStatusId &&
        statusId !== defaultStatusId,
    );
  }

  public static getOutcome(
    criteria: MonitorCriteriaInstanceType,
  ): MonitorMetricThresholdOutcome {
    if (criteria.createIncidents && (criteria.incidents || []).length > 0) {
      return MonitorMetricThresholdOutcome.Incident;
    }

    if (criteria.createAlerts && (criteria.alerts || []).length > 0) {
      return MonitorMetricThresholdOutcome.Alert;
    }

    return MonitorMetricThresholdOutcome.StatusChange;
  }

  /*
   * The step holding a criteria, by its id: the one whose criteria opened
   * an incident or an alert (createdCriteriaId). Null when no step holds it
   * any more.
   */
  public static findStepOfCriteria(input: {
    monitorSteps: MonitorSteps | undefined | null;
    criteriaId: string | undefined | null;
  }): MonitorStep | null {
    const criteriaId: string = idOf(input.criteriaId);

    if (!criteriaId) {
      return null;
    }

    const steps: Array<MonitorStep> =
      input.monitorSteps?.data?.monitorStepsInstanceArray || [];

    for (const step of steps) {
      const instances: Array<MonitorCriteriaInstance> =
        step?.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

      const holdsCriteria: boolean = instances.some(
        (instance: MonitorCriteriaInstance): boolean => {
          return idOf(instance?.data?.id) === criteriaId;
        },
      );

      if (holdsCriteria) {
        return step;
      }
    }

    return null;
  }

  /*
   * The query or formula a criteria compares, by its variable, as the
   * evaluator resolves it (MetricMonitorCriteria.resolveAlias): the one its
   * alias names, queries first, else the first query. Null when there is
   * nothing to draw the line on.
   */
  public static resolveVariable(input: {
    metricAlias: string | undefined;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  }): string | null {
    const alias: string = input.metricAlias || "";

    if (alias) {
      const isNamed: (config: {
        metricAliasData?: { metricVariable?: string | undefined } | undefined;
      }) => boolean = (config: {
        metricAliasData?: { metricVariable?: string | undefined } | undefined;
      }): boolean => {
        return config.metricAliasData?.metricVariable === alias;
      };

      if (input.queryConfigs.some(isNamed) || input.formulaConfigs.some(isNamed)) {
        return alias;
      }
    }

    return input.queryConfigs[0]?.metricAliasData?.metricVariable || null;
  }

  /*
   * Whether the values of a query or formula grow with how long a stretch
   * each covers: a query read as a sum or a count does, and a formula does
   * unless those cancel out (a share of two counts). A formula that cannot
   * be read is taken to.
   */
  public static scalesWithBucketWidth(input: {
    metricVariable: string;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  }): boolean {
    const query: MetricQueryConfigData | undefined = input.queryConfigs.find(
      (queryConfig: MetricQueryConfigData): boolean => {
        return queryConfig.metricAliasData?.metricVariable === input.metricVariable;
      },
    );

    if (query) {
      return MonitorStepMetricThresholds.isScalingQuery(query);
    }

    const formula: MetricFormulaConfigData | undefined =
      input.formulaConfigs.find(
        (formulaConfig: MetricFormulaConfigData): boolean => {
          return (
            formulaConfig.metricAliasData?.metricVariable ===
            input.metricVariable
          );
        },
      );

    if (!formula) {
      return true;
    }

    const scales: boolean | null = MetricFormulaEvaluator.scalesWithBucketWidth({
      formula: formula.metricFormulaData?.metricFormula || "",
      variableScales: (variable: string): boolean | null => {
        const referenced: MetricQueryConfigData | undefined =
          input.queryConfigs.find(
            (queryConfig: MetricQueryConfigData): boolean => {
              return (
                (
                  queryConfig.metricAliasData?.metricVariable || ""
                ).toLowerCase() === variable
              );
            },
          );

        // A formula of formulas is not read through: taken to grow.
        return referenced
          ? MonitorStepMetricThresholds.isScalingQuery(referenced)
          : null;
      },
    });

    return scales !== false;
  }

  // Whether a chart draws a query as a rate of change, not as it is read.
  public static isDrawnAsRate(input: {
    metricVariable: string;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  }): boolean {
    const isRate: (queryConfig: MetricQueryConfigData | undefined) => boolean =
      (queryConfig: MetricQueryConfigData | undefined): boolean => {
        return queryConfig?.transformAsRate === true;
      };

    const query: MetricQueryConfigData | undefined = input.queryConfigs.find(
      (queryConfig: MetricQueryConfigData): boolean => {
        return queryConfig.metricAliasData?.metricVariable === input.metricVariable;
      },
    );

    if (query) {
      return isRate(query);
    }

    const formula: MetricFormulaConfigData | undefined =
      input.formulaConfigs.find(
        (formulaConfig: MetricFormulaConfigData): boolean => {
          return (
            formulaConfig.metricAliasData?.metricVariable ===
            input.metricVariable
          );
        },
      );

    if (!formula) {
      return false;
    }

    // A formula over a query drawn as a rate is drawn of the rate.
    return MetricFormulaEvaluator.getReferencedVariables(
      formula.metricFormulaData?.metricFormula || "",
    ).some((variable: string): boolean => {
      return isRate(
        input.queryConfigs.find(
          (queryConfig: MetricQueryConfigData): boolean => {
            return (
              (
                queryConfig.metricAliasData?.metricVariable || ""
              ).toLowerCase() === variable
            );
          },
        ),
      );
    });
  }

  private static isScalingQuery(queryConfig: MetricQueryConfigData): boolean {
    const aggregation: string = String(
      queryConfig.metricQueryData?.filterData?.aggegationType ||
        AggregationType.Avg,
    );

    return SCALING_AGGREGATIONS.includes(aggregation);
  }

  // The line one filter of a criteria draws, or null when it draws none.
  private static getFilterThreshold(input: {
    criteria: MonitorCriteriaInstanceType;
    filter: CriteriaFilter;
    reads: MonitorStepMetricReads;
  }): MonitorMetricThreshold | null {
    const filter: CriteriaFilter = input.filter;
    const reads: MonitorStepMetricReads = input.reads;

    if (!filter || filter.checkOn !== CheckOn.MetricValue) {
      return null;
    }

    const filterType: FilterType | undefined = filter.filterType;

    if (
      !filterType ||
      !Object.prototype.hasOwnProperty.call(COMPARISON_SIDES, filterType)
    ) {
      return null;
    }

    const value: number | null = toNumber(filter.value);

    if (value === null) {
      return null;
    }

    const metricVariable: string | null =
      MonitorStepMetricThresholds.resolveVariable({
        metricAlias: filter.metricMonitorOptions?.metricAlias,
        queryConfigs: reads.queryConfigs,
        formulaConfigs: reads.formulaConfigs,
      });

    if (!metricVariable) {
      return null;
    }

    const series: {
      metricVariable: string;
      queryConfigs: Array<MetricQueryConfigData>;
      formulaConfigs: Array<MetricFormulaConfigData>;
    } = {
      metricVariable: metricVariable,
      queryConfigs: reads.queryConfigs,
      formulaConfigs: reads.formulaConfigs,
    };

    // The chart draws a rate of change; the monitor compares the value.
    if (MonitorStepMetricThresholds.isDrawnAsRate(series)) {
      return null;
    }

    if (
      MonitorStepMetricThresholds.isUnreachableHeartbeat({
        filter: filter,
        filterType: filterType,
        value: value,
        metricVariable: metricVariable,
        queryConfigs: reads.queryConfigs,
      })
    ) {
      return null;
    }

    const isForecast: boolean =
      CriteriaFilterUtil.isForecastFilterType(filterType);

    const evaluationType: EvaluateOverTimeType =
      filter.evaluateOverTimeOptions?.evaluateOverTimeType ||
      filter.metricMonitorOptions?.metricAggregationType ||
      DEFAULT_EVALUATION_TYPE;

    /*
     * A window's sum is not one of the values a chart draws, unless the
     * window is read as one value, or is no longer than one.
     */
    if (
      !isForecast &&
      evaluationType === EvaluateOverTimeType.Sum &&
      !reads.aggregatesWholeWindow &&
      reads.rollingTime !== RollingTime.Past1Minute
    ) {
      return null;
    }

    let onlyAtInterval: AggregationInterval | null = null;

    if (MonitorStepMetricThresholds.scalesWithBucketWidth(series)) {
      // A whole window's total is never one of a chart's points.
      if (reads.aggregatesWholeWindow) {
        return null;
      }

      onlyAtInterval = MonitorStepMetricQueries.getEvaluationInterval(reads);
    }

    return {
      criteriaId: idOf(input.criteria.id),
      criteriaName: (input.criteria.name || "").trim(),
      metricVariable: metricVariable,
      value: value,
      unit: filter.metricMonitorOptions?.thresholdUnit || undefined,
      filterType: filterType,
      breachSide: COMPARISON_SIDES[filterType] ?? null,
      isForecast: isForecast,
      outcome: MonitorStepMetricThresholds.getOutcome(input.criteria),
      onlyAtInterval: onlyAtInterval,
    };
  }

  /*
   * "Fewer than 0 samples", which fires only through its no-data policy
   * (RecommendationCriteriaBuilder's Stopped Reporting criteria): a count is
   * never below 0, so the line would mark a value nothing can reach.
   */
  private static isUnreachableHeartbeat(input: {
    filter: CriteriaFilter;
    filterType: FilterType;
    value: number;
    metricVariable: string;
    queryConfigs: Array<MetricQueryConfigData>;
  }): boolean {
    if (
      input.filter.metricMonitorOptions?.onNoDataPolicy !== NoDataPolicy.Trigger
    ) {
      return false;
    }

    const isBelowZero: boolean =
      (input.filterType === FilterType.LessThan && input.value <= 0) ||
      (input.filterType === FilterType.LessThanOrEqualTo && input.value < 0);

    if (!isBelowZero) {
      return false;
    }

    const query: MetricQueryConfigData | undefined = input.queryConfigs.find(
      (queryConfig: MetricQueryConfigData): boolean => {
        return queryConfig.metricAliasData?.metricVariable === input.metricVariable;
      },
    );

    return (
      String(query?.metricQueryData?.filterData?.aggegationType || "") ===
      AggregationType.Count
    );
  }

  private static dedupe(
    thresholds: Array<MonitorMetricThreshold>,
  ): Array<MonitorMetricThreshold> {
    const sorted: Array<MonitorMetricThreshold> = thresholds
      .map((threshold: MonitorMetricThreshold, index: number) => {
        return { threshold, index };
      })
      .sort(
        (
          first: { threshold: MonitorMetricThreshold; index: number },
          second: { threshold: MonitorMetricThreshold; index: number },
        ): number => {
          return (
            OUTCOME_RANK[first.threshold.outcome] -
              OUTCOME_RANK[second.threshold.outcome] || first.index - second.index
          );
        },
      )
      .map(
        (entry: {
          threshold: MonitorMetricThreshold;
          index: number;
        }): MonitorMetricThreshold => {
          return entry.threshold;
        },
      );

    const seen: Set<string> = new Set<string>();
    const kept: Array<MonitorMetricThreshold> = [];

    for (const threshold of sorted) {
      const key: string = JSON.stringify([
        threshold.metricVariable,
        threshold.value,
        threshold.unit || "",
        threshold.breachSide,
        threshold.isForecast,
        threshold.filterType === FilterType.NotEqualTo,
      ]);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      kept.push(threshold);
    }

    return kept;
  }
}
