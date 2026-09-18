/*
 * The incident, alert and scheduled maintenance services pull the native
 * isolated-vm addon in through their template renderer. Nothing here touches
 * the sandbox, and the prebuilt binary cannot always load in the test
 * environment, so stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerTeam from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import Service from "../../../../Models/DatabaseModels/Service";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertLabelRuleEngineService from "../../../../Server/Services/AlertLabelRuleEngineService";
import AlertLabelRuleService from "../../../../Server/Services/AlertLabelRuleService";
import AlertOwnerRuleEngineService from "../../../../Server/Services/AlertOwnerRuleEngineService";
import AlertOwnerRuleService from "../../../../Server/Services/AlertOwnerRuleService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import DockerHostOwnerTeamService from "../../../../Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../../../Server/Services/DockerHostOwnerUserService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import HostOwnerTeamService from "../../../../Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../../Server/Services/HostOwnerUserService";
import HostService from "../../../../Server/Services/HostService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentLabelRuleEngineService from "../../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentLabelRuleService from "../../../../Server/Services/IncidentLabelRuleService";
import IncidentOwnerRuleEngineService from "../../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerRuleService from "../../../../Server/Services/IncidentOwnerRuleService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../../Server/Services/IncidentService";
import KubernetesClusterOwnerTeamService from "../../../../Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../../Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import PodmanHostOwnerTeamService from "../../../../Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../../../Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ScheduledMaintenanceFeedService from "../../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../../Server/Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceLabelRuleService from "../../../../Server/Services/ScheduledMaintenanceLabelRuleService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../../Server/Services/ScheduledMaintenanceOwnerRuleEngineService";
import ScheduledMaintenanceOwnerRuleService from "../../../../Server/Services/ScheduledMaintenanceOwnerRuleService";
import ScheduledMaintenanceOwnerTeamService from "../../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run now" for incident, alert and scheduled
 * maintenance label and owner rules.
 *
 * Unlike the simple engines, these do not re-read the resource before
 * matching: they read its monitors, severity, labels, title and description -
 * and, to inherit, its hosts, clusters, Docker and Podman hosts and services -
 * straight off the object they are handed. On create that is the fresh row; in
 * a run it is a row the runner read with `resourceSelectForRuleRun`. So the
 * select is load-bearing: a column missing from it is a criterion a run never
 * matches on and a resource it never inherits from, with no error anywhere.
 *
 * The run must also be safe to repeat: labels and owners already there are
 * not added twice, and owners are only notified when the person running it
 * opted in - including owners inherited from monitors and hosts.
 */

// Services are spied on by method name; the cases only hold them as targets.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyTarget = any;

type ModelConstructor = new () => DatabaseBaseModel;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const HOST_ID: ObjectID = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const KUBERNETES_CLUSTER_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const DOCKER_HOST_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const PODMAN_HOST_ID: ObjectID = new ObjectID(
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
);

const EXISTING_LABEL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const HOST_LABEL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_RESOURCE_LABEL_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const USER_A_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const TEAM_A_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
// Owns the monitor, so it is what "inherit owners from monitors" adds.
const MONITOR_OWNER_USER_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
// Owns the host, so it is what "inherit owners from hosts" adds.
const HOST_OWNER_TEAM_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);

const DEFAULT_TITLE: string = "Checkout outage";
const DEFAULT_DESCRIPTION: string = "Customer checkout is failing";

interface IdRef {
  id: ObjectID;
  _id: string;
}

function ref(id: ObjectID): IdRef {
  return { id: id, _id: id.toString() };
}

function stub<T extends DatabaseBaseModel>(id: ObjectID): T {
  return ref(id) as unknown as T;
}

function labelStubs(ids: Array<ObjectID>): Array<Label> {
  return ids.map((id: ObjectID): Label => {
    return stub<Label>(id);
  });
}

function rule(fields: Record<string, unknown>): DatabaseBaseModel {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Checkout rule",
    ...fields,
  } as unknown as DatabaseBaseModel;
}

function monitorLabelCriteria(): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [
      {
        field: "monitorLabels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [MONITOR_LABEL_ID.toString()],
      },
    ],
  };
}

function labelIdsOf(resource: DatabaseBaseModel): Array<string> {
  const labels: Array<Label> =
    (resource as unknown as { labels?: Array<Label> }).labels || [];

  return labels.map((label: Label): string => {
    return label.id?.toString() || "";
  });
}

interface ResourceData {
  title?: string | undefined;
  monitorIds?: Array<ObjectID> | undefined;
}

// The monitor every resource is attached to, as the monitor cache reads it.
function fakeMonitor(): Monitor {
  return {
    ...ref(MONITOR_ID),
    name: "checkout-api",
    description: "Public checkout API",
    labels: labelStubs([MONITOR_LABEL_ID]),
  } as unknown as Monitor;
}

