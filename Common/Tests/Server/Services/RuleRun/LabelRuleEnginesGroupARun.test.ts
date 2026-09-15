import CephClusterFeedService from "../../../../Server/Services/CephClusterFeedService";
import CephClusterLabelRuleEngineService from "../../../../Server/Services/CephClusterLabelRuleEngineService";
import CephClusterLabelRuleService from "../../../../Server/Services/CephClusterLabelRuleService";
import CephClusterService from "../../../../Server/Services/CephClusterService";
import CloudResourceFeedService from "../../../../Server/Services/CloudResourceFeedService";
import CloudResourceLabelRuleEngineService from "../../../../Server/Services/CloudResourceLabelRuleEngineService";
import CloudResourceLabelRuleService from "../../../../Server/Services/CloudResourceLabelRuleService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DashboardLabelRuleEngineService from "../../../../Server/Services/DashboardLabelRuleEngineService";
import DashboardLabelRuleService from "../../../../Server/Services/DashboardLabelRuleService";
import DashboardService from "../../../../Server/Services/DashboardService";
import DockerHostFeedService from "../../../../Server/Services/DockerHostFeedService";
import DockerHostLabelRuleEngineService from "../../../../Server/Services/DockerHostLabelRuleEngineService";
import DockerHostLabelRuleService from "../../../../Server/Services/DockerHostLabelRuleService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import DockerSwarmClusterFeedService from "../../../../Server/Services/DockerSwarmClusterFeedService";
import DockerSwarmClusterLabelRuleEngineService from "../../../../Server/Services/DockerSwarmClusterLabelRuleEngineService";
import DockerSwarmClusterLabelRuleService from "../../../../Server/Services/DockerSwarmClusterLabelRuleService";
import DockerSwarmClusterService from "../../../../Server/Services/DockerSwarmClusterService";
import HostFeedService from "../../../../Server/Services/HostFeedService";
import HostLabelRuleEngineService from "../../../../Server/Services/HostLabelRuleEngineService";
import HostLabelRuleService from "../../../../Server/Services/HostLabelRuleService";
import HostService from "../../../../Server/Services/HostService";
import IncomingCallPolicyLabelRuleEngineService from "../../../../Server/Services/IncomingCallPolicyLabelRuleEngineService";
import IncomingCallPolicyLabelRuleService from "../../../../Server/Services/IncomingCallPolicyLabelRuleService";
import IncomingCallPolicyService from "../../../../Server/Services/IncomingCallPolicyService";
import IoTFleetLabelRuleEngineService from "../../../../Server/Services/IoTFleetLabelRuleEngineService";
import IoTFleetLabelRuleService from "../../../../Server/Services/IoTFleetLabelRuleService";
import IoTFleetService from "../../../../Server/Services/IoTFleetService";
import KubernetesClusterFeedService from "../../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterLabelRuleEngineService from "../../../../Server/Services/KubernetesClusterLabelRuleEngineService";
import KubernetesClusterLabelRuleService from "../../../../Server/Services/KubernetesClusterLabelRuleService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import NetworkDeviceLabelRuleEngineService from "../../../../Server/Services/NetworkDeviceLabelRuleEngineService";
import NetworkDeviceLabelRuleService from "../../../../Server/Services/NetworkDeviceLabelRuleService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import OnCallDutyPolicyLabelRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyLabelRuleService from "../../../../Server/Services/OnCallDutyPolicyLabelRuleService";
import OnCallDutyPolicyScheduleLabelRuleEngineService from "../../../../Server/Services/OnCallDutyPolicyScheduleLabelRuleEngineService";
import OnCallDutyPolicyScheduleLabelRuleService from "../../../../Server/Services/OnCallDutyPolicyScheduleLabelRuleService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import logger from "../../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import CephCluster from "../../../../Models/DatabaseModels/CephCluster";
import CephClusterLabelRule from "../../../../Models/DatabaseModels/CephClusterLabelRule";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceLabelRule from "../../../../Models/DatabaseModels/CloudResourceLabelRule";
import Dashboard from "../../../../Models/DatabaseModels/Dashboard";
import DashboardLabelRule from "../../../../Models/DatabaseModels/DashboardLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import DockerHostLabelRule from "../../../../Models/DatabaseModels/DockerHostLabelRule";
import DockerSwarmCluster from "../../../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterLabelRule from "../../../../Models/DatabaseModels/DockerSwarmClusterLabelRule";
import Host from "../../../../Models/DatabaseModels/Host";
import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import IncomingCallPolicy from "../../../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRule from "../../../../Models/DatabaseModels/IncomingCallPolicyLabelRule";
import IoTFleet from "../../../../Models/DatabaseModels/IoTFleet";
import IoTFleetLabelRule from "../../../../Models/DatabaseModels/IoTFleetLabelRule";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterLabelRule from "../../../../Models/DatabaseModels/KubernetesClusterLabelRule";
import Label from "../../../../Models/DatabaseModels/Label";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../../../Models/DatabaseModels/NetworkDeviceLabelRule";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyLabelRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyLabelRule";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLabelRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLabelRule";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run now" for the simple label rule engines.
 *
 * Each engine already applied its project's label rules to a freshly created
 * resource. applyRulesToExistingResource is the same evaluation for a
 * resource that already exists, restricted to the rules being run, and it
 * reports what it did so a run over hundreds of resources can say how many
 * matched, how many changed and how many failed.
 *
 * Every engine here re-reads the resource it is handed, so the run only has
 * to name it, and every one attaches labels through the relation query
 * builder - which is the write these tests watch.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RULE_NAME: string = "Tag production databases";
