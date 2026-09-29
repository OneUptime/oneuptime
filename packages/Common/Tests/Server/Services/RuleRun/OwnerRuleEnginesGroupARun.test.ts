import CephClusterFeedService from "../../../../Server/Services/CephClusterFeedService";
import CephClusterOwnerRuleEngineService from "../../../../Server/Services/CephClusterOwnerRuleEngineService";
import CephClusterOwnerRuleService from "../../../../Server/Services/CephClusterOwnerRuleService";
import CephClusterOwnerTeamService from "../../../../Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "../../../../Server/Services/CephClusterOwnerUserService";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import CloudResourceFeedService from "../../../../Server/Services/CloudResourceFeedService";
import CloudResourceOwnerRuleEngineService from "../../../../Server/Services/CloudResourceOwnerRuleEngineService";
import CloudResourceOwnerRuleService from "../../../../Server/Services/CloudResourceOwnerRuleService";
import CloudResourceOwnerTeamService from "../../../../Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "../../../../Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DashboardOwnerRuleEngineService from "../../../../Server/Services/DashboardOwnerRuleEngineService";
import DashboardOwnerRuleService from "../../../../Server/Services/DashboardOwnerRuleService";
import DashboardOwnerTeamService from "../../../../Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "../../../../Server/Services/DashboardOwnerUserService";
import DashboardService from "../../../../Server/Services/DashboardService";
import DockerHostFeedService from "../../../../Server/Services/DockerHostFeedService";
import DockerHostOwnerRuleEngineService from "../../../../Server/Services/DockerHostOwnerRuleEngineService";
import DockerHostOwnerRuleService from "../../../../Server/Services/DockerHostOwnerRuleService";
import DockerHostOwnerTeamService from "../../../../Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../../../Server/Services/DockerHostOwnerUserService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../../Server/Services/DockerSwarmClusterFeedService";
import DockerSwarmClusterOwnerRuleEngineService from "../../../../Server/Services/DockerSwarmClusterOwnerRuleEngineService";
import DockerSwarmClusterOwnerRuleService from "../../../../Server/Services/DockerSwarmClusterOwnerRuleService";
import DockerSwarmClusterOwnerTeamService from "../../../../Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "../../../../Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostFeedService from "../../../../Server/Services/HostFeedService";
import HostOwnerRuleEngineService from "../../../../Server/Services/HostOwnerRuleEngineService";
import HostOwnerRuleService from "../../../../Server/Services/HostOwnerRuleService";
import HostOwnerTeamService from "../../../../Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "../../../../Server/Services/HostOwnerUserService";
import HostService from "../../../../Server/Services/HostService";
import IncomingCallPolicyOwnerRuleEngineService from "../../../../Server/Services/IncomingCallPolicyOwnerRuleEngineService";
import IncomingCallPolicyOwnerRuleService from "../../../../Server/Services/IncomingCallPolicyOwnerRuleService";
import IncomingCallPolicyOwnerTeamService from "../../../../Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "../../../../Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "../../../../Server/Services/IncomingCallPolicyService";
import IoTFleetOwnerRuleEngineService from "../../../../Server/Services/IoTFleetOwnerRuleEngineService";
import IoTFleetOwnerRuleService from "../../../../Server/Services/IoTFleetOwnerRuleService";
import IoTFleetOwnerTeamService from "../../../../Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "../../../../Server/Services/IoTFleetOwnerUserService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import KubernetesClusterFeedService from "../../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterOwnerRuleEngineService from "../../../../Server/Services/KubernetesClusterOwnerRuleEngineService";
import KubernetesClusterOwnerRuleService from "../../../../Server/Services/KubernetesClusterOwnerRuleService";
import KubernetesClusterOwnerTeamService from "../../../../Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../../../Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceOwnerRuleEngineService from "../../../../Server/Services/NetworkDeviceOwnerRuleEngineService";
import NetworkDeviceOwnerRuleService from "../../../../Server/Services/NetworkDeviceOwnerRuleService";
import NetworkDeviceOwnerTeamService from "../../../../Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import OnCallDutyPolicyOwnerRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyOwnerRuleService from "../../../../Server/Services/OnCallDutyPolicyOwnerRuleService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleOwnerRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerRuleEngineService";
import OnCallDutyPolicyScheduleOwnerRuleService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerRuleService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import logger from "../../../../Server/Utils/Logger";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import PostgresErrorTranslator from "../../../../Server/Utils/Database/PostgresErrorTranslator";
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
import { describe, expect, it, afterEach, beforeEach } from "@jest/globals";

