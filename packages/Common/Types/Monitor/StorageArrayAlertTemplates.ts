import ObjectID from "../ObjectID";
import PlatformMetricUnitUtil from "../../Utils/Monitor/PlatformMetricUnitUtil";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import {
  STOPPED_REPORTING_METRIC_ALIAS,
  buildHealthyCriteriaInstance,
  buildStoppedReportingCriteriaInstances,
  buildUnhealthyCriteriaInstance,
} from "./Recommendation/RecommendationCriteriaBuilder";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorStepStorageArrayMonitor from "./MonitorStepStorageArrayMonitor";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import StorageSystem from "../StorageArray/StorageSystem";
import StorageSystemUtil from "../StorageArray/StorageSystemUtil";
import StorageArrayPlatformRegistry from "../StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayAlertTemplateCategory,
  StorageArrayAlertTemplateRatio,
  StorageArrayAlertTemplateSeverity,
  StorageArrayAlertTemplateSpec,
  StorageArrayPlatform,
} from "../StorageArray/StorageArrayPlatform";

export type {
  StorageArrayAlertTemplateCategory,
  StorageArrayAlertTemplateSeverity,
  StorageArrayAlertTemplateSpec,
};

export interface StorageArrayAlertTemplateArgs {
  // StorageArray.name — the `storage.array.name` resource attribute.
  arrayIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface StorageArrayAlertTemplate {
  id: string;
  name: string;
  /*
   * One plain sentence: when the template fires, with its threshold and
   * window, without metric names. The picker and a resource's
   * Recommendations list show it on the card; `description` (how it is
   * computed, and its caveats) is shown once a template is picked.
   */
  summary: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  // The platforms whose metrics the template reads.
  storageSystems: Array<StorageSystem>;
  getMonitorStep: (args: StorageArrayAlertTemplateArgs) => MonitorStep;
}

/*
 * THE STORAGE ARRAY ALERT TEMPLATES: every platform's, built from the specs
 * in its folder (StorageArrayPlatform.alertTemplates, Platforms/<Vendor>/
 * <Product>/) by the builders below, and listed in the order the platforms
 * are (StorageArrayPlatformRegistry). Each platform's list starts with its
 * Array Stopped Reporting, built from its heartbeat series. Its templates
 * are also what Recommendations offers an array of that platform
 * (MonitorRecommendationCatalog).
 *
 * A platform's file says how its series carry state: the filters its
 * templates pin, and which ones exist only while an object is in a state
 * (those recover once the series is gone: STORAGE_ARRAY_RECOVER_WHEN_ABSENT).
 */

export function buildStorageArrayMonitorStep(args: {
  storageArrayMonitor: MonitorStepStorageArrayMonitor;
  offlineCriteriaInstance: MonitorCriteriaInstance;
  onlineCriteriaInstance: MonitorCriteriaInstance;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();

  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      args.offlineCriteriaInstance,
      args.onlineCriteriaInstance,
    ],
  };

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: monitorCriteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: undefined,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
    profileMonitor: undefined,
    dockerMonitor: undefined,
    storageArrayMonitor: args.storageArrayMonitor,
  };

  return monitorStep;
}

export function buildStorageArrayOfflineCriteriaInstance(args: {
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
  monitorName: string;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  // Any reading of the window, not all of them (an event's).
  onAnyReading?: boolean | undefined;
  incidentTitle?: string;
  incidentDescription?: string;
  criteriaName?: string;
  criteriaDescription?: string;
}): MonitorCriteriaInstance {
  const { onAnyReading, ...criteria } = args;
  return buildUnhealthyCriteriaInstance({
    ...criteria,
    ...(onAnyReading
      ? { metricAggregationType: EvaluateOverTimeType.AnyValue }
      : {}),
    resourceNoun: "storage array",
  });
}

export function buildStorageArrayOnlineCriteriaInstance(args: {
  onlineMonitorStatusId: ObjectID;
  metricAlias: string;
  filterType: FilterType;
  value: number;
  isBinaryMetric?: boolean | undefined;
  /*
   * State-in-a-label series exist only while the object is in that state,
   * so the recover comparison (= 0) would otherwise see no data and never
   * match. TreatAsZero makes series absence count as 0.
   */
  treatNoDataAsZero?: boolean | undefined;
}): MonitorCriteriaInstance {
  return buildHealthyCriteriaInstance(args);
}