const RESOURCE_NAME: string = "prod-db-01";

type AsyncMethod = (...args: Array<unknown>) => Promise<unknown>;

// The slices of the services the engines call, in a shape jest can spy on.
interface SpiedResourceService {
  findOneById: AsyncMethod;
  getRepository: () => unknown;
}

interface SpiedRuleService {
  findBy: AsyncMethod;
}

// The rule columns an engine's legacy matcher reads.
interface LegacyFields {
  labels: string;
  namePattern: string;
  descriptionPattern: string;
}

interface RunData {
  resource: BaseModel;
  rules: Array<BaseModel>;
  allowOwnerNotification: boolean;
}

interface LabelEngineCase {
  name: string;
  ruleSelect: Record<string, unknown>;
  resourceSelectForRuleRun: Record<string, unknown>;
  run: (data: RunData) => Promise<RuleApplicationResult>;
  createHook: (resource: BaseModel) => Promise<void>;
  resourceService: SpiedResourceService;
  ruleService: SpiedRuleService;
  legacyFields: LegacyFields;
  // Resolves the feed write, returning the spy on it (a bare mock if none).
  mockFeed: () => jest.Mock | jest.SpyInstance;
  // How many feed items one successful attach records.
  feedItemsOnUpdate: number;
}

function labelEngineCase<
  TResource extends BaseModel,
  TRule extends BaseModel,
>(data: {
  name: string;
  engine: RuleRunEngine<TResource, TRule>;
  createHook: (resource: TResource) => Promise<void>;
  resourceService: Record<string, any>;
  ruleService: Record<string, any>;
  legacyFields: LegacyFields;
  mockFeed?: (() => jest.SpyInstance) | undefined;
}): LabelEngineCase {
  return {
    name: data.name,
    ruleSelect: data.engine.ruleSelect as unknown as Record<string, unknown>,
    resourceSelectForRuleRun: data.engine
      .resourceSelectForRuleRun as unknown as Record<string, unknown>,
    run: (runData: RunData): Promise<RuleApplicationResult> => {
      return data.engine.applyRulesToExistingResource({
        resource: runData.resource as TResource,
        rules: runData.rules as Array<TRule>,
        allowOwnerNotification: runData.allowOwnerNotification,
      });
    },
    createHook: (resource: BaseModel): Promise<void> => {
      return data.createHook(resource as TResource);
    },
    resourceService: data.resourceService as unknown as SpiedResourceService,
    ruleService: data.ruleService as unknown as SpiedRuleService,
    legacyFields: data.legacyFields,
    mockFeed:
      data.mockFeed ||
      ((): jest.Mock => {
        return jest.fn();
      }),
    feedItemsOnUpdate: data.mockFeed ? 1 : 0,
  };
}