function makeIncident(data: ResourceData): DatabaseBaseModel {
  const incident: Incident = new Incident();
  incident.id = RESOURCE_ID;
  incident.projectId = PROJECT_ID;
  incident.title = data.title ?? DEFAULT_TITLE;
  incident.description = DEFAULT_DESCRIPTION;
  incident.incidentSeverityId = SEVERITY_ID;
  incident.labels = labelStubs([EXISTING_LABEL_ID]);
  incident.monitors = (data.monitorIds ?? [MONITOR_ID]).map(
    (id: ObjectID): Monitor => {
      return stub<Monitor>(id);
    },
  );
  incident.hosts = [stub<Host>(HOST_ID)];
  incident.kubernetesClusters = [
    stub<KubernetesCluster>(KUBERNETES_CLUSTER_ID),
  ];
  incident.dockerHosts = [stub<DockerHost>(DOCKER_HOST_ID)];
  incident.podmanHosts = [stub<PodmanHost>(PODMAN_HOST_ID)];
  incident.services = [stub<Service>(SERVICE_ID)];
  return incident;
}

function makeAlert(data: ResourceData): DatabaseBaseModel {
  const alert: Alert = new Alert();
  alert.id = RESOURCE_ID;
  alert.projectId = PROJECT_ID;
  alert.title = data.title ?? DEFAULT_TITLE;
  alert.description = DEFAULT_DESCRIPTION;
  alert.alertSeverityId = SEVERITY_ID;
  alert.labels = labelStubs([EXISTING_LABEL_ID]);
  const monitorId: ObjectID | undefined = (data.monitorIds ?? [MONITOR_ID])[0];
  if (monitorId) {
    alert.monitorId = monitorId;
  }
  alert.hosts = [stub<Host>(HOST_ID)];
  alert.kubernetesClusters = [stub<KubernetesCluster>(KUBERNETES_CLUSTER_ID)];
  alert.dockerHosts = [stub<DockerHost>(DOCKER_HOST_ID)];
  alert.podmanHosts = [stub<PodmanHost>(PODMAN_HOST_ID)];
  alert.services = [stub<Service>(SERVICE_ID)];
  return alert;
}

function makeScheduledMaintenance(data: ResourceData): DatabaseBaseModel {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event.id = RESOURCE_ID;
  event.projectId = PROJECT_ID;
  event.title = data.title ?? DEFAULT_TITLE;
  event.description = DEFAULT_DESCRIPTION;
  event.labels = labelStubs([EXISTING_LABEL_ID]);
  event.monitors = (data.monitorIds ?? [MONITOR_ID]).map(
    (id: ObjectID): Monitor => {
      return stub<Monitor>(id);
    },
  );
  event.hosts = [stub<Host>(HOST_ID)];
  event.kubernetesClusters = [stub<KubernetesCluster>(KUBERNETES_CLUSTER_ID)];
  event.dockerHosts = [stub<DockerHost>(DOCKER_HOST_ID)];
  event.podmanHosts = [stub<PodmanHost>(PODMAN_HOST_ID)];
  event.services = [stub<Service>(SERVICE_ID)];
  return event;
}

// Legacy criteria that all hold for the default resource, one per field.
function incidentCriteriaMatchingEverything(): Record<string, unknown> {
  return {
    monitors: [ref(MONITOR_ID)],
    incidentSeverities: [ref(SEVERITY_ID)],
    incidentLabels: [ref(EXISTING_LABEL_ID)],
    monitorLabels: [ref(MONITOR_LABEL_ID)],
    incidentTitlePattern: "checkout",
    incidentDescriptionPattern: "customer",
    monitorNamePattern: "^checkout",
    monitorDescriptionPattern: "public",
  };
}

function alertCriteriaMatchingEverything(): Record<string, unknown> {
  return {
    monitors: [ref(MONITOR_ID)],
    alertSeverities: [ref(SEVERITY_ID)],
    alertLabels: [ref(EXISTING_LABEL_ID)],
    monitorLabels: [ref(MONITOR_LABEL_ID)],
    alertTitlePattern: "checkout",
    alertDescriptionPattern: "customer",
    monitorNamePattern: "^checkout",
    monitorDescriptionPattern: "public",
  };
}

function scheduledMaintenanceCriteriaMatchingEverything(): Record<
  string,
  unknown
> {
  return {
    monitors: [ref(MONITOR_ID)],
    scheduledMaintenanceLabels: [ref(EXISTING_LABEL_ID)],
    monitorLabels: [ref(MONITOR_LABEL_ID)],
    titlePattern: "checkout",
    descriptionPattern: "customer",
    monitorNamePattern: "^checkout",
    monitorDescriptionPattern: "public",
  };
}

function labelRuleAddingEverything(): Record<string, unknown> {
  return {
    labelsToAdd: [ref(RULE_LABEL_ID)],
    inheritLabelsFromMonitors: true,
    inheritLabelsFromHosts: true,
    inheritLabelsFromKubernetesClusters: true,
    inheritLabelsFromDockerHosts: true,
    inheritLabelsFromPodmanHosts: true,
    inheritLabelsFromServices: true,
  };
}

