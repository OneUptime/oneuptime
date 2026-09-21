import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeLabelRuleEngineService from "../../../../Server/Services/AlertEpisodeLabelRuleEngineService";
import AlertEpisodeLabelRuleService from "../../../../Server/Services/AlertEpisodeLabelRuleService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeLabelRuleEngineService from "../../../../Server/Services/IncidentEpisodeLabelRuleEngineService";
import IncidentEpisodeLabelRuleService from "../../../../Server/Services/IncidentEpisodeLabelRuleService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import LabelService from "../../../../Server/Services/LabelService";
import PodmanHostFeedService from "../../../../Server/Services/PodmanHostFeedService";
import PodmanHostLabelRuleEngineService from "../../../../Server/Services/PodmanHostLabelRuleEngineService";
import PodmanHostLabelRuleService from "../../../../Server/Services/PodmanHostLabelRuleService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import ProxmoxClusterFeedService from "../../../../Server/Services/ProxmoxClusterFeedService";
import ProxmoxClusterLabelRuleEngineService from "../../../../Server/Services/ProxmoxClusterLabelRuleEngineService";
import ProxmoxClusterLabelRuleService from "../../../../Server/Services/ProxmoxClusterLabelRuleService";
import ProxmoxClusterService from "../../../../Server/Services/ProxmoxClusterService";
import RumApplicationLabelRuleEngineService from "../../../../Server/Services/RumApplicationLabelRuleEngineService";
import RumApplicationLabelRuleService from "../../../../Server/Services/RumApplicationLabelRuleService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import RunbookLabelRuleEngineService from "../../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookLabelRuleService from "../../../../Server/Services/RunbookLabelRuleService";
import RunbookService from "../../../../Server/Services/RunbookService";
import ServerlessFunctionLabelRuleEngineService from "../../../../Server/Services/ServerlessFunctionLabelRuleEngineService";
import ServerlessFunctionLabelRuleService from "../../../../Server/Services/ServerlessFunctionLabelRuleService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import ServiceFeedService from "../../../../Server/Services/ServiceFeedService";
import ServiceLabelRuleEngineService from "../../../../Server/Services/ServiceLabelRuleEngineService";
import ServiceLabelRuleService from "../../../../Server/Services/ServiceLabelRuleService";
import ServiceService from "../../../../Server/Services/ServiceService";
import ServiceLevelObjectiveFeedService from "../../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveLabelRuleEngineService from "../../../../Server/Services/ServiceLevelObjectiveLabelRuleEngineService";
import ServiceLevelObjectiveLabelRuleService from "../../../../Server/Services/ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveService from "../../../../Server/Services/ServiceLevelObjectiveService";
import StatusPageLabelRuleEngineService from "../../../../Server/Services/StatusPageLabelRuleEngineService";
import StatusPageLabelRuleService from "../../../../Server/Services/StatusPageLabelRuleService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import VMwareVCenterFeedService from "../../../../Server/Services/VMwareVCenterFeedService";
import VMwareVCenterLabelRuleEngineService from "../../../../Server/Services/VMwareVCenterLabelRuleEngineService";
import VMwareVCenterLabelRuleService from "../../../../Server/Services/VMwareVCenterLabelRuleService";
import VMwareVCenterService from "../../../../Server/Services/VMwareVCenterService";
import WorkflowLabelRuleEngineService from "../../../../Server/Services/WorkflowLabelRuleEngineService";
import WorkflowLabelRuleService from "../../../../Server/Services/WorkflowLabelRuleService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeLabelRule from "../../../../Models/DatabaseModels/AlertEpisodeLabelRule";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeLabelRule from "../../../../Models/DatabaseModels/IncidentEpisodeLabelRule";
import Label from "../../../../Models/DatabaseModels/Label";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import PodmanHostLabelRule from "../../../../Models/DatabaseModels/PodmanHostLabelRule";
import ProxmoxCluster from "../../../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterLabelRule from "../../../../Models/DatabaseModels/ProxmoxClusterLabelRule";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import RumApplicationLabelRule from "../../../../Models/DatabaseModels/RumApplicationLabelRule";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookLabelRule from "../../../../Models/DatabaseModels/RunbookLabelRule";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionLabelRule from "../../../../Models/DatabaseModels/ServerlessFunctionLabelRule";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLabelRule from "../../../../Models/DatabaseModels/ServiceLabelRule";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveLabelRule from "../../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageLabelRule from "../../../../Models/DatabaseModels/StatusPageLabelRule";
import VMwareVCenter from "../../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterLabelRule from "../../../../Models/DatabaseModels/VMwareVCenterLabelRule";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLabelRule from "../../../../Models/DatabaseModels/WorkflowLabelRule";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run now" for the second group of label rule engines.
 *
 * A label rule used to fire only when a resource was created, so a rule
 * written after the fact never touched anything that already existed. Each
 * engine now exposes the same evaluation behind applyRulesToExistingResource,
 * and the shared runner reports what it did from the RuleApplicationResult
 * that comes back. The things pinned here are the ones a run depends on:
 *
 * - the result distinguishes "added N labels", "matched but nothing to add",
 *   "did not match" and "failed", and a failure never escapes as a throw;
 * - a run never re-writes a label the resource already carries;
 * - the columns a run reads for each resource (resourceSelectForRuleRun) are
 *   exactly the ones evaluation looks at on the object it is handed - most
 *   engines re-read the row, the episode engines match on the object itself;
 * - the create hook still reads every enabled rule with the same select a run
 *   is given, so the two paths cannot drift apart.
 */

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
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const LABEL_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const LABEL_C_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const EXISTING_LABEL_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OTHER_SEVERITY_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