/*
 * Contract under test - "Run now" for the owner rules that create owner rows
 * directly (group A: Ceph, cloud resources, dashboards, Docker hosts, Docker
 * Swarm clusters, hosts, incoming call policies, IoT fleets, Kubernetes
 * clusters, network devices, on-call duty policies and schedules).
 *
 * Owner rules used to fire only when a resource was created. Each engine now
 * also applies a rule to a resource that already exists, and says what it did:
 * the shared runner counts matched / updated / failed resources from that
 * answer. A run meets existing owners on almost every resource, so an owner
 * who is already there must be skipped rather than added twice, and a run the
 * operator did not opt into notifications for must add owners silently.
 *
 * The engines are one shape, so every case runs against all twelve.
 */

// Services are spied on generically; their concrete types differ per engine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpiedService = any;

interface FeedHooks {
  service: SpiedService;
  createItemMethod: string;
  markdownLinkMethod: string;
}

interface OwnerEngineCase {
  name: string;
  engine: RuleRunEngine<BaseModel, BaseModel>;
  applyCreateHook: (resource: BaseModel) => Promise<void>;
  ruleService: SpiedService;
  resourceService: SpiedService;
  ownerUserService: SpiedService;
  ownerTeamService: SpiedService;
  resourceIdColumn: string;
  labelsField: string;
  namePatternField: string;
  descriptionPatternField: string;
  feed: FeedHooks | null;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const LABEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function asEngine(engine: unknown): RuleRunEngine<BaseModel, BaseModel> {
  return engine as RuleRunEngine<BaseModel, BaseModel>;
}

const CASES: Array<OwnerEngineCase> = [
  {
    name: "CephClusterOwnerRuleEngineService",
    engine: asEngine(CephClusterOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await CephClusterOwnerRuleEngineService.applyRulesToCephCluster(
        resource as never,
      );
    },
    ruleService: CephClusterOwnerRuleService,
    resourceService: CephClusterService,
    ownerUserService: CephClusterOwnerUserService,
    ownerTeamService: CephClusterOwnerTeamService,
    resourceIdColumn: "cephClusterId",
    labelsField: "cephClusterLabels",
    namePatternField: "cephClusterNamePattern",
    descriptionPatternField: "cephClusterDescriptionPattern",
    feed: {
      service: CephClusterFeedService,
      createItemMethod: "createCephClusterFeedItem",
      markdownLinkMethod: "getCephClusterMarkdownLink",
    },
  },
  {
    name: "CloudResourceOwnerRuleEngineService",
    engine: asEngine(CloudResourceOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await CloudResourceOwnerRuleEngineService.applyRulesToCloudResource(
        resource as never,
      );
    },
    ruleService: CloudResourceOwnerRuleService,
    resourceService: CloudResourceService,
    ownerUserService: CloudResourceOwnerUserService,
    ownerTeamService: CloudResourceOwnerTeamService,
    resourceIdColumn: "cloudResourceId",
    labelsField: "matchLabels",
    namePatternField: "nameRegexPattern",
    descriptionPatternField: "descriptionRegexPattern",
    feed: {
      service: CloudResourceFeedService,
      createItemMethod: "createCloudResourceFeedItem",
      markdownLinkMethod: "getCloudResourceMarkdownLink",
    },
  },
  {
    name: "DashboardOwnerRuleEngineService",
    engine: asEngine(DashboardOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await DashboardOwnerRuleEngineService.applyRulesToDashboard(
        resource as never,
      );
    },
    ruleService: DashboardOwnerRuleService,
    resourceService: DashboardService,
    ownerUserService: DashboardOwnerUserService,
    ownerTeamService: DashboardOwnerTeamService,
    resourceIdColumn: "dashboardId",
    labelsField: "dashboardLabels",
    namePatternField: "dashboardNamePattern",
    descriptionPatternField: "dashboardDescriptionPattern",
    feed: null,
  },
  {
    name: "DockerHostOwnerRuleEngineService",
    engine: asEngine(DockerHostOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await DockerHostOwnerRuleEngineService.applyRulesToDockerHost(
        resource as never,
      );
    },
    ruleService: DockerHostOwnerRuleService,
    resourceService: DockerHostService,
    ownerUserService: DockerHostOwnerUserService,
    ownerTeamService: DockerHostOwnerTeamService,
    resourceIdColumn: "dockerHostId",
    labelsField: "dockerHostLabels",
    namePatternField: "dockerHostNamePattern",
    descriptionPatternField: "dockerHostDescriptionPattern",
    feed: {
      service: DockerHostFeedService,
      createItemMethod: "createDockerHostFeedItem",
      markdownLinkMethod: "getDockerHostMarkdownLink",
    },
  },
  {
    name: "DockerSwarmClusterOwnerRuleEngineService",
    engine: asEngine(DockerSwarmClusterOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await DockerSwarmClusterOwnerRuleEngineService.applyRulesToDockerSwarmCluster(
        resource as never,
      );
    },
    ruleService: DockerSwarmClusterOwnerRuleService,
    resourceService: DockerSwarmClusterService,
    ownerUserService: DockerSwarmClusterOwnerUserService,
    ownerTeamService: DockerSwarmClusterOwnerTeamService,
    resourceIdColumn: "dockerSwarmClusterId",
    labelsField: "dockerSwarmClusterLabels",
    namePatternField: "dockerSwarmClusterNamePattern",
    descriptionPatternField: "dockerSwarmClusterDescriptionPattern",
    feed: {
      service: DockerSwarmClusterFeedService,
      createItemMethod: "createDockerSwarmClusterFeedItem",
      markdownLinkMethod: "getDockerSwarmClusterMarkdownLink",
    },
  },
  {
    name: "HostOwnerRuleEngineService",
    engine: asEngine(HostOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await HostOwnerRuleEngineService.applyRulesToHost(resource as never);
    },
    ruleService: HostOwnerRuleService,
    resourceService: HostService,
    ownerUserService: HostOwnerUserService,
    ownerTeamService: HostOwnerTeamService,
    resourceIdColumn: "hostId",
    labelsField: "hostLabels",
    namePatternField: "hostNamePattern",
    descriptionPatternField: "hostDescriptionPattern",
    feed: {
      service: HostFeedService,
      createItemMethod: "createHostFeedItem",
      markdownLinkMethod: "getHostMarkdownLink",
    },
  },
  {
    name: "IncomingCallPolicyOwnerRuleEngineService",
    engine: asEngine(IncomingCallPolicyOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await IncomingCallPolicyOwnerRuleEngineService.applyRulesToIncomingCallPolicy(
        resource as never,
      );
    },
    ruleService: IncomingCallPolicyOwnerRuleService,
    resourceService: IncomingCallPolicyService,
    ownerUserService: IncomingCallPolicyOwnerUserService,
    ownerTeamService: IncomingCallPolicyOwnerTeamService,
    resourceIdColumn: "incomingCallPolicyId",
    labelsField: "incomingCallPolicyLabels",
    namePatternField: "incomingCallPolicyNamePattern",
    descriptionPatternField: "incomingCallPolicyDescriptionPattern",
    feed: null,
  },
  {
    name: "IoTFleetOwnerRuleEngineService",
    engine: asEngine(IoTFleetOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await IoTFleetOwnerRuleEngineService.applyRulesToIoTFleet(
        resource as never,
      );
    },
    ruleService: IoTFleetOwnerRuleService,
    resourceService: IoTFleetService,
    ownerUserService: IoTFleetOwnerUserService,
    ownerTeamService: IoTFleetOwnerTeamService,
    resourceIdColumn: "iotFleetId",
    labelsField: "iotFleetLabels",
    namePatternField: "iotFleetNamePattern",
    descriptionPatternField: "iotFleetDescriptionPattern",
    feed: null,
  },
  {
    name: "KubernetesClusterOwnerRuleEngineService",
    engine: asEngine(KubernetesClusterOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await KubernetesClusterOwnerRuleEngineService.applyRulesToKubernetesCluster(
        resource as never,
      );
    },
    ruleService: KubernetesClusterOwnerRuleService,
    resourceService: KubernetesClusterService,
    ownerUserService: KubernetesClusterOwnerUserService,
    ownerTeamService: KubernetesClusterOwnerTeamService,
    resourceIdColumn: "kubernetesClusterId",
    labelsField: "kubernetesClusterLabels",
    namePatternField: "kubernetesClusterNamePattern",
    descriptionPatternField: "kubernetesClusterDescriptionPattern",
    feed: {
      service: KubernetesClusterFeedService,
      createItemMethod: "createKubernetesClusterFeedItem",
      markdownLinkMethod: "getKubernetesClusterMarkdownLink",
    },
  },
  {
    name: "NetworkDeviceOwnerRuleEngineService",
    engine: asEngine(NetworkDeviceOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
        resource as never,
      );
    },
    ruleService: NetworkDeviceOwnerRuleService,
    resourceService: NetworkDeviceService,
    ownerUserService: NetworkDeviceOwnerUserService,
    ownerTeamService: NetworkDeviceOwnerTeamService,
    resourceIdColumn: "networkDeviceId",
    labelsField: "networkDeviceLabels",
    namePatternField: "networkDeviceNamePattern",
    descriptionPatternField: "networkDeviceDescriptionPattern",
    feed: null,
  },
  {
    name: "OnCallDutyPolicyOwnerRuleEngineService",
    engine: asEngine(OnCallDutyPolicyOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await OnCallDutyPolicyOwnerRuleEngineService.applyRulesToOnCallDutyPolicy(
        resource as never,
      );
    },
    ruleService: OnCallDutyPolicyOwnerRuleService,
    resourceService: OnCallDutyPolicyService,
    ownerUserService: OnCallDutyPolicyOwnerUserService,
    ownerTeamService: OnCallDutyPolicyOwnerTeamService,
    resourceIdColumn: "onCallDutyPolicyId",
    labelsField: "onCallDutyPolicyLabels",
    namePatternField: "onCallDutyPolicyNamePattern",
    descriptionPatternField: "onCallDutyPolicyDescriptionPattern",
    feed: null,
  },
  {
    name: "OnCallDutyPolicyScheduleOwnerRuleEngineService",
    engine: asEngine(OnCallDutyPolicyScheduleOwnerRuleEngineService),
    applyCreateHook: async (resource: BaseModel): Promise<void> => {
      await OnCallDutyPolicyScheduleOwnerRuleEngineService.applyRulesToSchedule(
        resource as never,
      );
    },
    ruleService: OnCallDutyPolicyScheduleOwnerRuleService,
    resourceService: OnCallDutyPolicyScheduleService,
    ownerUserService: OnCallDutyPolicyScheduleOwnerUserService,
    ownerTeamService: OnCallDutyPolicyScheduleOwnerTeamService,
    resourceIdColumn: "onCallDutyPolicyScheduleId",
    labelsField: "onCallDutyPolicyScheduleLabels",
    namePatternField: "onCallDutyPolicyScheduleNamePattern",
    descriptionPatternField: "onCallDutyPolicyScheduleDescriptionPattern",
    feed: null,
  },
];