export function buildStorageArrayMonitorConfig(args: {
  arrayIdentifier: string;
  storageSystem?: StorageSystem | undefined;
  metricName: string;
  metricAlias: string;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string>;
  groupByAttributeKey?: string | undefined;
  // The labels the object is named within (StorageArrayAlertTemplateSpec).
  scopeAttributeKeys?: ReadonlyArray<string> | undefined;
  /*
   * The series' display unit. Defaults to the unit the catalog gives the
   * metric (for its label filters: Pure puts several quantities on one
   * metric name), which every template and Custom Metric threw away. The
   * criteria take it as the sample unit and, unless a threshold names its
   * own, the threshold's: without it a latency threshold read as a bare
   * number of microseconds, and the threshold had no unit list. The worker
   * reads values in the same catalog units, so nothing is rescaled.
   */
  legendUnit?: string | undefined;
  /*
   * A second query of the same objects, and the quotient the criteria
   * read instead (StorageArrayAlertTemplateSpec.ratioTo).
   */
  ratioTo?: StorageArrayAlertTemplateRatio | undefined;
}): MonitorStepStorageArrayMonitor {
  const legendUnit: string | undefined =
    args.legendUnit ??
    PlatformMetricUnitUtil.getMetricUnit({
      platform: "storageArray",
      metricName: args.metricName,
      attributes: args.attributes,
    });

  const queryConfig: (query: {
    metricAlias: string;
    metricName: string;
    attributes?: Record<string, string> | undefined;
    aggregationType: MetricsAggregationType;
    legendUnit: string | undefined;
  }) => MonitorStepStorageArrayMonitor["metricViewConfig"]["queryConfigs"][number] = (query: {
    metricAlias: string;
    metricName: string;
    attributes?: Record<string, string> | undefined;
    aggregationType: MetricsAggregationType;
    legendUnit: string | undefined;
  }): MonitorStepStorageArrayMonitor["metricViewConfig"]["queryConfigs"][number] => {
    return {
      metricAliasData: {
        metricVariable: query.metricAlias,
        title: query.metricAlias,
        description: query.metricAlias,
        legend: query.metricAlias,
        legendUnit: query.legendUnit,
      },
      metricQueryData: {
        filterData: {
          metricName: query.metricName,
          attributes: query.attributes || {},
          aggegationType: query.aggregationType,
          aggregateBy: {},
        },
        ...(args.groupByAttributeKey
          ? {
              groupByAttributeKeys: [
                args.groupByAttributeKey,
                ...(args.scopeAttributeKeys || []),
              ],
            }
          : {}),
      },
    };
  };

  if (args.ratioTo) {
    const ratio: StorageArrayAlertTemplateRatio = args.ratioTo;
    return {
      arrayIdentifier: args.arrayIdentifier,
      storageSystem: args.storageSystem,
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            metricAlias: args.metricAlias,
            metricName: args.metricName,
            attributes: args.attributes,
            aggregationType: args.aggregationType,
            legendUnit: legendUnit,
          }),
          queryConfig({
            metricAlias: ratio.metricAlias,
            metricName: ratio.metricName,
            attributes: ratio.attributes,
            aggregationType: ratio.aggregationType,
            legendUnit: PlatformMetricUnitUtil.getMetricUnit({
              platform: "storageArray",
              metricName: ratio.metricName,
              attributes: ratio.attributes,
            }),
          }),
        ],
        formulaConfigs: [
          {
            metricAliasData: {
              metricVariable: ratio.formulaAlias,
              title: ratio.formulaAlias,
              description: ratio.formulaAlias,
              legend: ratio.formulaAlias,
              legendUnit: ratio.unit || undefined,
            },
            metricFormulaData: {
              metricFormula: `${args.metricAlias} / ${ratio.metricAlias}`,
            },
          },
        ],
      },
      rollingTime: args.rollingTime,
    };
  }

  return {
    arrayIdentifier: args.arrayIdentifier,
    storageSystem: args.storageSystem,
    resourceFilters: {},
    metricViewConfig: {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: args.metricAlias,
            title: args.metricAlias,
            description: args.metricAlias,
            legend: args.metricAlias,
            legendUnit: legendUnit,
          },
          metricQueryData: {
            filterData: {
              metricName: args.metricName,
              attributes: args.attributes || {},
              aggegationType: args.aggregationType,
              aggregateBy: {},
            },
            ...(args.groupByAttributeKey
              ? {
                  groupByAttributeKeys: [
                    args.groupByAttributeKey,
                    ...(args.scopeAttributeKeys || []),
                  ],
                }
              : {}),
          },
        },
      ],
      formulaConfigs: [],
    },
    rollingTime: args.rollingTime,
  };
}