function ownerRuleAddingEverything(): Record<string, unknown> {
  return {
    notifyOwners: true,
    ownerUsers: [ref(USER_A_ID)],
    ownerTeams: [ref(TEAM_A_ID)],
    inheritOwnersFromMonitors: true,
    inheritOwnersFromHosts: true,
    inheritOwnersFromKubernetesClusters: true,
    inheritOwnersFromDockerHosts: true,
    inheritOwnersFromPodmanHosts: true,
    inheritOwnersFromServices: true,
  };
}

interface OwnerConfig {
  ownerUserService: SpyTarget;
  ownerTeamService: SpyTarget;
  resourceIdColumn: string;
  newOwnerUserRow: (userId: ObjectID) => DatabaseBaseModel;
  newOwnerTeamRow: (teamId: ObjectID) => DatabaseBaseModel;
}

interface EngineCase {
  name: string;
  engine: RuleRunEngine<DatabaseBaseModel, DatabaseBaseModel>;
  modelType: ModelConstructor;
  ruleService: SpyTarget;
  resourceService: SpyTarget;
  feedService: SpyTarget;
  feedMethod: string;
  createHook: (resource: DatabaseBaseModel) => Promise<void>;
  makeResource: (data: ResourceData) => DatabaseBaseModel;
  titlePatternField: string;
  criteriaMatchingEverything: () => Record<string, unknown>;
  ruleAddingEverything: () => Record<string, unknown>;
  owner: OwnerConfig | null;
}

function asEngine(
  engine: unknown,
): RuleRunEngine<DatabaseBaseModel, DatabaseBaseModel> {
  return engine as RuleRunEngine<DatabaseBaseModel, DatabaseBaseModel>;
}

const LABEL_CASES: Array<EngineCase> = [
  {
    name: "IncidentLabelRuleEngineService",
    engine: asEngine(IncidentLabelRuleEngineService),
    modelType: Incident,
    ruleService: IncidentLabelRuleService,
    resourceService: IncidentService,
    feedService: IncidentFeedService,
    feedMethod: "createIncidentFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return IncidentLabelRuleEngineService.applyRulesToIncident(
        resource as Incident,
      );
    },
    makeResource: makeIncident,
    titlePatternField: "incidentTitlePattern",
    criteriaMatchingEverything: incidentCriteriaMatchingEverything,
    ruleAddingEverything: labelRuleAddingEverything,
    owner: null,
  },
  {
    name: "AlertLabelRuleEngineService",
    engine: asEngine(AlertLabelRuleEngineService),
    modelType: Alert,
    ruleService: AlertLabelRuleService,
    resourceService: AlertService,
    feedService: AlertFeedService,
    feedMethod: "createAlertFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return AlertLabelRuleEngineService.applyRulesToAlert(resource as Alert);
    },
    makeResource: makeAlert,
    titlePatternField: "alertTitlePattern",
    criteriaMatchingEverything: alertCriteriaMatchingEverything,
    ruleAddingEverything: labelRuleAddingEverything,
    owner: null,
  },
  {
    name: "ScheduledMaintenanceLabelRuleEngineService",
    engine: asEngine(ScheduledMaintenanceLabelRuleEngineService),
    modelType: ScheduledMaintenance,
    ruleService: ScheduledMaintenanceLabelRuleService,
    resourceService: ScheduledMaintenanceService,
    feedService: ScheduledMaintenanceFeedService,
    feedMethod: "createScheduledMaintenanceFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return ScheduledMaintenanceLabelRuleEngineService.applyRulesToScheduledMaintenance(
        resource as ScheduledMaintenance,
      );
    },
    makeResource: makeScheduledMaintenance,
    titlePatternField: "titlePattern",
    criteriaMatchingEverything: scheduledMaintenanceCriteriaMatchingEverything,
    ruleAddingEverything: labelRuleAddingEverything,
    owner: null,
  },
];

