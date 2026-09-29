import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeOwnerRuleEngineService from "../../../../Server/Services/AlertEpisodeOwnerRuleEngineService";
import AlertEpisodeOwnerRuleService from "../../../../Server/Services/AlertEpisodeOwnerRuleService";
import AlertEpisodeOwnerTeamService from "../../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeOwnerRuleEngineService from "../../../../Server/Services/IncidentEpisodeOwnerRuleEngineService";
import IncidentEpisodeOwnerRuleService from "../../../../Server/Services/IncidentEpisodeOwnerRuleService";
import IncidentEpisodeOwnerTeamService from "../../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import PodmanHostFeedService from "../../../../Server/Services/PodmanHostFeedService";
import PodmanHostOwnerRuleEngineService from "../../../../Server/Services/PodmanHostOwnerRuleEngineService";
import PodmanHostOwnerRuleService from "../../../../Server/Services/PodmanHostOwnerRuleService";
import PodmanHostOwnerTeamService from "../../../../Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../../../Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterFeedService from "../../../../Server/Services/ProxmoxClusterFeedService";
import ProxmoxClusterOwnerRuleEngineService from "../../../../Server/Services/ProxmoxClusterOwnerRuleEngineService";
import ProxmoxClusterOwnerRuleService from "../../../../Server/Services/ProxmoxClusterOwnerRuleService";
import ProxmoxClusterOwnerTeamService from "../../../../Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "../../../../Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import RumApplicationOwnerRuleEngineService from "../../../../Server/Services/RumApplicationOwnerRuleEngineService";
import RumApplicationOwnerRuleService from "../../../../Server/Services/RumApplicationOwnerRuleService";
import RumApplicationOwnerTeamService from "../../../../Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "../../../../Server/Services/RumApplicationOwnerUserService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import RunbookOwnerRuleEngineService from "../../../../Server/Services/RunbookOwnerRuleEngineService";
import RunbookOwnerRuleService from "../../../../Server/Services/RunbookOwnerRuleService";
import RunbookOwnerTeamService from "../../../../Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "../../../../Server/Services/RunbookOwnerUserService";
import RunbookService from "../../../../Server/Services/RunbookService";
import ServerlessFunctionOwnerRuleEngineService from "../../../../Server/Services/ServerlessFunctionOwnerRuleEngineService";
import ServerlessFunctionOwnerRuleService from "../../../../Server/Services/ServerlessFunctionOwnerRuleService";
import ServerlessFunctionOwnerTeamService from "../../../../Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "../../../../Server/Services/ServerlessFunctionOwnerUserService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import ServiceFeedService from "../../../../Server/Services/ServiceFeedService";
import ServiceOwnerRuleEngineService from "../../../../Server/Services/ServiceOwnerRuleEngineService";
import ServiceOwnerRuleService from "../../../../Server/Services/ServiceOwnerRuleService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../Server/Services/ServiceOwnerUserService";
import ServiceService from "../../../../Server/Services/ServiceService";
import ServiceLevelObjectiveFeedService from "../../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveOwnerRuleEngineService from "../../../../Server/Services/ServiceLevelObjectiveOwnerRuleEngineService";
import ServiceLevelObjectiveOwnerRuleService from "../../../../Server/Services/ServiceLevelObjectiveOwnerRuleService";
import ServiceLevelObjectiveOwnerTeamService from "../../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import StatusPageOwnerRuleEngineService from "../../../../Server/Services/StatusPageOwnerRuleEngineService";
import StatusPageOwnerRuleService from "../../../../Server/Services/StatusPageOwnerRuleService";
import StatusPageOwnerTeamService from "../../../../Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../../Server/Services/StatusPageOwnerUserService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import TeamService from "../../../../Server/Services/TeamService";
import UserService from "../../../../Server/Services/UserService";
import VMwareVCenterFeedService from "../../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterOwnerRuleEngineService from "../../../../Server/Services/VMwareVCenterOwnerRuleEngineService";
import VMwareVCenterOwnerRuleService from "../../../../Server/Services/VMwareVCenterOwnerRuleService";
import VMwareVCenterOwnerTeamService from "../../../../Server/Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "../../../../Server/Services/VMwareVCenterOwnerUserService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import WorkflowOwnerRuleEngineService from "../../../../Server/Services/WorkflowOwnerRuleEngineService";
import WorkflowOwnerRuleService from "../../../../Server/Services/WorkflowOwnerRuleService";
import WorkflowOwnerTeamService from "../../../../Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "../../../../Server/Services/WorkflowOwnerUserService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import AlertEpisodeOwnerTeam from "../../../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "../../../../Models/DatabaseModels/AlertEpisodeOwnerUser";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeOwnerTeam from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "../../../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import PodmanHostOwnerTeam from "../../../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "../../../../Models/DatabaseModels/PodmanHostOwnerUser";
import ProxmoxClusterOwnerTeam from "../../../../Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import ProxmoxClusterOwnerUser from "../../../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import RumApplicationOwnerTeam from "../../../../Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "../../../../Models/DatabaseModels/RumApplicationOwnerUser";
import RunbookOwnerTeam from "../../../../Models/DatabaseModels/RunbookOwnerTeam";
import RunbookOwnerUser from "../../../../Models/DatabaseModels/RunbookOwnerUser";
import ServerlessFunctionOwnerTeam from "../../../../Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerUser from "../../../../Models/DatabaseModels/ServerlessFunctionOwnerUser";
import ServiceOwnerTeam from "../../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../../Models/DatabaseModels/ServiceOwnerUser";
import ServiceLevelObjectiveOwnerTeam from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import StatusPageOwnerTeam from "../../../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "../../../../Models/DatabaseModels/StatusPageOwnerUser";
import VMwareVCenterOwnerTeam from "../../../../Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerUser from "../../../../Models/DatabaseModels/VMwareVCenterOwnerUser";
import WorkflowOwnerTeam from "../../../../Models/DatabaseModels/WorkflowOwnerTeam";
import WorkflowOwnerUser from "../../../../Models/DatabaseModels/WorkflowOwnerUser";
import logger from "../../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run now" for the owner rule engines of the Podman,
 * Proxmox, RUM, runbook, serverless, service, status page, vCenter, workflow,
 * alert episode and incident episode families.
 *
 * Each engine applies ONE rule to a resource that already exists. What a run
 * can get wrong that the create hook rarely does: an existing resource almost
 * always has owners already, so owners must not be duplicated and the result
 * must say "already applied" rather than "updated"; and a run can touch
 * hundreds of resources, so owners must be added silently unless the person
 * running it opted into notifications - whatever the rule itself says.
 *
 * Owner rows are captured at the owner services' `create`, so engines that go
 * through a resource service's addOwners are exercised through it.
 */

