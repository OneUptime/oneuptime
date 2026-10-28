import FilterCondition from "../Filter/FilterCondition";
import ObjectID from "../ObjectID";
import RollingTime from "../RollingTime/RollingTime";
import { CriteriaAlert } from "./CriteriaAlert";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
  MetricAnomalyDetectionOptions,
  MetricMonitorOptions,
  NoDataPolicy,
} from "./CriteriaFilter";
import { CriteriaIncident } from "./CriteriaIncident";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "./MonitorStepExceptionMonitor";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "./MonitorStepLogMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "./MonitorStepMetricMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "./MonitorStepTraceMonitor";
import MonitorType from "./MonitorType";
import {
  getRecoveryFilterType,
  getRecoveryThreshold,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * A telemetry monitor's criteria, read as the one rule most people mean by
 * them: "alert when there are more than 10 matching logs in 5 minutes",
 * "alert when the average of a metric over 5 minutes is above 80".
 *
 * Telemetry monitors (Logs, Traces, Exceptions, Metrics) store their
 * criteria in the same shape as every other monitor: criteria checked top
 * to bottom, each with filters, a status to change to, and incidents and
 * alerts to open. Most of them are one rule, often with its opposite beside
 * it to set the healthy status again - which is how the out-of-the-box
 * criteria, the recommendations, the AI insight monitors and the templates
 * all write them. The monitor form reads such criteria as a rule, and edits
 * the rule in plain words: a condition, a value, a window, and what
 * happens. Criteria that are more than that (several rules, several
 * filters, a disabled rule, grouped incidents) are not a rule: the form
 * shows them in the full criteria editor, unchanged.
 *
 * Nothing new is stored. A rule is read from the criteria and written back
 * onto them: every field the rule does not show (descriptions, owners,
 * labels, roles, remediation notes, a retained incident row of a switched
 * off action, the healthy criteria's name) is kept as it was, so reading a
 * monitor and saving it unchanged saves exactly what was there.
 */

export enum TelemetryAlertRuleAction {
  Alert = "Alert",
  Incident = "Incident",
  AlertAndIncident = "AlertAndIncident",
  // Only the monitor's status changes: nothing is opened.
  StatusOnly = "StatusOnly",
}

/*
 * How the monitor goes back to healthy once the rule stops matching.
 */
export enum TelemetryAlertRuleRecovery {
  /*
   * No criteria of its own: when no criteria matches, the monitor returns to
   * its default status, and the rule's incidents and alerts resolve.
   */
  DefaultStatus = "DefaultStatus",
  // A second criteria, the rule's exact opposite, sets the healthy status.
  Opposite = "Opposite",
  /*
   * The opposite, a little past the threshold, as the recommendations write
   * it (DefaultRecoveryMarginFraction), so a value sitting at the threshold
   * does not flip the status on every check.
   */
  OppositeWithMargin = "OppositeWithMargin",
  /*
   * A second criteria that sets the healthy status for some of the values
   * the rule does not match, and never for one it does: the out-of-the-box
   * Metrics criteria open an incident at exactly 0 and call anything above 0
   * healthy. The values in neither return to the default status, which is
   * the same healthy status, so it reads as the rule's recovery. A changed
   * rule writes it as the rule's exact opposite.
   */
  Disjoint = "Disjoint",
}

/*
 * Why criteria are not read as a rule. Said to the reader above the full
 * criteria editor, and pinned by tests.
 */
export enum TelemetryAlertRuleShapeProblem {
  NotARuleMonitorType = "NotARuleMonitorType",
  NoCriteria = "NoCriteria",
  SeveralRules = "SeveralRules",
  DisabledRule = "DisabledRule",
  SeveralFilters = "SeveralFilters",
  OtherCheck = "OtherCheck",
  UnsupportedCondition = "UnsupportedCondition",
  SeveralIncidentsOrAlerts = "SeveralIncidentsOrAlerts",
  GroupedIncidents = "GroupedIncidents",
  UnknownMetric = "UnknownMetric",
}

export interface TelemetryAlertRule {
  // The comparison the rule makes.
  filterType: FilterType;
  // The value it compares with; undefined for the anomaly conditions.
  threshold: number | undefined;
  /*
   * The window. Logs, Traces and Exceptions count over the last N seconds;
   * Metrics read a rolling time.
   */
  windowInSeconds: number | undefined;
  rollingTime: RollingTime | undefined;
  // Metrics only: which query or formula, and how its window is read.
  metricAlias: string | undefined;
  metricAggregationType: EvaluateOverTimeType | undefined;
  onNoDataPolicy: NoDataPolicy | undefined;
  thresholdUnit: string | undefined;
  // The anomaly conditions' sensitivity and baseline.
  anomalyDetection: MetricAnomalyDetectionOptions | undefined;
  // What happens when the rule matches.
  action: TelemetryAlertRuleAction;
  // The monitor's status while the rule matches.
  monitorStatusId: ObjectID | undefined;
  incident: CriteriaIncident | undefined;
  alert: CriteriaAlert | undefined;
  // The rule criteria's name.
  name: string;
  // Read only: where the rule sits and how it recovers.
  ruleCriteriaId: string;
  recovery: TelemetryAlertRuleRecovery;
}

export interface TelemetryAlertRuleReadResult {
  rule: TelemetryAlertRule | null;
  problem: TelemetryAlertRuleShapeProblem | null;
}

/*
 * The comparisons the rule editor offers, in the order it offers them. The
 * same set the full criteria editor offers for these checks
 * (CriteriaFilterUtil.getFilterTypeOptionsByCheckOn in the Dashboard), plus
 * Not Equal To, which only an older or hand-written criteria holds: read,
 * and offered back to such a rule, so it keeps meaning what it meant.
 */
const STATIC_COMPARISONS: Array<FilterType> = [
  FilterType.GreaterThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThan,
  FilterType.LessThanOrEqualTo,
  FilterType.EqualTo,
];

const ANOMALY_COMPARISONS: Array<FilterType> = [
  FilterType.AnomalouslyHigh,
  FilterType.AnomalouslyLow,
  FilterType.Anomalous,
];

const READ_ONLY_COMPARISONS: Array<FilterType> = [FilterType.NotEqualTo];

/*
 * A comparison of a count holds or not for every whole number. Read as the
 * set of counts it matches, two filters are opposites when every count
 * matches exactly one of them: "Equal To 0" and "Greater Than 0" are, as the
 * out-of-the-box Logs criteria pair them, though Greater Than is not the
 * formal opposite of Equal To.
 */
const LARGE_COUNT: number = 1000000000;

interface FilterSetComparison {
  isOpposite: boolean;
  overlaps: boolean;
}

export default class TelemetryAlertRuleUtil {
  public static readonly RULE_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
    MonitorType.Logs,
    MonitorType.Traces,
    MonitorType.Exceptions,
    MonitorType.Metrics,
  ];

  public static isRuleMonitorType(
    monitorType: MonitorType | undefined,
  ): boolean {
    return Boolean(
      monitorType &&
        TelemetryAlertRuleUtil.RULE_MONITOR_TYPES.includes(monitorType),
    );
  }

  // What a rule of this monitor type compares.
  public static getMeasureCheckOn(monitorType: MonitorType): CheckOn | null {
    switch (monitorType) {
      case MonitorType.Logs:
        return CheckOn.LogCount;
      case MonitorType.Traces:
        return CheckOn.SpanCount;
      case MonitorType.Exceptions:
        return CheckOn.ExceptionCount;
      case MonitorType.Metrics:
        return CheckOn.MetricValue;
      default:
        return null;
    }
  }

  // Whether the measure is a count of things in the window (not a metric).
  public static isCountMonitorType(monitorType: MonitorType): boolean {
    return (
      monitorType === MonitorType.Logs ||
      monitorType === MonitorType.Traces ||
      monitorType === MonitorType.Exceptions
    );
  }

  /*
   * The anomaly conditions are offered where the server judges them: log
   * and span counts against their hourly baselines, metrics against theirs.
   * Exceptions have no baseline.
   */
  public static supportsAnomaly(monitorType: MonitorType): boolean {
    return (
      monitorType === MonitorType.Logs ||
      monitorType === MonitorType.Traces ||
      monitorType === MonitorType.Metrics
    );
  }

  /*
   * The comparisons to offer for a rule of this type. A comparison the rule
   * already holds is always offered, so it can be kept.
   */
  public static getComparisons(data: {
    monitorType: MonitorType;
    current?: FilterType | undefined;
  }): Array<FilterType> {
    const comparisons: Array<FilterType> = [...STATIC_COMPARISONS];

    if (TelemetryAlertRuleUtil.supportsAnomaly(data.monitorType)) {
      comparisons.push(...ANOMALY_COMPARISONS);
    }

    if (data.current && !comparisons.includes(data.current)) {
      if (TelemetryAlertRuleUtil.isReadableComparison(data)) {
        comparisons.push(data.current);
      }
    }

    return comparisons;
  }

  public static isAnomaly(filterType: FilterType | undefined): boolean {
    return CriteriaFilterUtil.isAnomalyFilterType(filterType);
  }

  // The window of a count monitor, in seconds, as its step holds it.
  public static getWindowInSeconds(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
  }): number | undefined {
    switch (data.monitorType) {
      case MonitorType.Logs:
        return (
          data.monitorStep.data?.logMonitor?.lastXSecondsOfLogs ||
          MonitorStepLogMonitorUtil.getDefault().lastXSecondsOfLogs
        );
      case MonitorType.Traces:
        return (
          data.monitorStep.data?.traceMonitor?.lastXSecondsOfSpans ||
          MonitorStepTraceMonitorUtil.getDefault().lastXSecondsOfSpans
        );
      case MonitorType.Exceptions:
        return (
          data.monitorStep.data?.exceptionMonitor?.lastXSecondsOfExceptions ||
          MonitorStepExceptionMonitorUtil.getDefault().lastXSecondsOfExceptions
        );
      default:
        return undefined;
    }
  }

  public static getRollingTime(monitorStep: MonitorStep): RollingTime {
    return (
      monitorStep.data?.metricMonitor?.rollingTime || RollingTime.Past1Minute
    );
  }

  /*
   * The aliases a metric rule can compare: every query's and formula's
   * variable, queries first - the order the evaluator resolves them in.
   */
  public static getMetricAliases(monitorStep: MonitorStep): Array<string> {
    const config: MonitorStepMetricMonitor | undefined =
      monitorStep.data?.metricMonitor;
    const viewConfig: ReturnType<
      typeof MonitorStepMetricMonitorUtil.getMetricViewConfig
    > = MonitorStepMetricMonitorUtil.getMetricViewConfig(config);

    const aliases: Array<string> = [];

    for (const queryConfig of viewConfig.queryConfigs) {
      const alias: string | undefined =
        queryConfig.metricAliasData?.metricVariable;

      if (alias && !aliases.includes(alias)) {
        aliases.push(alias);
      }
    }

    for (const formulaConfig of viewConfig.formulaConfigs) {
      const alias: string | undefined =
        formulaConfig.metricAliasData?.metricVariable;

      if (alias && !aliases.includes(alias)) {
        aliases.push(alias);
      }
    }

    return aliases;
  }

  /*
   * Read the rule out of a step's criteria, or say why they are not one.
   * `defaultMonitorStatusId` is the status the monitor shows when no
   * criteria matches (MonitorSteps.defaultMonitorStatusId): a healthy
   * criteria is only the rule's recovery when it sets that same status, so
   * dropping it (when the rule becomes an anomaly) changes nothing.
   */
  public static read(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    defaultMonitorStatusId: ObjectID | undefined;
  }): TelemetryAlertRuleReadResult {
    const measure: CheckOn | null = TelemetryAlertRuleUtil.getMeasureCheckOn(
      data.monitorType,
    );

    if (!measure) {
      return {
        rule: null,
        problem: TelemetryAlertRuleShapeProblem.NotARuleMonitorType,
      };
    }

    const instances: Array<MonitorCriteriaInstance> =
      data.monitorStep.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    if (instances.length === 0) {
      return { rule: null, problem: TelemetryAlertRuleShapeProblem.NoCriteria };
    }

    if (instances.length > 2) {
      return {
        rule: null,
        problem: TelemetryAlertRuleShapeProblem.SeveralRules,
      };
    }

    let ruleInstance: MonitorCriteriaInstance | undefined = undefined;
    let recoveryInstance: MonitorCriteriaInstance | undefined = undefined;

    if (instances.length === 1) {
      ruleInstance = instances[0];
    } else {
      const recoveryCandidates: Array<MonitorCriteriaInstance> =
        instances.filter((instance: MonitorCriteriaInstance): boolean => {
          return TelemetryAlertRuleUtil.isRecoveryCandidate({
            instance,
            defaultMonitorStatusId: data.defaultMonitorStatusId,
          });
        });

      if (recoveryCandidates.length !== 1) {
        return {
          rule: null,
          problem: TelemetryAlertRuleShapeProblem.SeveralRules,
        };
      }

      recoveryInstance = recoveryCandidates[0];
      ruleInstance = instances.find((instance: MonitorCriteriaInstance) => {
        return instance !== recoveryInstance;
      });
    }

    if (!ruleInstance?.data) {
      return { rule: null, problem: TelemetryAlertRuleShapeProblem.NoCriteria };
    }

    const problem: TelemetryAlertRuleShapeProblem | null =
      TelemetryAlertRuleUtil.getRuleInstanceProblem({
        monitorType: data.monitorType,
        monitorStep: data.monitorStep,
        instance: ruleInstance,
        measure,
      });

    if (problem) {
      return { rule: null, problem };
    }

    const ruleFilter: CriteriaFilter = ruleInstance.data.filters[0]!;

    let recovery: TelemetryAlertRuleRecovery =
      TelemetryAlertRuleRecovery.DefaultStatus;

    if (recoveryInstance) {
      const recoveryFilter: CriteriaFilter | undefined =
        recoveryInstance.data?.filters.length === 1
          ? recoveryInstance.data.filters[0]
          : undefined;

      const matchedRecovery: TelemetryAlertRuleRecovery | null =
        recoveryFilter && recoveryInstance.data?.isEnabled !== false
          ? TelemetryAlertRuleUtil.getRecoveryKind({
              monitorType: data.monitorType,
              ruleFilter,
              recoveryFilter,
            })
          : null;

      if (!matchedRecovery) {
        return {
          rule: null,
          problem: TelemetryAlertRuleShapeProblem.SeveralRules,
        };
      }

      recovery = matchedRecovery;
    }

    const ruleData: MonitorCriteriaInstance["data"] = ruleInstance.data;
    const isMetric: boolean = data.monitorType === MonitorType.Metrics;
    const metricOptions: MetricMonitorOptions | undefined =
      ruleFilter.metricMonitorOptions;

    const rule: TelemetryAlertRule = {
      filterType: ruleFilter.filterType!,
      threshold: TelemetryAlertRuleUtil.isAnomaly(ruleFilter.filterType)
        ? undefined
        : TelemetryAlertRuleUtil.toNumber(ruleFilter.value),
      windowInSeconds: TelemetryAlertRuleUtil.getWindowInSeconds({
        monitorType: data.monitorType,
        monitorStep: data.monitorStep,
      }),
      rollingTime: isMetric
        ? TelemetryAlertRuleUtil.getRollingTime(data.monitorStep)
        : undefined,
      metricAlias: isMetric ? metricOptions?.metricAlias : undefined,
      metricAggregationType: isMetric
        ? metricOptions?.metricAggregationType
        : undefined,
      onNoDataPolicy: isMetric ? metricOptions?.onNoDataPolicy : undefined,
      thresholdUnit: isMetric ? metricOptions?.thresholdUnit : undefined,
      anomalyDetection: metricOptions?.anomalyDetection,
      action: TelemetryAlertRuleUtil.getAction(ruleInstance),
      monitorStatusId: ruleData!.changeMonitorStatus
        ? ruleData!.monitorStatusId
        : undefined,
      incident: ruleData!.incidents[0],
      alert: ruleData!.alerts[0],
      name: ruleData!.name || "",
      ruleCriteriaId: ruleData!.id,
      recovery,
    };

    return { rule, problem: null };
  }

  /*
   * Write a rule back onto a step: the rule criteria, its recovery criteria
   * (kept the opposite of the rule) and the window. Returns a new step; the
   * one handed in is not changed.
   */
  public static write(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    rule: TelemetryAlertRule;
  }): MonitorStep {
    const { monitorType, rule } = data;
    const step: MonitorStep = MonitorStep.clone(data.monitorStep);
    const measure: CheckOn | null =
      TelemetryAlertRuleUtil.getMeasureCheckOn(monitorType);

    if (!measure || !step.data) {
      return step;
    }

    TelemetryAlertRuleUtil.writeWindow({
      monitorType,
      monitorStep: step,
      rule,
    });

    const instances: Array<MonitorCriteriaInstance> = (
      step.data.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
    ).map((instance: MonitorCriteriaInstance) => {
      return MonitorCriteriaInstance.clone(instance);
    });

    const ruleInstance: MonitorCriteriaInstance | undefined = instances.find(
      (instance: MonitorCriteriaInstance) => {
        return instance.data?.id === rule.ruleCriteriaId;
      },
    );

    /*
     * A rule that is not one of these criteria is a new one (a recipe): it
     * takes the criteria's place.
     */
    if (!ruleInstance) {
      step.setMonitorCriteria(
        TelemetryAlertRuleUtil.buildCriteria({ monitorType, rule }),
      );

      return step;
    }

    const previousRuleFilter: CriteriaFilter | undefined =
      ruleInstance.data?.filters[0];

    const ruleFilter: CriteriaFilter = TelemetryAlertRuleUtil.buildRuleFilter({
      monitorType,
      measure,
      rule,
      previous: previousRuleFilter,
    });

    TelemetryAlertRuleUtil.applyRuleToInstance({
      instance: ruleInstance,
      rule,
      filter: ruleFilter,
    });

    const recoveryIndex: number = instances.findIndex(
      (instance: MonitorCriteriaInstance) => {
        return instance !== ruleInstance;
      },
    );

    if (recoveryIndex >= 0) {
      const recoveryInstance: MonitorCriteriaInstance =
        instances[recoveryIndex]!;

      /*
       * An anomaly has no opposite to write: the monitor is healthy again
       * when no criteria matches, and its default status is the one this
       * criteria set (read() requires that), so dropping it changes nothing.
       */
      if (
        TelemetryAlertRuleUtil.isAnomaly(rule.filterType) ||
        rule.recovery === TelemetryAlertRuleRecovery.DefaultStatus
      ) {
        instances.splice(recoveryIndex, 1);
      } else {
        const ruleChanged: boolean = !TelemetryAlertRuleUtil.isSameComparison(
          previousRuleFilter,
          ruleFilter,
        );
        const previousRecoveryFilter: CriteriaFilter | undefined =
          recoveryInstance.data?.filters[0];

        if (recoveryInstance.data && previousRecoveryFilter) {
          recoveryInstance.data.filters = [
            TelemetryAlertRuleUtil.buildRecoveryFilter({
              monitorType,
              ruleFilter,
              previousRecoveryFilter,
              recovery: rule.recovery,
              ruleChanged,
            }),
          ];
        }
      }
    }

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: instances };
    step.setMonitorCriteria(criteria);

    return step;
  }

  /*
   * The criteria for a new rule: the rule alone. When it stops matching, no
   * criteria matches, and the monitor returns to its default status and
   * resolves what the rule opened (MonitorResource, "No criteria met").
   */
  public static buildCriteria(data: {
    monitorType: MonitorType;
    rule: TelemetryAlertRule;
  }): MonitorCriteria {
    const measure: CheckOn | null = TelemetryAlertRuleUtil.getMeasureCheckOn(
      data.monitorType,
    );
    const instance: MonitorCriteriaInstance =
      TelemetryAlertRuleUtil.newRuleInstance(data.rule);

    if (measure) {
      TelemetryAlertRuleUtil.applyRuleToInstance({
        instance,
        rule: data.rule,
        filter: TelemetryAlertRuleUtil.buildRuleFilter({
          monitorType: data.monitorType,
          measure,
          rule: data.rule,
          previous: undefined,
        }),
      });
    }

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = { monitorCriteriaInstanceArray: [instance] };

    return criteria;
  }

  /*
   * The window, written where the step's sub-configuration keeps it. A step
   * without the sub-configuration gets its type's defaults with the window.
   */
  public static writeWindow(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    rule: Pick<TelemetryAlertRule, "windowInSeconds" | "rollingTime">;
  }): void {
    const { monitorType, monitorStep, rule } = data;

    if (!monitorStep.data) {
      return;
    }

    if (monitorType === MonitorType.Logs && rule.windowInSeconds) {
      const logMonitor: MonitorStepLogMonitor =
        monitorStep.data.logMonitor || MonitorStepLogMonitorUtil.getDefault();
      monitorStep.setLogMonitor({
        ...logMonitor,
        lastXSecondsOfLogs: rule.windowInSeconds,
      });
    }

    if (monitorType === MonitorType.Traces && rule.windowInSeconds) {
      const traceMonitor: MonitorStepTraceMonitor =
        monitorStep.data.traceMonitor ||
        MonitorStepTraceMonitorUtil.getDefault();
      monitorStep.setTraceMonitor({
        ...traceMonitor,
        lastXSecondsOfSpans: rule.windowInSeconds,
      });
    }

    if (monitorType === MonitorType.Exceptions && rule.windowInSeconds) {
      const exceptionMonitor: MonitorStepExceptionMonitor =
        monitorStep.data.exceptionMonitor ||
        MonitorStepExceptionMonitorUtil.getDefault();
      monitorStep.setExceptionMonitor({
        ...exceptionMonitor,
        lastXSecondsOfExceptions: rule.windowInSeconds,
      });
    }

    if (monitorType === MonitorType.Metrics && rule.rollingTime) {
      const metricMonitor: MonitorStepMetricMonitor =
        monitorStep.data.metricMonitor ||
        MonitorStepMetricMonitorUtil.getDefault();
      monitorStep.setMetricMonitor({
        ...metricMonitor,
        rollingTime: rule.rollingTime,
      });
    }
  }

  /*
   * Whether a value matches a comparison, the way the server compares one
   * number (CompareCriteria.compareCriteriaNumbers). The rule editor's
   * preview marks the windows a rule would have matched with it.
   */
  public static matches(data: {
    filterType: FilterType;
    threshold: number;
    value: number;
  }): boolean {
    switch (data.filterType) {
      case FilterType.GreaterThan:
        return data.value > data.threshold;
      case FilterType.GreaterThanOrEqualTo:
        return data.value >= data.threshold;
      case FilterType.LessThan:
        return data.value < data.threshold;
      case FilterType.LessThanOrEqualTo:
        return data.value <= data.threshold;
      case FilterType.EqualTo:
        return data.value === data.threshold;
      case FilterType.NotEqualTo:
        return data.value !== data.threshold;
      default:
        return false;
    }
  }

  // ---- private ----

  private static isReadableComparison(data: {
    monitorType: MonitorType;
    current?: FilterType | undefined;
  }): boolean {
    if (!data.current) {
      return false;
    }

    if (STATIC_COMPARISONS.includes(data.current)) {
      return true;
    }

    if (READ_ONLY_COMPARISONS.includes(data.current)) {
      return true;
    }

    return (
      ANOMALY_COMPARISONS.includes(data.current) &&
      TelemetryAlertRuleUtil.supportsAnomaly(data.monitorType)
    );
  }

  private static getRuleInstanceProblem(data: {
    monitorType: MonitorType;
    monitorStep: MonitorStep;
    instance: MonitorCriteriaInstance;
    measure: CheckOn;
  }): TelemetryAlertRuleShapeProblem | null {
    const instanceData: MonitorCriteriaInstance["data"] = data.instance.data;

    if (!instanceData) {
      return TelemetryAlertRuleShapeProblem.NoCriteria;
    }

    if (instanceData.isEnabled === false) {
      return TelemetryAlertRuleShapeProblem.DisabledRule;
    }

    if (instanceData.filters.length !== 1) {
      return TelemetryAlertRuleShapeProblem.SeveralFilters;
    }

    const filter: CriteriaFilter = instanceData.filters[0]!;

    if (filter.checkOn !== data.measure) {
      return TelemetryAlertRuleShapeProblem.OtherCheck;
    }

    if (
      filter.evaluateOverTime ||
      !TelemetryAlertRuleUtil.isReadableComparison({
        monitorType: data.monitorType,
        current: filter.filterType,
      })
    ) {
      return TelemetryAlertRuleShapeProblem.UnsupportedCondition;
    }

    /*
     * A rule without a value is still a rule: a new Metrics monitor starts
     * on "above a value" and asks for the value, and the criteria cannot be
     * saved until it has one (MonitorCriteriaInstance.getValidationError).
     */

    if (instanceData.incidents.length > 1 || instanceData.alerts.length > 1) {
      return TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts;
    }

    if (
      (instanceData.createIncidents && instanceData.incidents.length !== 1) ||
      (instanceData.createAlerts && instanceData.alerts.length !== 1)
    ) {
      return TelemetryAlertRuleShapeProblem.SeveralIncidentsOrAlerts;
    }

    if (instanceData.incidentGrouping || instanceData.openForEveryEmail) {
      return TelemetryAlertRuleShapeProblem.GroupedIncidents;
    }

    if (data.monitorType === MonitorType.Metrics) {
      const alias: string | undefined =
        filter.metricMonitorOptions?.metricAlias;

      if (
        alias &&
        !TelemetryAlertRuleUtil.getMetricAliases(data.monitorStep).includes(
          alias,
        )
      ) {
        return TelemetryAlertRuleShapeProblem.UnknownMetric;
      }
    }

    return null;
  }

  /*
   * A criteria that can be the rule's recovery: on, opening nothing, and
   * setting the monitor's default status.
   */
  private static isRecoveryCandidate(data: {
    instance: MonitorCriteriaInstance;
    defaultMonitorStatusId: ObjectID | undefined;
  }): boolean {
    const instanceData: MonitorCriteriaInstance["data"] = data.instance.data;

    if (!instanceData || !data.defaultMonitorStatusId) {
      return false;
    }

    return (
      instanceData.isEnabled !== false &&
      !instanceData.createIncidents &&
      !instanceData.createAlerts &&
      Boolean(instanceData.changeMonitorStatus) &&
      instanceData.monitorStatusId?.toString() ===
        data.defaultMonitorStatusId.toString() &&
      !instanceData.incidentGrouping &&
      !instanceData.openForEveryEmail
    );
  }

  private static getRecoveryKind(data: {
    monitorType: MonitorType;
    ruleFilter: CriteriaFilter;
    recoveryFilter: CriteriaFilter;
  }): TelemetryAlertRuleRecovery | null {
    const { ruleFilter, recoveryFilter } = data;

    if (
      recoveryFilter.checkOn !== ruleFilter.checkOn ||
      recoveryFilter.evaluateOverTime ||
      TelemetryAlertRuleUtil.isAnomaly(ruleFilter.filterType) ||
      TelemetryAlertRuleUtil.isAnomaly(recoveryFilter.filterType)
    ) {
      return null;
    }

    const ruleValue: number | undefined = TelemetryAlertRuleUtil.toNumber(
      ruleFilter.value,
    );
    const recoveryValue: number | undefined = TelemetryAlertRuleUtil.toNumber(
      recoveryFilter.value,
    );

    if (
      ruleValue === undefined ||
      recoveryValue === undefined ||
      !ruleFilter.filterType ||
      !recoveryFilter.filterType
    ) {
      return null;
    }

    const isMetric: boolean = data.monitorType === MonitorType.Metrics;

    /*
     * A metric's recovery must read the same number the rule reads: the
     * same query, in the same unit, taken from its window the same way.
     */
    if (isMetric) {
      const ruleOptions: MetricMonitorOptions | undefined =
        ruleFilter.metricMonitorOptions;
      const recoveryOptions: MetricMonitorOptions | undefined =
        recoveryFilter.metricMonitorOptions;

      if (
        (ruleOptions?.metricAlias || "") !==
          (recoveryOptions?.metricAlias || "") ||
        (ruleOptions?.thresholdUnit || "") !==
          (recoveryOptions?.thresholdUnit || "") ||
        (ruleOptions?.metricAggregationType || "") !==
          (recoveryOptions?.metricAggregationType || "")
      ) {
        return null;
      }
    }

    const comparison: FilterSetComparison =
      TelemetryAlertRuleUtil.compareFilterSets({
        isCount: !isMetric,
        rule: { filterType: ruleFilter.filterType, value: ruleValue },
        recovery: {
          filterType: recoveryFilter.filterType,
          value: recoveryValue,
        },
      });

    if (comparison.isOpposite) {
      return TelemetryAlertRuleRecovery.Opposite;
    }

    if (comparison.overlaps) {
      return null;
    }

    if (
      isMetric &&
      recoveryFilter.filterType === getRecoveryFilterType(ruleFilter.filterType)
    ) {
      const withMargin: number | undefined = getRecoveryThreshold({
        filterType: ruleFilter.filterType,
        value: ruleValue,
      });

      if (
        withMargin !== undefined &&
        TelemetryAlertRuleUtil.isSameNumber(withMargin, recoveryValue)
      ) {
        return TelemetryAlertRuleRecovery.OppositeWithMargin;
      }
    }

    return TelemetryAlertRuleRecovery.Disjoint;
  }

  /*
   * How the values two comparisons match relate: whether every value
   * matches exactly one of them (opposites), and whether any value matches
   * both. A comparison changes its answer only at its own value, so a few
   * values on each side of the two thresholds, and far beyond them, decide
   * it: whole numbers from 0 for a count, any number for a metric.
   */
  private static compareFilterSets(data: {
    isCount: boolean;
    rule: { filterType: FilterType; value: number };
    recovery: { filterType: FilterType; value: number };
  }): FilterSetComparison {
    const thresholds: Array<number> = [data.rule.value, data.recovery.value];
    const candidates: Array<number> = [];

    if (data.isCount) {
      candidates.push(0, LARGE_COUNT);

      for (const threshold of thresholds) {
        for (const near of [
          Math.floor(threshold) - 1,
          Math.floor(threshold),
          Math.ceil(threshold),
          Math.ceil(threshold) + 1,
        ]) {
          if (near >= 0) {
            candidates.push(near);
          }
        }
      }
    } else {
      const lowest: number = Math.min(...thresholds);
      const highest: number = Math.max(...thresholds);
      const gap: number = highest - lowest;
      const step: number =
        gap > 0 ? gap / 4 : Math.max(1, Math.abs(lowest)) * 1e-6;

      candidates.push(-LARGE_COUNT, LARGE_COUNT, (lowest + highest) / 2);

      for (const threshold of thresholds) {
        candidates.push(threshold - step, threshold, threshold + step);
      }
    }

    let isOpposite: boolean = true;
    let overlaps: boolean = false;

    for (const candidate of candidates) {
      const ruleMatches: boolean = TelemetryAlertRuleUtil.matches({
        filterType: data.rule.filterType,
        threshold: data.rule.value,
        value: candidate,
      });
      const recoveryMatches: boolean = TelemetryAlertRuleUtil.matches({
        filterType: data.recovery.filterType,
        threshold: data.recovery.value,
        value: candidate,
      });

      if (ruleMatches === recoveryMatches) {
        isOpposite = false;
      }

      if (ruleMatches && recoveryMatches) {
        overlaps = true;
      }
    }

    return { isOpposite, overlaps };
  }

  private static getAction(
    instance: MonitorCriteriaInstance,
  ): TelemetryAlertRuleAction {
    const createIncidents: boolean = Boolean(instance.data?.createIncidents);
    const createAlerts: boolean = Boolean(instance.data?.createAlerts);

    if (createIncidents && createAlerts) {
      return TelemetryAlertRuleAction.AlertAndIncident;
    }

    if (createIncidents) {
      return TelemetryAlertRuleAction.Incident;
    }

    if (createAlerts) {
      return TelemetryAlertRuleAction.Alert;
    }

    return TelemetryAlertRuleAction.StatusOnly;
  }

  private static newRuleInstance(
    rule: TelemetryAlertRule,
  ): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    instance.data = {
      id: rule.ruleCriteriaId || ObjectID.generate().toString(),
      monitorStatusId: undefined,
      filterCondition: FilterCondition.Any,
      filters: [],
      incidents: [],
      alerts: [],
      changeMonitorStatus: false,
      createIncidents: false,
      createAlerts: false,
      isEnabled: true,
      name: "",
      description: "",
    };

    return instance;
  }

  private static buildRuleFilter(data: {
    monitorType: MonitorType;
    measure: CheckOn;
    rule: TelemetryAlertRule;
    previous: CriteriaFilter | undefined;
  }): CriteriaFilter {
    const { rule } = data;
    const isAnomaly: boolean = TelemetryAlertRuleUtil.isAnomaly(
      rule.filterType,
    );

    /*
     * The value as it was stored when it is still the same number: the API
     * and Terraform may have written it as text ("10"), and a rule saved
     * unchanged must save what was there.
     */
    const previousValue: CriteriaFilter["value"] = data.previous?.value;
    const value: CriteriaFilter["value"] = isAnomaly
      ? undefined
      : previousValue !== undefined &&
          TelemetryAlertRuleUtil.toNumber(previousValue) === rule.threshold
        ? previousValue
        : rule.threshold;

    const filter: CriteriaFilter = {
      ...(data.previous || {}),
      checkOn: data.measure,
      filterType: rule.filterType,
      value: value,
    };

    if (data.monitorType === MonitorType.Metrics) {
      const options: MetricMonitorOptions = {
        ...(data.previous?.metricMonitorOptions || {}),
      };

      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "metricAlias",
        rule.metricAlias,
      );
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "metricAggregationType",
        rule.metricAggregationType,
      );
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "onNoDataPolicy",
        rule.onNoDataPolicy,
      );
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "thresholdUnit",
        rule.thresholdUnit,
      );
      /*
       * Kept whichever comparison the rule makes, as the full editor keeps
       * it: a threshold condition ignores it, and a rule switched back to an
       * anomaly finds its sensitivity again.
       */
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "anomalyDetection",
        rule.anomalyDetection,
      );

      filter.metricMonitorOptions = options;
    } else {
      /*
       * A count's anomaly conditions read their sensitivity and baseline
       * from the same options a metric's do (LogMonitorCriteria,
       * TraceMonitorCriteria).
       */
      const options: MetricMonitorOptions = {
        ...(data.previous?.metricMonitorOptions || {}),
      };

      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "anomalyDetection",
        rule.anomalyDetection,
      );

      if (Object.keys(options).length > 0) {
        filter.metricMonitorOptions = options;
      } else {
        delete filter.metricMonitorOptions;
      }
    }

    return filter;
  }

  private static buildRecoveryFilter(data: {
    monitorType: MonitorType;
    ruleFilter: CriteriaFilter;
    previousRecoveryFilter: CriteriaFilter;
    recovery: TelemetryAlertRuleRecovery;
    ruleChanged: boolean;
  }): CriteriaFilter {
    const { ruleFilter, previousRecoveryFilter } = data;

    const recoveryFilter: CriteriaFilter = { ...previousRecoveryFilter };

    /*
     * A metric's recovery reads the same query, unit and aggregation as the
     * rule; the other options (a no-data policy of its own) stay its own.
     */
    if (data.monitorType === MonitorType.Metrics) {
      const options: MetricMonitorOptions = {
        ...(previousRecoveryFilter.metricMonitorOptions || {}),
      };

      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "metricAlias",
        ruleFilter.metricMonitorOptions?.metricAlias,
      );
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "metricAggregationType",
        ruleFilter.metricMonitorOptions?.metricAggregationType,
      );
      TelemetryAlertRuleUtil.setOrDelete(
        options,
        "thresholdUnit",
        ruleFilter.metricMonitorOptions?.thresholdUnit,
      );

      recoveryFilter.metricMonitorOptions = options;
    }

    // Unchanged comparison: the recovery keeps its own wording of it.
    if (!data.ruleChanged) {
      return recoveryFilter;
    }

    const ruleValue: number = TelemetryAlertRuleUtil.toNumber(
      ruleFilter.value,
    )!;

    recoveryFilter.filterType = TelemetryAlertRuleUtil.getOppositeFilterType({
      monitorType: data.monitorType,
      filterType: ruleFilter.filterType!,
      value: ruleValue,
    });

    recoveryFilter.value =
      data.recovery === TelemetryAlertRuleRecovery.OppositeWithMargin
        ? getRecoveryThreshold({
            filterType: ruleFilter.filterType!,
            value: ruleValue,
          }) ?? ruleValue
        : ruleValue;

    return recoveryFilter;
  }

  /*
   * The opposite of a comparison. For a count, "is 0" is written as its
   * opposite "more than 0", as the out-of-the-box criteria write it.
   */
  private static getOppositeFilterType(data: {
    monitorType: MonitorType;
    filterType: FilterType;
    value: number;
  }): FilterType {
    if (
      TelemetryAlertRuleUtil.isCountMonitorType(data.monitorType) &&
      data.filterType === FilterType.EqualTo &&
      data.value === 0
    ) {
      return FilterType.GreaterThan;
    }

    return getRecoveryFilterType(data.filterType);
  }

  private static applyRuleToInstance(data: {
    instance: MonitorCriteriaInstance;
    rule: TelemetryAlertRule;
    filter: CriteriaFilter;
  }): void {
    const { instance, rule } = data;

    if (!instance.data) {
      return;
    }

    instance.data.filters = [data.filter];
    instance.data.name = rule.name;

    const opensIncident: boolean =
      rule.action === TelemetryAlertRuleAction.Incident ||
      rule.action === TelemetryAlertRuleAction.AlertAndIncident;
    const opensAlert: boolean =
      rule.action === TelemetryAlertRuleAction.Alert ||
      rule.action === TelemetryAlertRuleAction.AlertAndIncident;

    instance.data.createIncidents = opensIncident;
    instance.data.createAlerts = opensAlert;

    /*
     * The rows of an action that is off stay, as the full editor keeps them
     * (MonitorCriteriaInstance.getValidationError): turning it back on
     * brings back what was typed. Only the first row is the rule's.
     */
    if (rule.incident) {
      instance.data.incidents = [
        rule.incident,
        ...instance.data.incidents.slice(1),
      ];
    }

    if (rule.alert) {
      instance.data.alerts = [rule.alert, ...instance.data.alerts.slice(1)];
    }

    instance.data.changeMonitorStatus = Boolean(rule.monitorStatusId);
    instance.data.monitorStatusId = rule.monitorStatusId;
  }

  private static isSameComparison(
    previous: CriteriaFilter | undefined,
    next: CriteriaFilter,
  ): boolean {
    if (!previous) {
      return false;
    }

    return (
      previous.filterType === next.filterType &&
      TelemetryAlertRuleUtil.toNumber(previous.value) ===
        TelemetryAlertRuleUtil.toNumber(next.value)
    );
  }

  // A stored value as a number: numbers, and numeric text (the API's).
  public static toNumber(value: unknown): number | undefined {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed: number = Number(value.trim());
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  private static isSameNumber(a: number, b: number): boolean {
    const scale: number = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= scale * 1e-9;
  }

  private static setOrDelete<T, K extends keyof T>(
    target: T,
    key: K,
    value: T[K] | undefined,
  ): void {
    if (value === undefined) {
      delete target[key];
      return;
    }

    target[key] = value;
  }
}
