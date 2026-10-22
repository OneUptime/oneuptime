import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ActiveMonitorLimitUtil, {
  ActiveMonitorLimitStatus,
} from "Common/Types/Monitor/ActiveMonitorLimit";
import { NetworkAlertPolicyScopeUtil } from "Common/Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "Common/Types/ObjectID";
import DeviceMonitorTemplateUtil, {
  DEVICE_MONITOR_TEMPLATE_TYPES,
  isDeviceAddressMonitorType,
  isDeviceMonitorTemplateType,
} from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { summarizeMonitorTemplateAlerts } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import NetworkAlertPolicyBootstrapUtil, {
  RECOMMENDED_TEMPLATE_NAME,
} from "Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { fetchActiveMonitorLimitStatus } from "../../Monitor/ActiveMonitorLimitStatusApi";
import PingMonitorSeedIds, { SeedIdsPurpose } from "../PingMonitorSeedIds";
import { buildRecommendedMonitorTemplatePreview } from "../RecommendedMonitorTemplate";
import {
  DiscoveryImportPolicyFact,
  DiscoveryImportTemplateChoice,
} from "./DiscoveryImportOutcome";
import { NO_DEVICE_MONITOR_TEMPLATE_REASON } from "./DiscoveryImportTemplateCopy";

// Its tests read it where the facts are read.
export { NO_DEVICE_MONITOR_TEMPLATE_REASON };

/*
 * What the import's monitoring step needs to know about the project, read
 * when the reader reaches that step: the monitor templates they can pick -
 * Network Device ones, and since issue #5145 Ping, IP, Port and NTP ones -
 * with what each raises, the names of the severities and statuses those
 * templates name, the alert policies that already cover devices, how much
 * room the plan has for monitors, and what the reader may do. Every read can
 * fail on its own - a reader who may not list templates still imports
 * devices - so each one is settled separately, and what failed is said
 * where it matters rather than failing the step.
 */

export interface NamedColor {
  name: string;
  // A CSS colour, when the record has one.
  color?: string | undefined;
}

export interface DiscoveryImportProjectFacts {
  /*
   * The templates the reader can pick, the recommended one first - the
   * project's own when it has it, else the one Import would create, when
   * the reader may create templates and the project has what it needs.
   */
  templates: Array<DiscoveryImportTemplateChoice>;
  // Why no template can be picked, when none can.
  templatesUnavailableReason?: string | undefined;
  /*
   * Whether the project's templates were read: a read that failed lists
   * none, and must not be taken for a project that has none.
   */
  didReadTemplates: boolean;
  incidentSeverities: Map<string, NamedColor>;
  alertSeverities: Map<string, NamedColor>;
  monitorStatuses: Map<string, NamedColor>;
  policies: Array<DiscoveryImportPolicyFact>;
  // The plan's limit on active monitors, when it has one and it was read.
  monitorLimitStatus: ActiveMonitorLimitStatus | null;
  // How many more monitors fit; null when there is no limit (or not known).
  monitorRoom: number | null;
  canCreateMonitors: PermissionGateResult;
  canCreateDevices: PermissionGateResult;
  // The ids a new recommended template is built with, when the project has them.
  seedIds: MonitorCriteriaSeedIds | null;
}

function toNamedColorMap<
  T extends { id: ObjectID | null; name?: string | undefined },