const OWNER_CASES: Array<EngineCase> = [
  {
    name: "IncidentOwnerRuleEngineService",
    engine: asEngine(IncidentOwnerRuleEngineService),
    modelType: Incident,
    ruleService: IncidentOwnerRuleService,
    resourceService: IncidentService,
    feedService: IncidentFeedService,
    feedMethod: "createIncidentFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return IncidentOwnerRuleEngineService.applyRulesToIncident(
        resource as Incident,
      );
    },
    makeResource: makeIncident,
    titlePatternField: "incidentTitlePattern",
    criteriaMatchingEverything: incidentCriteriaMatchingEverything,
    ruleAddingEverything: ownerRuleAddingEverything,
    owner: {
      ownerUserService: IncidentOwnerUserService,
      ownerTeamService: IncidentOwnerTeamService,
      resourceIdColumn: "incidentId",
      newOwnerUserRow: (userId: ObjectID): DatabaseBaseModel => {
        const row: IncidentOwnerUser = new IncidentOwnerUser();
        row.userId = userId;
        row.incidentId = RESOURCE_ID;
        return row;
      },
      newOwnerTeamRow: (teamId: ObjectID): DatabaseBaseModel => {
        const row: IncidentOwnerTeam = new IncidentOwnerTeam();
        row.teamId = teamId;
        row.incidentId = RESOURCE_ID;
        return row;
      },
    },
  },
  {
    name: "AlertOwnerRuleEngineService",
    engine: asEngine(AlertOwnerRuleEngineService),
    modelType: Alert,
    ruleService: AlertOwnerRuleService,
    resourceService: AlertService,
    feedService: AlertFeedService,
    feedMethod: "createAlertFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return AlertOwnerRuleEngineService.applyRulesToAlert(resource as Alert);
    },
    makeResource: makeAlert,
    titlePatternField: "alertTitlePattern",
    criteriaMatchingEverything: alertCriteriaMatchingEverything,
    ruleAddingEverything: ownerRuleAddingEverything,
    owner: {
      ownerUserService: AlertOwnerUserService,
      ownerTeamService: AlertOwnerTeamService,
      resourceIdColumn: "alertId",
      newOwnerUserRow: (userId: ObjectID): DatabaseBaseModel => {
        const row: AlertOwnerUser = new AlertOwnerUser();
        row.userId = userId;
        row.alertId = RESOURCE_ID;
        return row;
      },
      newOwnerTeamRow: (teamId: ObjectID): DatabaseBaseModel => {
        const row: AlertOwnerTeam = new AlertOwnerTeam();
        row.teamId = teamId;
        row.alertId = RESOURCE_ID;
        return row;
      },
    },
  },
  {
    name: "ScheduledMaintenanceOwnerRuleEngineService",
    engine: asEngine(ScheduledMaintenanceOwnerRuleEngineService),
    modelType: ScheduledMaintenance,
    ruleService: ScheduledMaintenanceOwnerRuleService,
    resourceService: ScheduledMaintenanceService,
    feedService: ScheduledMaintenanceFeedService,
    feedMethod: "createScheduledMaintenanceFeedItem",
    createHook: (resource: DatabaseBaseModel): Promise<void> => {
      return ScheduledMaintenanceOwnerRuleEngineService.applyRulesToScheduledMaintenance(
        resource as ScheduledMaintenance,
      );
    },
    makeResource: makeScheduledMaintenance,
    titlePatternField: "titlePattern",
    criteriaMatchingEverything: scheduledMaintenanceCriteriaMatchingEverything,
    ruleAddingEverything: ownerRuleAddingEverything,
    owner: {
      ownerUserService: ScheduledMaintenanceOwnerUserService,
      ownerTeamService: ScheduledMaintenanceOwnerTeamService,
      resourceIdColumn: "scheduledMaintenanceId",
      newOwnerUserRow: (userId: ObjectID): DatabaseBaseModel => {
        const row: ScheduledMaintenanceOwnerUser =
          new ScheduledMaintenanceOwnerUser();
        row.userId = userId;
        row.scheduledMaintenanceId = RESOURCE_ID;
        return row;
      },
      newOwnerTeamRow: (teamId: ObjectID): DatabaseBaseModel => {
        const row: ScheduledMaintenanceOwnerTeam =
          new ScheduledMaintenanceOwnerTeam();
        row.teamId = teamId;
        row.scheduledMaintenanceId = RESOURCE_ID;
        return row;
      },
    },
  },
];

interface Fixture {
  // The resource no longer exists when the engine re-reads it.
  resourceGone: boolean;
  // Labels the re-read finds on the resource.
  existingLabelIds: Array<ObjectID>;
  // Owners the resource already has.
  existingOwnerUserIds: Array<ObjectID>;
  existingOwnerTeamIds: Array<ObjectID>;
  // Label attaches and owner inserts throw.
  failWrites: boolean;
}

const DEFAULT_FIXTURE: Fixture = {
  resourceGone: false,
  existingLabelIds: [EXISTING_LABEL_ID],
  existingOwnerUserIds: [],
  existingOwnerTeamIds: [],
  failWrites: false,
};

interface LabelAdd {
  resourceId: string;
  labelIds: Array<string>;
}

interface Mocks {
  labelAdds: Array<LabelAdd>;
  ownerUserRows: Array<DatabaseBaseModel>;
  ownerTeamRows: Array<DatabaseBaseModel>;
  feed: jest.SpyInstance;
  resourceRead: jest.SpyInstance;
  ownerAssignmentLookup: jest.SpyInstance | null;
  userLookup: jest.SpyInstance;
  teamLookup: jest.SpyInstance;
}

interface FakeRelationBuilder {
  createQueryBuilder: () => FakeRelationBuilder;
  relation: () => FakeRelationBuilder;
  of: (resourceId: string) => FakeRelationBuilder;
  add: (labelIds: Array<string>) => Promise<void>;
}

interface RelatedOwners {
  userService: SpyTarget;
  teamService: SpyTarget;
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
}

function mockMethod(
  target: SpyTarget,
  method: string,
  implementation: (...args: Array<SpyTarget>) => unknown,
): jest.SpyInstance {
  return jest.spyOn(target, method).mockImplementation(implementation);
}