type AnyFunction = (...args: Array<any>) => any;
type OwnerModelType = new () => BaseModel;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const USER_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_B: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const TEAM_A: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_SEVERITY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const LABEL_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

const RESOURCE_NAME: string = "checkout-api";
const RESOURCE_DESCRIPTION: string = "Customer checkout";

interface EngineUnderTest {
  ruleSelect: Record<string, unknown>;
  resourceSelectForRuleRun: Record<string, unknown>;
  applyRulesToExistingResource(data: {
    resource: BaseModel;
    rules: Array<BaseModel>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult>;
}

interface EngineCase {
  name: string;
  engine: Record<string, any>;
  // The public method the resource's create hook calls.
  createHook: string;
  ruleService: Record<string, any>;
  /*
   * The service evaluation re-reads the resource through. Null for the
   * episode engines, which match on the object they are handed.
   */
  rereadService: Record<string, any> | null;
  ownerUserService: Record<string, any>;
  ownerTeamService: Record<string, any>;
  ownerUserModel: OwnerModelType;
  ownerTeamModel: OwnerModelType;
  resourceIdColumn: string;
  // The legacy rule field that matches on the resource's name (or title).
  namePatternField: string;
  // Service owner rows have no isOwnerNotified column at all.
  hasNotificationFlag: boolean;
  // The resource service whose addOwners the engine adds owners through.
  addOwnersService: Record<string, any> | null;
  mockFeed: () => jest.SpyInstance | null;
  prepare: () => void;
}

interface OwnerWrite {
  kind: "user" | "team";
  id: string;
  isOwnerNotified: boolean | undefined;
}

interface Harness {
  writes: Array<OwnerWrite>;
  reread: jest.SpyInstance | null;
  ownerUserFindBy: jest.SpyInstance;
  ownerTeamFindBy: jest.SpyInstance;
  addOwners: jest.SpyInstance | null;
  feed: jest.SpyInstance | null;
  loggedError: jest.SpyInstance;
}

function spy(target: Record<string, any>, method: string): jest.SpyInstance {
  return jest.spyOn(target as Record<string, AnyFunction>, method);
}

function ref(id: ObjectID): BaseModel {
  return { id: id, _id: id.toString() } as unknown as BaseModel;
}

function noop(): void {
  // Nothing beyond the shared mocks.
}

function noFeed(): jest.SpyInstance | null {
  return null;
}

function feedMock(data: {
  linkService: Record<string, any>;
  linkMethod: string;
  feedService: Record<string, any>;
  feedMethod: string;
}): () => jest.SpyInstance {
  return (): jest.SpyInstance => {
    spy(data.linkService, data.linkMethod).mockResolvedValue(
      "[resource](https://oneuptime.test/resource)",
    );
    return spy(data.feedService, data.feedMethod).mockResolvedValue(undefined);
  };
}

const ENGINE_CASES: Array<EngineCase> = [
  {
    name: "Podman host",
    engine: PodmanHostOwnerRuleEngineService,
    createHook: "applyRulesToPodmanHost",
    ruleService: PodmanHostOwnerRuleService,
    rereadService: PodmanHostService,
    ownerUserService: PodmanHostOwnerUserService,
    ownerTeamService: PodmanHostOwnerTeamService,
    ownerUserModel: PodmanHostOwnerUser,
    ownerTeamModel: PodmanHostOwnerTeam,
    resourceIdColumn: "podmanHostId",
    namePatternField: "podmanHostNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: feedMock({
      linkService: PodmanHostService,
      linkMethod: "getPodmanHostMarkdownLink",
      feedService: PodmanHostFeedService,
      feedMethod: "createPodmanHostFeedItem",
    }),
    prepare: noop,
  },
  {
    name: "Proxmox cluster",
    engine: ProxmoxClusterOwnerRuleEngineService,
    createHook: "applyRulesToProxmoxCluster",
    ruleService: ProxmoxClusterOwnerRuleService,
    rereadService: ProxmoxClusterService,
    ownerUserService: ProxmoxClusterOwnerUserService,
    ownerTeamService: ProxmoxClusterOwnerTeamService,
    ownerUserModel: ProxmoxClusterOwnerUser,
    ownerTeamModel: ProxmoxClusterOwnerTeam,
    resourceIdColumn: "proxmoxClusterId",
    namePatternField: "proxmoxClusterNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: feedMock({
      linkService: ProxmoxClusterService,
      linkMethod: "getProxmoxClusterMarkdownLink",
      feedService: ProxmoxClusterFeedService,
      feedMethod: "createProxmoxClusterFeedItem",
    }),
    prepare: noop,
  },
  {
    name: "RUM application",
    engine: RumApplicationOwnerRuleEngineService,
    createHook: "applyRulesToRumApplication",
    ruleService: RumApplicationOwnerRuleService,
    rereadService: RumApplicationService,
    ownerUserService: RumApplicationOwnerUserService,
    ownerTeamService: RumApplicationOwnerTeamService,
    ownerUserModel: RumApplicationOwnerUser,
    ownerTeamModel: RumApplicationOwnerTeam,
    resourceIdColumn: "rumApplicationId",
    namePatternField: "nameRegexPattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: noFeed,
    prepare: noop,
  },
  {
    name: "runbook",
    engine: RunbookOwnerRuleEngineService,
    createHook: "applyRulesToRunbook",
    ruleService: RunbookOwnerRuleService,
    rereadService: RunbookService,
    ownerUserService: RunbookOwnerUserService,
    ownerTeamService: RunbookOwnerTeamService,
    ownerUserModel: RunbookOwnerUser,
    ownerTeamModel: RunbookOwnerTeam,
    resourceIdColumn: "runbookId",
    namePatternField: "runbookNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: noFeed,
    prepare: noop,
  },
  {
    name: "serverless function",
    engine: ServerlessFunctionOwnerRuleEngineService,
    createHook: "applyRulesToServerlessFunction",
    ruleService: ServerlessFunctionOwnerRuleService,
    rereadService: ServerlessFunctionService,
    ownerUserService: ServerlessFunctionOwnerUserService,
    ownerTeamService: ServerlessFunctionOwnerTeamService,
    ownerUserModel: ServerlessFunctionOwnerUser,
    ownerTeamModel: ServerlessFunctionOwnerTeam,
    resourceIdColumn: "serverlessFunctionId",
    namePatternField: "nameRegexPattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: noFeed,
    prepare: noop,
  },
  {
    name: "service",
    engine: ServiceOwnerRuleEngineService,
    createHook: "applyRulesToService",
    ruleService: ServiceOwnerRuleService,
    rereadService: ServiceService,
    ownerUserService: ServiceOwnerUserService,
    ownerTeamService: ServiceOwnerTeamService,
    ownerUserModel: ServiceOwnerUser,
    ownerTeamModel: ServiceOwnerTeam,
    resourceIdColumn: "serviceId",
    namePatternField: "serviceNamePattern",
    hasNotificationFlag: false,
    addOwnersService: null,
    mockFeed: feedMock({
      linkService: ServiceService,
      linkMethod: "getServiceMarkdownLink",
      feedService: ServiceFeedService,
      feedMethod: "createServiceFeedItem",
    }),
    prepare: noop,
  },
  {
    name: "SLO",
    engine: ServiceLevelObjectiveOwnerRuleEngineService,
    createHook: "applyRulesToServiceLevelObjective",
    ruleService: ServiceLevelObjectiveOwnerRuleService,
    rereadService: ServiceLevelObjectiveService,
    ownerUserService: ServiceLevelObjectiveOwnerUserService,
    ownerTeamService: ServiceLevelObjectiveOwnerTeamService,
    ownerUserModel: ServiceLevelObjectiveOwnerUser,
    ownerTeamModel: ServiceLevelObjectiveOwnerTeam,
    resourceIdColumn: "serviceLevelObjectiveId",
    namePatternField: "serviceLevelObjectiveNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: feedMock({
      linkService: ServiceLevelObjectiveService,
      linkMethod: "getSloMarkdownLink",
      feedService: ServiceLevelObjectiveFeedService,
      feedMethod: "createServiceLevelObjectiveFeedItem",
    }),
    prepare: noop,
  },
  {
    name: "status page",
    engine: StatusPageOwnerRuleEngineService,
    createHook: "applyRulesToStatusPage",
    ruleService: StatusPageOwnerRuleService,
    rereadService: StatusPageService,
    ownerUserService: StatusPageOwnerUserService,
    ownerTeamService: StatusPageOwnerTeamService,
    ownerUserModel: StatusPageOwnerUser,
    ownerTeamModel: StatusPageOwnerTeam,
    resourceIdColumn: "statusPageId",
    namePatternField: "statusPageNamePattern",
    hasNotificationFlag: true,
    addOwnersService: StatusPageService,
    mockFeed: noFeed,
    prepare: noop,
  },
  {
    name: "vCenter",
    engine: VMwareVCenterOwnerRuleEngineService,
    createHook: "applyRulesToVMwareVCenter",
    ruleService: VMwareVCenterOwnerRuleService,
    rereadService: VMwareVCenterService,
    ownerUserService: VMwareVCenterOwnerUserService,
    ownerTeamService: VMwareVCenterOwnerTeamService,
    ownerUserModel: VMwareVCenterOwnerUser,
    ownerTeamModel: VMwareVCenterOwnerTeam,
    resourceIdColumn: "vmwareVCenterId",
    namePatternField: "vmwareVCenterNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: feedMock({
      linkService: VMwareVCenterService,
      linkMethod: "getVMwareVCenterMarkdownLink",
      feedService: VMwareVCenterFeedService,
      feedMethod: "createVMwareVCenterFeedItem",
    }),
    prepare: noop,
  },
  {
    name: "workflow",
    engine: WorkflowOwnerRuleEngineService,
    createHook: "applyRulesToWorkflow",
    ruleService: WorkflowOwnerRuleService,
    rereadService: WorkflowService,
    ownerUserService: WorkflowOwnerUserService,
    ownerTeamService: WorkflowOwnerTeamService,
    ownerUserModel: WorkflowOwnerUser,
    ownerTeamModel: WorkflowOwnerTeam,
    resourceIdColumn: "workflowId",
    namePatternField: "workflowNamePattern",
    hasNotificationFlag: true,
    addOwnersService: null,
    mockFeed: noFeed,
    prepare: noop,
  },
  {
    name: "alert episode",
    engine: AlertEpisodeOwnerRuleEngineService,
    createHook: "applyRulesToEpisode",
    ruleService: AlertEpisodeOwnerRuleService,
    rereadService: null,
    ownerUserService: AlertEpisodeOwnerUserService,
    ownerTeamService: AlertEpisodeOwnerTeamService,
    ownerUserModel: AlertEpisodeOwnerUser,
    ownerTeamModel: AlertEpisodeOwnerTeam,
    resourceIdColumn: "alertEpisodeId",
    namePatternField: "episodeTitlePattern",
    hasNotificationFlag: true,
    addOwnersService: AlertEpisodeService,
    mockFeed: (): jest.SpyInstance => {
      return spy(
        AlertEpisodeFeedService,
        "createAlertEpisodeFeedItem",
      ).mockResolvedValue(undefined);
    },
    prepare: noop,
  },
  {
    name: "incident episode",
    engine: IncidentEpisodeOwnerRuleEngineService,
    createHook: "applyRulesToEpisode",
    ruleService: IncidentEpisodeOwnerRuleService,
    rereadService: null,
    ownerUserService: IncidentEpisodeOwnerUserService,
    ownerTeamService: IncidentEpisodeOwnerTeamService,
    ownerUserModel: IncidentEpisodeOwnerUser,
    ownerTeamModel: IncidentEpisodeOwnerTeam,
    resourceIdColumn: "incidentEpisodeId",
    namePatternField: "episodeTitlePattern",
    hasNotificationFlag: true,
    addOwnersService: IncidentEpisodeService,
    mockFeed: (): jest.SpyInstance => {
      return spy(
        IncidentEpisodeFeedService,
        "createIncidentEpisodeFeedItem",
      ).mockResolvedValue(undefined);
    },
    prepare: (): void => {
      // IncidentEpisodeService.addOwners checks for an existing owner first.
      spy(IncidentEpisodeOwnerUserService, "findOneBy").mockResolvedValue(null);
      spy(IncidentEpisodeOwnerTeamService, "findOneBy").mockResolvedValue(null);
    },
  },
];