function fakeRef(id: ObjectID): BaseModel {
  return { id: id, _id: id.toString() } as unknown as BaseModel;
}

// The resource as a run (or onCreateSuccess) hands it to an engine: ids only.
function ruleTarget(): BaseModel {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as BaseModel;
}

// The row the engine re-reads to match on.
function fakeDetails(): BaseModel {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-core-01",
    description: "Primary production core",
    labels: [fakeRef(LABEL_ID)],
  } as unknown as BaseModel;
}

function fakeRule(
  c: OwnerEngineCase,
  data: {
    id?: ObjectID | undefined;
    namePattern?: string | undefined;
    criteria?: RuleCriteria | undefined;
    notifyOwners?: boolean | undefined;
    userIds?: Array<ObjectID> | undefined;
    teamIds?: Array<ObjectID> | undefined;
  } = {},
): BaseModel {
  const id: ObjectID = data.id || RULE_ID;
  const rule: Record<string, unknown> = {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    name: "Production owners",
    ownerUsers: (data.userIds || [USER_ID]).map(fakeRef),
    ownerTeams: (data.teamIds || [TEAM_ID]).map(fakeRef),
    [c.namePatternField]: data.namePattern ?? "^prod-",
  };

  if (data.notifyOwners !== undefined) {
    rule["notifyOwners"] = data.notifyOwners;
  }

  if (data.criteria) {
    rule["criteria"] = data.criteria;
  }

  return rule as unknown as BaseModel;
}

