import Dictionary from "Common/Types/Dictionary";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorStepMetricQueries, {
  MetricMonitorStepSettings,
} from "Common/Utils/Monitor/MonitorStepMetricQueries";
import MonitorStepMetricThresholds from "Common/Utils/Monitor/MonitorStepMetricThresholds";
import MetricTelemetrySnapshot from "Common/Utils/Monitor/MetricTelemetrySnapshot";
import { MetricInvestigationQueries } from "../Components/Metrics/Investigation/MetricInvestigationQueries";
import { EventRuleMonitor, getQueryIdentity } from "./EventMetricThresholds";
import { getMonitorResourceName } from "./MonitorMetricInvestigation";

/*
 * THE METRICS AN INCIDENT'S OR ALERT'S CARD STARTS FROM (issue #6265).
 *
 * An event's metric card charts the snapshot the event keeps of the check
 * that opened it. An infrastructure monitor reads each query narrowed to
 * the cluster, host, vCenter, array or fleet it watches and its resource
 * filters, which the step never stores: charted as the step keeps them, a
 * Proxmox monitor's incident showed the metric for every cluster in the
 * project.
 *
 * - A snapshot stored since keeps beside each query the filters the
 *   monitor added (MetricTelemetrySnapshot): the card charts each query
 *   with them, as the check read it.
 * - One stored before keeps none. It is narrowed from its monitor as it is
 *   now: each of its queries that a step of the monitor still reads - the
 *   same metric, aggregation and grouping, its filters aside, as the event's
 *   rule line is matched (EventMetricThresholds) - takes the filters that
 *   step's monitor adds to it (MonitorStepMetricQueries, held to the
 *   worker), the step holding the event's criteria first. The card says so:
 *   the monitor may have watched another resource when it opened the event.
 *   A query no step reads any more, and a monitor that cannot be read, are
 *   charted as they are.
 *
 * Pure: the card and its tests read it the same way.
 */

export interface EventMetricScope {
  // The metrics the card starts from: the snapshot's, narrowed where needed.
  queries: MetricInvestigationQueries;
  // Whether a query was narrowed from the monitor as it is now.
  isFromMonitorNow: boolean;
  // The resource that monitor watches now, by name; "" when it names none.
  resourceName: string;
}

interface ScopeSource {
  monitorType: MonitorType | undefined;
  settings: MetricMonitorStepSettings;
}

type Attributes = Dictionary<unknown>;

const getAttributes: (queryConfig: MetricQueryConfigData) => Attributes = (
  queryConfig: MetricQueryConfigData,
): Attributes => {
  const attributes: unknown =
    queryConfig.metricQueryData?.filterData?.attributes;

  return attributes &&
    typeof attributes === "object" &&
    !Array.isArray(attributes)
    ? (attributes as Attributes)
    : {};
};

/*
 * The monitors' steps to read a scope from, the step holding the event's
 * criteria first in each monitor, then the rest in order.
 */
const getScopeSources: (input: {
  createdCriteriaId: string;
  monitors: Array<EventRuleMonitor>;
}) => Array<ScopeSource> = (input: {
  createdCriteriaId: string;
  monitors: Array<EventRuleMonitor>;
}): Array<ScopeSource> => {
  const sources: Array<ScopeSource> = [];

  for (const monitor of input.monitors) {
    const steps: Array<MonitorStep> = (
      monitor.monitorSteps?.data?.monitorStepsInstanceArray || []
    ).filter((step: MonitorStep): boolean => {
      return Boolean(step && typeof step === "object");
    });

    const criteriaStep: MonitorStep | null = input.createdCriteriaId
      ? MonitorStepMetricThresholds.findStepOfCriteria({
          monitorSteps: monitor.monitorSteps,
          criteriaId: input.createdCriteriaId,
        })
      : null;

    const ordered: Array<MonitorStep> = criteriaStep
      ? [
          criteriaStep,
          ...steps.filter((step: MonitorStep): boolean => {
            return step !== criteriaStep;
          }),
        ]
      : steps;

    for (const step of ordered) {
      const settings: MetricMonitorStepSettings | null =
        MonitorStepMetricQueries.getSettings({
          monitorType: monitor.monitorType,
          monitorStep: step,
        });

      if (settings) {
        sources.push({ monitorType: monitor.monitorType, settings: settings });
      }
    }
  }

  return sources;
};