function findCase(name: string): EngineCase {
  const found: EngineCase | undefined = ENGINE_CASES.find(
    (testCase: EngineCase): boolean => {
      return testCase.name === name;
    },
  );

  if (!found) {
    throw new Error(`No engine case named ${name}`);
  }

  return found;
}

function engineOf(testCase: EngineCase): EngineUnderTest {
  return testCase.engine as unknown as EngineUnderTest;
}

async function runCreateHook(
  testCase: EngineCase,
  resource: BaseModel,
): Promise<void> {
  const hooks: Record<string, (resource: BaseModel) => Promise<void>> =
    testCase.engine as unknown as Record<
      string,
      (resource: BaseModel) => Promise<void>
    >;

  await hooks[testCase.createHook]!(resource);
}

function ownerRow(
  modelType: OwnerModelType,
  column: string,
  id: ObjectID,
): BaseModel {
  const row: BaseModel = new modelType();
  (row as unknown as Record<string, ObjectID>)[column] = id;
  return row;
}

/*
 * The resource a run hands the engine: loaded with resourceSelectForRuleRun,
 * so ids only for engines that re-read it, and the matched fields for the
 * episode engines.
 */
function runTarget(
  testCase: EngineCase,
  overrides: Record<string, unknown> = {},
): BaseModel {
  const target: Record<string, unknown> = {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
  };

  if (!testCase.rereadService) {
    target["title"] = RESOURCE_NAME;
    target["description"] = RESOURCE_DESCRIPTION;
    target["labels"] = [];
  }

  return { ...target, ...overrides } as unknown as BaseModel;
}