function singleQueryTemplate(
  spec: StorageArrayAlertTemplateSpec,
  storageSystem: StorageSystem,
): StorageArrayAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    storageSystems: [storageSystem],
    getMonitorStep: (args: StorageArrayAlertTemplateArgs): MonitorStep => {
      return buildStorageArrayMonitorStep({
        storageArrayMonitor: buildStorageArrayMonitorConfig({
          arrayIdentifier: args.arrayIdentifier,
          storageSystem: storageSystem,
          metricName: spec.metricName,
          metricAlias: spec.metricAlias,
          rollingTime: spec.rollingTime,
          aggregationType: spec.aggregationType,
          ...(spec.attributes ? { attributes: spec.attributes } : {}),
          groupByAttributeKey: spec.groupByAttributeKey,
          scopeAttributeKeys: spec.scopeAttributeKeys,
          ratioTo: spec.ratioTo,
        }),
        offlineCriteriaInstance: buildStorageArrayOfflineCriteriaInstance({
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          // A ratio template's criteria read the quotient.
          metricAlias: spec.ratioTo?.formulaAlias || spec.metricAlias,
          filterType: spec.fire.filterType,
          value: spec.fire.value,
          onAnyReading: spec.fire.onAnyReading,
          incidentTitle: `${spec.incidentTitle} - ${args.monitorName}`,
          incidentDescription: spec.incidentDescription,
          criteriaName: spec.criteriaName,
          criteriaDescription: spec.criteriaDescription,
        }),
        onlineCriteriaInstance: buildStorageArrayOnlineCriteriaInstance({
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          metricAlias: spec.ratioTo?.formulaAlias || spec.metricAlias,
          filterType: spec.recover.filterType,
          value: spec.recover.value,
          isBinaryMetric: spec.recover.isBinaryMetric,
          treatNoDataAsZero: spec.recover.treatNoDataAsZero,
        }),
      });
    },
  };
}

/*
 * "Array Stopped Reporting", one per platform: the heartbeat is the
 * platform's identity series (StorageArrayPlatform.heartbeat). Every
 * endpoint the Storage Array Agent scrapes exports it, value 1, with the
 * array's name and version as labels, on every scrape, whatever state the
 * array is in. Ungrouped and counted: only a window with no row at all is
 * the breach.
 */
function arrayStoppedReportingTemplate(data: {
  id: string;
  storageSystem: StorageSystem;
  platformName: string;
  infoMetricName: string;
  /*
   * What the agent logs in with, in a sentence: "API token" (the default)
   * or "password", for a platform whose agent logs in with a user.
   */
  credential?: string | undefined;
}): StorageArrayAlertTemplate {
  const credential: string = data.credential || "API token";
  return {
    id: data.id,
    name: "Array Stopped Reporting",
    summary: "The array sends no data for 10 minutes.",
    description: `Alert when the ${data.platformName} sends no data for ten minutes: the Storage Array Agent stopped, lost its route to OneUptime or had its token revoked, or the array stopped answering it (down, unreachable, or its read-only ${credential} no longer works). Reads ${data.infoMetricName}, which every endpoint the agent scrapes exports on every scrape.`,
    category: "Availability",
    severity: "Critical",
    storageSystems: [data.storageSystem],
    getMonitorStep: (args: StorageArrayAlertTemplateArgs): MonitorStep => {
      const metricAlias: string = STOPPED_REPORTING_METRIC_ALIAS;

      return buildStorageArrayMonitorStep({
        storageArrayMonitor: buildStorageArrayMonitorConfig({
          arrayIdentifier: args.arrayIdentifier,
          storageSystem: data.storageSystem,
          metricName: data.infoMetricName,
          metricAlias,
          rollingTime: RollingTime.Past10Minutes,
          aggregationType: MetricsAggregationType.Count,
        }),
        ...buildStoppedReportingCriteriaInstances({
          onlineMonitorStatusId: args.onlineMonitorStatusId,
          offlineMonitorStatusId: args.offlineMonitorStatusId,
          incidentSeverityId: args.defaultIncidentSeverityId,
          alertSeverityId: args.defaultAlertSeverityId,
          monitorName: args.monitorName,
          metricAlias,
          resourceNoun: "storage array",
          incidentTitle: `[Storage Array] Array Stopped Reporting - ${args.monitorName}`,
          incidentDescription: `OneUptime has received no data from this ${data.platformName} for ten minutes, so its other monitors have nothing to evaluate either. Check, in order: whether the array's management address answers from the agent's machine, whether the read-only user's ${credential} still works, whether the Storage Array Agent's containers are running and what the collector's log says, and whether the agent can reach OneUptime with its token. The incident resolves on its own once data arrives again.`,
          criteriaName: "Array Stopped Reporting - No data for 10 minutes",
          criteriaDescription: `Triggers when the array sends no ${data.infoMetricName} data for the whole ten-minute window.`,
        }),
      });
    },
  };
}