const MARKDOWN_LINK: string = `[${RESOURCE_NAME}](/dashboard/resource)`;

const ENGINES: Array<LabelEngineCase> = [
  labelEngineCase<CephCluster, CephClusterLabelRule>({
    name: "CephClusterLabelRuleEngineService",
    engine: CephClusterLabelRuleEngineService,
    createHook: (resource: CephCluster): Promise<void> => {
      return CephClusterLabelRuleEngineService.applyRulesToCephCluster(
        resource,
      );
    },
    resourceService: CephClusterService,
    ruleService: CephClusterLabelRuleService,
    legacyFields: {
      labels: "cephClusterLabels",
      namePattern: "cephClusterNamePattern",
      descriptionPattern: "cephClusterDescriptionPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(CephClusterService, "getCephClusterMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(CephClusterFeedService, "createCephClusterFeedItem")
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<CloudResource, CloudResourceLabelRule>({
    name: "CloudResourceLabelRuleEngineService",
    engine: CloudResourceLabelRuleEngineService,
    createHook: (resource: CloudResource): Promise<void> => {
      return CloudResourceLabelRuleEngineService.applyRulesToCloudResource(
        resource,
      );
    },
    resourceService: CloudResourceService,
    ruleService: CloudResourceLabelRuleService,
    legacyFields: {
      labels: "matchLabels",
      namePattern: "nameRegexPattern",
      descriptionPattern: "descriptionRegexPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(CloudResourceService, "getCloudResourceMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(CloudResourceFeedService, "createCloudResourceFeedItem")
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<Dashboard, DashboardLabelRule>({
    name: "DashboardLabelRuleEngineService",
    engine: DashboardLabelRuleEngineService,
    createHook: (resource: Dashboard): Promise<void> => {
      return DashboardLabelRuleEngineService.applyRulesToDashboard(resource);
    },
    resourceService: DashboardService,
    ruleService: DashboardLabelRuleService,
    legacyFields: {
      labels: "dashboardLabels",
      namePattern: "dashboardNamePattern",
      descriptionPattern: "dashboardDescriptionPattern",
    },
  }),
  labelEngineCase<DockerHost, DockerHostLabelRule>({
    name: "DockerHostLabelRuleEngineService",
    engine: DockerHostLabelRuleEngineService,
    createHook: (resource: DockerHost): Promise<void> => {
      return DockerHostLabelRuleEngineService.applyRulesToDockerHost(resource);
    },
    resourceService: DockerHostService,
    ruleService: DockerHostLabelRuleService,
    legacyFields: {
      labels: "dockerHostLabels",
      namePattern: "dockerHostNamePattern",
      descriptionPattern: "dockerHostDescriptionPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(DockerHostService, "getDockerHostMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<DockerSwarmCluster, DockerSwarmClusterLabelRule>({
    name: "DockerSwarmClusterLabelRuleEngineService",
    engine: DockerSwarmClusterLabelRuleEngineService,
    createHook: (resource: DockerSwarmCluster): Promise<void> => {
      return DockerSwarmClusterLabelRuleEngineService.applyRulesToDockerSwarmCluster(
        resource,
      );
    },
    resourceService: DockerSwarmClusterService,
    ruleService: DockerSwarmClusterLabelRuleService,
    legacyFields: {
      labels: "dockerSwarmClusterLabels",
      namePattern: "dockerSwarmClusterNamePattern",
      descriptionPattern: "dockerSwarmClusterDescriptionPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(DockerSwarmClusterService, "getDockerSwarmClusterMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(
          DockerSwarmClusterFeedService,
          "createDockerSwarmClusterFeedItem",
        )
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<Host, HostLabelRule>({
    name: "HostLabelRuleEngineService",
    engine: HostLabelRuleEngineService,
    createHook: (resource: Host): Promise<void> => {
      return HostLabelRuleEngineService.applyRulesToHost(resource);
    },
    resourceService: HostService,
    ruleService: HostLabelRuleService,
    legacyFields: {
      labels: "hostLabels",
      namePattern: "hostNamePattern",
      descriptionPattern: "hostDescriptionPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(HostService, "getHostMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(HostFeedService, "createHostFeedItem")
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<IncomingCallPolicy, IncomingCallPolicyLabelRule>({
    name: "IncomingCallPolicyLabelRuleEngineService",
    engine: IncomingCallPolicyLabelRuleEngineService,
    createHook: (resource: IncomingCallPolicy): Promise<void> => {
      return IncomingCallPolicyLabelRuleEngineService.applyRulesToIncomingCallPolicy(
        resource,
      );
    },
    resourceService: IncomingCallPolicyService,
    ruleService: IncomingCallPolicyLabelRuleService,
    legacyFields: {
      labels: "incomingCallPolicyLabels",
      namePattern: "incomingCallPolicyNamePattern",
      descriptionPattern: "incomingCallPolicyDescriptionPattern",
    },
  }),
  labelEngineCase<IoTFleet, IoTFleetLabelRule>({
    name: "IoTFleetLabelRuleEngineService",
    engine: IoTFleetLabelRuleEngineService,
    createHook: (resource: IoTFleet): Promise<void> => {
      return IoTFleetLabelRuleEngineService.applyRulesToIoTFleet(resource);
    },
    resourceService: IoTFleetService,
    ruleService: IoTFleetLabelRuleService,
    legacyFields: {
      labels: "iotFleetLabels",
      namePattern: "iotFleetNamePattern",
      descriptionPattern: "iotFleetDescriptionPattern",
    },
  }),
  labelEngineCase<KubernetesCluster, KubernetesClusterLabelRule>({
    name: "KubernetesClusterLabelRuleEngineService",
    engine: KubernetesClusterLabelRuleEngineService,
    createHook: (resource: KubernetesCluster): Promise<void> => {
      return KubernetesClusterLabelRuleEngineService.applyRulesToKubernetesCluster(
        resource,
      );
    },
    resourceService: KubernetesClusterService,
    ruleService: KubernetesClusterLabelRuleService,
    legacyFields: {
      labels: "kubernetesClusterLabels",
      namePattern: "kubernetesClusterNamePattern",
      descriptionPattern: "kubernetesClusterDescriptionPattern",
    },
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(KubernetesClusterService, "getKubernetesClusterMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined);
    },
  }),
  labelEngineCase<NetworkDevice, NetworkDeviceLabelRule>({
    name: "NetworkDeviceLabelRuleEngineService",
    engine: NetworkDeviceLabelRuleEngineService,
    createHook: (resource: NetworkDevice): Promise<void> => {
      return NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
        resource,
      );
    },
    resourceService: NetworkDeviceService,
    ruleService: NetworkDeviceLabelRuleService,
    legacyFields: {
      labels: "networkDeviceLabels",
      namePattern: "networkDeviceNamePattern",
      descriptionPattern: "networkDeviceDescriptionPattern",
    },
  }),
  labelEngineCase<OnCallDutyPolicy, OnCallDutyPolicyLabelRule>({
    name: "OnCallDutyPolicyLabelRuleEngineService",
    engine: OnCallDutyPolicyLabelRuleEngineService,
    createHook: (resource: OnCallDutyPolicy): Promise<void> => {
      return OnCallDutyPolicyLabelRuleEngineService.applyRulesToOnCallDutyPolicy(
        resource,
      );
    },
    resourceService: OnCallDutyPolicyService,
    ruleService: OnCallDutyPolicyLabelRuleService,
    legacyFields: {
      labels: "onCallDutyPolicyLabels",
      namePattern: "onCallDutyPolicyNamePattern",
      descriptionPattern: "onCallDutyPolicyDescriptionPattern",
    },
  }),
  labelEngineCase<OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleLabelRule>({
    name: "OnCallDutyPolicyScheduleLabelRuleEngineService",
    engine: OnCallDutyPolicyScheduleLabelRuleEngineService,
    createHook: (resource: OnCallDutyPolicySchedule): Promise<void> => {
      return OnCallDutyPolicyScheduleLabelRuleEngineService.applyRulesToSchedule(
        resource,
      );
    },
    resourceService: OnCallDutyPolicyScheduleService,
    ruleService: OnCallDutyPolicyScheduleLabelRuleService,
    legacyFields: {
      labels: "onCallDutyPolicyScheduleLabels",
      namePattern: "onCallDutyPolicyScheduleNamePattern",
      descriptionPattern: "onCallDutyPolicyScheduleDescriptionPattern",
    },
  }),
];

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

// The resource as a run hands it to an engine: the resourceSelectForRuleRun columns.
function runTarget(): BaseModel {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as BaseModel;
}

// The row the engine re-reads to match on.
function fakeResourceDetails(
  data: { labels?: Array<ObjectID> | undefined } = {},
): BaseModel {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: RESOURCE_NAME,
    description: "Primary production database",
    labels: (data.labels || []).map((labelId: ObjectID) => {
      return fakeLabel(labelId);
    }),
  } as unknown as BaseModel;
}

function fakeRule(
  testCase: LabelEngineCase,
  data: {
    namePattern?: string | undefined;
    labelsToAdd?: Array<ObjectID> | undefined;
    criteria?: RuleCriteria | undefined;
  },
): BaseModel {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: RULE_NAME,
    criteria: data.criteria,
    [testCase.legacyFields.namePattern]: data.namePattern,
    labelsToAdd: (data.labelsToAdd || [LABEL_A_ID]).map((labelId: ObjectID) => {
      return fakeLabel(labelId);
    }),
  } as unknown as BaseModel;
}

// A rule whose legacy name pattern matches RESOURCE_NAME.
function matchingRule(
  testCase: LabelEngineCase,
  labelsToAdd?: Array<ObjectID> | undefined,
): BaseModel {
  return fakeRule(testCase, {
    namePattern: "^prod-db",
    labelsToAdd: labelsToAdd,
  });
}

/*
 * The relation query builder the engines attach labels through, recorded as
 * one entry per `.add(...)` so a test can assert exactly what was written.
 */
interface LabelWrite {
  relation: string;
  resourceId: string;
  labelIds: Array<string>;
}

interface FakeRelationBuilder {
  createQueryBuilder: () => FakeRelationBuilder;
  relation: (target: unknown, relationName: string) => FakeRelationBuilder;
  of: (resourceId: string) => FakeRelationBuilder;
  add: (labelIds: Array<string>) => Promise<void>;
}

interface Arranged {
  findResource: jest.SpyInstance;
  findRules: jest.SpyInstance;
  writes: Array<LabelWrite>;
  feed: jest.Mock | jest.SpyInstance;
}

function arrange(
  testCase: LabelEngineCase,
  data: {
    details: BaseModel | null;
    rules?: Array<BaseModel> | undefined;
    failWrite?: boolean | undefined;
  },
): Arranged {
  const writes: Array<LabelWrite> = [];
  let pendingRelation: string = "";
  let pendingResourceId: string = "";

  const builder: FakeRelationBuilder = {
    createQueryBuilder: (): FakeRelationBuilder => {
      return builder;
    },
    relation: (_target: unknown, relationName: string): FakeRelationBuilder => {
      pendingRelation = relationName;
      return builder;
    },
    of: (resourceId: string): FakeRelationBuilder => {
      pendingResourceId = resourceId;
      return builder;
    },
    add: async (labelIds: Array<string>): Promise<void> => {
      if (data.failWrite) {
        throw new Error("duplicate key value violates unique constraint");
      }

      writes.push({
        relation: pendingRelation,
        resourceId: pendingResourceId,
        labelIds: [...labelIds],
      });
    },
  };

  jest
    .spyOn(testCase.resourceService, "getRepository")
    .mockReturnValue(builder);

  return {
    findResource: jest
      .spyOn(testCase.resourceService, "findOneById")
      .mockResolvedValue(data.details),
    findRules: jest
      .spyOn(testCase.ruleService, "findBy")
      .mockResolvedValue(data.rules || []),
    writes: writes,
    feed: testCase.mockFeed(),
  };
}

function labelIdsOf(resource: BaseModel): Array<string> {
  const labels: Array<Label> =
    (resource as unknown as { labels?: Array<Label> }).labels || [];

  return labels.map((label: Label) => {
    return label.id?.toString() || "";
  });
}

describe.each(ENGINES)("$name - rule run", (testCase: LabelEngineCase) => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Silence the logs the failure-path tests deliberately provoke.
    errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
    jest.spyOn(logger, "warn").mockImplementation(() => {});
    jest.spyOn(logger, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exposes the rule columns evaluation reads, criteria included", () => {
    expect(testCase.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      [testCase.legacyFields.labels]: { _id: true },
      [testCase.legacyFields.namePattern]: true,
      [testCase.legacyFields.descriptionPattern]: true,
      labelsToAdd: { _id: true },
    });
  });

  // The engine re-reads the resource, so a run only has to name it.
  it("asks a run for the resource's id and project only", () => {
    expect(testCase.resourceSelectForRuleRun).toEqual({
      _id: true,
      projectId: true,
    });
  });

  it("still reads the project's enabled rules with ruleSelect on create", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
      rules: [matchingRule(testCase)],
    });

    await testCase.createHook(runTarget());

    expect(arranged.findRules).toHaveBeenCalledTimes(1);

    const findBy: {
      query: { projectId: ObjectID; isEnabled: boolean };
      select: unknown;
      limit: number;
      skip: number;
    } = arranged.findRules.mock.calls[0]![0];

    expect(findBy.select).toBe(testCase.ruleSelect);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.skip).toBe(0);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arranged.writes).toHaveLength(1);
  });

  it("attaches a matching rule's labels and reports how many", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });
    const resource: BaseModel = runTarget();

    const result: RuleApplicationResult = await testCase.run({
      resource: resource,
      rules: [matchingRule(testCase, [LABEL_A_ID, LABEL_B_ID])],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(2));
    expect(arranged.writes).toEqual([
      {
        relation: "labels",
        resourceId: RESOURCE_ID.toString(),
        labelIds: [LABEL_A_ID.toString(), LABEL_B_ID.toString()],
      },
    ]);
    expect(labelIdsOf(resource)).toEqual([
      LABEL_A_ID.toString(),
      LABEL_B_ID.toString(),
    ]);
    expect(arranged.feed).toHaveBeenCalledTimes(testCase.feedItemsOnUpdate);
  });

  // A run evaluates only the rules it was given, never the whole project.
  it("does not read the project's rules during a run", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase)],
      allowOwnerNotification: false,
    });

    expect(arranged.findRules).not.toHaveBeenCalled();
    expect(
      (
        arranged.findResource.mock.calls[0]![0] as { id: ObjectID }
      ).id.toString(),
    ).toBe(RESOURCE_ID.toString());
  });

  it("adds only the labels the resource is missing", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails({ labels: [LABEL_A_ID] }),
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase, [LABEL_A_ID, LABEL_B_ID])],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(arranged.writes).toHaveLength(1);
    expect(arranged.writes[0]!.labelIds).toEqual([LABEL_B_ID.toString()]);
  });

  /*
   * The common second click: every label is already there, so the run
   * counts the resource as matched but writes nothing.
   */
  it("reports already applied and writes nothing when every label is present", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails({ labels: [LABEL_A_ID, LABEL_B_ID] }),
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase, [LABEL_A_ID, LABEL_B_ID])],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(arranged.writes).toHaveLength(0);
    expect(arranged.feed).not.toHaveBeenCalled();
  });

  it("reports already applied for a matching rule that adds no labels", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase, [])],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
    expect(arranged.writes).toHaveLength(0);
  });

  it("reports no match and writes nothing for a rule that does not match", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [fakeRule(testCase, { namePattern: "^staging-" })],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(arranged.writes).toHaveLength(0);
    expect(arranged.feed).not.toHaveBeenCalled();
  });

  // Configurable criteria take over from the legacy columns under a run too.
  it("matches on the rule's criteria, ignoring stale legacy columns", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    const criteriaFor: (value: string) => RuleCriteria = (
      value: string,
    ): RuleCriteria => {
      return {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: testCase.legacyFields.namePattern,
            operator: RuleCriteriaOperator.Contains,
            value: value,
          },
        ],
      };
    };

    const matched: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [
        fakeRule(testCase, {
          namePattern: "^staging-",
          criteria: criteriaFor("db-01"),
        }),
      ],
      allowOwnerNotification: false,
    });

    expect(matched).toEqual(RuleApplicationResultUtil.updated(1));
    expect(arranged.writes).toHaveLength(1);

    const unmatched: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [
        fakeRule(testCase, {
          namePattern: "^prod-db",
          criteria: criteriaFor("staging"),
        }),
      ],
      allowOwnerNotification: false,
    });

    expect(unmatched).toEqual(RuleApplicationResultUtil.noMatch());
    expect(arranged.writes).toHaveLength(1);
  });

  // Deleted between the run's page read and its turn to be evaluated.
  it("reports no match when the resource is gone on re-read", async () => {
    const arranged: Arranged = arrange(testCase, { details: null });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase)],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(arranged.writes).toHaveLength(0);
  });

  it("reports no match without a read for a resource with no id", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: { projectId: PROJECT_ID } as unknown as BaseModel,
      rules: [matchingRule(testCase)],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.noMatch());
    expect(arranged.findResource).not.toHaveBeenCalled();
  });

  /*
   * One resource failing must not abort a run over the rest, so the error
   * comes back as a result rather than a throw - and is logged.
   */
  it("reports a failed write as failed instead of throwing", async () => {
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
      failWrite: true,
    });

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase)],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.failed());
    expect(arranged.writes).toHaveLength(0);
    expect(arranged.feed).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a failed re-read as failed instead of throwing", async () => {
    arrange(testCase, { details: fakeResourceDetails() });
    jest
      .spyOn(testCase.resourceService, "findOneById")
      .mockRejectedValue(new Error("database is down"));

    const result: RuleApplicationResult = await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase)],
      allowOwnerNotification: false,
    });

    expect(result).toEqual(RuleApplicationResultUtil.failed());
  });

  // The create hook keeps swallowing errors: a label must never break a create.
  it("keeps the create hook from throwing when the write fails", async () => {
    arrange(testCase, {
      details: fakeResourceDetails(),
      rules: [matchingRule(testCase)],
      failWrite: true,
    });

    await expect(testCase.createHook(runTarget())).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

/*
 * The engines that record a feed item keep doing so under a run, naming the
 * rule - labels arriving from a rule is exactly what an overview page cannot
 * otherwise explain.
 */
describe.each(
  ENGINES.filter((testCase: LabelEngineCase) => {
    return testCase.feedItemsOnUpdate > 0;
  }),
)("$name - rule run feed item", (testCase: LabelEngineCase) => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("records the matched rule on the resource's feed", async () => {
    jest.spyOn(logger, "debug").mockImplementation(() => {});
    const arranged: Arranged = arrange(testCase, {
      details: fakeResourceDetails(),
    });

    await testCase.run({
      resource: runTarget(),
      rules: [matchingRule(testCase, [LABEL_A_ID, LABEL_B_ID])],
      allowOwnerNotification: false,
    });

    expect(arranged.feed).toHaveBeenCalledTimes(1);
    expect(arranged.feed.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        feedInfoInMarkdown: expect.stringContaining("2 label(s)"),
        moreInformationInMarkdown: expect.stringContaining(RULE_NAME),
      }),
    );
  });
});