// The row an engine that re-reads the resource gets back.
function resourceDetails(): BaseModel {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: RESOURCE_NAME,
    description: RESOURCE_DESCRIPTION,
    labels: [],
  } as unknown as BaseModel;
}

function fakeRule(
  testCase: EngineCase,
  data: {
    id?: ObjectID | undefined;
    namePattern?: string | undefined;
    notifyOwners?: boolean | undefined;
    users?: Array<ObjectID> | undefined;
    teams?: Array<ObjectID> | undefined;
    extra?: Record<string, unknown> | undefined;
  } = {},
): BaseModel {
  const ruleId: ObjectID = data.id || RULE_ID;

  return {
    id: ruleId,
    _id: ruleId.toString(),
    projectId: PROJECT_ID,
    name: "Checkout owners",
    notifyOwners: data.notifyOwners,
    [testCase.namePatternField]:
      data.namePattern === undefined ? "checkout" : data.namePattern,
    ownerUsers: (data.users || [USER_A]).map(ref),
    ownerTeams: (data.teams || []).map(ref),
    ...(data.extra || {}),
  } as unknown as BaseModel;
}

function captureCreates(data: {
  service: Record<string, any>;
  kind: "user" | "team";
  writes: Array<OwnerWrite>;
  failure: Error | undefined;
}): void {
  const column: string = data.kind === "user" ? "userId" : "teamId";

  spy(data.service, "create").mockImplementation(
    async (createBy: { data: BaseModel }): Promise<BaseModel> => {
      if (data.failure) {
        throw data.failure;
      }

      const row: Record<string, unknown> = createBy.data as unknown as Record<
        string,
        unknown
      >;

      data.writes.push({
        kind: data.kind,
        id: String(row[column]),
        isOwnerNotified: row["isOwnerNotified"] as boolean | undefined,
      });

      return createBy.data;
    },
  );
}