function nameAndLabelCriteria(
  c: OwnerEngineCase,
  labelId: ObjectID,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [
      {
        field: c.namePatternField,
        operator: RuleCriteriaOperator.Contains,
        value: "core",
      },
      {
        field: c.labelsField,
        operator: RuleCriteriaOperator.HasAllOf,
        value: [labelId.toString()],
      },
    ],
  };
}

// An owner row as OwnerRuleAssignment reads it back: only the id column.
function existingOwnerRow(column: string, id: ObjectID): BaseModel {
  return {
    getColumnValue: (key: string): unknown => {
      return key === column ? id : undefined;
    },
  } as unknown as BaseModel;
}

interface EngineMocks {
  ruleRead: jest.SpyInstance;
  resourceRead: jest.SpyInstance;
  ownerUserRead: jest.SpyInstance;
  ownerTeamRead: jest.SpyInstance;
  createOwnerUser: jest.SpyInstance;
  createOwnerTeam: jest.SpyInstance;
  createFeedItem: jest.SpyInstance | null;
  memberCheck: jest.SpyInstance;
}

function mockEngine(
  c: OwnerEngineCase,
  data: {
    rules?: Array<BaseModel> | undefined;
    details?: BaseModel | null | undefined;
    assignedUserIds?: Array<ObjectID> | undefined;
    assignedTeamIds?: Array<ObjectID> | undefined;
    ownerWriteError?: Error | undefined;
    // Whether the rule's owner user is still a member of the project.
    userIsProjectMember?: boolean | undefined;
  } = {},
): EngineMocks {
  const ruleRead: jest.SpyInstance = jest
    .spyOn(c.ruleService, "findBy")
    .mockResolvedValue(data.rules || []);
  const resourceRead: jest.SpyInstance = jest
    .spyOn(c.resourceService, "findOneById")
    .mockResolvedValue(
      data.details === undefined ? fakeDetails() : data.details,
    );
  const ownerUserRead: jest.SpyInstance = jest
    .spyOn(c.ownerUserService, "findBy")
    .mockResolvedValue(
      (data.assignedUserIds || []).map((id: ObjectID): BaseModel => {
        return existingOwnerRow("userId", id);
      }),
    );
  const ownerTeamRead: jest.SpyInstance = jest
    .spyOn(c.ownerTeamService, "findBy")
    .mockResolvedValue(
      (data.assignedTeamIds || []).map((id: ObjectID): BaseModel => {
        return existingOwnerRow("teamId", id);
      }),
    );
  const createOwnerUser: jest.SpyInstance = jest
    .spyOn(c.ownerUserService, "create")
    .mockImplementation(async (): Promise<unknown> => {
      if (data.ownerWriteError) {
        throw data.ownerWriteError;
      }

      return {};
    });
  const createOwnerTeam: jest.SpyInstance = jest
    .spyOn(c.ownerTeamService, "create")
    .mockResolvedValue({});

  let createFeedItem: jest.SpyInstance | null = null;

  if (c.feed) {
    jest
      .spyOn(c.resourceService, c.feed.markdownLinkMethod)
      .mockResolvedValue("[prod-core-01](/resource)");
    createFeedItem = jest
      .spyOn(c.feed.service, c.feed.createItemMethod)
      .mockResolvedValue(undefined);
  }

  const memberCheck: jest.SpyInstance = jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(data.userIsProjectMember !== false);

  return {
    ruleRead: ruleRead,
    resourceRead: resourceRead,
    ownerUserRead: ownerUserRead,
    ownerTeamRead: ownerTeamRead,
    createOwnerUser: createOwnerUser,
    createOwnerTeam: createOwnerTeam,
    createFeedItem: createFeedItem,
    memberCheck: memberCheck,
  };
}