// Stands in for the database behind every engine in this file.
function installMocks(c: EngineCase, overrides: Partial<Fixture> = {}): Mocks {
  const fixture: Fixture = { ...DEFAULT_FIXTURE, ...overrides };

  mockMethod(MonitorService, "findOneById", async (data: SpyTarget) => {
    return data.id.toString() === MONITOR_ID.toString() ? fakeMonitor() : null;
  });

  for (const service of [
    HostService,
    KubernetesClusterService,
    DockerHostService,
    PodmanHostService,
    ServiceService,
  ] as Array<SpyTarget>) {
    mockMethod(service, "findOneById", async (data: SpyTarget) => {
      return {
        ...ref(data.id),
        labels: labelStubs([
          service === HostService ? HOST_LABEL_ID : OTHER_RESOURCE_LABEL_ID,
        ]),
      };
    });
  }

  const relatedOwners: Array<RelatedOwners> = [
    {
      userService: MonitorOwnerUserService,
      teamService: MonitorOwnerTeamService,
      userIds: [MONITOR_OWNER_USER_ID],
      teamIds: [],
    },
    {
      userService: HostOwnerUserService,
      teamService: HostOwnerTeamService,
      userIds: [],
      teamIds: [HOST_OWNER_TEAM_ID],
    },
    {
      userService: KubernetesClusterOwnerUserService,
      teamService: KubernetesClusterOwnerTeamService,
      userIds: [],
      teamIds: [],
    },
    {
      userService: DockerHostOwnerUserService,
      teamService: DockerHostOwnerTeamService,
      userIds: [],
      teamIds: [],
    },
    {
      userService: PodmanHostOwnerUserService,
      teamService: PodmanHostOwnerTeamService,
      userIds: [],
      teamIds: [],
    },
    {
      userService: ServiceOwnerUserService,
      teamService: ServiceOwnerTeamService,
      userIds: [],
      teamIds: [],
    },
  ];

  for (const related of relatedOwners) {
    mockMethod(related.userService, "findBy", async () => {
      return related.userIds.map((id: ObjectID) => {
        return { userId: id };
      });
    });
    mockMethod(related.teamService, "findBy", async () => {
      return related.teamIds.map((id: ObjectID) => {
        return { teamId: id };
      });
    });
  }

  mockMethod(LabelService, "findBy", async () => {
    return [];
  });
  const userLookup: jest.SpyInstance = mockMethod(
    UserService,
    "findBy",
    async () => {
      return [];
    },
  );
  const teamLookup: jest.SpyInstance = mockMethod(
    TeamService,
    "findBy",
    async () => {
      return [];
    },
  );
  const feed: jest.SpyInstance = mockMethod(
    c.feedService,
    c.feedMethod,
    async () => {
      return undefined;
    },
  );

  const resourceRead: jest.SpyInstance = mockMethod(
    c.resourceService,
    "findOneById",
    async () => {
      if (fixture.resourceGone) {
        return null;
      }

      return {
        ...ref(RESOURCE_ID),
        labels: labelStubs(fixture.existingLabelIds),
        hosts: [ref(HOST_ID)],
        kubernetesClusters: [ref(KUBERNETES_CLUSTER_ID)],
        dockerHosts: [ref(DOCKER_HOST_ID)],
        podmanHosts: [ref(PODMAN_HOST_ID)],
        services: [ref(SERVICE_ID)],
      };
    },
  );

  const labelAdds: Array<LabelAdd> = [];
  let pendingResourceId: string = "";
  const builder: FakeRelationBuilder = {
    createQueryBuilder: (): FakeRelationBuilder => {
      return builder;
    },
    relation: (): FakeRelationBuilder => {
      return builder;
    },
    of: (resourceId: string): FakeRelationBuilder => {
      pendingResourceId = resourceId;
      return builder;
    },
    add: async (labelIds: Array<string>): Promise<void> => {
      if (fixture.failWrites) {
        throw new Error("insert or update violates foreign key constraint");
      }

      labelAdds.push({
        resourceId: pendingResourceId,
        labelIds: [...labelIds],
      });
    },
  };
  mockMethod(c.resourceService, "getRepository", () => {
    return builder;
  });

  const ownerUserRows: Array<DatabaseBaseModel> = [];
  const ownerTeamRows: Array<DatabaseBaseModel> = [];
  let ownerAssignmentLookup: jest.SpyInstance | null = null;

  if (c.owner) {
    const owner: OwnerConfig = c.owner;

    ownerAssignmentLookup = mockMethod(
      owner.ownerUserService,
      "findBy",
      async () => {
        return fixture.existingOwnerUserIds.map((id: ObjectID) => {
          return owner.newOwnerUserRow(id);
        });
      },
    );
    mockMethod(owner.ownerTeamService, "findBy", async () => {
      return fixture.existingOwnerTeamIds.map((id: ObjectID) => {
        return owner.newOwnerTeamRow(id);
      });
    });
    mockMethod(owner.ownerUserService, "create", async (data: SpyTarget) => {
      if (fixture.failWrites) {
        throw new Error("insert or update violates foreign key constraint");
      }
      ownerUserRows.push(data.data);
      return data.data;
    });
    mockMethod(owner.ownerTeamService, "create", async (data: SpyTarget) => {
      if (fixture.failWrites) {
        throw new Error("insert or update violates foreign key constraint");
      }
      ownerTeamRows.push(data.data);
      return data.data;
    });
  }

  return {
    labelAdds: labelAdds,
    ownerUserRows: ownerUserRows,
    ownerTeamRows: ownerTeamRows,
    feed: feed,
    resourceRead: resourceRead,
    ownerAssignmentLookup: ownerAssignmentLookup,
    userLookup: userLookup,
    teamLookup: teamLookup,
  };
}