function setup(
  testCase: EngineCase,
  options: {
    resourceGone?: boolean | undefined;
    existingUsers?: Array<ObjectID> | undefined;
    existingTeams?: Array<ObjectID> | undefined;
    writeFailure?: Error | undefined;
  } = {},
): Harness {
  const writes: Array<OwnerWrite> = [];

  const reread: jest.SpyInstance | null = testCase.rereadService
    ? spy(testCase.rereadService, "findOneById").mockResolvedValue(
        options.resourceGone ? null : resourceDetails(),
      )
    : null;

  const ownerUserFindBy: jest.SpyInstance = spy(
    testCase.ownerUserService,
    "findBy",
  ).mockResolvedValue(
    (options.existingUsers || []).map((id: ObjectID): BaseModel => {
      return ownerRow(testCase.ownerUserModel, "userId", id);
    }),
  );
  const ownerTeamFindBy: jest.SpyInstance = spy(
    testCase.ownerTeamService,
    "findBy",
  ).mockResolvedValue(
    (options.existingTeams || []).map((id: ObjectID): BaseModel => {
      return ownerRow(testCase.ownerTeamModel, "teamId", id);
    }),
  );

  captureCreates({
    service: testCase.ownerUserService,
    kind: "user",
    writes: writes,
    failure: options.writeFailure,
  });
  captureCreates({
    service: testCase.ownerTeamService,
    kind: "team",
    writes: writes,
    failure: options.writeFailure,
  });

  // Calls through, so the owner rows it creates are the ones captured.
  const addOwners: jest.SpyInstance | null = testCase.addOwnersService
    ? spy(testCase.addOwnersService, "addOwners")
    : null;

  // The episode engines' feed item looks the added owners up by name.
  spy(UserService, "findBy").mockResolvedValue([]);
  spy(TeamService, "findBy").mockResolvedValue([]);

  const loggedError: jest.SpyInstance = spy(logger, "error").mockImplementation(
    (): void => {
      // Silenced; asserted where it matters.
    },
  );

  testCase.prepare();

  return {
    writes: writes,
    reread: reread,
    ownerUserFindBy: ownerUserFindBy,
    ownerTeamFindBy: ownerTeamFindBy,
    addOwners: addOwners,
    feed: testCase.mockFeed(),
    loggedError: loggedError,
  };
}