>(
  rows: Array<T>,
  colorOf: (row: T) => string | undefined,
): Map<string, NamedColor> {
  const map: Map<string, NamedColor> = new Map<string, NamedColor>();

  for (const row of rows) {
    const id: string = row.id?.toString() || "";

    if (!id) {
      continue;
    }

    map.set(id, { name: row.name || "", color: colorOf(row) });
  }

  return map;
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

/*
 * A template choice as the step offers it, from a project template. A
 * template with no name (the API allows one) is named by the step, in the
 * reader's language: the name here is only ever what someone typed.
 */
export function toTemplateChoice(
  template: MonitorTemplate,
): DiscoveryImportTemplateChoice {
  const monitorType: MonitorType = template.monitorType!;
  const choice: DiscoveryImportTemplateChoice = {
    id: template.id!.toString(),
    name: template.templateName?.trim() || "",
    monitorType: monitorType,
    summary: summarizeMonitorTemplateAlerts(template.monitorSteps, {
      monitorType: monitorType,
    }),
  };

  if (isDeviceAddressMonitorType(monitorType)) {
    if (template.monitoringInterval) {
      choice.monitoringInterval = template.monitoringInterval;
    }

    if (monitorType === MonitorType.Port) {
      choice.ports = DeviceMonitorTemplateUtil.readPorts(template.monitorSteps);
    }
  }

  return choice;
}

/*
 * The templates, the recommended first. A project template carrying the
 * recommended marker is the recommended one; with none, the recommended pack
 * is offered as the template Import creates - when the reader may create
 * templates and the project has the statuses and severities it is built
 * with. Then the project's other Network Device templates, which read each
 * device's polls, then its Ping, IP, Port and NTP templates, which check
 * each device's address (#5145) - each in the order they were read, by name.
 * A template of any other kind is not offered: nothing of a device's is for
 * it to check (DEVICE_MONITOR_TEMPLATE_TYPES).
 */
export function buildTemplateChoices(data: {
  templates: Array<MonitorTemplate>;
  canCreateTemplates: boolean;
  seedIds: MonitorCriteriaSeedIds | null;
  projectId: ObjectID | null;
}): Array<DiscoveryImportTemplateChoice> {
  const offered: Array<MonitorTemplate> = data.templates.filter(
    (template: MonitorTemplate): boolean => {
      return (
        Boolean(template.id) &&
        isDeviceMonitorTemplateType(template.monitorType)
      );
    },
  );

  const recommended: MonitorTemplate | null =
    NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate(
      offered.filter((template: MonitorTemplate): boolean => {
        return template.monitorType === MonitorType.NetworkDevice;
      }),
    );
  const recommendedId: string = recommended?.id?.toString() || "";

  const byKind: (
    readsPolls: boolean,
  ) => Array<DiscoveryImportTemplateChoice> = (
    readsPolls: boolean,
  ): Array<DiscoveryImportTemplateChoice> => {
    return offered
      .filter((template: MonitorTemplate): boolean => {
        return (
          template.id!.toString() !== recommendedId &&
          (template.monitorType === MonitorType.NetworkDevice) === readsPolls
        );
      })
      .map(toTemplateChoice);
  };

  const rest: Array<DiscoveryImportTemplateChoice> = [
    ...byKind(true),
    ...byKind(false),
  ];

  if (recommended?.id) {
    return [toTemplateChoice(recommended), ...rest];
  }

  if (data.canCreateTemplates && data.seedIds && data.projectId) {
    const preview: MonitorTemplate = buildRecommendedMonitorTemplatePreview({
      projectId: data.projectId,
      seedIds: data.seedIds,
    });

    return [
      {
        id: "",
        name: RECOMMENDED_TEMPLATE_NAME,
        monitorType: MonitorType.NetworkDevice,
        summary: summarizeMonitorTemplateAlerts(preview.monitorSteps),
        isCreatedOnImport: true,
      },
      ...rest,
    ];
  }

  return rest;
}

/*
 * What the step knows once the templates are read again - the reader came
 * back to the dialog's window, maybe from making a template in another tab
 * (issue #5145): the templates replaced, everything else as it was read
 * when the step opened. Null keeps the step as it is, when the read that
 * matters failed: a template read that failed lists none, and a status or
 * severity read that failed would take away the recommended template the
 * import creates - neither means the project's templates changed.
 */
export function mergeRefreshedFacts(data: {
  current: DiscoveryImportProjectFacts;
  loaded: DiscoveryImportProjectFacts;
}): DiscoveryImportProjectFacts | null {
  if (!data.loaded.didReadTemplates) {
    return null;
  }

  if (data.current.seedIds && !data.loaded.seedIds) {
    return null;
  }

  return {
    ...data.current,
    templates: data.loaded.templates,
    templatesUnavailableReason: data.loaded.templatesUnavailableReason,
    didReadTemplates: true,
  };
}

export function toPolicyFacts(data: {
  policies: Array<NetworkAlertPolicy>;
  templateNamesById: Map<string, string>;
}): Array<DiscoveryImportPolicyFact> {
  return data.policies.map(
    (policy: NetworkAlertPolicy): DiscoveryImportPolicyFact => {
      const templateId: string = policy.monitorTemplateId?.toString() || "";

      return {
        name: policy.name || "",
        isEnabled: Boolean(policy.isEnabled),
        isUnscoped: NetworkAlertPolicyScopeUtil.isUnscoped(policy.scope),
        hasTemplate: Boolean(templateId),
        templateName: templateId
          ? data.templateNamesById.get(templateId)
          : undefined,
      };
    },
  );
}

export async function loadDiscoveryImportProjectFacts(): Promise<DiscoveryImportProjectFacts> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const canReadTemplates: PermissionGateResult = PermissionGate.check(
    new MonitorTemplate(),
    ModelAction.Read,
  );
  const canCreateTemplates: PermissionGateResult = PermissionGate.check(
    new MonitorTemplate(),
    ModelAction.Create,
  );
  const canCreateMonitors: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );
  const canCreateDevices: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Create,
  );

  const [
    templatesResult,
    statusesResult,
    incidentSeveritiesResult,
    alertSeveritiesResult,
    policiesResult,
    limitResult,
  ]: [
    PromiseSettledResult<ListResult<MonitorTemplate>>,
    PromiseSettledResult<ListResult<MonitorStatus>>,
    PromiseSettledResult<ListResult<IncidentSeverity>>,
    PromiseSettledResult<ListResult<AlertSeverity>>,
    PromiseSettledResult<ListResult<NetworkAlertPolicy>>,
    PromiseSettledResult<ActiveMonitorLimitStatus | null>,
  ] = await Promise.allSettled([
    canReadTemplates.isAllowed
      ? ModelAPI.getList<MonitorTemplate>({
          modelType: MonitorTemplate,
          query: {
            ...(projectId ? { projectId: projectId } : {}),
            // Every kind a device's monitor can be made from (#5145).
            monitorType: new Includes([...DEVICE_MONITOR_TEMPLATE_TYPES]),
          },
          select: {
            _id: true,
            templateName: true,
            templateDescription: true,
            monitorType: true,
            monitorSteps: true,
            monitoringInterval: true,
          },
          sort: { templateName: SortOrder.Ascending },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        })
      : Promise.reject(new Error(canReadTemplates.disabledReason || "")),
    ModelAPI.getList<MonitorStatus>({
      modelType: MonitorStatus,
      query: {},
      select: {
        _id: true,
        name: true,
        color: true,
        isOperationalState: true,
        isOfflineState: true,
      },
      sort: { priority: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
    ModelAPI.getList<IncidentSeverity>({
      modelType: IncidentSeverity,
      query: {},
      select: { _id: true, name: true, color: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
    ModelAPI.getList<AlertSeverity>({
      modelType: AlertSeverity,
      query: {},
      select: { _id: true, name: true, color: true },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
    ModelAPI.getList<NetworkAlertPolicy>({
      modelType: NetworkAlertPolicy,
      query: {},
      select: {
        _id: true,
        name: true,
        isEnabled: true,
        scope: true,
        monitorTemplateId: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    }),
    /*
     * A self-hosted install has no plans: nothing is asked, as the monitor
     * pages do (ActiveMonitorLimitNotice).
     */
    BILLING_ENABLED
      ? fetchActiveMonitorLimitStatus()
      : Promise.resolve<ActiveMonitorLimitStatus | null>(null),
  ]);

  const templates: Array<MonitorTemplate> =
    settledValue(templatesResult)?.data || [];
  const statuses: Array<MonitorStatus> =
    settledValue(statusesResult)?.data || [];
  const incidentSeverities: Array<IncidentSeverity> =
    settledValue(incidentSeveritiesResult)?.data || [];
  const alertSeverities: Array<AlertSeverity> =
    settledValue(alertSeveritiesResult)?.data || [];
  const policies: Array<NetworkAlertPolicy> =
    settledValue(policiesResult)?.data || [];
  const limitStatus: ActiveMonitorLimitStatus | null =
    settledValue(limitResult) || null;

  let seedIds: MonitorCriteriaSeedIds | null = null;
  let seedIdsError: string | undefined = undefined;

  try {
    seedIds = PingMonitorSeedIds.fromLists(
      {
        monitorStatuses: statuses,
        incidentSeverities: incidentSeverities,
        alertSeverities: alertSeverities,
      },
      SeedIdsPurpose.RecommendedTemplate,
    );
  } catch (err) {
    seedIdsError = API.getFriendlyMessage(err);
  }

  /*
   * The recommended template is offered for Import to create only when the
   * project's templates were read: with no list there is no telling whether
   * the project has it already, and creating it again would make a second.
   */
  const templateChoices: Array<DiscoveryImportTemplateChoice> =
    buildTemplateChoices({
      templates: templates,
      canCreateTemplates:
        canCreateTemplates.isAllowed && templatesResult.status === "fulfilled",
      seedIds: seedIds,
      projectId: projectId,
    });

  let templatesUnavailableReason: string | undefined = undefined;

  if (templateChoices.length === 0) {
    if (templatesResult.status === "rejected") {
      templatesUnavailableReason =
        canReadTemplates.disabledReason ||
        API.getFriendlyMessage(templatesResult.reason);
    } else if (!canCreateTemplates.isAllowed) {
      templatesUnavailableReason = NO_DEVICE_MONITOR_TEMPLATE_REASON;
    } else {
      templatesUnavailableReason = seedIdsError;
    }
  }

  const templateNamesById: Map<string, string> = new Map<string, string>(
    templates
      .filter((template: MonitorTemplate): boolean => {
        return Boolean(template.id);
      })
      .map((template: MonitorTemplate): [string, string] => {
        return [template.id!.toString(), template.templateName || ""];
      }),
  );

  return {
    templates: templateChoices,
    templatesUnavailableReason: templatesUnavailableReason,
    didReadTemplates: templatesResult.status === "fulfilled",
    incidentSeverities: toNamedColorMap<IncidentSeverity>(
      incidentSeverities,
      (row: IncidentSeverity): string | undefined => {
        return row.color?.toString();
      },
    ),
    alertSeverities: toNamedColorMap<AlertSeverity>(
      alertSeverities,
      (row: AlertSeverity): string | undefined => {
        return row.color?.toString();
      },
    ),
    monitorStatuses: toNamedColorMap<MonitorStatus>(
      statuses,
      (row: MonitorStatus): string | undefined => {
        return row.color?.toString();
      },
    ),
    policies: toPolicyFacts({
      policies: policies,
      templateNamesById: templateNamesById,
    }),
    monitorLimitStatus: limitStatus,
    monitorRoom:
      limitStatus?.limit && limitStatus.activeMonitors !== null
        ? ActiveMonitorLimitUtil.getRoom({
            limit: limitStatus.limit.limit,
            activeMonitors: limitStatus.activeMonitors,
          })
        : null,
    canCreateMonitors: canCreateMonitors,
    canCreateDevices: canCreateDevices,
    seedIds: seedIds,
  };
}