const RULE_NAME: string = "Tag production edge";
const MATCHING_TEXT: string = "prod-edge-01";
const MATCHING_PATTERN: string = "^prod-";
const NON_MATCHING_PATTERN: string = "^staging-";
const MARKDOWN_LINK: string = "[prod-edge-01](https://oneuptime.test/r)";

// Engines that re-read the resource only need to be handed its id.
const IDS_ONLY_RESOURCE_SELECT: Record<string, unknown> = {
  _id: true,
  projectId: true,
};

interface RuleReadService {
  findBy: (data: any) => Promise<any>;
}

interface ResourceService {
  findOneById: (data: any) => Promise<any>;
  getRepository: () => any;
}

interface SeverityFields {
  // The relation on the rule, e.g. alertSeverities.
  ruleField: string;
  // The column on the resource it is compared with, e.g. alertSeverityId.
  resourceField: string;
}

interface LabelEngineCase {
  name: string;
  engine: RuleRunEngine<BaseModel, BaseModel>;
  applyOnCreate: (resource: BaseModel) => Promise<void>;
  ruleService: RuleReadService;
  resourceService: ResourceService;
  // The entity handed to the relation query builder.
  resourceModel: unknown;
  // The resource column the name/title pattern is matched against.
  textField: string;
  // The rule column holding that pattern.
  patternField: string;
  // The rule relation holding the "resource already has one of" labels.
  labelMatchField: string;
  // True when evaluation reads the object it is handed instead of a re-read.
  matchesHandedResource: boolean;
  // True when the engine writes the merged labels back onto that object.
  syncsInMemoryLabels: boolean;
  severity: SeverityFields | null;
  expectedRuleSelect: Record<string, unknown>;
  expectedResourceSelect: Record<string, unknown>;
  // Mocks the feed write (and anything it reads) and returns the write spy.
  mockFeed: (() => jest.SpyInstance) | null;
  feedResourceIdKey: string | null;
}

/*
 * Typed per engine, so a default export that stops satisfying the
 * RuleRunEngine contract fails to compile here rather than at registration.
 */
function labelEngineCase<TResource extends BaseModel, TRule extends BaseModel>(
  data: Omit<LabelEngineCase, "engine" | "applyOnCreate"> & {
    engine: RuleRunEngine<TResource, TRule>;
    applyOnCreate: (resource: TResource) => Promise<void>;
  },
): LabelEngineCase {
  return {
    ...data,
    engine: data.engine as unknown as RuleRunEngine<BaseModel, BaseModel>,
    applyOnCreate: data.applyOnCreate as unknown as (
      resource: BaseModel,
    ) => Promise<void>,
  };
}