async function run(
  testCase: EngineCase,
  data: {
    rules: Array<BaseModel>;
    allowOwnerNotification?: boolean | undefined;
    resource?: BaseModel | undefined;
  },
): Promise<RuleApplicationResult> {
  return await engineOf(testCase).applyRulesToExistingResource({
    resource: data.resource || runTarget(testCase),
    rules: data.rules,
    allowOwnerNotification: data.allowOwnerNotification ?? true,
  });
}

function describeWrites(writes: Array<OwnerWrite>): Array<string> {
  return writes
    .map((write: OwnerWrite): string => {
      return `${write.kind}:${write.id}`;
    })
    .sort();
}

/*
 * isOwnerNotified defaults to false in the database, so a row written without
 * the flag is one the owner-added notification job will pick up.
 */
function isNotificationPending(write: OwnerWrite): boolean {
  return write.isOwnerNotified !== true;
}

function expectSilent(testCase: EngineCase, write: OwnerWrite): void {
  if (testCase.hasNotificationFlag) {
    expect(write.isOwnerNotified).toBe(true);
  } else {
    expect(write.isOwnerNotified).toBeUndefined();
  }
}

function expectNotifying(testCase: EngineCase, write: OwnerWrite): void {
  if (testCase.hasNotificationFlag) {
    expect(isNotificationPending(write)).toBe(true);
  } else {
    expect(write.isOwnerNotified).toBeUndefined();
  }
}