/*
 * One platform's templates: its Array Stopped Reporting, then its specs in
 * order. Built once per platform, so a template is one object between
 * calls.
 */
const templatesByPlatform: WeakMap<
  StorageArrayPlatform,
  Array<StorageArrayAlertTemplate>
> = new WeakMap();

function getPlatformTemplates(
  platform: StorageArrayPlatform,
): Array<StorageArrayAlertTemplate> {
  let templates: Array<StorageArrayAlertTemplate> | undefined =
    templatesByPlatform.get(platform);
  if (!templates) {
    const storageSystem: StorageSystem =
      platform.storageSystem as StorageSystem;
    templates = [
      arrayStoppedReportingTemplate({
        id: platform.heartbeat.templateId,
        storageSystem: storageSystem,
        platformName: platform.shortName,
        infoMetricName: platform.heartbeat.metricName,
        credential: platform.agentConfigs.some(
          (config: StorageArrayPlatform["agentConfigs"][number]): boolean => {
            return Boolean(config.userVariable);
          },
        )
          ? "password"
          : undefined,
      }),
      ...platform.alertTemplates.map(
        (spec: StorageArrayAlertTemplateSpec): StorageArrayAlertTemplate => {
          return singleQueryTemplate(spec, storageSystem);
        },
      ),
    ];
    templatesByPlatform.set(platform, templates);
  }
  return templates;
}

export function getAllStorageArrayAlertTemplates(): Array<StorageArrayAlertTemplate> {
  return StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): Array<StorageArrayAlertTemplate> => {
      return getPlatformTemplates(platform);
    },
  );
}

/*
 * The templates for one platform. An array whose platform is not known yet
 * (no batch has reported it) gets every template, each named with its
 * platform — FlashArray and FlashBlade both have a "Capacity Above 80%", and
 * the two must be told apart in one list.
 */
export function getStorageArrayAlertTemplatesForSystem(
  system: string | null | undefined,
): Array<StorageArrayAlertTemplate> {
  const forSystem: Array<StorageArrayAlertTemplate> =
    getAllStorageArrayAlertTemplates().filter(
      (template: StorageArrayAlertTemplate) => {
        return (template.storageSystems as Array<string>).includes(
          system as string,
        );
      },
    );

  if (forSystem.length > 0) {
    return forSystem;
  }

  return getAllStorageArrayAlertTemplates().map(
    (template: StorageArrayAlertTemplate) => {
      const platforms: string = template.storageSystems
        .map((templateSystem: StorageSystem) => {
          return StorageSystemUtil.getShortName(templateSystem);
        })
        .join(", ");
      return { ...template, name: `${template.name} (${platforms})` };
    },
  );
}

export function getStorageArrayAlertTemplatesByCategory(
  category: StorageArrayAlertTemplateCategory,
): Array<StorageArrayAlertTemplate> {
  return getAllStorageArrayAlertTemplates().filter(
    (template: StorageArrayAlertTemplate) => {
      return template.category === category;
    },
  );
}

export function getStorageArrayAlertTemplateById(
  id: string,
): StorageArrayAlertTemplate | undefined {
  return getAllStorageArrayAlertTemplates().find(
    (template: StorageArrayAlertTemplate) => {
      return template.id === id;
    },
  );
}

/*
 * The template a NEW storage array monitor starts on: the array going
 * silent, for the array's platform. It is the one template that still speaks
 * when every other one has stopped being evaluated, and it has no threshold
 * to tune. An array whose platform is not known yet gets the default
 * platform's, the one the agent assumes (STORAGE_SYSTEM).
 */
export function getStorageArrayDefaultAlertTemplateId(
  system?: string | null | undefined,
): string {
  return StorageArrayPlatformRegistry.getPlatformOrDefault(system).heartbeat
    .templateId;
}