/*
 * The filters a monitor adds to one of its step's queries: what it reads
 * the query with that the query does not say itself (a value of its own the
 * monitor overrides counts). Null when no query of the step compares what
 * this one does.
 */
const getAddedScope: (input: {
  source: ScopeSource;
  identity: string;
}) => Attributes | null = (input: {
  source: ScopeSource;
  identity: string;
}): Attributes | null => {
  const stepQuery: MetricQueryConfigData | undefined =
    MonitorStepMetricMonitorUtil.getMetricViewConfig(
      input.source.settings as MonitorStepMetricMonitor,
    ).queryConfigs.find((queryConfig: MetricQueryConfigData): boolean => {
      return Boolean(
        queryConfig &&
          typeof queryConfig === "object" &&
          getQueryIdentity(queryConfig) === input.identity,
      );
    });

  if (!stepQuery) {
    return null;
  }

  const read: Attributes =
    (MonitorStepMetricQueries.getReadAttributes({
      monitorType: input.source.monitorType,
      settings: input.source.settings,
      queryConfig: stepQuery,
    }) as Attributes | undefined) || {};
  const own: Attributes = getAttributes(stepQuery);

  const added: Attributes = {};

  for (const key of Object.keys(read)) {
    if (
      !Object.prototype.hasOwnProperty.call(own, key) ||
      !JSONFunctions.deepEqual(own[key], read[key])
    ) {
      added[key] = read[key];
    }
  }

  return added;
};

export function getEventMetricScope(input: {
  // The metrics the event's card starts from: its snapshot's.
  snapshotQueries: MetricInvestigationQueries;
  /*
   * The filters the snapshot keeps beside its queries, one per query
   * (MetricTelemetrySnapshot.getStoredScopes); null for one stored before.
   */
  storedScopes: Array<Dictionary<unknown> | null> | null;
  // The criteria that opened the event (Incident / Alert createdCriteriaId).
  createdCriteriaId: string | null | undefined;
  // The monitors the event is on, as they are now.
  monitors: Array<EventRuleMonitor>;
}): EventMetricScope {
  const scopedBy: (
    scopes: Array<Dictionary<unknown> | null>,
  ) => MetricInvestigationQueries = (
    scopes: Array<Dictionary<unknown> | null>,
  ): MetricInvestigationQueries => {
    const queryConfigs: Array<MetricQueryConfigData> =
      MetricTelemetrySnapshot.applyScopes({
        queryConfigs: input.snapshotQueries.queryConfigs,
        scopes: scopes,
      });

    return queryConfigs === input.snapshotQueries.queryConfigs
      ? input.snapshotQueries
      : {
          queryConfigs: queryConfigs,
          formulaConfigs: input.snapshotQueries.formulaConfigs,
        };
  };

  // Kept with the snapshot: each query as the check read it.
  if (input.storedScopes) {
    return {
      queries: scopedBy(input.storedScopes),
      isFromMonitorNow: false,
      resourceName: "",
    };
  }

  const unchanged: EventMetricScope = {
    queries: input.snapshotQueries,
    isFromMonitorNow: false,
    resourceName: "",
  };

  const sources: Array<ScopeSource> = getScopeSources({
    createdCriteriaId: (input.createdCriteriaId || "").trim(),
    monitors: input.monitors,
  });

  if (sources.length === 0) {
    return unchanged;
  }

  let resourceName: string = "";

  // Stored before: what the monitor adds to each query now.
  const scopes: Array<Dictionary<unknown> | null> =
    input.snapshotQueries.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): Dictionary<unknown> | null => {
        if (!queryConfig || typeof queryConfig !== "object") {
          return null;
        }

        const identity: string = getQueryIdentity(queryConfig);

        for (const source of sources) {
          const added: Attributes | null = getAddedScope({
            source: source,
            identity: identity,
          });

          if (added === null) {
            continue;
          }

          const attributes: Attributes = getAttributes(queryConfig);

          // Only what it would change: a snapshot that reads it already is kept.
          if (
            JSONFunctions.deepEqual({ ...attributes, ...added }, attributes)
          ) {
            return null;
          }

          resourceName =
            resourceName || getMonitorResourceName(source.settings);

          return added;
        }

        return null;
      },
    );

  const queries: MetricInvestigationQueries = scopedBy(scopes);

  if (queries === input.snapshotQueries) {
    return unchanged;
  }

  return {
    queries: queries,
    isFromMonitorNow: true,
    resourceName: resourceName,
  };
}