beforeEach(() => {
  // Owner users here are project members; OwnerRuleAssignment.test.ts covers ones who left.
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ENGINE_CASES)(
  "$name owner rule engine run",
  (testCase: EngineCase) => {
    it("reads rules for the create hook with the select a run uses", async () => {
      const engine: EngineUnderTest = engineOf(testCase);

      expect(engine.ruleSelect).toEqual(
        expect.objectContaining({
          criteria: true,
          notifyOwners: true,
          ownerUsers: { _id: true },
          ownerTeams: { _id: true },
        }),
      );

      const harness: Harness = setup(testCase);
      const ruleRead: jest.SpyInstance = spy(
        testCase.ruleService,
        "findBy",
      ).mockResolvedValue([fakeRule(testCase)]);

      await runCreateHook(testCase, runTarget(testCase));

      expect(ruleRead).toHaveBeenCalledTimes(1);
      const findBy: { select: unknown; limit: number } = ruleRead.mock
        .calls[0]![0] as { select: unknown; limit: number };
      expect(findBy.select).toBe(engine.ruleSelect);
      expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);

      // The create hook notifies, as it always did.
      expect(describeWrites(harness.writes)).toEqual([
        `user:${USER_A.toString()}`,
      ]);
      expectNotifying(testCase, harness.writes[0]!);
    });

    it("adds a matching rule's owners and counts them", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [
          fakeRule(testCase, { users: [USER_A, USER_B], teams: [TEAM_A] }),
        ],
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(3));
      expect(describeWrites(harness.writes)).toEqual(
        [
          `user:${USER_A.toString()}`,
          `user:${USER_B.toString()}`,
          `team:${TEAM_A.toString()}`,
        ].sort(),
      );

      if (harness.reread) {
        expect(harness.reread).toHaveBeenCalledTimes(1);
      }

      if (harness.feed) {
        expect(harness.feed).toHaveBeenCalledTimes(1);
      }
    });

    it("reports alreadyApplied and writes nothing when every owner is already assigned", async () => {
      const harness: Harness = setup(testCase, {
        existingUsers: [USER_A],
        existingTeams: [TEAM_A],
      });

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { users: [USER_A], teams: [TEAM_A] })],
      });

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(harness.writes).toEqual([]);

      if (harness.addOwners) {
        expect(harness.addOwners).not.toHaveBeenCalled();
      }

      if (harness.feed) {
        expect(harness.feed).not.toHaveBeenCalled();
      }
    });

    it("does not create an owner that is already assigned again", async () => {
      const harness: Harness = setup(testCase, { existingUsers: [USER_A] });

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { users: [USER_A, USER_B] })],
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(describeWrites(harness.writes)).toEqual([
        `user:${USER_B.toString()}`,
      ]);

      // The existing-owner lookup is keyed on a column the owner row has.
      const query: Record<string, unknown> = (
        harness.ownerUserFindBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query;
      expect(query[testCase.resourceIdColumn]).toEqual(RESOURCE_ID);
      expect(
        ownerRow(
          testCase.ownerUserModel,
          testCase.resourceIdColumn,
          RESOURCE_ID,
        ).getColumnValue(testCase.resourceIdColumn),
      ).toEqual(RESOURCE_ID);
    });

    it("reports noMatch and writes nothing for a rule that does not match", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { namePattern: "billing" })],
      });

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(harness.writes).toEqual([]);
      expect(harness.ownerUserFindBy).not.toHaveBeenCalled();
      expect(harness.ownerTeamFindBy).not.toHaveBeenCalled();
    });

    it("reports noMatch when the resource is gone", async () => {
      const harness: Harness = setup(testCase, { resourceGone: true });

      /*
       * Engines that re-read the resource find nothing. The episode engines
       * match on the object they are handed, so for them the equivalent is
       * a resource with no id.
       */
      const resource: BaseModel = testCase.rereadService
        ? runTarget(testCase)
        : runTarget(testCase, { id: undefined, _id: undefined });

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase)],
        resource: resource,
      });

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(harness.writes).toEqual([]);
    });

    it("reports failed, without throwing, when an owner write throws", async () => {
      const harness: Harness = setup(testCase, {
        writeFailure: new Error("database unavailable"),
      });

      await expect(
        run(testCase, { rules: [fakeRule(testCase)] }),
      ).resolves.toEqual(RuleApplicationResultUtil.failed());
      expect(harness.loggedError).toHaveBeenCalled();

      if (harness.feed) {
        expect(harness.feed).not.toHaveBeenCalled();
      }
    });

    it("adds owners silently when the run does not allow notifications, even if the rule notifies", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [
          fakeRule(testCase, {
            notifyOwners: true,
            users: [USER_A],
            teams: [TEAM_A],
          }),
        ],
        allowOwnerNotification: false,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(harness.writes).toHaveLength(2);

      for (const write of harness.writes) {
        expectSilent(testCase, write);
      }
    });

    it("leaves owners to be notified when the run allows it and the rule notifies", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [
          fakeRule(testCase, {
            notifyOwners: true,
            users: [USER_A],
            teams: [TEAM_A],
          }),
        ],
        allowOwnerNotification: true,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(harness.writes).toHaveLength(2);

      for (const write of harness.writes) {
        expectNotifying(testCase, write);
      }
    });

    it("adds owners silently for a rule with notifications off, even when the run allows them", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { notifyOwners: false })],
        allowOwnerNotification: true,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(harness.writes).toHaveLength(1);
      expectSilent(testCase, harness.writes[0]!);
    });

    it("adds an owner two matching rules disagree about once, and notified", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [
          fakeRule(testCase, { id: RULE_ID, notifyOwners: false }),
          fakeRule(testCase, { id: OTHER_RULE_ID, notifyOwners: true }),
        ],
        allowOwnerNotification: true,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(describeWrites(harness.writes)).toEqual([
        `user:${USER_A.toString()}`,
      ]);
      expectNotifying(testCase, harness.writes[0]!);
    });

    it("reports alreadyApplied for a matching rule that names no owners", async () => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { users: [], teams: [] })],
      });

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(harness.writes).toEqual([]);
      expect(harness.ownerUserFindBy).not.toHaveBeenCalled();
    });

    if (testCase.rereadService) {
      it("only needs the resource's ids, because evaluation re-reads it", () => {
        expect(engineOf(testCase).resourceSelectForRuleRun).toEqual({
          _id: true,
          projectId: true,
        });
      });
    }
  },
);

interface EpisodeCase {
  name: string;
  engineCase: EngineCase;
  episodeService: Record<string, any>;
  severityRuleField: string;
  severityColumn: string;
}

const EPISODE_CASES: Array<EpisodeCase> = [
  {
    name: "alert episode",
    engineCase: findCase("alert episode"),
    episodeService: AlertEpisodeService,
    severityRuleField: "alertSeverities",
    severityColumn: "alertSeverityId",
  },
  {
    name: "incident episode",
    engineCase: findCase("incident episode"),
    episodeService: IncidentEpisodeService,
    severityRuleField: "incidentSeverities",
    severityColumn: "incidentSeverityId",
  },
];