async function runRules(
  c: OwnerEngineCase,
  rules: Array<BaseModel>,
  allowOwnerNotification: boolean,
): Promise<RuleApplicationResult> {
  return await c.engine.applyRulesToExistingResource({
    resource: ruleTarget(),
    rules: rules,
    allowOwnerNotification: allowOwnerNotification,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writtenRow(spy: jest.SpyInstance, index: number = 0): any {
  return spy.mock.calls[index]![0].data;
}

describe.each(
  CASES.map((c: OwnerEngineCase): [string, OwnerEngineCase] => {
    return [c.name, c];
  }),
)("%s - Run now", (_name: string, c: OwnerEngineCase) => {
  beforeEach(() => {
    // Silence the logs the failure-path tests deliberately provoke.
    jest.spyOn(logger, "error").mockImplementation(() => {});
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    jest.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what a run reads", () => {
    it("selects the rule's criteria, legacy fields and owners", () => {
      expect(c.engine.ruleSelect).toMatchObject({
        _id: true,
        name: true,
        criteria: true,
        notifyOwners: true,
        [c.labelsField]: { _id: true },
        [c.namePatternField]: true,
        [c.descriptionPatternField]: true,
        ownerUsers: { _id: true },
        ownerTeams: { _id: true },
      });
    });

    // Evaluation re-reads the resource, so the run only has to name it.
    it("needs only the resource's id and project", () => {
      expect(c.engine.resourceSelectForRuleRun).toEqual({
        _id: true,
        projectId: true,
      });
    });

    it("still reads the project's enabled rules with ruleSelect on create", async () => {
      const mocks: EngineMocks = mockEngine(c, { rules: [fakeRule(c)] });

      await c.applyCreateHook(ruleTarget());

      expect(mocks.ruleRead).toHaveBeenCalledTimes(1);
      const findBy: any = mocks.ruleRead.mock.calls[0]![0];
      expect(findBy.select).toBe(c.engine.ruleSelect);
      expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
      expect(findBy.query.isEnabled).toBe(true);
      expect(findBy.query.projectId.toString()).toBe(PROJECT_ID.toString());

      // The create path is not a run: a notifying rule still notifies.
      expect(mocks.createOwnerUser).toHaveBeenCalledTimes(1);
      expect(writtenRow(mocks.createOwnerUser).isOwnerNotified).toBe(false);
      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);
      expect(writtenRow(mocks.createOwnerTeam).isOwnerNotified).toBe(false);
    });

    it("does not duplicate an owner already assigned on create either", async () => {
      const mocks: EngineMocks = mockEngine(c, {
        rules: [fakeRule(c)],
        assignedUserIds: [USER_ID],
      });

      await c.applyCreateHook(ruleTarget());

      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);
    });
  });

  describe("applyRulesToExistingResource", () => {
    it("adds a matching rule's owners to the resource and counts them", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c)],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));

      // A run evaluates the rules it is handed, not the project's.
      expect(mocks.ruleRead).not.toHaveBeenCalled();

      expect(mocks.createOwnerUser).toHaveBeenCalledTimes(1);
      const userRow: any = writtenRow(mocks.createOwnerUser);
      expect(userRow[c.resourceIdColumn].toString()).toBe(
        RESOURCE_ID.toString(),
      );
      expect(userRow.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(userRow.userId.toString()).toBe(USER_ID.toString());
      expect(mocks.createOwnerUser.mock.calls[0]![0].props).toEqual({
        isRoot: true,
      });

      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);
      const teamRow: any = writtenRow(mocks.createOwnerTeam);
      expect(teamRow[c.resourceIdColumn].toString()).toBe(
        RESOURCE_ID.toString(),
      );
      expect(teamRow.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(teamRow.teamId.toString()).toBe(TEAM_ID.toString());
    });

    it("looks up existing owners of this resource before adding", async () => {
      const mocks: EngineMocks = mockEngine(c);

      await runRules(c, [fakeRule(c)], true);

      const userQuery: any = mocks.ownerUserRead.mock.calls[0]![0].query;
      expect(userQuery[c.resourceIdColumn].toString()).toBe(
        RESOURCE_ID.toString(),
      );
      const teamQuery: any = mocks.ownerTeamRead.mock.calls[0]![0].query;
      expect(teamQuery[c.resourceIdColumn].toString()).toBe(
        RESOURCE_ID.toString(),
      );
    });

    it("notifies added owners when the run allows it and the rule notifies", async () => {
      const mocks: EngineMocks = mockEngine(c);

      await runRules(c, [fakeRule(c, { notifyOwners: true })], true);

      expect(writtenRow(mocks.createOwnerUser).isOwnerNotified).toBe(false);
      expect(writtenRow(mocks.createOwnerTeam).isOwnerNotified).toBe(false);
    });

    it("adds owners silently when the run does not allow notifications", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c, { notifyOwners: true })],
        false,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(writtenRow(mocks.createOwnerUser).isOwnerNotified).toBe(true);
      expect(writtenRow(mocks.createOwnerTeam).isOwnerNotified).toBe(true);
    });

    it("adds owners silently when the rule does not notify", async () => {
      const mocks: EngineMocks = mockEngine(c);

      await runRules(c, [fakeRule(c, { notifyOwners: false })], true);

      expect(writtenRow(mocks.createOwnerUser).isOwnerNotified).toBe(true);
      expect(writtenRow(mocks.createOwnerTeam).isOwnerNotified).toBe(true);
    });

    it("skips an owner who is already assigned", async () => {
      const mocks: EngineMocks = mockEngine(c, {
        assignedUserIds: [USER_ID],
      });

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c)],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);
    });

    it("does not make a rule's owner user who has left the project an owner", async () => {
      const mocks: EngineMocks = mockEngine(c, { userIsProjectMember: false });

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c)],
        true,
      );

      // The rule's team is still added; the departed user is not.
      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);

      const asked: any = mocks.memberCheck.mock.calls[0]![0];
      expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(asked.userId.toString()).toBe(USER_ID.toString());
    });

    it("reports already applied, and writes nothing, when every owner is assigned", async () => {
      const mocks: EngineMocks = mockEngine(c, {
        assignedUserIds: [USER_ID],
        assignedTeamIds: [TEAM_ID],
      });

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c)],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).not.toHaveBeenCalled();
      if (mocks.createFeedItem) {
        expect(mocks.createFeedItem).not.toHaveBeenCalled();
      }
    });

    it("reports already applied when the matching rule names no owners", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c, { userIds: [], teamIds: [] })],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(mocks.ownerUserRead).not.toHaveBeenCalled();
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).not.toHaveBeenCalled();
    });

    it("adds an owner two matching rules disagree about once, and notifies", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [
          fakeRule(c, { notifyOwners: false, teamIds: [] }),
          fakeRule(c, {
            id: SECOND_RULE_ID,
            notifyOwners: true,
            teamIds: [],
          }),
        ],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(mocks.createOwnerUser).toHaveBeenCalledTimes(1);
      expect(writtenRow(mocks.createOwnerUser).isOwnerNotified).toBe(false);
    });

    it("reports no match, and writes nothing, when the rule does not match", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c, { namePattern: "^staging-" })],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(mocks.ownerUserRead).not.toHaveBeenCalled();
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).not.toHaveBeenCalled();
    });

    it("matches on the rule's criteria rather than stale legacy fields", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [
          fakeRule(c, {
            criteria: nameAndLabelCriteria(c, LABEL_ID),
            namePattern: "^stale-and-never-matches-",
          }),
        ],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(mocks.createOwnerUser).toHaveBeenCalledTimes(1);
    });

    it("reports no match when the rule's criteria do not match", async () => {
      const mocks: EngineMocks = mockEngine(c);

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c, { criteria: nameAndLabelCriteria(c, OTHER_LABEL_ID) })],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
    });

    it("reports no match when the resource is gone", async () => {
      const mocks: EngineMocks = mockEngine(c, { details: null });

      const result: RuleApplicationResult = await runRules(
        c,
        [fakeRule(c)],
        true,
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(mocks.ownerUserRead).not.toHaveBeenCalled();
      expect(mocks.createOwnerUser).not.toHaveBeenCalled();
      expect(mocks.createOwnerTeam).not.toHaveBeenCalled();
    });

    it("reports a failure, without throwing, when a write fails", async () => {
      mockEngine(c, {
        ownerWriteError: new Error("database is down"),
      });

      await expect(runRules(c, [fakeRule(c)], true)).resolves.toEqual(
        RuleApplicationResultUtil.failed(),
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it("carries on, counting only what it added, when another writer added the owner first", async () => {
      /*
       * Issue #3394: owner rows are unique, so an owner added between the
       * "who is already assigned" read and this insert is refused. That is the
       * outcome the run wanted, not a failure - and it must not stop the
       * team being added after it.
       */
      const mocks: EngineMocks = mockEngine(c, {
        ownerWriteError: PostgresErrorTranslator.translate({
          code: "23505",
          table: "OwnerUser",
          detail:
            'Key ("resourceId", "userId", "projectId")=(c, u, p) already exists.',
        }) as Error,
      });

      await expect(runRules(c, [fakeRule(c)], true)).resolves.toEqual(
        RuleApplicationResultUtil.updated(1),
      );
      expect(mocks.createOwnerUser).toHaveBeenCalledTimes(1);
      expect(mocks.createOwnerTeam).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("reports already applied when the only owner to add was added concurrently", async () => {
      const mocks: EngineMocks = mockEngine(c, {
        ownerWriteError: PostgresErrorTranslator.createUniqueViolationException(
          "This user is already an owner.",
        ),
        assignedTeamIds: [TEAM_ID],
      });

      await expect(runRules(c, [fakeRule(c)], true)).resolves.toEqual(
        RuleApplicationResultUtil.alreadyApplied(),
      );
      expect(mocks.createOwnerTeam).not.toHaveBeenCalled();
      if (mocks.createFeedItem) {
        // Nothing was added, so no "owners were added by rule" item either.
        expect(mocks.createFeedItem).not.toHaveBeenCalled();
      }
    });
  });
});

describe.each(
  CASES.filter((c: OwnerEngineCase): boolean => {
    return c.feed !== null;
  }).map((c: OwnerEngineCase): [string, OwnerEngineCase] => {
    return [c.name, c];
  }),
)("%s - Run now feed item", (_name: string, c: OwnerEngineCase) => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation(() => {});
    jest.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records which rule added owners", async () => {
    const mocks: EngineMocks = mockEngine(c);

    await runRules(c, [fakeRule(c)], false);

    expect(mocks.createFeedItem).toHaveBeenCalledTimes(1);
    const feedItem: any = mocks.createFeedItem!.mock.calls[0]![0];
    expect(feedItem.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(feedItem.moreInformationInMarkdown).toContain("Production owners");
  });

  it("records nothing when no owner was added", async () => {
    const mocks: EngineMocks = mockEngine(c);

    await runRules(c, [fakeRule(c, { namePattern: "^staging-" })], true);

    expect(mocks.createFeedItem).not.toHaveBeenCalled();
  });
});