interface CreatedOwner {
  ownerId: string;
  resourceId: string;
  isOwnerNotified: boolean;
}

function createdOwners(
  rows: Array<DatabaseBaseModel>,
  ownerIdColumn: "userId" | "teamId",
  resourceIdColumn: string,
): Array<CreatedOwner> {
  return rows.map((row: DatabaseBaseModel): CreatedOwner => {
    const values: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;

    return {
      ownerId: String(values[ownerIdColumn]),
      resourceId: String(values[resourceIdColumn]),
      isOwnerNotified: values["isOwnerNotified"] === true,
    };
  });
}

function run(
  c: EngineCase,
  data: {
    resource?: DatabaseBaseModel | undefined;
    rules: Array<DatabaseBaseModel>;
    allowOwnerNotification?: boolean | undefined;
  },
): Promise<RuleApplicationResult> {
  return c.engine.applyRulesToExistingResource({
    resource: data.resource ?? c.makeResource({}),
    rules: data.rules,
    allowOwnerNotification: data.allowOwnerNotification ?? false,
  });
}

beforeEach(() => {
  // Silence the logs the failure-path tests deliberately provoke.
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(LABEL_CASES)("$name - run now", (c: EngineCase) => {
  it("matches on the resource's monitor and attaches the rule's labels", async () => {
    const mocks: Mocks = installMocks(c);
    const resource: DatabaseBaseModel = c.makeResource({});

    const result: RuleApplicationResult = await run(c, {
      resource: resource,
      rules: [
        rule({
          monitorNamePattern: "^checkout",
          labelsToAdd: [ref(RULE_LABEL_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(mocks.labelAdds).toEqual([
      {
        resourceId: RESOURCE_ID.toString(),
        labelIds: [RULE_LABEL_ID.toString()],
      },
    ]);
    expect(mocks.feed).toHaveBeenCalledTimes(1);
    // Later engines in a create chain match on the labels held in memory.
    expect(labelIdsOf(resource)).toEqual([
      EXISTING_LABEL_ID.toString(),
      RULE_LABEL_ID.toString(),
    ]);
  });

  it("matches configurable criteria on a label of the resource's monitor", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          criteria: monitorLabelCriteria(),
          labelsToAdd: [ref(RULE_LABEL_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(mocks.labelAdds).toHaveLength(1);
  });

  it("does not match a monitor criterion on a resource with no monitor", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      resource: c.makeResource({ monitorIds: [] }),
      rules: [
        rule({
          monitorNamePattern: "^checkout",
          labelsToAdd: [ref(RULE_LABEL_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(mocks.labelAdds).toEqual([]);
  });

  it("reports noMatch and writes nothing for a rule that does not match", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          [c.titlePatternField]: "^billing",
          labelsToAdd: [ref(RULE_LABEL_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(mocks.labelAdds).toEqual([]);
    expect(mocks.resourceRead).not.toHaveBeenCalled();
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("inherits the labels of the resource's monitors", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ inheritLabelsFromMonitors: true })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(mocks.labelAdds).toEqual([
      {
        resourceId: RESOURCE_ID.toString(),
        labelIds: [MONITOR_LABEL_ID.toString()],
      },
    ]);
  });

  it("inherits the labels of the resource's hosts", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ inheritLabelsFromHosts: true })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(mocks.labelAdds[0]!.labelIds).toEqual([HOST_LABEL_ID.toString()]);
  });

  it("reports alreadyApplied and writes nothing when every label is attached", async () => {
    const mocks: Mocks = installMocks(c, {
      existingLabelIds: [EXISTING_LABEL_ID, RULE_LABEL_ID],
    });

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ labelsToAdd: [ref(RULE_LABEL_ID)] })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(mocks.labelAdds).toEqual([]);
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("reports alreadyApplied when the rule only inherits from nothing", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      resource: c.makeResource({ monitorIds: [] }),
      rules: [rule({ inheritLabelsFromMonitors: true })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(mocks.labelAdds).toEqual([]);
  });

  it("reports noMatch and writes nothing when the resource is gone on re-read", async () => {
    const mocks: Mocks = installMocks(c, { resourceGone: true });

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          labelsToAdd: [ref(RULE_LABEL_ID)],
          inheritLabelsFromHosts: true,
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(mocks.labelAdds).toEqual([]);
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("reports failed, without throwing, when the write fails", async () => {
    installMocks(c, { failWrites: true });

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ labelsToAdd: [ref(RULE_LABEL_ID)] })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.failed());
  });

  it("selects criteria on the rule, and the create hook reads rules with that select", async () => {
    const mocks: Mocks = installMocks(c);
    const findBy: jest.SpyInstance = mockMethod(
      c.ruleService,
      "findBy",
      async () => {
        return [rule({ labelsToAdd: [ref(RULE_LABEL_ID)] })];
      },
    );

    await c.createHook(c.makeResource({}));

    expect(c.engine.ruleSelect).toMatchObject({ criteria: true });
    expect(findBy.mock.calls[0]![0].select).toBe(c.engine.ruleSelect);
    expect(findBy.mock.calls[0]![0].limit).toBe(
      MAX_RULES_EVALUATED_PER_PROJECT,
    );
    expect(mocks.labelAdds).toHaveLength(1);
  });

  it("still swallows a failure on the create path", async () => {
    installMocks(c, { failWrites: true });
    mockMethod(c.ruleService, "findBy", async () => {
      return [rule({ labelsToAdd: [ref(RULE_LABEL_ID)] })];
    });

    await expect(c.createHook(c.makeResource({}))).resolves.toBeUndefined();
  });
});

describe.each(OWNER_CASES)("$name - run now", (c: EngineCase) => {
  const owner: OwnerConfig = c.owner!;

  function users(mocks: Mocks): Array<CreatedOwner> {
    return createdOwners(mocks.ownerUserRows, "userId", owner.resourceIdColumn);
  }

  function teams(mocks: Mocks): Array<CreatedOwner> {
    return createdOwners(mocks.ownerTeamRows, "teamId", owner.resourceIdColumn);
  }

  it("matches on the resource's monitor and adds the rule's owners, notified when the run allows it", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          monitorNamePattern: "^checkout",
          notifyOwners: true,
          ownerUsers: [ref(USER_A_ID)],
          ownerTeams: [ref(TEAM_A_ID)],
        }),
      ],
      allowOwnerNotification: true,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(users(mocks)).toEqual([
      {
        ownerId: USER_A_ID.toString(),
        resourceId: RESOURCE_ID.toString(),
        isOwnerNotified: false,
      },
    ]);
    expect(teams(mocks)).toEqual([
      {
        ownerId: TEAM_A_ID.toString(),
        resourceId: RESOURCE_ID.toString(),
        isOwnerNotified: false,
      },
    ]);
    expect(mocks.feed).toHaveBeenCalledTimes(1);
  });

  it("matches configurable criteria on a label of the resource's monitor", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          criteria: monitorLabelCriteria(),
          ownerUsers: [ref(USER_A_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(users(mocks)).toHaveLength(1);
  });

  // Marked notified up front means no notification goes out.
  it("adds owners silently when the run does not allow notifications, even if the rule notifies", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          notifyOwners: true,
          ownerUsers: [ref(USER_A_ID)],
          ownerTeams: [ref(TEAM_A_ID)],
        }),
      ],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(
      [...users(mocks), ...teams(mocks)].map((row: CreatedOwner) => {
        return row.isOwnerNotified;
      }),
    ).toEqual([true, true]);
  });

  it.each<[boolean, boolean]>([
    [true, false],
    [false, true],
  ])(
    "inherits the owners of the resource's monitors (allowOwnerNotification: %s, isOwnerNotified: %s)",
    async (allowOwnerNotification: boolean, isOwnerNotified: boolean) => {
      const mocks: Mocks = installMocks(c);

      const result: RuleApplicationResult = await run(c, {
        rules: [rule({ notifyOwners: true, inheritOwnersFromMonitors: true })],
        allowOwnerNotification: allowOwnerNotification,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(users(mocks)).toEqual([
        {
          ownerId: MONITOR_OWNER_USER_ID.toString(),
          resourceId: RESOURCE_ID.toString(),
          isOwnerNotified: isOwnerNotified,
        },
      ]);
    },
  );

  it("inherits the owners of the resource's hosts", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ inheritOwnersFromHosts: true })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(teams(mocks)).toEqual([
      {
        ownerId: HOST_OWNER_TEAM_ID.toString(),
        resourceId: RESOURCE_ID.toString(),
        isOwnerNotified: true,
      },
    ]);
  });

  it("does not create an owner that is already assigned", async () => {
    const mocks: Mocks = installMocks(c, {
      existingOwnerUserIds: [USER_A_ID],
    });

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          ownerUsers: [ref(USER_A_ID)],
          ownerTeams: [ref(TEAM_A_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(users(mocks)).toEqual([]);
    expect(teams(mocks)).toHaveLength(1);
    // The feed item names only the owners actually added.
    expect(mocks.userLookup).not.toHaveBeenCalled();
    expect(mocks.teamLookup).toHaveBeenCalledTimes(1);
  });

  it("does not name an inherited source in the feed when its owners were already assigned", async () => {
    const mocks: Mocks = installMocks(c, {
      existingOwnerUserIds: [MONITOR_OWNER_USER_ID],
    });

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({ ownerTeams: [ref(TEAM_A_ID)], inheritOwnersFromMonitors: true }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(users(mocks)).toEqual([]);
    expect(mocks.feed.mock.calls[0]![0].feedInfoInMarkdown).not.toContain(
      "inherited",
    );
  });

  it("reports alreadyApplied and writes nothing when every owner is assigned", async () => {
    const mocks: Mocks = installMocks(c, {
      existingOwnerUserIds: [USER_A_ID],
      existingOwnerTeamIds: [TEAM_A_ID],
    });

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          ownerUsers: [ref(USER_A_ID)],
          ownerTeams: [ref(TEAM_A_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(users(mocks)).toEqual([]);
    expect(teams(mocks)).toEqual([]);
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  it("adds an owner two rules disagree about once, and notified", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({ notifyOwners: false, ownerUsers: [ref(USER_A_ID)] }),
        rule({ notifyOwners: true, ownerUsers: [ref(USER_A_ID)] }),
      ],
      allowOwnerNotification: true,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(users(mocks)).toEqual([
      {
        ownerId: USER_A_ID.toString(),
        resourceId: RESOURCE_ID.toString(),
        isOwnerNotified: false,
      },
    ]);
  });

  it("reports noMatch and writes nothing for a rule that does not match", async () => {
    const mocks: Mocks = installMocks(c);

    const result: RuleApplicationResult = await run(c, {
      rules: [
        rule({
          [c.titlePatternField]: "^billing",
          ownerUsers: [ref(USER_A_ID)],
        }),
      ],
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(users(mocks)).toEqual([]);
    expect(mocks.ownerAssignmentLookup).not.toHaveBeenCalled();
    expect(mocks.feed).not.toHaveBeenCalled();
  });

  /*
   * These engines never re-read the resource, so the "gone" case is a resource
   * with nothing to address - or an insert that fails, covered below.
   */
  it("reports noMatch for a resource without an id", async () => {
    const mocks: Mocks = installMocks(c);
    const resource: DatabaseBaseModel = c.makeResource({});
    (resource as unknown as { _id: string | undefined })._id = undefined;

    const result: RuleApplicationResult = await run(c, {
      resource: resource,
      rules: [rule({ ownerUsers: [ref(USER_A_ID)] })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(users(mocks)).toEqual([]);
  });

  it("reports failed, without throwing, when the write fails", async () => {
    installMocks(c, { failWrites: true });

    const result: RuleApplicationResult = await run(c, {
      rules: [rule({ ownerUsers: [ref(USER_A_ID)] })],
    });

    expect(result).toEqual(RuleApplicationResultUtil.failed());
  });

  it("selects criteria on the rule, and the create hook reads rules with that select and notifies", async () => {
    const mocks: Mocks = installMocks(c);
    const findBy: jest.SpyInstance = mockMethod(
      c.ruleService,
      "findBy",
      async () => {
        return [rule({ notifyOwners: true, ownerUsers: [ref(USER_A_ID)] })];
      },
    );

    await c.createHook(c.makeResource({}));

    expect(c.engine.ruleSelect).toMatchObject({ criteria: true });
    expect(findBy.mock.calls[0]![0].select).toBe(c.engine.ruleSelect);
    expect(findBy.mock.calls[0]![0].limit).toBe(
      MAX_RULES_EVALUATED_PER_PROJECT,
    );
    expect(users(mocks)).toEqual([
      {
        ownerId: USER_A_ID.toString(),
        resourceId: RESOURCE_ID.toString(),
        isOwnerNotified: false,
      },
    ]);
  });
});

describe.each([...LABEL_CASES, ...OWNER_CASES])(
  "$name - resourceSelectForRuleRun",
  (c: EngineCase) => {
    /*
     * Runs a rule that exercises every criterion and every inheritance source
     * against a resource that records which of its properties are read. The
     * columns read have to be exactly the ones the run selects: one read but
     * not selected would be undefined in a run, and silently never match.
     */
    it("names every column evaluation reads off the resource, and no other", async () => {
      installMocks(c);
      const propertiesRead: Set<string> = new Set();
      const resource: DatabaseBaseModel = new Proxy<DatabaseBaseModel>(
        c.makeResource({}),
        {
          get: (
            target: DatabaseBaseModel,
            property: string | symbol,
            receiver: unknown,
          ): unknown => {
            if (typeof property === "string") {
              propertiesRead.add(property);
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );

      const result: RuleApplicationResult = await run(c, {
        resource: resource,
        rules: [
          rule({
            ...c.criteriaMatchingEverything(),
            ...c.ruleAddingEverything(),
          }),
        ],
        allowOwnerNotification: true,
      });

      expect(result.matched).toBe(true);
      expect(result.failed).toBe(false);
      expect(result.updated).toBe(true);

      const columns: DatabaseBaseModel = new c.modelType();
      const columnsRead: Array<string> = Array.from(propertiesRead)
        .filter((property: string): boolean => {
          return Object.prototype.hasOwnProperty.call(columns, property);
        })
        .sort();

      expect(columnsRead).toEqual(
        Object.keys(c.engine.resourceSelectForRuleRun).sort(),
      );
    });
  },
);