describe.each(EPISODE_CASES)(
  "$name owner rule engine matching the episode it is handed",
  (episodeCase: EpisodeCase) => {
    const testCase: EngineCase = episodeCase.engineCase;

    it("selects every field evaluation reads off the episode", () => {
      expect(engineOf(testCase).resourceSelectForRuleRun).toEqual({
        _id: true,
        projectId: true,
        title: true,
        description: true,
        [episodeCase.severityColumn]: true,
        labels: { _id: true },
      });
    });

    it("matches on severity, labels and title carried by the passed episode without re-reading it", async () => {
      const harness: Harness = setup(testCase);
      const reread: jest.SpyInstance = spy(
        episodeCase.episodeService,
        "findOneById",
      );

      const rule: BaseModel = fakeRule(testCase, {
        extra: {
          [episodeCase.severityRuleField]: [ref(SEVERITY_ID)],
          episodeLabels: [ref(LABEL_ID)],
        },
      });

      const matching: RuleApplicationResult = await run(testCase, {
        rules: [rule],
        resource: runTarget(testCase, {
          [episodeCase.severityColumn]: SEVERITY_ID,
          labels: [ref(LABEL_ID)],
        }),
      });

      expect(matching).toEqual(RuleApplicationResultUtil.updated(1));
      expect(harness.writes).toHaveLength(1);

      const otherSeverity: RuleApplicationResult = await run(testCase, {
        rules: [rule],
        resource: runTarget(testCase, {
          [episodeCase.severityColumn]: OTHER_SEVERITY_ID,
          labels: [ref(LABEL_ID)],
        }),
      });

      expect(otherSeverity).toEqual(RuleApplicationResultUtil.noMatch());
      expect(harness.writes).toHaveLength(1);
      expect(reread).not.toHaveBeenCalled();
    });

    it("names only the owners actually added in the rule-executed feed item", async () => {
      setup(testCase, { existingUsers: [USER_A] });
      const feedItem: jest.SpyInstance = spy(
        testCase.engine,
        "createRuleExecutedFeedItem",
      );

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { users: [USER_A, USER_B] })],
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(feedItem).toHaveBeenCalledTimes(1);
      expect(feedItem.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          userIds: [USER_B.toString()],
          teamIds: [],
        }),
      );
    });
  },
);

describe("status page and alert episode owner rule engines", () => {
  it.each([findCase("status page"), findCase("alert episode")])(
    "$name adds owners through the resource service's addOwners with the run's notify flag",
    async (testCase: EngineCase) => {
      const harness: Harness = setup(testCase);

      const result: RuleApplicationResult = await run(testCase, {
        rules: [fakeRule(testCase, { notifyOwners: true })],
        allowOwnerNotification: false,
      });

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(harness.addOwners).toHaveBeenCalledTimes(1);
      expect(harness.addOwners).toHaveBeenCalledWith(
        PROJECT_ID,
        RESOURCE_ID,
        [USER_A],
        [],
        false,
        { isRoot: true },
      );
    },
  );
});

describe("incident episode owner rule engine notifications", () => {
  const testCase: EngineCase = findCase("incident episode");

  /*
   * IncidentEpisodeService.addOwners takes no notify flag and leaves
   * isOwnerNotified at its default, which is what the owner-added job sends
   * for. Silent owners therefore cannot go through it.
   */
  it("writes silent owners already marked notified, without addOwners", async () => {
    const harness: Harness = setup(testCase);

    const result: RuleApplicationResult = await run(testCase, {
      rules: [fakeRule(testCase, { notifyOwners: true, teams: [TEAM_A] })],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(harness.addOwners).not.toHaveBeenCalled();
    expect(harness.writes).toHaveLength(2);

    for (const write of harness.writes) {
      expect(write.isOwnerNotified).toBe(true);
    }
  });

  it("adds notifying owners through IncidentEpisodeService.addOwners", async () => {
    const harness: Harness = setup(testCase);

    const result: RuleApplicationResult = await run(testCase, {
      rules: [fakeRule(testCase, { notifyOwners: true })],
      allowOwnerNotification: true,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(harness.addOwners).toHaveBeenCalledTimes(1);
    expect(harness.addOwners).toHaveBeenCalledWith({
      episodeId: RESOURCE_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A],
      teamIds: [],
    });
    expect(harness.writes).toHaveLength(1);
    expect(isNotificationPending(harness.writes[0]!)).toBe(true);
  });

  it("splits a run's owners between addOwners and silent writes by rule", async () => {
    const harness: Harness = setup(testCase);

    const result: RuleApplicationResult = await run(testCase, {
      rules: [
        fakeRule(testCase, { id: RULE_ID, notifyOwners: true }),
        fakeRule(testCase, {
          id: OTHER_RULE_ID,
          notifyOwners: false,
          users: [USER_B],
        }),
      ],
      allowOwnerNotification: true,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(harness.addOwners).toHaveBeenCalledTimes(1);

    const byId: Map<string, OwnerWrite> = new Map(
      harness.writes.map((write: OwnerWrite): [string, OwnerWrite] => {
        return [write.id, write];
      }),
    );
    expect(isNotificationPending(byId.get(USER_A.toString())!)).toBe(true);
    expect(byId.get(USER_B.toString())!.isOwnerNotified).toBe(true);
  });
});