const cases: Array<LabelEngineCase> = [
  labelEngineCase<PodmanHost, PodmanHostLabelRule>({
    name: "PodmanHostLabelRuleEngineService",
    engine: PodmanHostLabelRuleEngineService,
    applyOnCreate: (resource: PodmanHost): Promise<void> => {
      return PodmanHostLabelRuleEngineService.applyRulesToPodmanHost(resource);
    },
    ruleService: PodmanHostLabelRuleService as unknown as RuleReadService,
    resourceService: PodmanHostService as unknown as ResourceService,
    resourceModel: PodmanHost,
    textField: "name",
    patternField: "podmanHostNamePattern",
    labelMatchField: "podmanHostLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      podmanHostLabels: { _id: true },
      podmanHostNamePattern: true,
      podmanHostDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(PodmanHostService, "getPodmanHostMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(PodmanHostFeedService, "createPodmanHostFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "podmanHostId",
  }),
  labelEngineCase<ProxmoxCluster, ProxmoxClusterLabelRule>({
    name: "ProxmoxClusterLabelRuleEngineService",
    engine: ProxmoxClusterLabelRuleEngineService,
    applyOnCreate: (resource: ProxmoxCluster): Promise<void> => {
      return ProxmoxClusterLabelRuleEngineService.applyRulesToProxmoxCluster(
        resource,
      );
    },
    ruleService: ProxmoxClusterLabelRuleService as unknown as RuleReadService,
    resourceService: ProxmoxClusterService as unknown as ResourceService,
    resourceModel: ProxmoxCluster,
    textField: "name",
    patternField: "proxmoxClusterNamePattern",
    labelMatchField: "proxmoxClusterLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      proxmoxClusterLabels: { _id: true },
      proxmoxClusterNamePattern: true,
      proxmoxClusterDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(ProxmoxClusterService, "getProxmoxClusterMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(ProxmoxClusterFeedService, "createProxmoxClusterFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "proxmoxClusterId",
  }),
  labelEngineCase<RumApplication, RumApplicationLabelRule>({
    name: "RumApplicationLabelRuleEngineService",
    engine: RumApplicationLabelRuleEngineService,
    applyOnCreate: (resource: RumApplication): Promise<void> => {
      return RumApplicationLabelRuleEngineService.applyRulesToRumApplication(
        resource,
      );
    },
    ruleService: RumApplicationLabelRuleService as unknown as RuleReadService,
    resourceService: RumApplicationService as unknown as ResourceService,
    resourceModel: RumApplication,
    textField: "name",
    patternField: "nameRegexPattern",
    labelMatchField: "matchLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      matchLabels: { _id: true },
      nameRegexPattern: true,
      descriptionRegexPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: null,
    feedResourceIdKey: null,
  }),
  labelEngineCase<Runbook, RunbookLabelRule>({
    name: "RunbookLabelRuleEngineService",
    engine: RunbookLabelRuleEngineService,
    applyOnCreate: (resource: Runbook): Promise<void> => {
      return RunbookLabelRuleEngineService.applyRulesToRunbook(resource);
    },
    ruleService: RunbookLabelRuleService as unknown as RuleReadService,
    resourceService: RunbookService as unknown as ResourceService,
    resourceModel: Runbook,
    textField: "name",
    patternField: "runbookNamePattern",
    labelMatchField: "runbookLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      runbookLabels: { _id: true },
      runbookNamePattern: true,
      runbookDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: null,
    feedResourceIdKey: null,
  }),
  labelEngineCase<ServerlessFunction, ServerlessFunctionLabelRule>({
    name: "ServerlessFunctionLabelRuleEngineService",
    engine: ServerlessFunctionLabelRuleEngineService,
    applyOnCreate: (resource: ServerlessFunction): Promise<void> => {
      return ServerlessFunctionLabelRuleEngineService.applyRulesToServerlessFunction(
        resource,
      );
    },
    ruleService:
      ServerlessFunctionLabelRuleService as unknown as RuleReadService,
    resourceService: ServerlessFunctionService as unknown as ResourceService,
    resourceModel: ServerlessFunction,
    textField: "name",
    patternField: "nameRegexPattern",
    labelMatchField: "matchLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      matchLabels: { _id: true },
      nameRegexPattern: true,
      descriptionRegexPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: null,
    feedResourceIdKey: null,
  }),
  labelEngineCase<Service, ServiceLabelRule>({
    name: "ServiceLabelRuleEngineService",
    engine: ServiceLabelRuleEngineService,
    applyOnCreate: (resource: Service): Promise<void> => {
      return ServiceLabelRuleEngineService.applyRulesToService(resource);
    },
    ruleService: ServiceLabelRuleService as unknown as RuleReadService,
    resourceService: ServiceService as unknown as ResourceService,
    resourceModel: Service,
    textField: "name",
    patternField: "serviceNamePattern",
    labelMatchField: "serviceLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      serviceLabels: { _id: true },
      serviceNamePattern: true,
      serviceDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(ServiceService, "getServiceMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(ServiceFeedService, "createServiceFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "serviceId",
  }),
  labelEngineCase<ServiceLevelObjective, ServiceLevelObjectiveLabelRule>({
    name: "ServiceLevelObjectiveLabelRuleEngineService",
    engine: ServiceLevelObjectiveLabelRuleEngineService,
    applyOnCreate: (resource: ServiceLevelObjective): Promise<void> => {
      return ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(
        resource,
      );
    },
    ruleService:
      ServiceLevelObjectiveLabelRuleService as unknown as RuleReadService,
    resourceService: ServiceLevelObjectiveService as unknown as ResourceService,
    resourceModel: ServiceLevelObjective,
    textField: "name",
    patternField: "serviceLevelObjectiveNamePattern",
    labelMatchField: "serviceLevelObjectiveLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      serviceLevelObjectiveLabels: { _id: true },
      serviceLevelObjectiveNamePattern: true,
      serviceLevelObjectiveDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(
          ServiceLevelObjectiveFeedService,
          "createServiceLevelObjectiveFeedItem",
        )
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "serviceLevelObjectiveId",
  }),
  labelEngineCase<StatusPage, StatusPageLabelRule>({
    name: "StatusPageLabelRuleEngineService",
    engine: StatusPageLabelRuleEngineService,
    applyOnCreate: (resource: StatusPage): Promise<void> => {
      return StatusPageLabelRuleEngineService.applyRulesToStatusPage(resource);
    },
    ruleService: StatusPageLabelRuleService as unknown as RuleReadService,
    resourceService: StatusPageService as unknown as ResourceService,
    resourceModel: StatusPage,
    textField: "name",
    patternField: "statusPageNamePattern",
    labelMatchField: "statusPageLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      statusPageLabels: { _id: true },
      statusPageNamePattern: true,
      statusPageDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: null,
    feedResourceIdKey: null,
  }),
  labelEngineCase<VMwareVCenter, VMwareVCenterLabelRule>({
    name: "VMwareVCenterLabelRuleEngineService",
    engine: VMwareVCenterLabelRuleEngineService,
    applyOnCreate: (resource: VMwareVCenter): Promise<void> => {
      return VMwareVCenterLabelRuleEngineService.applyRulesToVMwareVCenter(
        resource,
      );
    },
    ruleService: VMwareVCenterLabelRuleService as unknown as RuleReadService,
    resourceService: VMwareVCenterService as unknown as ResourceService,
    resourceModel: VMwareVCenter,
    textField: "name",
    patternField: "vmwareVCenterNamePattern",
    labelMatchField: "vmwareVCenterLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      vmwareVCenterLabels: { _id: true },
      vmwareVCenterNamePattern: true,
      vmwareVCenterDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: (): jest.SpyInstance => {
      jest
        .spyOn(VMwareVCenterService, "getVMwareVCenterMarkdownLink")
        .mockResolvedValue(MARKDOWN_LINK);
      return jest
        .spyOn(VMwareVCenterFeedService, "createVMwareVCenterFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "vmwareVCenterId",
  }),
  labelEngineCase<Workflow, WorkflowLabelRule>({
    name: "WorkflowLabelRuleEngineService",
    engine: WorkflowLabelRuleEngineService,
    applyOnCreate: (resource: Workflow): Promise<void> => {
      return WorkflowLabelRuleEngineService.applyRulesToWorkflow(resource);
    },
    ruleService: WorkflowLabelRuleService as unknown as RuleReadService,
    resourceService: WorkflowService as unknown as ResourceService,
    resourceModel: Workflow,
    textField: "name",
    patternField: "workflowNamePattern",
    labelMatchField: "workflowLabels",
    matchesHandedResource: false,
    syncsInMemoryLabels: true,
    severity: null,
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      workflowLabels: { _id: true },
      workflowNamePattern: true,
      workflowDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: IDS_ONLY_RESOURCE_SELECT,
    mockFeed: null,
    feedResourceIdKey: null,
  }),
  labelEngineCase<AlertEpisode, AlertEpisodeLabelRule>({
    name: "AlertEpisodeLabelRuleEngineService",
    engine: AlertEpisodeLabelRuleEngineService,
    applyOnCreate: (resource: AlertEpisode): Promise<void> => {
      return AlertEpisodeLabelRuleEngineService.applyRulesToEpisode(resource);
    },
    ruleService: AlertEpisodeLabelRuleService as unknown as RuleReadService,
    resourceService: AlertEpisodeService as unknown as ResourceService,
    resourceModel: AlertEpisode,
    textField: "title",
    patternField: "episodeTitlePattern",
    labelMatchField: "episodeLabels",
    matchesHandedResource: true,
    syncsInMemoryLabels: false,
    severity: {
      ruleField: "alertSeverities",
      resourceField: "alertSeverityId",
    },
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      alertSeverities: { _id: true },
      episodeLabels: { _id: true },
      episodeTitlePattern: true,
      episodeDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      title: true,
      description: true,
      alertSeverityId: true,
      labels: { _id: true },
    },
    mockFeed: (): jest.SpyInstance => {
      return jest
        .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "alertEpisodeId",
  }),
  labelEngineCase<IncidentEpisode, IncidentEpisodeLabelRule>({
    name: "IncidentEpisodeLabelRuleEngineService",
    engine: IncidentEpisodeLabelRuleEngineService,
    applyOnCreate: (resource: IncidentEpisode): Promise<void> => {
      return IncidentEpisodeLabelRuleEngineService.applyRulesToEpisode(
        resource,
      );
    },
    ruleService: IncidentEpisodeLabelRuleService as unknown as RuleReadService,
    resourceService: IncidentEpisodeService as unknown as ResourceService,
    resourceModel: IncidentEpisode,
    textField: "title",
    patternField: "episodeTitlePattern",
    labelMatchField: "episodeLabels",
    matchesHandedResource: true,
    syncsInMemoryLabels: false,
    severity: {
      ruleField: "incidentSeverities",
      resourceField: "incidentSeverityId",
    },
    expectedRuleSelect: {
      _id: true,
      name: true,
      criteria: true,
      incidentSeverities: { _id: true },
      episodeLabels: { _id: true },
      episodeTitlePattern: true,
      episodeDescriptionPattern: true,
      labelsToAdd: { _id: true },
    },
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      labels: { _id: true },
    },
    mockFeed: (): jest.SpyInstance => {
      return jest
        .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
        .mockResolvedValue(undefined);
    },
    feedResourceIdKey: "incidentEpisodeId",
  }),
];

function idStub(id: ObjectID): BaseModel {
  return { id: id, _id: id.toString() } as unknown as BaseModel;
}

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString(), name: "production" } as unknown as Label;
}

function labelIdsOf(labels: unknown): Array<string> {
  return ((labels as Array<Label> | undefined) || []).map((label: Label) => {
    return label.id?.toString() || "";
  });
}

function criteria(filters: RuleCriteria["filters"]): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  };
}

