import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MonitorStepMetricQueries, {
  MetricMonitorStepSettings,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds, {
  MonitorMetricThreshold,
} from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import { MetricInvestigationQueries } from "../Components/Metrics/Investigation/MetricInvestigationQueries";
import { MetricInvestigationThreshold } from "../Components/Metrics/Investigation/MetricInvestigationThresholds";
import { toMetricInvestigationThresholds } from "./MonitorMetricInvestigation";

/*
 * THE RULE THAT OPENED AN INCIDENT OR ALERT, ON ITS METRIC CHARTS (issue
 * #6250). A metrics incident's card charts what its monitor watched; this
 * finds the value the monitor compared the metric with, so the card draws
 * it as the monitor's page does: "CPU above 90" is a line at 90 on the CPU
 * chart.
 *
 * The rule is the criteria the event names (createdCriteriaId), in
 * whichever of its monitor's steps holds it, read as the monitor's page
 * reads it (MonitorStepMetricThresholds). Nothing is drawn when the
 * criteria is gone, cannot be drawn as a line, or no longer compares the
 * metric the event charts:
 *
 * The event keeps the queries the monitor read when it opened it, but not
 * the rule's value. A monitor edited since compares what it compares now.
 * Its line is drawn only while the query or formula it is on still reads
 * the event's metric - the same metric, aggregation and grouping (the
 * event's own series filter aside) - so a line never lands on a chart of
 * something else. A value changed since is drawn as it is now: what the
 * monitor would alert at today.
 *
 * Pure: the card, its tests and the pages read it the same way.
 */

export interface EventRuleMonitor {
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
}

/*
 * What a query compares: its metric, aggregation, grouping and rate. Its
 * filters are left out, so an event's query (with its own series' filter,
 * and the scope its monitor read it with) matches its monitor's step query.
 */
export const getQueryIdentity: (queryConfig: MetricQueryConfigData) => string = (
  queryConfig: MetricQueryConfigData,
): string => {
  const filterData: Record<string, unknown> =
    (queryConfig.metricQueryData?.filterData as unknown as Record<
      string,
      unknown
    >) || {};

  return JSON.stringify({
    metricName: String(filterData["metricName"] || ""),
    aggregationType: String(filterData["aggegationType"] || ""),
    groupByAttributeKeys: [
      ...(queryConfig.metricQueryData?.groupByAttributeKeys || []),
    ]
      .filter(Boolean)
      .sort(),
    transformAsRate: queryConfig.transformAsRate === true,
  });
};

/*
 * What a query or formula compares, leaving its filters out: the event's
 * queries carry its own series' filter (MetricSeriesScope). A formula is
 * its expression and what each query it reads compares. Null when there is
 * none by that variable.
 */
export function getMetricIdentityKey(
  queries: MetricsViewConfig | MetricInvestigationQueries,
  variable: string,
): string | null {
  const query: MetricQueryConfigData | undefined = queries.queryConfigs.find(
    (queryConfig: MetricQueryConfigData): boolean => {
      return queryConfig?.metricAliasData?.metricVariable === variable;
    },
  );

  if (query) {
    return `query:${getQueryIdentity(query)}`;
  }

  const formula: MetricFormulaConfigData | undefined =
    queries.formulaConfigs.find(
      (formulaConfig: MetricFormulaConfigData): boolean => {
        return formulaConfig?.metricAliasData?.metricVariable === variable;
      },
    );

  if (!formula) {
    return null;
  }

  const expression: string = (
    formula.metricFormulaData?.metricFormula || ""
  ).trim();

  return `formula:${JSON.stringify({
    expression,
    referenced: MetricFormulaEvaluator.getReferencedVariables(expression).map(
      (referencedVariable: string): string => {
        const referencedQuery: MetricQueryConfigData | undefined =
          queries.queryConfigs.find(
            (queryConfig: MetricQueryConfigData): boolean => {
              return (
                (
                  queryConfig?.metricAliasData?.metricVariable || ""
                ).toLowerCase() === referencedVariable
              );
            },
          );

        return referencedQuery ? getQueryIdentity(referencedQuery) : "";
      },
    ),
  })}`;
}

/*
 * The lines the event's card draws: the rule that opened it, on the query
 * or formula it compares, while that still reads the event's metric. None
 * when it cannot be found or drawn.
 */
export function getEventMetricThresholds(input: {
  // The criteria that opened the event (Incident / Alert createdCriteriaId).
  createdCriteriaId: string | null | undefined;
  // The monitors the event is on.
  monitors: Array<EventRuleMonitor>;
  // The metrics the event's card starts from: its snapshot's.
  snapshotQueries: MetricInvestigationQueries;
}): Array<MetricInvestigationThreshold> {
  const criteriaId: string = (input.createdCriteriaId || "").trim();

  if (!criteriaId) {
    return [];
  }

  for (const monitor of input.monitors) {
    const step: MonitorStep | null =
      MonitorStepMetricThresholds.findStepOfCriteria({
        monitorSteps: monitor.monitorSteps,
        criteriaId: criteriaId,
      });

    if (!step) {
      continue;
    }

    const thresholds: Array<MonitorMetricThreshold> =
      MonitorStepMetricThresholds.getThresholds({
        monitorType: monitor.monitorType,
        monitorStep: step,
        criteriaIds: [criteriaId],
      });

    const settings: MetricMonitorStepSettings | null =
      MonitorStepMetricQueries.getSettings({
        monitorType: monitor.monitorType,
        monitorStep: step,
      });

    // The step's queries as it keeps them, as the event's snapshot keeps them.
    const stepQueries: MetricsViewConfig =
      MonitorStepMetricMonitorUtil.getMetricViewConfig(
        settings as MonitorStepMetricMonitor | null,
      );

    return toMetricInvestigationThresholds(
      thresholds.filter((threshold: MonitorMetricThreshold): boolean => {
        const nowCompares: string | null = getMetricIdentityKey(
          stepQueries,
          threshold.metricVariable,
        );

        return (
          nowCompares !== null &&
          nowCompares ===
            getMetricIdentityKey(
              input.snapshotQueries,
              threshold.metricVariable,
            )
        );
      }),
    );
  }

  return [];
}
