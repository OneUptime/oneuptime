import OneUptimeDate from "Common/Types/Date";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and rules of an infrastructure monitor's setup - Host,
 * Kubernetes, Docker, Podman, Docker Swarm, Proxmox, VMware, Ceph, Storage
 * Array and IoT Device - in the one shape all ten share
 * (InfrastructureMonitorSetup):
 *
 *   1. what to watch: the host, cluster, vCenter, array or fleet, with
 *      whether it is sending data, and - when there is none yet - the
 *      install steps, keys filled in, that wait for its first data;
 *   2. what to alert on: the alert templates, starting on the type's
 *      default (it stopped reporting, or IoT's Device Offline);
 *   3. More fields, folded: a metric of your own (Custom Metric) or the
 *      query builder (Advanced).
 *
 * React-free, so App tests can read it.
 */

export const INFRASTRUCTURE_ALERT_SECTION_TITLE: string =
  translationKey("What to alert on");

export const INFRASTRUCTURE_MORE_FIELDS_SUMMARY: string = translationKey(
  "Watch a metric of your own, or build the query yourself.",
);

// The two ways under More fields, by the names the docs give them.
export const INFRASTRUCTURE_CUSTOM_METRIC_TAB: string = "Custom Metric";
export const INFRASTRUCTURE_QUERY_BUILDER_TAB: string = "Advanced";

export const INFRASTRUCTURE_NOTHING_SENDING: string = translationKey(
  "Nothing is sending data yet.",
);

export const INFRASTRUCTURE_ADD_EXPLANATION: string = translationKey(
  "The install steps come with your keys filled in, and wait for the first data.",
);

export const INFRASTRUCTURE_RECEIVING_DATA: string = translationKey(
  "Receiving data. Last data {{time}}.",
);

export const INFRASTRUCTURE_QUIET: string = translationKey(
  "No data since {{time}}. Check that its agent is running.",
);

export const INFRASTRUCTURE_ADD_VCENTER: string = translationKey("Add vCenter");

/*
 * How the way a step watches its data is chosen when the form opens: a new
 * step starts on its alert template, a step that already reads a query
 * without one opens More fields on the query builder, so it can be read and
 * changed where it was made.
 */
export enum InfrastructureWatchWay {
  AlertTemplate = "alert-template",
  CustomMetric = "custom-metric",
  QueryBuilder = "query-builder",
}

export function getInitialWatchWay(input: {
  queryCount: number;
  isTemplatePicked: boolean;
}): InfrastructureWatchWay {
  if (input.queryCount === 0 || input.isTemplatePicked) {
    return InfrastructureWatchWay.AlertTemplate;
  }

  return InfrastructureWatchWay.QueryBuilder;
}

/*
 * Whether the picked resource is sending data. Agents report every 30 to 60
 * seconds, so a resource heard from in the last ten minutes is receiving; one
 * heard from before that has gone quiet.
 */
export const RECEIVING_WINDOW_IN_MINUTES: number = 10;

export enum ResourceDataState {
  Receiving = "receiving",
  Quiet = "quiet",
  Unknown = "unknown",
}

export function getResourceDataState(input: {
  lastSeenAt: Date | string | null | undefined;
  now: Date;
}): ResourceDataState {
  if (!input.lastSeenAt) {
    return ResourceDataState.Unknown;
  }

  const lastSeenAt: Date = OneUptimeDate.fromString(input.lastSeenAt);

  if (isNaN(lastSeenAt.getTime())) {
    return ResourceDataState.Unknown;
  }

  const minutes: number =
    (input.now.getTime() - lastSeenAt.getTime()) / (60 * 1000);

  return minutes <= RECEIVING_WINDOW_IN_MINUTES
    ? ResourceDataState.Receiving
    : ResourceDataState.Quiet;
}

/*
 * What a step's metric view reads, as one comparable string: each query's
 * variable, metric, aggregation, filters and group-by, each formula's
 * variable and expression - in no particular order.
 */
export function getMetricsViewSignature(
  config: MetricsViewConfig | undefined,
): string {
  const queries: Array<string> = (config?.queryConfigs || [])
    .map((query: MetricQueryConfigData): string => {
      const filterData: Record<string, unknown> = (query.metricQueryData
        ?.filterData || {}) as unknown as Record<string, unknown>;
      const attributes: Record<string, unknown> =
        (filterData["attributes"] as Record<string, unknown> | undefined) || {};

      return JSON.stringify([
        query.metricAliasData?.metricVariable || "",
        String(filterData["metricName"] || ""),
        String(filterData["aggegationType"] || ""),
        Object.keys(attributes)
          .sort()
          .map((key: string): string => {
            return `${key}=${JSON.stringify(attributes[key])}`;
          }),
        [...(query.metricQueryData?.groupByAttributeKeys || [])].sort(),
      ]);
    })
    .sort();

  const formulas: Array<string> = (config?.formulaConfigs || [])
    .map((formula: MetricFormulaConfigData): string => {
      return JSON.stringify([
        formula.metricAliasData?.metricVariable || "",
        formula.metricFormulaData?.metricFormula || "",
      ]);
    })
    .sort();

  return JSON.stringify({ queries: queries, formulas: formulas });
}

/*
 * The alert template a saved step was made from, or undefined. Opening a
 * monitor made from a template shows that template picked - folded, as it
 * was left - instead of an empty list over a query builder.
 */
export function findTemplateIdForMetricsView<T extends { id: string }>(input: {
  templates: Array<T>;
  getMetricsViewConfig: (template: T) => MetricsViewConfig | undefined;
  current: MetricsViewConfig | undefined;
}): string | undefined {
  if (!input.current || (input.current.queryConfigs || []).length === 0) {
    return undefined;
  }

  const current: string = getMetricsViewSignature(input.current);

  for (const template of input.templates) {
    if (
      getMetricsViewSignature(input.getMetricsViewConfig(template)) === current
    ) {
      return template.id;
    }
  }

  return undefined;
}