function fakeRule(
  c: LabelEngineCase,
  fields: {
    id?: ObjectID | undefined;
    pattern?: string | undefined;
    criteria?: RuleCriteria | undefined;
    labelsToAdd?: Array<ObjectID> | undefined;
    severityIds?: Array<ObjectID> | undefined;
  } = {},
): BaseModel {
  const id: ObjectID = fields.id || RULE_ID;
  const rule: Record<string, unknown> = {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    name: RULE_NAME,
    labelsToAdd: (fields.labelsToAdd || [LABEL_A_ID]).map(fakeLabel),
  };

  if (fields.pattern !== undefined) {
    rule[c.patternField] = fields.pattern;
  }

  if (fields.criteria !== undefined) {
    rule["criteria"] = fields.criteria;
  }

  if (fields.severityIds !== undefined && c.severity) {
    rule[c.severity.ruleField] = fields.severityIds.map(idStub);
  }

  return rule as unknown as BaseModel;
}

// A full row: what the create hook hands over, and what a re-read returns.
function resourceRow(
  c: LabelEngineCase,
  fields: {
    text?: string | undefined;
    labels?: Array<ObjectID> | undefined;
    severityId?: ObjectID | undefined;
  } = {},
): BaseModel {
  const row: Record<string, unknown> = {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    description: "Production edge node",
    labels: (fields.labels || []).map(fakeLabel),
  };

  row[c.textField] = fields.text ?? MATCHING_TEXT;

  if (c.severity) {
    row[c.severity.resourceField] = fields.severityId || SEVERITY_ID;
  }

  return row as unknown as BaseModel;
}

