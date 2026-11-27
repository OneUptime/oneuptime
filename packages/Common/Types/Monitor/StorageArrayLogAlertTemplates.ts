import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import StorageSystem from "../StorageArray/StorageSystem";
import StorageArrayPlatformRegistry from "../StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayAlertTemplateCategory,
  StorageArrayAlertTemplateSeverity,
  StorageArrayLogAlertTemplateSpec,
  StorageArrayPlatform,
} from "../StorageArray/StorageArrayPlatform";
import { StorageArrayAlertTemplateArgs } from "./StorageArrayAlertTemplates";

/*
 * THE STORAGE ARRAY ALERTS AN ARRAY RAISES ITSELF.
 *
 * A platform whose arrays send their own alerts as logs (a PowerStore's
 * remote syslog, which its agent parses into attributes) declares the
 * templates over those logs as data (StorageArrayPlatform.logAlertTemplates),
 * and these builders make each one a Logs monitor scoped to the array: the
 * array's lines that carry the template's attributes, grouped so each of the
 * array's alerts raises its own, and resolved by the array's own line that
 * says the alert is over (MonitorStepLogMonitor.resolvedByAttributes) - never
 * just because the window moved on, so an alert stays open as long as the
 * array keeps it open. They are offered on an array's Recommendations page
 * under the Array Alerts heading, beside the metric templates
 * (MonitorRecommendationCatalog); a storage array monitor reads metrics, and
 * its Quick Setup never lists them.
 */

// The resource attribute every line of an array's agent carries, as logs store it.
export const STORAGE_ARRAY_NAME_LOG_ATTRIBUTE: string =
  "resource.storage.array.name";

export interface StorageArrayLogAlertTemplate {
  id: string;
  name: string;
  summary: string;
  description: string;
  category: StorageArrayAlertTemplateCategory;
  severity: StorageArrayAlertTemplateSeverity;
  // The platforms whose logs the template reads.
  storageSystems: Array<StorageSystem>;
  getMonitorStep: (args: StorageArrayAlertTemplateArgs) => MonitorStep;
}

// The Logs monitor's query: the array's lines of this template, grouped.
export function buildStorageArrayLogMonitor(data: {
  spec: StorageArrayLogAlertTemplateSpec;
  arrayIdentifier: string;
}): MonitorStepLogMonitor {
  return {
    attributes: {
      [STORAGE_ARRAY_NAME_LOG_ATTRIBUTE]: data.arrayIdentifier,
      ...data.spec.attributes,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: data.spec.windowSeconds,
    groupByAttributes: [...data.spec.groupByAttributes],
    /*
     * The resolving query uses these attributes alone, so they name the
     * array too.
     */
    resolvedByAttributes: {
      [STORAGE_ARRAY_NAME_LOG_ATTRIBUTE]: data.arrayIdentifier,
      ...data.spec.resolvedByAttributes,
    },
  };
}

function buildCriteria(data: {
  spec: StorageArrayLogAlertTemplateSpec;
  args: StorageArrayAlertTemplateArgs;
}): MonitorCriteria {
  const title: string = `${data.spec.incidentTitle} - ${data.args.monitorName}`;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ],
    incidents: [
      {
        title: title,
        description: data.spec.incidentDescription,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: title,
        description: data.spec.incidentDescription,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    // Both, as every template ships (see KubernetesEventAlertTemplates).
    createIncidents: true,
    createAlerts: true,
    name: `${data.args.monitorName} - ${data.spec.criteriaName}`,
    description: data.spec.criteriaDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: data.spec.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

export function buildStorageArrayLogAlertMonitorStep(data: {
  spec: StorageArrayLogAlertTemplateSpec;
  args: StorageArrayAlertTemplateArgs;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: buildCriteria(data),
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: buildStorageArrayLogMonitor({
      spec: data.spec,
      arrayIdentifier: data.args.arrayIdentifier,
    }),
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
  };

  return monitorStep;
}

/*
 * One platform's log templates, built once per platform, so a template is
 * one object between calls.
 */
const templatesByPlatform: WeakMap<
  StorageArrayPlatform,
  Array<StorageArrayLogAlertTemplate>
> = new WeakMap();

function getPlatformLogTemplates(
  platform: StorageArrayPlatform,
): Array<StorageArrayLogAlertTemplate> {
  let templates: Array<StorageArrayLogAlertTemplate> | undefined =
    templatesByPlatform.get(platform);
  if (!templates) {
    const storageSystem: StorageSystem =
      platform.storageSystem as StorageSystem;
    templates = (platform.logAlertTemplates || []).map(
      (
        spec: StorageArrayLogAlertTemplateSpec,
      ): StorageArrayLogAlertTemplate => {
        return {
          id: spec.id,
          name: spec.name,
          summary: spec.summary,
          description: spec.description,
          category: spec.category,
          severity: spec.severity,
          storageSystems: [storageSystem],
          getMonitorStep: (
            args: StorageArrayAlertTemplateArgs,
          ): MonitorStep => {
            return buildStorageArrayLogAlertMonitorStep({ spec, args });
          },
        };
      },
    );
    templatesByPlatform.set(platform, templates);
  }
  return templates;
}

// Every platform's log templates, in the order the platforms are listed.
export function getAllStorageArrayLogAlertTemplates(): Array<StorageArrayLogAlertTemplate> {
  return StorageArrayPlatformRegistry.getPlatforms().flatMap(
    (platform: StorageArrayPlatform): Array<StorageArrayLogAlertTemplate> => {
      return getPlatformLogTemplates(platform);
    },
  );
}

/*
 * The log templates of one platform: none for an array whose platform is
 * not known yet. Unlike the metric templates, nothing is offered across
 * platforms meanwhile: these read one platform's log attributes, which no
 * other platform's agent writes.
 */
export function getStorageArrayLogAlertTemplatesForSystem(
  system: string | null | undefined,
): Array<StorageArrayLogAlertTemplate> {
  const platform: StorageArrayPlatform | null =
    StorageArrayPlatformRegistry.getPlatform(system);
  return platform ? getPlatformLogTemplates(platform) : [];
}

export function getStorageArrayLogAlertTemplateById(
  id: string,
): StorageArrayLogAlertTemplate | undefined {
  return getAllStorageArrayLogAlertTemplates().find(
    (template: StorageArrayLogAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}