/*
 * The resource as a run hands it over: only what resourceSelectForRuleRun
 * asks for. For a re-reading engine that is its id; an episode carries every
 * field it is matched on.
 */
function handedResource(
  c: LabelEngineCase,
  fields: {
    text?: string | undefined;
    labels?: Array<ObjectID> | undefined;
    severityId?: ObjectID | undefined;
  } = {},
): BaseModel {
  if (c.matchesHandedResource) {
    return resourceRow(c, fields);
  }

  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as BaseModel;
}

// One `.relation(Entity, name).of(id).add(labelIds)` call.
interface RelationWrite {
  entity: unknown;
  relationName: string;
  resourceId: string;
  labelIds: Array<string>;
}

function mockRelationWrite(
  c: LabelEngineCase,
  options: { fail?: boolean | undefined } = {},
): Array<RelationWrite> {
  const writes: Array<RelationWrite> = [];

  jest.spyOn(c.resourceService, "getRepository").mockReturnValue({
    createQueryBuilder: (): any => {
      return {
        relation: (entity: unknown, relationName: string): any => {
          return {
            of: (resourceId: string): any => {
              return {
                add: async (labelIds: Array<string>): Promise<void> => {
                  if (options.fail) {
                    throw new Error(
                      "duplicate key value violates unique constraint",
                    );
                  }

                  writes.push({
                    entity: entity,
                    relationName: relationName,
                    resourceId: resourceId,
                    labelIds: [...labelIds],
                  });
                },
              };
            },
          };
        },
      };
    },
  });

  return writes;
}

interface Arranged {
  reRead: jest.SpyInstance;
  writes: Array<RelationWrite>;
  feed: jest.SpyInstance | null;
}

function arrange(
  c: LabelEngineCase,
  data: {
    existingLabels?: Array<ObjectID> | undefined;
    reReadText?: string | undefined;
    resourceGone?: boolean | undefined;
    failWrite?: boolean | undefined;
  } = {},
): Arranged {
  const reRead: jest.SpyInstance = jest
    .spyOn(c.resourceService, "findOneById")
    .mockResolvedValue(
      data.resourceGone
        ? null
        : resourceRow(c, {
            labels: data.existingLabels,
            text: data.reReadText,
          }),
    );
  const writes: Array<RelationWrite> = mockRelationWrite(c, {
    fail: data.failWrite,
  });
  const feed: jest.SpyInstance | null = c.mockFeed ? c.mockFeed() : null;

  return { reRead: reRead, writes: writes, feed: feed };
}

function run(
  c: LabelEngineCase,
  rules: Array<BaseModel>,
  resource?: BaseModel | undefined,
): Promise<RuleApplicationResult> {
  return c.engine.applyRulesToExistingResource({
    resource: resource || handedResource(c),
    rules: rules,
    allowOwnerNotification: false,
  });
}

describe("label rule engines (group B) - applying a rule to existing resources", () => {
  beforeEach(() => {
    // Silence the logs the failure-path tests deliberately provoke.
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    // The episode engines name the added labels in their feed item.
    jest
      .spyOn(LabelService, "findBy")
      .mockResolvedValue([fakeLabel(LABEL_A_ID)]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("covers every engine in the group", () => {
    expect(
      cases.map((c: LabelEngineCase) => {
        return c.name;
      }),
    ).toHaveLength(12);
  });

  describe.each(cases)("$name", (c: LabelEngineCase) => {
    it("gives a run the rule select its create hook uses, criteria included", () => {
      expect(c.engine.ruleSelect).toEqual(c.expectedRuleSelect);
      expect(
        (c.engine.ruleSelect as unknown as Record<string, unknown>)["criteria"],
      ).toBe(true);
    });

    it("names every column evaluation reads off the resource it is handed", () => {
      expect(c.engine.resourceSelectForRuleRun).toEqual(
        c.expectedResourceSelect,
      );
    });

    it("attaches a matching rule's labels and reports how many", async () => {
      const { writes }: Arranged = arrange(c, {
        existingLabels: [EXISTING_LABEL_ID],
      });

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, {
          pattern: MATCHING_PATTERN,
          labelsToAdd: [LABEL_A_ID, LABEL_B_ID],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(writes).toHaveLength(1);
      expect(writes[0]!.entity).toBe(c.resourceModel);
      expect(writes[0]!.relationName).toBe("labels");
      expect(writes[0]!.resourceId).toBe(RESOURCE_ID.toString());
      expect(writes[0]!.labelIds).toEqual([
        LABEL_A_ID.toString(),
        LABEL_B_ID.toString(),
      ]);
    });

    it("adds only the labels the resource is missing", async () => {
      const { writes }: Arranged = arrange(c, {
        existingLabels: [LABEL_A_ID],
      });

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, {
          pattern: MATCHING_PATTERN,
          labelsToAdd: [LABEL_A_ID, LABEL_B_ID],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toHaveLength(1);
      expect(writes[0]!.labelIds).toEqual([LABEL_B_ID.toString()]);
    });

    /*
     * Running the same rule twice is the common case - the operator clicks it
     * again to be sure. The second run must be a reported no-op.
     */
    it("reports alreadyApplied and writes nothing when the labels are already there", async () => {
      const { writes }: Arranged = arrange(c, {
        existingLabels: [LABEL_A_ID, LABEL_B_ID],
      });

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, {
          pattern: MATCHING_PATTERN,
          labelsToAdd: [LABEL_A_ID, LABEL_B_ID],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(writes).toHaveLength(0);
    });

    it("reports alreadyApplied for a matching rule that adds no labels", async () => {
      const { writes }: Arranged = arrange(c);

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, { pattern: MATCHING_PATTERN, labelsToAdd: [] }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(writes).toHaveLength(0);
    });

    it("reports noMatch and writes nothing for a rule that does not match", async () => {
      const { writes }: Arranged = arrange(c);

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, { pattern: NON_MATCHING_PATTERN }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(writes).toHaveLength(0);
    });

    // Deleted between the run's page read and its evaluation.
    it("reports noMatch when the resource is gone by the time it is re-read", async () => {
      const { writes }: Arranged = arrange(c, { resourceGone: true });

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, { pattern: MATCHING_PATTERN }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(writes).toHaveLength(0);
    });

    it("reports failed, without throwing, when the label write throws", async () => {
      arrange(c, { failWrite: true });

      await expect(
        run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })]),
      ).resolves.toEqual(RuleApplicationResultUtil.failed());
    });

    it("reports failed, without throwing, when the re-read throws", async () => {
      const { writes }: Arranged = arrange(c);
      jest
        .spyOn(c.resourceService, "findOneById")
        .mockRejectedValue(new Error("connection reset"));

      await expect(
        run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })]),
      ).resolves.toEqual(RuleApplicationResultUtil.failed());
      expect(writes).toHaveLength(0);
    });

    it("matches on configurable criteria rather than a stale legacy pattern", async () => {
      const { writes }: Arranged = arrange(c);

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, {
          pattern: NON_MATCHING_PATTERN,
          criteria: criteria([
            {
              field: c.patternField,
              operator: RuleCriteriaOperator.Contains,
              value: "edge",
            },
          ]),
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes[0]!.labelIds).toEqual([LABEL_A_ID.toString()]);
    });

    it("matches label criteria against the labels evaluation sees", async () => {
      const { writes }: Arranged = arrange(c, {
        existingLabels: [EXISTING_LABEL_ID],
      });
      const rule: BaseModel = fakeRule(c, {
        criteria: criteria([
          {
            field: c.labelMatchField,
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [EXISTING_LABEL_ID.toString()],
          },
        ]),
      });

      const matched: RuleApplicationResult = await run(
        c,
        [rule],
        handedResource(c, { labels: [EXISTING_LABEL_ID] }),
      );

      expect(matched).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes[0]!.labelIds).toEqual([LABEL_A_ID.toString()]);
    });

    it("reads nothing and matches nothing for a resource without an id", async () => {
      const { reRead, writes }: Arranged = arrange(c);

      const result: RuleApplicationResult = await run(
        c,
        [fakeRule(c, { pattern: MATCHING_PATTERN })],
        { projectId: PROJECT_ID } as unknown as BaseModel,
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(reRead).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });

    describe("create hook", () => {
      it("reads the project's enabled rules with ruleSelect and the whole-project limit", async () => {
        const findBy: jest.SpyInstance = jest
          .spyOn(c.ruleService, "findBy")
          .mockResolvedValue([fakeRule(c, { pattern: MATCHING_PATTERN })]);
        const { writes }: Arranged = arrange(c);

        await expect(c.applyOnCreate(resourceRow(c))).resolves.toBeUndefined();

        expect(findBy).toHaveBeenCalledTimes(1);
        const findByArgs: any = findBy.mock.calls[0]![0];
        expect(findByArgs.select).toBe(c.engine.ruleSelect);
        expect(findByArgs.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
        expect(findByArgs.skip).toBe(0);
        expect(findByArgs.query.projectId).toBe(PROJECT_ID);
        expect(findByArgs.query.isEnabled).toBe(true);
        expect(writes).toHaveLength(1);
        expect(writes[0]!.labelIds).toEqual([LABEL_A_ID.toString()]);
      });

      it("attaches the union of every matching rule's labels in one write", async () => {
        jest.spyOn(c.ruleService, "findBy").mockResolvedValue([
          fakeRule(c, {
            id: RULE_ID,
            pattern: MATCHING_PATTERN,
            labelsToAdd: [LABEL_A_ID],
          }),
          fakeRule(c, {
            id: SECOND_RULE_ID,
            labelsToAdd: [LABEL_A_ID, LABEL_B_ID],
          }),
          fakeRule(c, {
            id: THIRD_RULE_ID,
            pattern: NON_MATCHING_PATTERN,
            labelsToAdd: [LABEL_C_ID],
          }),
        ]);
        const { writes }: Arranged = arrange(c);

        await c.applyOnCreate(resourceRow(c));

        expect(writes).toHaveLength(1);
        expect(writes[0]!.labelIds).toEqual([
          LABEL_A_ID.toString(),
          LABEL_B_ID.toString(),
        ]);
      });

      it("never fails the create when the label write throws", async () => {
        jest
          .spyOn(c.ruleService, "findBy")
          .mockResolvedValue([fakeRule(c, { pattern: MATCHING_PATTERN })]);
        arrange(c, { failWrite: true });

        await expect(c.applyOnCreate(resourceRow(c))).resolves.toBeUndefined();
      });

      it("evaluates nothing when the project has no enabled rules", async () => {
        jest.spyOn(c.ruleService, "findBy").mockResolvedValue([]);
        const { reRead, writes }: Arranged = arrange(c);

        await c.applyOnCreate(resourceRow(c));

        expect(reRead).not.toHaveBeenCalled();
        expect(writes).toHaveLength(0);
      });
    });
  });

  describe.each(
    cases.filter((c: LabelEngineCase) => {
      return c.mockFeed !== null;
    }),
  )("$name feed item", (c: LabelEngineCase) => {
    it("records which rule attached the labels", async () => {
      const { feed }: Arranged = arrange(c);

      await run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })]);

      expect(feed!).toHaveBeenCalledTimes(1);
      const payload: any = feed!.mock.calls[0]![0];
      expect(payload[c.feedResourceIdKey!].toString()).toBe(
        RESOURCE_ID.toString(),
      );
      expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(JSON.stringify(payload)).toContain(RULE_NAME);
    });

    it("records nothing when the labels were already there", async () => {
      const { feed }: Arranged = arrange(c, { existingLabels: [LABEL_A_ID] });

      await run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })]);

      expect(feed!).not.toHaveBeenCalled();
    });

    it("records nothing when the rule does not match", async () => {
      const { feed }: Arranged = arrange(c);

      await run(c, [fakeRule(c, { pattern: NON_MATCHING_PATTERN })]);

      expect(feed!).not.toHaveBeenCalled();
    });
  });

  describe.each(
    cases.filter((c: LabelEngineCase) => {
      return !c.matchesHandedResource;
    }),
  )("$name (re-reads the resource)", (c: LabelEngineCase) => {
    /*
     * Why resourceSelectForRuleRun can be just the id: the stale name on the
     * object a run hands over is never looked at.
     */
    it("matches on the re-read row, so a run only has to name the resource", async () => {
      const { reRead, writes }: Arranged = arrange(c, {
        reReadText: MATCHING_TEXT,
      });
      const stale: BaseModel = {
        id: RESOURCE_ID,
        _id: RESOURCE_ID.toString(),
        projectId: PROJECT_ID,
        name: "staging-renamed-since",
      } as unknown as BaseModel;

      const result: RuleApplicationResult = await run(
        c,
        [fakeRule(c, { pattern: MATCHING_PATTERN })],
        stale,
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toHaveLength(1);
      const reReadArgs: any = reRead.mock.calls[0]![0];
      expect(reReadArgs.id.toString()).toBe(RESOURCE_ID.toString());
      expect(reReadArgs.select).toEqual({
        name: true,
        description: true,
        labels: { _id: true },
      });
    });

    /*
     * A downstream owner-rule engine in the same create chain matches on the
     * labels this engine just added, so they have to land on the object.
     */
    it("writes the merged label set back onto the resource it was handed", async () => {
      arrange(c, { existingLabels: [EXISTING_LABEL_ID] });
      const resource: BaseModel = handedResource(c);

      await run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })], resource);

      expect(
        labelIdsOf((resource as unknown as Record<string, unknown>)["labels"]),
      ).toEqual([EXISTING_LABEL_ID.toString(), LABEL_A_ID.toString()]);
    });

    it("leaves the resource's labels alone when the write fails", async () => {
      arrange(c, { existingLabels: [EXISTING_LABEL_ID], failWrite: true });
      const resource: BaseModel = handedResource(c);

      await run(c, [fakeRule(c, { pattern: MATCHING_PATTERN })], resource);

      expect(
        (resource as unknown as Record<string, unknown>)["labels"],
      ).toBeUndefined();
    });
  });

  describe.each(
    cases.filter((c: LabelEngineCase) => {
      return c.matchesHandedResource;
    }),
  )("$name (matches the episode it is handed)", (c: LabelEngineCase) => {
    /*
     * The re-read only fetches existing labels, so a title that is not on
     * the handed episode can never match - which is why the run has to select
     * it.
     */
    it("matches on the handed episode and re-reads only its existing labels", async () => {
      const { reRead, writes }: Arranged = arrange(c, {
        reReadText: "staging-not-consulted",
      });

      const result: RuleApplicationResult = await run(
        c,
        [fakeRule(c, { pattern: MATCHING_PATTERN })],
        handedResource(c, { text: MATCHING_TEXT }),
      );

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toHaveLength(1);
      expect(reRead.mock.calls[0]![0].select).toEqual({
        labels: { _id: true },
      });
    });

    it("does not match a title the handed episode lacks", async () => {
      const { reRead, writes }: Arranged = arrange(c, {
        reReadText: MATCHING_TEXT,
      });
      const withoutTitle: BaseModel = handedResource(c, { text: "" });

      const result: RuleApplicationResult = await run(
        c,
        [fakeRule(c, { pattern: MATCHING_PATTERN })],
        withoutTitle,
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(reRead).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });

    it("matches severity rules on the severity the episode is handed with", async () => {
      const { writes }: Arranged = arrange(c);
      const rule: BaseModel = fakeRule(c, { severityIds: [SEVERITY_ID] });

      const matched: RuleApplicationResult = await run(
        c,
        [rule],
        handedResource(c, { severityId: SEVERITY_ID }),
      );
      const unmatched: RuleApplicationResult = await run(
        c,
        [rule],
        handedResource(c, { severityId: OTHER_SEVERITY_ID }),
      );

      expect(matched).toEqual(RuleApplicationResultUtil.updated(1));
      expect(unmatched).toEqual(RuleApplicationResultUtil.noMatch());
      expect(writes).toHaveLength(1);
    });

    it("does not match label rules when the handed episode carries no labels", async () => {
      const { writes }: Arranged = arrange(c, {
        existingLabels: [EXISTING_LABEL_ID],
      });
      const rule: BaseModel = fakeRule(c, {
        criteria: criteria([
          {
            field: c.labelMatchField,
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [EXISTING_LABEL_ID.toString()],
          },
        ]),
      });

      const result: RuleApplicationResult = await run(
        c,
        [rule],
        handedResource(c, { labels: [] }),
      );

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(writes).toHaveLength(0);
    });

    // The feed item is best-effort; the label is already attached.
    it("still reports the label as added when the feed item cannot be built", async () => {
      const { writes }: Arranged = arrange(c);
      jest
        .spyOn(LabelService, "findBy")
        .mockRejectedValue(new Error("label lookup failed"));

      const result: RuleApplicationResult = await run(c, [
        fakeRule(c, { pattern: MATCHING_PATTERN }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toHaveLength(1);
    });
  });
});
