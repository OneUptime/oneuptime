import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIAgentOwnerTeam from "../../Models/DatabaseModels/AIAgentOwnerTeam";
import AIPostmortemRule from "../../Models/DatabaseModels/AIPostmortemRule";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisodeOnCallRule from "../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertEpisodeOwnerTeam from "../../Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertGroupingRule from "../../Models/DatabaseModels/AlertGroupingRule";
import AlertIncidentRule from "../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertOwnerTeam from "../../Models/DatabaseModels/AlertOwnerTeam";
import AlertPrivacyRule from "../../Models/DatabaseModels/AlertPrivacyRule";
import AutoRemediationRule from "../../Models/DatabaseModels/AutoRemediationRule";
import CephClusterOwnerTeam from "../../Models/DatabaseModels/CephClusterOwnerTeam";
import CloudBudget from "../../Models/DatabaseModels/CloudBudget";
import CloudResourceOwnerTeam from "../../Models/DatabaseModels/CloudResourceOwnerTeam";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "../../Models/DatabaseModels/DashboardOwnerTeam";
import DataAssetOwnerTeam from "../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataPipelineOwnerTeam from "../../Models/DatabaseModels/DataPipelineOwnerTeam";
import DataStoreOwnerTeam from "../../Models/DatabaseModels/DataStoreOwnerTeam";
import DatabaseServerOwnerTeam from "../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DockerHostOwnerTeam from "../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerSwarmClusterOwnerTeam from "../../Models/DatabaseModels/DockerSwarmClusterOwnerTeam";
import HostOwnerTeam from "../../Models/DatabaseModels/HostOwnerTeam";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisodeOnCallRule from "../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentEpisodeOwnerTeam from "../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentGroupingRule from "../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentLabelRule from "../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOnCallRule from "../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerTeam from "../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentPrivacyRule from "../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSlaRule from "../../Models/DatabaseModels/IncidentSlaRule";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncomingCallPolicyOwnerTeam from "../../Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IoTFleetOwnerTeam from "../../Models/DatabaseModels/IoTFleetOwnerTeam";
import KubernetesClusterOwnerTeam from "../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import MessageQueueOwnerTeam from "../../Models/DatabaseModels/MessageQueueOwnerTeam";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupOwnerTeam from "../../Models/DatabaseModels/MonitorGroupOwnerTeam";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import NetworkDeviceOwnerTeam from "../../Models/DatabaseModels/NetworkDeviceOwnerTeam";
import NetworkSiteOwnerTeam from "../../Models/DatabaseModels/NetworkSiteOwnerTeam";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OpenStackCloudOwnerTeam from "../../Models/DatabaseModels/OpenStackCloudOwnerTeam";
import PodmanHostOwnerTeam from "../../Models/DatabaseModels/PodmanHostOwnerTeam";
import ProbeOwnerTeam from "../../Models/DatabaseModels/ProbeOwnerTeam";
import ProxmoxClusterOwnerTeam from "../../Models/DatabaseModels/ProxmoxClusterOwnerTeam";
import RumApplicationOwnerTeam from "../../Models/DatabaseModels/RumApplicationOwnerTeam";
import RunbookOwnerTeam from "../../Models/DatabaseModels/RunbookOwnerTeam";
import RunbookRule from "../../Models/DatabaseModels/RunbookRule";
import RunnerOwnerTeam from "../../Models/DatabaseModels/RunnerOwnerTeam";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceLabelRule from "../../Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import ScheduledMaintenanceOwnerRule from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceOwnerTeam from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceTemplate from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "../../Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ServerlessFunctionOwnerTeam from "../../Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import Service from "../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjectiveOwnerTeam from "../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncementTemplate from "../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPageOwnerTeam from "../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StorageArrayOwnerTeam from "../../Models/DatabaseModels/StorageArrayOwnerTeam";
import TeamOwnerTeam from "../../Models/DatabaseModels/TeamOwnerTeam";
import VMwareVCenterOwnerTeam from "../../Models/DatabaseModels/VMwareVCenterOwnerTeam";
import Workflow from "../../Models/DatabaseModels/Workflow";
import WorkflowOwnerTeam from "../../Models/DatabaseModels/WorkflowOwnerTeam";
import AutoRemediationTriggerEntity from "../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";
import ServerException from "../../Types/Exception/ServerException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import RunbookRuleTriggerEntity from "../../Types/Runbook/RunbookRuleTriggerEntity";
import {
  USED_BY_BULK_MAX_RECORDS,
  USED_BY_PREVIEW_ROW_COUNT,
  UsedByBulkSummary,
  UsedByCounts,
  UsedByGroup,
  UsedByGroupPart,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRow,
  UsedByRowKind,
  UsedBySummary,
  getUsedByBulkRelations,
  getUsedByRelations,
  normalizeUsedByPageSize,
  normalizeUsedBySkip,
} from "../../Types/UsedBy/UsedBy";
import ArrayUtil from "../../Utils/Array";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import Sort from "../Types/Database/Sort";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentStatusPageScope, {
  StatusPageScopeTarget,
} from "../Utils/StatusPage/IncidentStatusPageScope";
import StatusPageVisibilityQuery from "../Utils/StatusPage/StatusPageVisibilityQuery";
import AIAgentService from "./AIAgentService";
import AIPostmortemRuleService from "./AIPostmortemRuleService";
import AlertEpisodeOnCallRuleService from "./AlertEpisodeOnCallRuleService";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertGroupingRuleService from "./AlertGroupingRuleService";
import AlertIncidentRuleService from "./AlertIncidentRuleService";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertPrivacyRuleService from "./AlertPrivacyRuleService";
import AlertService from "./AlertService";
import AutoRemediationRuleService from "./AutoRemediationRuleService";
import CephClusterService from "./CephClusterService";
import CloudBudgetService from "./CloudBudgetService";
import CloudResourceService from "./CloudResourceService";
import DashboardService from "./DashboardService";
import DataAssetService from "./DataAssetService";
import DataPipelineService from "./DataPipelineService";
import DataStoreService from "./DataStoreService";
import DatabaseServerService from "./DatabaseServerService";
import DatabaseService from "./DatabaseService";
import DockerHostService from "./DockerHostService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import HostService from "./HostService";
import IncidentEpisodeOnCallRuleService from "./IncidentEpisodeOnCallRuleService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentGroupingRuleService from "./IncidentGroupingRuleService";
import IncidentLabelRuleService from "./IncidentLabelRuleService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import IncidentOwnerRuleService from "./IncidentOwnerRuleService";
import IncidentPrivacyRuleService from "./IncidentPrivacyRuleService";
import IncidentService from "./IncidentService";
import IncidentSlaRuleService from "./IncidentSlaRuleService";
import IncidentStateService from "./IncidentStateService";
import IncidentTemplateService from "./IncidentTemplateService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import IoTFleetService from "./IoTFleetService";
import KubernetesClusterService from "./KubernetesClusterService";
import LabelService from "./LabelService";
import MessageQueueService from "./MessageQueueService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorGroupService from "./MonitorGroupService";
import MonitorService from "./MonitorService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkSiteService from "./NetworkSiteService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import OpenStackCloudService from "./OpenStackCloudService";
import PodmanHostService from "./PodmanHostService";
import ProbeService from "./ProbeService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import RumApplicationService from "./RumApplicationService";
import RunbookRuleService from "./RunbookRuleService";
import RunbookService from "./RunbookService";
import RunnerService from "./RunnerService";
import ScheduledMaintenanceLabelRuleService from "./ScheduledMaintenanceLabelRuleService";
import ScheduledMaintenanceOwnerRuleService from "./ScheduledMaintenanceOwnerRuleService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceTemplateService from "./ScheduledMaintenanceTemplateService";
import ServerlessFunctionService from "./ServerlessFunctionService";
import ServiceLevelObjectiveBurnRateRuleService from "./ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveErrorBudgetPolicyTierService from "./ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import ServiceService from "./ServiceService";
import StatusPageAnnouncementTemplateService from "./StatusPageAnnouncementTemplateService";
import StatusPageService from "./StatusPageService";
import StorageArrayService from "./StorageArrayService";
import TeamService from "./TeamService";
import VMwareVCenterService from "./VMwareVCenterService";
import WorkflowService from "./WorkflowService";

/*
 * WHAT REFERS TO A RECORD (#6813; the shapes and the list of relations are
 * in Types/UsedBy/UsedBy).
 *
 * Every relation is read here, in one place, from an explicit definition:
 * the model whose rows refer to the record, how they refer (a column of a
 * join model, a many-to-many list, a monitor id in a workflow's steps),
 * and the column that names a row. Each is read through that model's own
 * DatabaseService, with the reader's props - so tenant scoping, table and
 * column permissions, labels a team is limited to, and private records
 * apply exactly as they do to the model's own list - and once more as
 * OneUptime, narrowed to the project, for the total: the difference is
 * what the reader may not see, which is counted and never named.
 *
 * A FAMILY (the rules that name a monitor, everything else a team owns) is
 * several of those plans counted as one line: each kind of record read
 * through its own service, its counts summed, its rows read kind by kind.
 *
 * READS STAY BOUNDED, however many records refer to one: per kind of
 * record one COUNT as OneUptime, one COUNT as the reader (skipped when the
 * total is 0), and the first USED_BY_PREVIEW_ROW_COUNT rows across a
 * relation's kinds (skipped where the reader may see none) - a family's
 * kinds are counted a few at a time (USED_BY_FAMILY_CONCURRENCY) so one
 * card never takes the connection pool. The rest of a relation is read a
 * page at a time (getPage), at most USED_BY_MAX_PAGE_SIZE rows, each kind's
 * page in turn, skipped over by their counts. A reference is written as a
 * condition on the referring row's own id - `_id IN (SELECT ... FROM <join
 * table> WHERE <column> IN (:ids))` - never as a join, so a count is one row
 * per record and a page never repeats one.
 *
 * SEVERAL RECORDS AT ONCE (getSummaries, for a list's bulk Delete and
 * Archive): every condition takes the list of ids, so each relation is
 * counted once for all of them - a record that refers to two of them is
 * one record - with no rows read.
 *
 * Archived records are left out wherever a model can be archived: they
 * are retired, hidden from their lists, and change nothing.
 */

export const USED_BY_ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

// How many kinds of a family are counted at the same time.
export const USED_BY_FAMILY_CONCURRENCY: number = 4;

export interface UsedByReadContext {
  projectId: ObjectID;
  /*
   * The records asked about: the one a page is about, or a list's selection
   * (getSummaries). Every relation's condition reads all of them.
   */
  recordIds: Array<ObjectID>;
  // The reader's props: what they may see is read with these.
  props: DatabaseCommonInteractionProps;
  // When the read is made: maintenance "coming up" is after this.
  now: Date;
}

export interface UsedByFindData {
  props: DatabaseCommonInteractionProps;
  select: Select<BaseModel>;
  sort: Sort<BaseModel>;
  skip: number;
  limit: number;
}

/*
 * How one kind of record that refers is read for the records asked about.
 * A plain plan is a query on `service`'s model; a relation that cannot be
 * one query (the incidents a status page shows, which only
 * IncidentStatusPageScope decides) gives `count` and `find` instead, each
 * handed the props to read with.
 */
export interface UsedByReadPlan {
  service: DatabaseService<BaseModel>;
  /*
   * The rows that refer to the record, without the project (the engine
   * adds it) - or null when nothing can (a status page that shows no
   * incidents).
   */
  query: Query<BaseModel> | null;
  // The column that names a row: "name", or "title" for an event.
  nameColumn: string;
  // The column with a numbered record's number and its prefix.
  numberColumn?: string | undefined;
  sort?: Sort<BaseModel> | undefined;
  count?:
    | ((props: DatabaseCommonInteractionProps) => Promise<number>)
    | undefined;
  find?: ((data: UsedByFindData) => Promise<Array<BaseModel>>) | undefined;
  /*
   * More about how each of `rowIds` refers, by row id, read with the
   * reader's props: a policy's escalation rules that page the record.
   */
  getDetails?:
    | ((data: {
        rowIds: Array<ObjectID>;
        props: DatabaseCommonInteractionProps;
      }) => Promise<Dictionary<string>>)
    | undefined;
  /*
   * A family's kind: the kind of record its rows are, said on each row.
   * Required of every plan of a family.
   */
  rowKind?: UsedByRowKind | undefined;
  /*
   * A row's kind by one of its columns, where one model's rows open
   * different pages: a runbook rule's by what triggers it. A value it does
   * not list keeps `rowKind`.
   */
  rowKindByColumn?:
    | { column: string; rowKinds: Dictionary<UsedByRowKind> }
    | undefined;
  /*
   * The column naming the record whose page opens a row, when that is not
   * the row: an SLO's burn-rate rule opens its SLO's page.
   */
  linkIdColumn?: string | undefined;
  /*
   * The column that says a row does nothing now, and the value that means
   * so: a rule's isEnabled false, a monitor's disableActiveMonitoring true.
   */
  offWhen?: { column: string; value: boolean } | undefined;
}

export interface UsedByRelationDefinition {
  relation: UsedByRelation;
  // A relation of one kind of record.
  getPlan?:
    | ((context: UsedByReadContext) => Promise<UsedByReadPlan>)
    | undefined;
  /*
   * A family: one plan per kind of record it counts together, in the order
   * its rows are read, each with its rowKind.
   */
  getFamilyPlans?:
    | ((context: UsedByReadContext) => Promise<Array<UsedByReadPlan>>)
    | undefined;
}

type ModelType = { new (): BaseModel };

function asService<TModel extends BaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<BaseModel> {
  return service as unknown as DatabaseService<BaseModel>;
}

function asQuery<TModel extends BaseModel = BaseModel>(
  query: Dictionary<unknown>,
): Query<TModel> {
  return query as unknown as Query<TModel>;
}

/*
 * The join table of a many-to-many list, from the model's own decorators
 * (TypeORM's metadata, read without a database): its table, the column
 * holding the owner's id, and the one holding the listed record's id.
 */
export function getListJoinTable(
  modelType: ModelType,
  propertyName: string,
): {
  joinTableName: string;
  ownerColumnName: string;
  relationColumnName: string;
} {
  const joinTable: JoinTableMetadataArgs | undefined =
    getMetadataArgsStorage().joinTables.find(
      (args: JoinTableMetadataArgs): boolean => {
        return args.target === modelType && args.propertyName === propertyName;
      },
    );

  const ownerColumnName: string | undefined = joinTable?.joinColumns?.[0]?.name;
  const relationColumnName: string | undefined =
    joinTable?.inverseJoinColumns?.[0]?.name;

  if (
    !joinTable ||
    !joinTable.name ||
    !ownerColumnName ||
    !relationColumnName
  ) {
    throw new ServerException(
      `${modelType.name}.${propertyName} is not a list with a join table, so what refers through it cannot be read.`,
    );
  }

  return {
    joinTableName: joinTable.name,
    ownerColumnName: ownerColumnName,
    relationColumnName: relationColumnName,
  };
}

/*
 * The records of `modelType` whose list `propertyName` holds one of
 * `values`: a condition on their own id. An empty list matches nothing.
 */
export function listHoldsAny(
  modelType: ModelType,
  propertyName: string,
  values: Array<ObjectID>,
): unknown {
  return QueryHelper.anyOfEntitiesInManyToMany({
    values: values,
    ...getListJoinTable(modelType, propertyName),
  });
}

/*
 * The records of `modelType` any of whose lists `propertyNames` holds one
 * of `values` - an SLO burn-rate rule pages a policy for its alerts or its
 * incidents: one condition on their own id.
 */
export function anyListHoldsAny(
  modelType: ModelType,
  propertyNames: Array<string>,
  values: Array<ObjectID>,
): unknown {
  if (propertyNames.length === 1) {
    return listHoldsAny(modelType, propertyNames[0] as string, values);
  }

  return QueryHelper.anyOfConditions(
    propertyNames.map((propertyName: string) => {
      return {
        condition: listHoldsAny(modelType, propertyName, values) as any,
      };
    }),
  );
}

/*
 * The records named by `ownerColumn` of the rows of `joinModel` whose
 * `referenceColumn` is one of `values` - the status pages (statusPageId)
 * of the StatusPageResource rows that list a monitor (monitorId): a
 * condition on their own id. An empty list matches nothing.
 */
export function namedByRowsReferencing(data: {
  joinModel: ModelType;
  ownerColumn: string;
  referenceColumn: string;
  values: Array<ObjectID>;
}): unknown {
  const model: BaseModel = new data.joinModel();

  if (
    !model.tableName ||
    !model.getTableColumnMetadata(data.ownerColumn) ||
    !model.getTableColumnMetadata(data.referenceColumn)
  ) {
    throw new ServerException(
      `${data.joinModel.name} has no ${data.ownerColumn} or ${data.referenceColumn}, so what refers through it cannot be read.`,
    );
  }

  return QueryHelper.anyOfEntitiesInManyToMany({
    values: data.values,
    joinTableName: model.tableName,
    ownerColumnName: data.ownerColumn,
    relationColumnName: data.referenceColumn,
  });
}

// The query, less the archived records of a model that can be archived.
export function withoutArchived(
  service: DatabaseService<BaseModel>,
  query: Dictionary<unknown>,
): Dictionary<unknown> {
  const model: BaseModel = service.getModel();

  if (model.getTableColumnMetadata("isArchived")) {
    return { ...query, isArchived: false };
  }

  return query;
}

// A rule that can be switched off says so on its row.
function offWhenSwitchedOff(
  service: DatabaseService<BaseModel>,
): UsedByReadPlan["offWhen"] {
  return service.getModel().getTableColumnMetadata("isEnabled")
    ? { column: "isEnabled", value: false }
    : undefined;
}

// A plain relation: the rows of `service` matching `query`, by name.
function plainPlan(data: {
  service: DatabaseService<BaseModel>;
  query: Dictionary<unknown> | null;
  nameColumn?: string | undefined;
  numberColumn?: string | undefined;
  sort?: Sort<BaseModel> | undefined;
  getDetails?: UsedByReadPlan["getDetails"];
  rowKind?: UsedByRowKind | undefined;
  rowKindByColumn?: UsedByReadPlan["rowKindByColumn"];
  linkIdColumn?: string | undefined;
  offWhen?: UsedByReadPlan["offWhen"];
}): UsedByReadPlan {
  return {
    service: data.service,
    query: data.query
      ? asQuery(withoutArchived(data.service, data.query))
      : null,
    nameColumn: data.nameColumn || "name",
    numberColumn: data.numberColumn,
    sort: data.sort,
    getDetails: data.getDetails,
    rowKind: data.rowKind,
    rowKindByColumn: data.rowKindByColumn,
    linkIdColumn: data.linkIdColumn,
    offWhen: data.offWhen,
  };
}

/*
 * The escalation rules of each policy that page the record, by policy id:
 * "Primary, Second line", in the order the rules escalate. Two reads, each
 * with the reader's props: which rules of the policies name the record,
 * then those rules by id - a rule's order is not a column a read through
 * a relation may select, so reading it that way refused the whole card.
 * A rule they may not read is left out.
 */
async function getEscalationRuleNames(data: {
  service: DatabaseService<BaseModel>;
  recordColumn: string;
  context: UsedByReadContext;
  rowIds: Array<ObjectID>;
  props: DatabaseCommonInteractionProps;
}): Promise<Dictionary<string>> {
  if (data.rowIds.length === 0) {
    return {};
  }

  const links: Array<BaseModel> = await data.service.findBy({
    query: asQuery({
      projectId: data.context.projectId,
      [data.recordColumn]: QueryHelper.any(data.context.recordIds),
      onCallDutyPolicyId: QueryHelper.any(data.rowIds),
    }),
    select: {
      onCallDutyPolicyId: true,
      onCallDutyPolicyEscalationRuleId: true,
    } as Select<BaseModel>,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: data.props,
  });

  const ruleIds: Array<ObjectID> = toIds(
    links,
    (link: BaseModel): ObjectID | null => {
      const id: string = readIdText(link, "onCallDutyPolicyEscalationRuleId");
      return id ? new ObjectID(id) : null;
    },
  );

  if (ruleIds.length === 0) {
    return {};
  }

  const escalationRules: Array<OnCallDutyPolicyEscalationRule> =
    await OnCallDutyPolicyEscalationRuleService.findBy({
      query: {
        projectId: data.context.projectId,
        _id: QueryHelper.any(ruleIds),
      },
      select: {
        _id: true,
        name: true,
        order: true,
      },
      skip: 0,
      limit: ruleIds.length,
      props: data.props,
    });

  const ruleById: Dictionary<OnCallDutyPolicyEscalationRule> = {};

  for (const escalationRule of escalationRules) {
    if (escalationRule.id) {
      ruleById[escalationRule.id.toString()] = escalationRule;
    }
  }

  const rulesByPolicy: Dictionary<Array<{ name: string; order: number }>> = {};

  for (const link of links) {
    const policyId: string = readIdText(link, "onCallDutyPolicyId");
    const rule: OnCallDutyPolicyEscalationRule | undefined =
      ruleById[readIdText(link, "onCallDutyPolicyEscalationRuleId")];
    const name: string = String(rule?.name || "").trim();

    if (!policyId || !rule || !name) {
      continue;
    }

    const rules: Array<{ name: string; order: number }> =
      rulesByPolicy[policyId] || [];

    if (
      !rules.some((each: { name: string; order: number }): boolean => {
        return each.name === name;
      })
    ) {
      rules.push({ name: name, order: Number(rule.order) || 0 });
    }

    rulesByPolicy[policyId] = rules;
  }

  const details: Dictionary<string> = {};

  for (const policyId of Object.keys(rulesByPolicy)) {
    details[policyId] = (rulesByPolicy[policyId] || [])
      .sort(
        (
          a: { name: string; order: number },
          b: { name: string; order: number },
        ): number => {
          return a.order - b.order;
        },
      )
      .map((rule: { name: string; order: number }): string => {
        return rule.name;
      })
      .join(", ");
  }

  return details;
}

// The ids, each once, in their order.
export function uniqueIds(ids: Array<ObjectID>): Array<ObjectID> {
  const seen: Set<string> = new Set<string>();

  return ids.filter((id: ObjectID): boolean => {
    const text: string = id.toString().toLowerCase();

    if (seen.has(text)) {
      return false;
    }

    seen.add(text);
    return true;
  });
}

function toIds<TModel extends BaseModel>(
  models: Array<TModel>,
  read: (model: TModel) => ObjectID | null | undefined,
): Array<ObjectID> {
  const seen: Set<string> = new Set<string>();
  const ids: Array<ObjectID> = [];

  for (const model of models) {
    const id: ObjectID | null | undefined = read(model);

    if (id && !seen.has(id.toString())) {
      seen.add(id.toString());
      ids.push(id);
    }
  }

  return ids;
}

// The ids of the monitor groups the monitors are in, read as OneUptime.
async function getMonitorGroupIdsOf(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const rows: Array<MonitorGroupResource> =
    await MonitorGroupResourceService.findBy({
      query: {
        projectId: context.projectId,
        monitorId: QueryHelper.any(context.recordIds),
      },
      select: {
        monitorGroupId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: USED_BY_ROOT_PROPS,
    });

  return toIds(rows, (row: MonitorGroupResource): ObjectID | undefined => {
    return row.monitorGroupId;
  });
}

// The ids of the monitors in the monitor groups, read as OneUptime.
async function getMonitorIdsInGroups(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const rows: Array<MonitorGroupResource> =
    await MonitorGroupResourceService.findBy({
      query: {
        projectId: context.projectId,
        monitorGroupId: QueryHelper.any(context.recordIds),
      },
      select: {
        monitorId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: USED_BY_ROOT_PROPS,
    });

  return toIds(rows, (row: MonitorGroupResource): ObjectID | undefined => {
    return row.monitorId;
  });
}

// The ids of the monitors watching the services, read as OneUptime.
async function getMonitorIdsWatching(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: asQuery<Monitor>({
      projectId: context.projectId,
      isArchived: false,
      _id: listHoldsAny(Monitor, "services", context.recordIds),
    }),
    select: {
      _id: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: USED_BY_ROOT_PROPS,
  });

  return toIds(monitors, (monitor: Monitor): ObjectID | null => {
    return monitor.id;
  });
}

/*
 * The ids of the project's maintenance states an event is coming up or in
 * progress in (Common/Utils/ScheduledMaintenanceStart): not ended, not
 * completed, and not a draft waiting for a person.
 */
async function getUpcomingOrOngoingStateIds(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const states: Array<ScheduledMaintenanceState> =
    await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
      projectId: context.projectId,
      props: USED_BY_ROOT_PROPS,
    });

  return [
    ...ScheduledMaintenanceStartUtil.getWaitingToStartStateIds({
      states: states,
    }),
    ...ScheduledMaintenanceStartUtil.getInProgressStateIds({
      states: states,
    }),
  ];
}

// How the records a team can own are named, by kind.
interface NamedBy {
  nameColumn?: string | undefined;
  numberColumn?: string | undefined;
  sort?: Sort<BaseModel> | undefined;
}

const NEWEST_FIRST: Sort<BaseModel> = {
  createdAt: SortOrder.Descending,
};

const SOONEST_FIRST: Sort<BaseModel> = {
  startsAt: SortOrder.Ascending,
} as Sort<BaseModel>;

// A template is named by its template name.
const TEMPLATE_NAMED: NamedBy = { nameColumn: "templateName" };

function eventNamed(numberColumn: string): NamedBy {
  return {
    nameColumn: "title",
    numberColumn: numberColumn,
    sort: NEWEST_FIRST,
  };
}

// The team owns these: the records of `ownerTeamModel` that name it.
function ownedByTeam(data: {
  service: DatabaseService<BaseModel>;
  ownerTeamModel: ModelType;
  ownerColumn: string;
  rowKind?: UsedByRowKind | undefined;
  namedBy?: NamedBy | undefined;
}): (context: UsedByReadContext) => UsedByReadPlan {
  return (context: UsedByReadContext): UsedByReadPlan => {
    return plainPlan({
      service: data.service,
      query: {
        _id: namedByRowsReferencing({
          joinModel: data.ownerTeamModel,
          ownerColumn: data.ownerColumn,
          referenceColumn: "teamId",
          values: context.recordIds,
        }),
      },
      rowKind: data.rowKind,
      ...(data.namedBy || {}),
    });
  };
}

// The records of `service`'s model whose labels hold the label.
function carriesLabel(data: {
  service: DatabaseService<BaseModel>;
  modelType: ModelType;
  nameColumn?: string | undefined;
  numberColumn?: string | undefined;
  sort?: Sort<BaseModel> | undefined;
}): (context: UsedByReadContext) => Promise<UsedByReadPlan> {
  return async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
    return plainPlan({
      service: data.service,
      query: {
        _id: listHoldsAny(data.modelType, "labels", context.recordIds),
      },
      nameColumn: data.nameColumn,
      numberColumn: data.numberColumn,
      sort: data.sort,
    });
  };
}

/*
 * A family's kind that names the records in one of its lists - a rule's
 * `monitors`, a template's `onCallDutyPolicies`: switched-off rules said so.
 */
function naming(data: {
  service: DatabaseService<BaseModel>;
  modelType: ModelType;
  lists: Array<string>;
  rowKind: UsedByRowKind;
  rowKindByColumn?: UsedByReadPlan["rowKindByColumn"];
  linkIdColumn?: string | undefined;
  namedBy?: NamedBy | undefined;
}): (context: UsedByReadContext) => UsedByReadPlan {
  return (context: UsedByReadContext): UsedByReadPlan => {
    return plainPlan({
      service: data.service,
      query: {
        _id: anyListHoldsAny(data.modelType, data.lists, context.recordIds),
      },
      rowKind: data.rowKind,
      rowKindByColumn: data.rowKindByColumn,
      linkIdColumn: data.linkIdColumn,
      offWhen: offWhenSwitchedOff(data.service),
      ...(data.namedBy || {}),
    });
  };
}

// A family read from plans that need nothing but the records asked about.
function familyOf(
  builders: Array<(context: UsedByReadContext) => UsedByReadPlan>,
): (context: UsedByReadContext) => Promise<Array<UsedByReadPlan>> {
  return async (context: UsedByReadContext): Promise<Array<UsedByReadPlan>> => {
    return builders.map(
      (build: (context: UsedByReadContext) => UsedByReadPlan) => {
        return build(context);
      },
    );
  };
}

/*
 * The rules limited to particular monitors, in MONITOR_RULE_ROW_KINDS's
 * order. An AI rule and a runbook rule open the page of what triggers them.
 */
export const MONITOR_RULE_PLANS: Array<
  (context: UsedByReadContext) => UsedByReadPlan
> = [
  naming({
    service: asService(IncidentOnCallRuleService),
    modelType: IncidentOnCallRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentOnCallRule,
  }),
  naming({
    service: asService(AlertOnCallRuleService),
    modelType: AlertOnCallRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertOnCallRule,
  }),
  naming({
    service: asService(IncidentGroupingRuleService),
    modelType: IncidentGroupingRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentGroupingRule,
  }),
  naming({
    service: asService(AlertGroupingRuleService),
    modelType: AlertGroupingRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertGroupingRule,
  }),
  naming({
    service: asService(IncidentOwnerRuleService),
    modelType: IncidentOwnerRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentOwnerRule,
  }),
  naming({
    service: asService(AlertOwnerRuleService),
    modelType: AlertOwnerRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertOwnerRule,
  }),
  naming({
    service: asService(IncidentLabelRuleService),
    modelType: IncidentLabelRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentLabelRule,
  }),
  naming({
    service: asService(AlertLabelRuleService),
    modelType: AlertLabelRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertLabelRule,
  }),
  naming({
    service: asService(IncidentPrivacyRuleService),
    modelType: IncidentPrivacyRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentPrivacyRule,
  }),
  naming({
    service: asService(AlertPrivacyRuleService),
    modelType: AlertPrivacyRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertPrivacyRule,
  }),
  naming({
    service: asService(IncidentSlaRuleService),
    modelType: IncidentSlaRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentSlaRule,
  }),
  naming({
    service: asService(AlertIncidentRuleService),
    modelType: AlertIncidentRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AlertIncidentRule,
  }),
  naming({
    service: asService(AutoRemediationRuleService),
    modelType: AutoRemediationRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentAiRule,
    rowKindByColumn: {
      column: "triggerEntityType",
      rowKinds: {
        [AutoRemediationTriggerEntity.Incident]: UsedByRowKind.IncidentAiRule,
        [AutoRemediationTriggerEntity.Alert]: UsedByRowKind.AlertAiRule,
      },
    },
  }),
  naming({
    service: asService(RunbookRuleService),
    modelType: RunbookRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentRunbookRule,
    rowKindByColumn: {
      column: "triggerEntityType",
      rowKinds: {
        [RunbookRuleTriggerEntity.Incident]: UsedByRowKind.IncidentRunbookRule,
        [RunbookRuleTriggerEntity.Alert]: UsedByRowKind.AlertRunbookRule,
        [RunbookRuleTriggerEntity.ScheduledMaintenance]:
          UsedByRowKind.MaintenanceRunbookRule,
      },
    },
  }),
  naming({
    service: asService(AIPostmortemRuleService),
    modelType: AIPostmortemRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.PostmortemRule,
  }),
  naming({
    service: asService(ScheduledMaintenanceOwnerRuleService),
    modelType: ScheduledMaintenanceOwnerRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.MaintenanceOwnerRule,
  }),
  naming({
    service: asService(ScheduledMaintenanceLabelRuleService),
    modelType: ScheduledMaintenanceLabelRule,
    lists: ["monitors"],
    rowKind: UsedByRowKind.MaintenanceLabelRule,
  }),
];

// The templates that name monitors, in MONITOR_TEMPLATE_ROW_KINDS's order.
export const MONITOR_TEMPLATE_PLANS: Array<
  (context: UsedByReadContext) => UsedByReadPlan
> = [
  naming({
    service: asService(IncidentTemplateService),
    modelType: IncidentTemplate,
    lists: ["monitors"],
    rowKind: UsedByRowKind.IncidentTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
  naming({
    service: asService(ScheduledMaintenanceTemplateService),
    modelType: ScheduledMaintenanceTemplate,
    lists: ["monitors"],
    rowKind: UsedByRowKind.MaintenanceTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
  naming({
    service: asService(StatusPageAnnouncementTemplateService),
    modelType: StatusPageAnnouncementTemplate,
    lists: ["monitors"],
    rowKind: UsedByRowKind.AnnouncementTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
];

// Everything else a team owns, in TEAM_OWNED_OTHER_ROW_KINDS's order.
export const TEAM_OWNED_OTHER_PLANS: Array<
  (context: UsedByReadContext) => UsedByReadPlan
> = [
  ownedByTeam({
    service: asService(ServiceLevelObjectiveService),
    ownerTeamModel: ServiceLevelObjectiveOwnerTeam,
    ownerColumn: "serviceLevelObjectiveId",
    rowKind: UsedByRowKind.ServiceLevelObjective,
  }),
  ownedByTeam({
    service: asService(DashboardService),
    ownerTeamModel: DashboardOwnerTeam,
    ownerColumn: "dashboardId",
    rowKind: UsedByRowKind.Dashboard,
  }),
  ownedByTeam({
    service: asService(WorkflowService),
    ownerTeamModel: WorkflowOwnerTeam,
    ownerColumn: "workflowId",
    rowKind: UsedByRowKind.Workflow,
  }),
  ownedByTeam({
    service: asService(MonitorGroupService),
    ownerTeamModel: MonitorGroupOwnerTeam,
    ownerColumn: "monitorGroupId",
    rowKind: UsedByRowKind.MonitorGroup,
  }),
  ownedByTeam({
    service: asService(RunbookService),
    ownerTeamModel: RunbookOwnerTeam,
    ownerColumn: "runbookId",
    rowKind: UsedByRowKind.Runbook,
  }),
  ownedByTeam({
    service: asService(IncidentTemplateService),
    ownerTeamModel: IncidentTemplateOwnerTeam,
    ownerColumn: "incidentTemplateId",
    rowKind: UsedByRowKind.IncidentTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
  ownedByTeam({
    service: asService(ScheduledMaintenanceTemplateService),
    ownerTeamModel: ScheduledMaintenanceTemplateOwnerTeam,
    ownerColumn: "scheduledMaintenanceTemplateId",
    rowKind: UsedByRowKind.MaintenanceTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
  ownedByTeam({
    service: asService(IncomingCallPolicyService),
    ownerTeamModel: IncomingCallPolicyOwnerTeam,
    ownerColumn: "incomingCallPolicyId",
    rowKind: UsedByRowKind.IncomingCallPolicy,
  }),
  ownedByTeam({
    service: asService(TeamService),
    ownerTeamModel: TeamOwnerTeam,
    ownerColumn: "ownedTeamId",
    rowKind: UsedByRowKind.Team,
  }),
  ownedByTeam({
    service: asService(HostService),
    ownerTeamModel: HostOwnerTeam,
    ownerColumn: "hostId",
    rowKind: UsedByRowKind.Host,
  }),
  ownedByTeam({
    service: asService(KubernetesClusterService),
    ownerTeamModel: KubernetesClusterOwnerTeam,
    ownerColumn: "kubernetesClusterId",
    rowKind: UsedByRowKind.KubernetesCluster,
  }),
  ownedByTeam({
    service: asService(DockerHostService),
    ownerTeamModel: DockerHostOwnerTeam,
    ownerColumn: "dockerHostId",
    rowKind: UsedByRowKind.DockerHost,
  }),
  ownedByTeam({
    service: asService(DockerSwarmClusterService),
    ownerTeamModel: DockerSwarmClusterOwnerTeam,
    ownerColumn: "dockerSwarmClusterId",
    rowKind: UsedByRowKind.DockerSwarmCluster,
  }),
  ownedByTeam({
    service: asService(PodmanHostService),
    ownerTeamModel: PodmanHostOwnerTeam,
    ownerColumn: "podmanHostId",
    rowKind: UsedByRowKind.PodmanHost,
  }),
  ownedByTeam({
    service: asService(ProxmoxClusterService),
    ownerTeamModel: ProxmoxClusterOwnerTeam,
    ownerColumn: "proxmoxClusterId",
    rowKind: UsedByRowKind.ProxmoxCluster,
  }),
  ownedByTeam({
    service: asService(OpenStackCloudService),
    ownerTeamModel: OpenStackCloudOwnerTeam,
    ownerColumn: "openStackCloudId",
    rowKind: UsedByRowKind.OpenStackCloud,
  }),
  ownedByTeam({
    service: asService(VMwareVCenterService),
    ownerTeamModel: VMwareVCenterOwnerTeam,
    ownerColumn: "vmwareVCenterId",
    rowKind: UsedByRowKind.VMwareVCenter,
  }),
  ownedByTeam({
    service: asService(CephClusterService),
    ownerTeamModel: CephClusterOwnerTeam,
    ownerColumn: "cephClusterId",
    rowKind: UsedByRowKind.CephCluster,
  }),
  ownedByTeam({
    service: asService(StorageArrayService),
    ownerTeamModel: StorageArrayOwnerTeam,
    ownerColumn: "storageArrayId",
    rowKind: UsedByRowKind.StorageArray,
  }),
  ownedByTeam({
    service: asService(NetworkDeviceService),
    ownerTeamModel: NetworkDeviceOwnerTeam,
    ownerColumn: "networkDeviceId",
    rowKind: UsedByRowKind.NetworkDevice,
  }),
  ownedByTeam({
    service: asService(NetworkSiteService),
    ownerTeamModel: NetworkSiteOwnerTeam,
    ownerColumn: "networkSiteId",
    rowKind: UsedByRowKind.NetworkSite,
  }),
  ownedByTeam({
    service: asService(IoTFleetService),
    ownerTeamModel: IoTFleetOwnerTeam,
    ownerColumn: "iotFleetId",
    rowKind: UsedByRowKind.IoTFleet,
  }),
  ownedByTeam({
    service: asService(CloudResourceService),
    ownerTeamModel: CloudResourceOwnerTeam,
    ownerColumn: "cloudResourceId",
    rowKind: UsedByRowKind.CloudResource,
  }),
  ownedByTeam({
    service: asService(ServerlessFunctionService),
    ownerTeamModel: ServerlessFunctionOwnerTeam,
    ownerColumn: "serverlessFunctionId",
    rowKind: UsedByRowKind.ServerlessFunction,
  }),
  ownedByTeam({
    service: asService(DatabaseServerService),
    ownerTeamModel: DatabaseServerOwnerTeam,
    ownerColumn: "databaseServerId",
    rowKind: UsedByRowKind.DatabaseServer,
  }),
  ownedByTeam({
    service: asService(MessageQueueService),
    ownerTeamModel: MessageQueueOwnerTeam,
    ownerColumn: "messageQueueId",
    rowKind: UsedByRowKind.MessageQueue,
  }),
  ownedByTeam({
    service: asService(RumApplicationService),
    ownerTeamModel: RumApplicationOwnerTeam,
    ownerColumn: "rumApplicationId",
    rowKind: UsedByRowKind.RumApplication,
  }),
  ownedByTeam({
    service: asService(DataStoreService),
    ownerTeamModel: DataStoreOwnerTeam,
    ownerColumn: "dataStoreId",
    rowKind: UsedByRowKind.DataStore,
  }),
  ownedByTeam({
    service: asService(DataAssetService),
    ownerTeamModel: DataAssetOwnerTeam,
    ownerColumn: "dataAssetId",
    rowKind: UsedByRowKind.DataAsset,
  }),
  ownedByTeam({
    service: asService(DataPipelineService),
    ownerTeamModel: DataPipelineOwnerTeam,
    ownerColumn: "dataPipelineId",
    rowKind: UsedByRowKind.DataPipeline,
    // A pipeline has no name of its own: it is its OpenLineage job's.
    namedBy: { nameColumn: "jobName" },
  }),
  ownedByTeam({
    service: asService(ProbeService),
    ownerTeamModel: ProbeOwnerTeam,
    ownerColumn: "probeId",
    rowKind: UsedByRowKind.Probe,
  }),
  ownedByTeam({
    service: asService(RunnerService),
    ownerTeamModel: RunnerOwnerTeam,
    ownerColumn: "runnerId",
    rowKind: UsedByRowKind.Runner,
  }),
  ownedByTeam({
    service: asService(AIAgentService),
    ownerTeamModel: AIAgentOwnerTeam,
    ownerColumn: "aiAgentId",
    rowKind: UsedByRowKind.AIAgent,
  }),
  ownedByTeam({
    service: asService(IncidentService),
    ownerTeamModel: IncidentOwnerTeam,
    ownerColumn: "incidentId",
    rowKind: UsedByRowKind.Incident,
    namedBy: eventNamed("incidentNumberWithPrefix"),
  }),
  ownedByTeam({
    service: asService(IncidentEpisodeService),
    ownerTeamModel: IncidentEpisodeOwnerTeam,
    ownerColumn: "incidentEpisodeId",
    rowKind: UsedByRowKind.IncidentEpisode,
    namedBy: eventNamed("episodeNumberWithPrefix"),
  }),
  ownedByTeam({
    service: asService(AlertService),
    ownerTeamModel: AlertOwnerTeam,
    ownerColumn: "alertId",
    rowKind: UsedByRowKind.Alert,
    namedBy: eventNamed("alertNumberWithPrefix"),
  }),
  ownedByTeam({
    service: asService(AlertEpisodeService),
    ownerTeamModel: AlertEpisodeOwnerTeam,
    ownerColumn: "alertEpisodeId",
    rowKind: UsedByRowKind.AlertEpisode,
    namedBy: eventNamed("episodeNumberWithPrefix"),
  }),
  ownedByTeam({
    service: asService(ScheduledMaintenanceService),
    ownerTeamModel: ScheduledMaintenanceOwnerTeam,
    ownerColumn: "scheduledMaintenanceId",
    rowKind: UsedByRowKind.ScheduledMaintenance,
    namedBy: eventNamed("scheduledMaintenanceNumberWithPrefix"),
  }),
];

// The on-call rules that page a policy, in ON_CALL_POLICY_RULE_ROW_KINDS's order.
export const ON_CALL_POLICY_RULE_PLANS: Array<
  (context: UsedByReadContext) => UsedByReadPlan
> = [
  naming({
    service: asService(IncidentOnCallRuleService),
    modelType: IncidentOnCallRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.IncidentOnCallRule,
  }),
  naming({
    service: asService(AlertOnCallRuleService),
    modelType: AlertOnCallRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.AlertOnCallRule,
  }),
  naming({
    service: asService(IncidentEpisodeOnCallRuleService),
    modelType: IncidentEpisodeOnCallRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.IncidentEpisodeOnCallRule,
  }),
  naming({
    service: asService(AlertEpisodeOnCallRuleService),
    modelType: AlertEpisodeOnCallRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.AlertEpisodeOnCallRule,
  }),
];

// Everything else that pages a policy, in ON_CALL_POLICY_OTHER_ROW_KINDS's order.
export const ON_CALL_POLICY_OTHER_PLANS: Array<
  (context: UsedByReadContext) => UsedByReadPlan
> = [
  naming({
    service: asService(IncidentTemplateService),
    modelType: IncidentTemplate,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.IncidentTemplate,
    namedBy: TEMPLATE_NAMED,
  }),
  naming({
    service: asService(IncidentGroupingRuleService),
    modelType: IncidentGroupingRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.IncidentGroupingRule,
  }),
  naming({
    service: asService(AlertGroupingRuleService),
    modelType: AlertGroupingRule,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.AlertGroupingRule,
  }),
  naming({
    service: asService(ServiceLevelObjectiveBurnRateRuleService),
    modelType: ServiceLevelObjectiveBurnRateRule,
    lists: ["onCallDutyPolicies", "incidentOnCallDutyPolicies"],
    rowKind: UsedByRowKind.SloBurnRateRule,
    linkIdColumn: "serviceLevelObjectiveId",
  }),
  naming({
    service: asService(ServiceLevelObjectiveErrorBudgetPolicyTierService),
    modelType: ServiceLevelObjectiveErrorBudgetPolicyTier,
    lists: ["onCallDutyPolicies", "incidentOnCallDutyPolicies"],
    rowKind: UsedByRowKind.SloErrorBudgetPolicyTier,
    linkIdColumn: "serviceLevelObjectiveId",
  }),
  naming({
    service: asService(CloudBudgetService),
    modelType: CloudBudget,
    lists: ["onCallDutyPolicies"],
    rowKind: UsedByRowKind.CloudBudget,
  }),
];

/*
 * Every relation, by the way it is read. Types/UsedBy/UsedBy lists which
 * kind has which, in what order; UsedByService.test holds the two lists to
 * each other.
 */
export const USED_BY_RELATION_DEFINITIONS: Readonly<
  Record<UsedByRelation, UsedByRelationDefinition>
> = {
  [UsedByRelation.MonitorStatusPages]: {
    relation: UsedByRelation.MonitorStatusPages,
    /*
     * A status page that lists the monitor, or one of the monitor groups it
     * is in: either way, the page shows it.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const groupIds: Array<ObjectID> = await getMonitorGroupIdsOf(context);

      return plainPlan({
        service: asService(StatusPageService),
        query: {
          _id: QueryHelper.anyOfConditions([
            {
              condition: namedByRowsReferencing({
                joinModel: StatusPageResource,
                ownerColumn: "statusPageId",
                referenceColumn: "monitorId",
                values: context.recordIds,
              }) as any,
            },
            {
              condition: namedByRowsReferencing({
                joinModel: StatusPageResource,
                ownerColumn: "statusPageId",
                referenceColumn: "monitorGroupId",
                values: groupIds,
              }) as any,
            },
          ]),
        },
      });
    },
  },
  [UsedByRelation.MonitorGroups]: {
    relation: UsedByRelation.MonitorGroups,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(MonitorGroupService),
        query: {
          _id: namedByRowsReferencing({
            joinModel: MonitorGroupResource,
            ownerColumn: "monitorGroupId",
            referenceColumn: "monitorId",
            values: context.recordIds,
          }),
        },
      });
    },
  },
  [UsedByRelation.MonitorSlos]: {
    relation: UsedByRelation.MonitorSlos,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(ServiceLevelObjectiveService),
        query: {
          _id: listHoldsAny(
            ServiceLevelObjective,
            "monitors",
            context.recordIds,
          ),
        },
      });
    },
  },
  [UsedByRelation.MonitorScheduledMaintenance]: {
    relation: UsedByRelation.MonitorScheduledMaintenance,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const stateIds: Array<ObjectID> =
        await getUpcomingOrOngoingStateIds(context);

      return plainPlan({
        service: asService(ScheduledMaintenanceService),
        query:
          stateIds.length > 0
            ? {
                _id: listHoldsAny(
                  ScheduledMaintenance,
                  "monitors",
                  context.recordIds,
                ),
                currentScheduledMaintenanceStateId: QueryHelper.any(stateIds),
              }
            : null,
        nameColumn: "title",
        numberColumn: "scheduledMaintenanceNumberWithPrefix",
        sort: SOONEST_FIRST,
      });
    },
  },
  [UsedByRelation.MonitorDependents]: {
    relation: UsedByRelation.MonitorDependents,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(MonitorService),
        query: {
          _id: listHoldsAny(Monitor, "dependsOnMonitors", context.recordIds),
        },
      });
    },
  },
  [UsedByRelation.MonitorRules]: {
    relation: UsedByRelation.MonitorRules,
    getFamilyPlans: familyOf(MONITOR_RULE_PLANS),
  },
  [UsedByRelation.MonitorTemplates]: {
    relation: UsedByRelation.MonitorTemplates,
    getFamilyPlans: familyOf(MONITOR_TEMPLATE_PLANS),
  },
  [UsedByRelation.MonitorWorkflows]: {
    relation: UsedByRelation.MonitorWorkflows,
    // A step's arguments hold the monitor's id: its text holds the id.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(WorkflowService),
        query: {
          graph: QueryHelper.textContainsAnyOf(
            context.recordIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        },
      });
    },
  },
  [UsedByRelation.MonitorDashboards]: {
    relation: UsedByRelation.MonitorDashboards,
    // A widget's filter holds the monitor's id: the layout's text holds it.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(DashboardService),
        query: DashboardService.getQueryForLayoutsNaming(context.recordIds),
      });
    },
  },

  [UsedByRelation.ScheduleOnCallPolicies]: {
    relation: UsedByRelation.ScheduleOnCallPolicies,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(OnCallDutyPolicyService),
        query: {
          _id: namedByRowsReferencing({
            joinModel: OnCallDutyPolicyEscalationRuleSchedule,
            ownerColumn: "onCallDutyPolicyId",
            referenceColumn: "onCallDutyPolicyScheduleId",
            values: context.recordIds,
          }),
        },
        getDetails: (data: {
          rowIds: Array<ObjectID>;
          props: DatabaseCommonInteractionProps;
        }): Promise<Dictionary<string>> => {
          return getEscalationRuleNames({
            service: asService(OnCallDutyPolicyEscalationRuleScheduleService),
            recordColumn: "onCallDutyPolicyScheduleId",
            context: context,
            rowIds: data.rowIds,
            props: data.props,
          });
        },
      });
    },
  },

  [UsedByRelation.ServiceMonitors]: {
    relation: UsedByRelation.ServiceMonitors,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(MonitorService),
        query: {
          _id: listHoldsAny(Monitor, "services", context.recordIds),
        },
      });
    },
  },
  [UsedByRelation.ServiceSlos]: {
    relation: UsedByRelation.ServiceSlos,
    /*
     * No SLO names a service: a service's SLOs are those that measure a
     * monitor watching it.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const monitorIds: Array<ObjectID> = await getMonitorIdsWatching(context);

      return plainPlan({
        service: asService(ServiceLevelObjectiveService),
        query:
          monitorIds.length > 0
            ? {
                _id: listHoldsAny(
                  ServiceLevelObjective,
                  "monitors",
                  monitorIds,
                ),
              }
            : null,
      });
    },
  },

  [UsedByRelation.StatusPageOpenIncidents]: {
    relation: UsedByRelation.StatusPageOpenIncidents,
    /*
     * The open incidents the page shows right now, as its visitors see
     * them: on a monitor it lists (directly or through a group), visible
     * on status pages, not private, within the page's scope - decided only
     * by IncidentStatusPageScope - and only while the page shows incidents
     * at all. One page at a time (isOneRecordOnly): each page's scope is
     * its own.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const statusPageId: ObjectID | undefined = context.recordIds[0];

      const plan: UsedByReadPlan = {
        service: asService(IncidentService),
        query: null,
        nameColumn: "title",
        numberColumn: "incidentNumberWithPrefix",
        sort: NEWEST_FIRST,
      };

      if (!statusPageId || context.recordIds.length !== 1) {
        return plan;
      }

      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: statusPageId,
          select: {
            _id: true,
            projectId: true,
            onlyShowScopedIncidents: true,
            showIncidentsOnStatusPage: true,
          },
          props: USED_BY_ROOT_PROPS,
        },
      );

      const monitorIds: Array<ObjectID> =
        statusPage && statusPage.showIncidentsOnStatusPage
          ? (
              await StatusPageService.getMonitorIdsOnStatusPage({
                statusPageId: statusPageId,
              })
            ).monitorsOnStatusPage
          : [];

      if (!statusPage || monitorIds.length === 0) {
        return plan;
      }

      const query: Query<Incident> = {
        monitors: monitorIds as any,
        currentIncidentStateId: QueryHelper.any(
          await IncidentStateService.getUnresolvedIncidentStateIds(
            context.projectId,
          ),
        ),
      };

      const scopeTarget: StatusPageScopeTarget = statusPage;

      return {
        ...plan,
        query: query as Query<BaseModel>,
        count: (props: DatabaseCommonInteractionProps): Promise<number> => {
          return IncidentStatusPageScope.countIncidentsForStatusPage({
            statusPage: scopeTarget,
            projectId: context.projectId,
            query: query,
            props: props,
          });
        },
        find: async (data: UsedByFindData): Promise<Array<BaseModel>> => {
          return await IncidentStatusPageScope.findIncidentsForStatusPage({
            statusPage: scopeTarget,
            query: { ...query, projectId: context.projectId },
            select: data.select as Select<Incident>,
            sort: data.sort as Sort<Incident>,
            skip: data.skip,
            limit: data.limit,
            props: data.props,
          });
        },
      };
    },
  },
  [UsedByRelation.StatusPageMaintenance]: {
    relation: UsedByRelation.StatusPageMaintenance,
    /*
     * The maintenance in progress or coming up that the pages show: named
     * on them, visible on status pages and published by now - and only on
     * pages that show scheduled maintenance at all.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const statusPages: Array<StatusPage> = await StatusPageService.findBy({
        query: {
          _id: QueryHelper.any(context.recordIds),
          projectId: context.projectId,
          showScheduledMaintenanceEventsOnStatusPage: true,
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: context.recordIds.length,
        props: USED_BY_ROOT_PROPS,
      });

      const shownOn: Array<ObjectID> = toIds(
        statusPages,
        (statusPage: StatusPage): ObjectID | null => {
          return statusPage.id;
        },
      );

      const stateIds: Array<ObjectID> =
        shownOn.length > 0 ? await getUpcomingOrOngoingStateIds(context) : [];

      return plainPlan({
        service: asService(ScheduledMaintenanceService),
        query:
          stateIds.length > 0
            ? (StatusPageVisibilityQuery.shownScheduledMaintenance(
                asQuery<ScheduledMaintenance>({
                  _id: listHoldsAny(
                    ScheduledMaintenance,
                    "statusPages",
                    shownOn,
                  ),
                  currentScheduledMaintenanceStateId: QueryHelper.any(stateIds),
                }),
                { now: context.now },
              ) as unknown as Dictionary<unknown>)
            : null,
        nameColumn: "title",
        numberColumn: "scheduledMaintenanceNumberWithPrefix",
        sort: SOONEST_FIRST,
      });
    },
  },

  [UsedByRelation.TeamOnCallPolicies]: {
    relation: UsedByRelation.TeamOnCallPolicies,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(OnCallDutyPolicyService),
        query: {
          _id: namedByRowsReferencing({
            joinModel: OnCallDutyPolicyEscalationRuleTeam,
            ownerColumn: "onCallDutyPolicyId",
            referenceColumn: "teamId",
            values: context.recordIds,
          }),
        },
        getDetails: (data: {
          rowIds: Array<ObjectID>;
          props: DatabaseCommonInteractionProps;
        }): Promise<Dictionary<string>> => {
          return getEscalationRuleNames({
            service: asService(OnCallDutyPolicyEscalationRuleTeamService),
            recordColumn: "teamId",
            context: context,
            rowIds: data.rowIds,
            props: data.props,
          });
        },
      });
    },
  },
  [UsedByRelation.TeamOwnedMonitors]: {
    relation: UsedByRelation.TeamOwnedMonitors,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return ownedByTeam({
        service: asService(MonitorService),
        ownerTeamModel: MonitorOwnerTeam,
        ownerColumn: "monitorId",
      })(context);
    },
  },
  [UsedByRelation.TeamOwnedStatusPages]: {
    relation: UsedByRelation.TeamOwnedStatusPages,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return ownedByTeam({
        service: asService(StatusPageService),
        ownerTeamModel: StatusPageOwnerTeam,
        ownerColumn: "statusPageId",
      })(context);
    },
  },
  [UsedByRelation.TeamOwnedServices]: {
    relation: UsedByRelation.TeamOwnedServices,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return ownedByTeam({
        service: asService(ServiceService),
        ownerTeamModel: ServiceOwnerTeam,
        ownerColumn: "serviceId",
      })(context);
    },
  },
  [UsedByRelation.TeamOwnedOnCallPolicies]: {
    relation: UsedByRelation.TeamOwnedOnCallPolicies,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return ownedByTeam({
        service: asService(OnCallDutyPolicyService),
        ownerTeamModel: OnCallDutyPolicyOwnerTeam,
        ownerColumn: "onCallDutyPolicyId",
      })(context);
    },
  },
  [UsedByRelation.TeamOwnedSchedules]: {
    relation: UsedByRelation.TeamOwnedSchedules,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return ownedByTeam({
        service: asService(OnCallDutyPolicyScheduleService),
        ownerTeamModel: OnCallDutyPolicyScheduleOwnerTeam,
        ownerColumn: "onCallDutyPolicyScheduleId",
      })(context);
    },
  },
  [UsedByRelation.TeamOwnedOther]: {
    relation: UsedByRelation.TeamOwnedOther,
    getFamilyPlans: familyOf(TEAM_OWNED_OTHER_PLANS),
  },

  [UsedByRelation.OnCallPolicyRules]: {
    relation: UsedByRelation.OnCallPolicyRules,
    getFamilyPlans: familyOf(ON_CALL_POLICY_RULE_PLANS),
  },
  [UsedByRelation.OnCallPolicyMonitors]: {
    relation: UsedByRelation.OnCallPolicyMonitors,
    /*
     * A monitor's criteria page a policy when they open an incident or an
     * alert: the policy's id is in the monitor's steps. A monitor that is
     * not checked says so - it pages nobody until it is.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(MonitorService),
        query: {
          monitorSteps: QueryHelper.textContainsAnyOf(
            context.recordIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        },
        offWhen: { column: "disableActiveMonitoring", value: true },
      });
    },
  },
  [UsedByRelation.OnCallPolicyOther]: {
    relation: UsedByRelation.OnCallPolicyOther,
    getFamilyPlans: familyOf(ON_CALL_POLICY_OTHER_PLANS),
  },
  [UsedByRelation.OnCallPolicyWorkflows]: {
    relation: UsedByRelation.OnCallPolicyWorkflows,
    // A workflow's Page On-Call Policy step holds the policy's id.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(WorkflowService),
        query: {
          graph: QueryHelper.textContainsAnyOf(
            context.recordIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
        },
      });
    },
  },

  [UsedByRelation.MonitorGroupStatusPages]: {
    relation: UsedByRelation.MonitorGroupStatusPages,
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(StatusPageService),
        query: {
          _id: namedByRowsReferencing({
            joinModel: StatusPageResource,
            ownerColumn: "statusPageId",
            referenceColumn: "monitorGroupId",
            values: context.recordIds,
          }),
        },
      });
    },
  },
  [UsedByRelation.MonitorGroupSlos]: {
    relation: UsedByRelation.MonitorGroupSlos,
    /*
     * No SLO names a monitor group: its SLOs are those that measure one of
     * its monitors.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const monitorIds: Array<ObjectID> = await getMonitorIdsInGroups(context);

      return plainPlan({
        service: asService(ServiceLevelObjectiveService),
        query:
          monitorIds.length > 0
            ? {
                _id: listHoldsAny(
                  ServiceLevelObjective,
                  "monitors",
                  monitorIds,
                ),
              }
            : null,
      });
    },
  },

  [UsedByRelation.SloBurnRateRules]: {
    relation: UsedByRelation.SloBurnRateRules,
    // Its rules open the SLO's Burn-Rate Rules page.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const service: DatabaseService<BaseModel> = asService(
        ServiceLevelObjectiveBurnRateRuleService,
      );

      return plainPlan({
        service: service,
        query: {
          serviceLevelObjectiveId: QueryHelper.any(context.recordIds),
        },
        linkIdColumn: "serviceLevelObjectiveId",
        offWhen: offWhenSwitchedOff(service),
      });
    },
  },
  [UsedByRelation.SloErrorBudgetPolicies]: {
    relation: UsedByRelation.SloErrorBudgetPolicies,
    // Its tiers open the SLO's Error Budget Policy page.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const service: DatabaseService<BaseModel> = asService(
        ServiceLevelObjectiveErrorBudgetPolicyTierService,
      );

      return plainPlan({
        service: service,
        query: {
          serviceLevelObjectiveId: QueryHelper.any(context.recordIds),
        },
        linkIdColumn: "serviceLevelObjectiveId",
        offWhen: offWhenSwitchedOff(service),
      });
    },
  },
  [UsedByRelation.SloDashboards]: {
    relation: UsedByRelation.SloDashboards,
    // A widget's SLO holds the SLO's id: the layout's text holds it.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(DashboardService),
        query: DashboardService.getQueryForLayoutsNaming(context.recordIds),
      });
    },
  },

  [UsedByRelation.LabelMonitors]: {
    relation: UsedByRelation.LabelMonitors,
    getPlan: carriesLabel({
      service: asService(MonitorService),
      modelType: Monitor,
    }),
  },
  [UsedByRelation.LabelMonitorGroups]: {
    relation: UsedByRelation.LabelMonitorGroups,
    getPlan: carriesLabel({
      service: asService(MonitorGroupService),
      modelType: MonitorGroup,
    }),
  },
  [UsedByRelation.LabelStatusPages]: {
    relation: UsedByRelation.LabelStatusPages,
    getPlan: carriesLabel({
      service: asService(StatusPageService),
      modelType: StatusPage,
    }),
  },
  [UsedByRelation.LabelServices]: {
    relation: UsedByRelation.LabelServices,
    getPlan: carriesLabel({
      service: asService(ServiceService),
      modelType: Service,
    }),
  },
  [UsedByRelation.LabelIncidents]: {
    relation: UsedByRelation.LabelIncidents,
    getPlan: carriesLabel({
      service: asService(IncidentService),
      modelType: Incident,
      nameColumn: "title",
      numberColumn: "incidentNumberWithPrefix",
      sort: NEWEST_FIRST,
    }),
  },
  [UsedByRelation.LabelAlerts]: {
    relation: UsedByRelation.LabelAlerts,
    getPlan: carriesLabel({
      service: asService(AlertService),
      modelType: Alert,
      nameColumn: "title",
      numberColumn: "alertNumberWithPrefix",
      sort: NEWEST_FIRST,
    }),
  },
  [UsedByRelation.LabelScheduledMaintenance]: {
    relation: UsedByRelation.LabelScheduledMaintenance,
    getPlan: carriesLabel({
      service: asService(ScheduledMaintenanceService),
      modelType: ScheduledMaintenance,
      nameColumn: "title",
      numberColumn: "scheduledMaintenanceNumberWithPrefix",
      sort: NEWEST_FIRST,
    }),
  },
  [UsedByRelation.LabelOnCallPolicies]: {
    relation: UsedByRelation.LabelOnCallPolicies,
    getPlan: carriesLabel({
      service: asService(OnCallDutyPolicyService),
      modelType: OnCallDutyPolicy,
    }),
  },
  [UsedByRelation.LabelOnCallSchedules]: {
    relation: UsedByRelation.LabelOnCallSchedules,
    getPlan: carriesLabel({
      service: asService(OnCallDutyPolicyScheduleService),
      modelType: OnCallDutyPolicySchedule,
    }),
  },
  [UsedByRelation.LabelSlos]: {
    relation: UsedByRelation.LabelSlos,
    getPlan: carriesLabel({
      service: asService(ServiceLevelObjectiveService),
      modelType: ServiceLevelObjective,
    }),
  },
  [UsedByRelation.LabelWorkflows]: {
    relation: UsedByRelation.LabelWorkflows,
    getPlan: carriesLabel({
      service: asService(WorkflowService),
      modelType: Workflow,
    }),
  },
  [UsedByRelation.LabelDashboards]: {
    relation: UsedByRelation.LabelDashboards,
    getPlan: carriesLabel({
      service: asService(DashboardService),
      modelType: Dashboard,
    }),
  },
};

/*
 * The record each kind is: read with the reader's props first, so a reader
 * who may not read the record learns nothing about what refers to it.
 */
export const USED_BY_RECORD_SERVICES: Readonly<
  Record<UsedByRecordKind, DatabaseService<BaseModel>>
> = {
  [UsedByRecordKind.Monitor]: asService(MonitorService),
  [UsedByRecordKind.OnCallSchedule]: asService(OnCallDutyPolicyScheduleService),
  [UsedByRecordKind.Service]: asService(ServiceService),
  [UsedByRecordKind.StatusPage]: asService(StatusPageService),
  [UsedByRecordKind.Team]: asService(TeamService),
  [UsedByRecordKind.Label]: asService(LabelService),
  [UsedByRecordKind.OnCallPolicy]: asService(OnCallDutyPolicyService),
  [UsedByRecordKind.MonitorGroup]: asService(MonitorGroupService),
  [UsedByRecordKind.Slo]: asService(ServiceLevelObjectiveService),
};

// A refusal that means "you may not read these", not a failure.
export function isReadRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof ForbiddenException ||
    error instanceof PaymentRequiredException
  );
}

function toCount(value: PositiveNumber | number): number {
  return typeof value === "number" ? value : value.toNumber();
}

function readString(model: BaseModel, column: string): string {
  const value: unknown = (model as unknown as Dictionary<unknown>)[column];

  return typeof value === "string" ? value : "";
}

// An id a column holds, as text: an ObjectID or its string.
function readIdText(model: BaseModel, column: string): string {
  const value: unknown = (model as unknown as Dictionary<unknown>)[column];

  if (value instanceof ObjectID) {
    return value.toString();
  }

  return typeof value === "string" ? value : "";
}

// One kind of record that refers, with how many of it the reader may read.
export interface UsedByMemberCounts {
  plan: UsedByReadPlan;
  count: number;
  hiddenCount: number;
}

// How a relation is read: one plan, or a family's several.
interface RelationPlans {
  isFamily: boolean;
  plans: Array<UsedByReadPlan>;
}

export class UsedByServiceClass {
  /*
   * How many records refer to the record by every relation of its kind,
   * and the first few the reader may read of each.
   */
  @CaptureSpan()
  public async getSummary(data: {
    recordKind: UsedByRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<UsedBySummary> {
    const context: UsedByReadContext = await this.getContext(data);

    const groups: Array<UsedByGroup> = await Promise.all(
      getUsedByRelations(data.recordKind).map(
        async (
          description: UsedByRelationDescription,
        ): Promise<UsedByGroup> => {
          const read: RelationPlans = await this.getRelationPlans(
            description.relation,
            context,
          );
          const members: Array<UsedByMemberCounts> = await this.countMembers(
            read.plans,
            context,
          );
          const counts: UsedByCounts = this.toCounts(
            description,
            read.isFamily,
            members,
          );

          return {
            ...counts,
            rows:
              counts.count > 0
                ? await this.findMemberRows({
                    members: members,
                    context: context,
                    skip: 0,
                    limit: USED_BY_PREVIEW_ROW_COUNT,
                  })
                : [],
          };
        },
      ),
    );

    return {
      recordKind: data.recordKind,
      recordId: data.recordId.toString(),
      groups: groups,
    };
  }

  /*
   * What refers to any of several records of one kind - a list's selection,
   * before its bulk Delete or Archive: each relation counted once for all
   * of them, with no rows. Only the records the reader may read are
   * counted (recordCount says how many); none of them, and nothing is.
   */
  @CaptureSpan()
  public async getSummaries(data: {
    recordKind: UsedByRecordKind;
    recordIds: Array<ObjectID>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<UsedByBulkSummary> {
    if (data.recordIds.length > USED_BY_BULK_MAX_RECORDS) {
      throw new BadDataException(
        `At most ${USED_BY_BULK_MAX_RECORDS} records can be counted at once. Select fewer, then try again.`,
      );
    }

    const recordIds: Array<ObjectID> = await this.getReadableRecordIds(data);
    const descriptions: ReadonlyArray<UsedByRelationDescription> =
      getUsedByBulkRelations(data.recordKind);

    if (recordIds.length === 0) {
      return {
        recordKind: data.recordKind,
        recordCount: 0,
        groups: descriptions.map(
          (description: UsedByRelationDescription): UsedByCounts => {
            return this.toCounts(description, Boolean(description.family), []);
          },
        ),
      };
    }

    const context: UsedByReadContext = {
      projectId: data.projectId,
      recordIds: recordIds,
      props: data.props,
      now: data.now || new Date(),
    };

    const groups: Array<UsedByCounts> = await Promise.all(
      descriptions.map(
        async (
          description: UsedByRelationDescription,
        ): Promise<UsedByCounts> => {
          const read: RelationPlans = await this.getRelationPlans(
            description.relation,
            context,
          );

          return this.toCounts(
            description,
            read.isFamily,
            await this.countMembers(read.plans, context),
          );
        },
      ),
    );

    return {
      recordKind: data.recordKind,
      recordCount: recordIds.length,
      groups: groups,
    };
  }

  // One page of one relation's rows, with its counts.
  @CaptureSpan()
  public async getPage(data: {
    recordKind: UsedByRecordKind;
    recordId: ObjectID;
    relation: UsedByRelation;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    skip?: unknown;
    limit?: unknown;
    now?: Date | undefined;
  }): Promise<UsedByPage> {
    const description: UsedByRelationDescription | undefined =
      getUsedByRelations(data.recordKind).find(
        (each: UsedByRelationDescription): boolean => {
          return each.relation === data.relation;
        },
      );

    if (!description) {
      throw new BadDataException(
        `${data.relation} is not something that refers to a ${data.recordKind}. Ask for one of that kind's relations.`,
      );
    }

    const skip: number = normalizeUsedBySkip(data.skip);
    const limit: number = normalizeUsedByPageSize(data.limit);
    const context: UsedByReadContext = await this.getContext(data);
    const read: RelationPlans = await this.getRelationPlans(
      data.relation,
      context,
    );
    const members: Array<UsedByMemberCounts> = await this.countMembers(
      read.plans,
      context,
    );
    const counts: UsedByCounts = this.toCounts(
      description,
      read.isFamily,
      members,
    );

    return {
      recordKind: data.recordKind,
      recordId: data.recordId.toString(),
      relation: data.relation,
      rowKind: description.rowKind,
      count: counts.count,
      hiddenCount: counts.hiddenCount,
      pageStart: skip,
      pageSize: limit,
      rows:
        counts.count > skip
          ? await this.findMemberRows({
              members: members,
              context: context,
              skip: skip,
              limit: limit,
            })
          : [],
    };
  }

  /*
   * The record, read with the reader's props: one they may not read (or
   * that is not in their project) is not found, so nothing about what
   * refers to it is told.
   */
  private async getContext(data: {
    recordKind: UsedByRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<UsedByReadContext> {
    const service: DatabaseService<BaseModel> = this.getRecordService(
      data.recordKind,
    );

    let record: BaseModel | null = null;

    try {
      record = await service.findOneBy({
        query: asQuery({
          _id: data.recordId.toString(),
          projectId: data.projectId,
        }),
        select: {
          _id: true,
        } as Select<BaseModel>,
        props: data.props,
      });
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }
    }

    if (!record) {
      throw new NotFoundException(
        "This record was not found in the project, or you may not read it. Check the link, or ask a Project Admin for access.",
      );
    }

    return {
      projectId: data.projectId,
      recordIds: [data.recordId],
      props: data.props,
      now: data.now || new Date(),
    };
  }

  /*
   * Of several records, those the reader may read in the project: the
   * others are not counted, so nothing about what refers to them is told.
   */
  private async getReadableRecordIds(data: {
    recordKind: UsedByRecordKind;
    recordIds: Array<ObjectID>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ObjectID>> {
    const service: DatabaseService<BaseModel> = this.getRecordService(
      data.recordKind,
    );
    const asked: Array<ObjectID> = uniqueIds(data.recordIds);

    if (asked.length === 0) {
      return [];
    }

    try {
      const records: Array<BaseModel> = await service.findBy({
        query: asQuery({
          _id: QueryHelper.any(asked),
          projectId: data.projectId,
        }),
        select: {
          _id: true,
        } as Select<BaseModel>,
        skip: 0,
        limit: asked.length,
        props: data.props,
      });

      return toIds(records, (record: BaseModel): ObjectID | null => {
        return record.id;
      });
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }

      return [];
    }
  }

  private getRecordService(
    recordKind: UsedByRecordKind,
  ): DatabaseService<BaseModel> {
    const service: DatabaseService<BaseModel> | undefined =
      USED_BY_RECORD_SERVICES[recordKind];

    if (!service) {
      throw new BadDataException(
        `${recordKind} is not a kind of record that shows what uses it. Ask about a monitor, an on-call schedule, an on-call policy, a service, a status page, a team, a label, a monitor group or an SLO.`,
      );
    }

    return service;
  }

  // How a relation is read: its one plan, or its family's.
  public async getRelationPlans(
    relation: UsedByRelation,
    context: UsedByReadContext,
  ): Promise<RelationPlans> {
    const definition: UsedByRelationDefinition | undefined =
      USED_BY_RELATION_DEFINITIONS[relation];

    if (definition?.getFamilyPlans) {
      return {
        isFamily: true,
        plans: await definition.getFamilyPlans(context),
      };
    }

    if (definition?.getPlan) {
      return { isFamily: false, plans: [await definition.getPlan(context)] };
    }

    throw new ServerException(
      `${relation} has no definition of how it is read. Add it to USED_BY_RELATION_DEFINITIONS.`,
    );
  }

  private async countWith(
    plan: UsedByReadPlan,
    context: UsedByReadContext,
    props: DatabaseCommonInteractionProps,
  ): Promise<number> {
    if (!plan.query) {
      return 0;
    }

    if (plan.count) {
      return await plan.count(props);
    }

    return toCount(
      await plan.service.countBy({
        query: asQuery({
          ...(plan.query as unknown as Dictionary<unknown>),
          projectId: context.projectId,
        }),
        props: props,
      }),
    );
  }

  /*
   * How many refer to the record this way, and how many of those the
   * reader may read: the project's total as OneUptime, then as the reader.
   * A reader refused the model altogether may read none of them.
   */
  public async countRelation(
    plan: UsedByReadPlan,
    context: UsedByReadContext,
  ): Promise<{ count: number; hiddenCount: number }> {
    const total: number = await this.countWith(
      plan,
      context,
      USED_BY_ROOT_PROPS,
    );

    if (total === 0) {
      return { count: 0, hiddenCount: 0 };
    }

    let visible: number = 0;

    try {
      visible = await this.countWith(plan, context, context.props);
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }
    }

    visible = Math.min(Math.max(visible, 0), total);

    return { count: visible, hiddenCount: total - visible };
  }

  // Every kind of a relation counted, a few at a time.
  public async countMembers(
    plans: Array<UsedByReadPlan>,
    context: UsedByReadContext,
  ): Promise<Array<UsedByMemberCounts>> {
    return await ArrayUtil.mapWithConcurrency(
      plans,
      USED_BY_FAMILY_CONCURRENCY,
      async (plan: UsedByReadPlan): Promise<UsedByMemberCounts> => {
        return {
          plan: plan,
          ...(await this.countRelation(plan, context)),
        };
      },
    );
  }

  // A relation's counts: its kinds' summed, and a family's parts.
  private toCounts(
    description: UsedByRelationDescription,
    isFamily: boolean,
    members: Array<UsedByMemberCounts>,
  ): UsedByCounts {
    let count: number = 0;
    let hiddenCount: number = 0;
    const parts: Array<UsedByGroupPart> = [];

    for (const member of members) {
      count += member.count;
      hiddenCount += member.hiddenCount;

      if (isFamily && member.count + member.hiddenCount > 0) {
        parts.push({
          rowKind: member.plan.rowKind || description.rowKind,
          count: member.count,
          hiddenCount: member.hiddenCount,
        });
      }
    }

    const counts: UsedByCounts = {
      relation: description.relation,
      rowKind: description.rowKind,
      count: count,
      hiddenCount: hiddenCount,
    };

    if (isFamily) {
      counts.parts = parts;
    }

    return counts;
  }

  /*
   * A page of a relation's rows the reader may read, across its kinds in
   * order: the kinds before the page are skipped over by their counts, and
   * a kind is read only for the rows of the page it holds - never every
   * row of every kind.
   */
  public async findMemberRows(data: {
    members: Array<UsedByMemberCounts>;
    context: UsedByReadContext;
    skip: number;
    limit: number;
  }): Promise<Array<UsedByRow>> {
    const rows: Array<UsedByRow> = [];
    let toSkip: number = Math.max(0, data.skip);
    let left: number = Math.max(0, data.limit);

    for (const member of data.members) {
      if (left <= 0) {
        break;
      }

      if (member.count <= 0) {
        continue;
      }

      if (toSkip >= member.count) {
        toSkip -= member.count;
        continue;
      }

      const take: number = Math.min(left, member.count - toSkip);

      rows.push(
        ...(await this.findRows({
          plan: member.plan,
          context: data.context,
          skip: toSkip,
          limit: take,
        })),
      );

      left -= take;
      toSkip = 0;
    }

    return rows;
  }

  // The rows the reader may read, a page of them, with their details.
  public async findRows(data: {
    plan: UsedByReadPlan;
    context: UsedByReadContext;
    skip: number;
    limit: number;
  }): Promise<Array<UsedByRow>> {
    const plan: UsedByReadPlan = data.plan;

    if (!plan.query || data.limit <= 0) {
      return [];
    }

    const select: Dictionary<boolean> = {
      _id: true,
      [plan.nameColumn]: true,
    };

    for (const column of [
      plan.numberColumn,
      plan.rowKindByColumn?.column,
      plan.linkIdColumn,
      plan.offWhen?.column,
    ]) {
      if (column) {
        select[column] = true;
      }
    }

    const sort: Sort<BaseModel> =
      plan.sort ||
      ({
        [plan.nameColumn]: SortOrder.Ascending,
      } as Sort<BaseModel>);

    let models: Array<BaseModel> = [];

    try {
      models = plan.find
        ? await plan.find({
            props: data.context.props,
            select: select as Select<BaseModel>,
            sort: sort,
            skip: data.skip,
            limit: data.limit,
          })
        : await plan.service.findBy({
            query: asQuery({
              ...(plan.query as unknown as Dictionary<unknown>),
              projectId: data.context.projectId,
            }),
            select: select as Select<BaseModel>,
            sort: sort,
            skip: data.skip,
            limit: data.limit,
            props: data.context.props,
          });
    } catch (error) {
      if (!isReadRefusal(error)) {
        throw error;
      }

      return [];
    }

    const ids: Array<ObjectID> = toIds(
      models,
      (model: BaseModel): ObjectID | null => {
        return model.id;
      },
    );

    let details: Dictionary<string> = {};

    if (plan.getDetails && ids.length > 0) {
      try {
        details = await plan.getDetails({
          rowIds: ids,
          props: data.context.props,
        });
      } catch (error) {
        if (!isReadRefusal(error)) {
          throw error;
        }
      }
    }

    const rows: Array<UsedByRow> = [];
    const seen: Set<string> = new Set<string>();

    for (const model of models) {
      const id: string = model.id?.toString() || "";

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);

      const row: UsedByRow = {
        id: id,
        name: readString(model, plan.nameColumn),
      };

      const number: string = plan.numberColumn
        ? readString(model, plan.numberColumn)
        : "";

      if (number) {
        row.number = number;
      }

      if (details[id]) {
        row.detail = details[id];
      }

      const rowKind: UsedByRowKind | undefined =
        (plan.rowKindByColumn
          ? plan.rowKindByColumn.rowKinds[
              String(
                (model as unknown as Dictionary<unknown>)[
                  plan.rowKindByColumn.column
                ] ?? "",
              )
            ]
          : undefined) || plan.rowKind;

      if (rowKind) {
        row.rowKind = rowKind;
      }

      const linkId: string = plan.linkIdColumn
        ? readIdText(model, plan.linkIdColumn)
        : "";

      if (linkId) {
        row.linkId = linkId;
      }

      if (
        plan.offWhen &&
        (model as unknown as Dictionary<unknown>)[plan.offWhen.column] ===
          plan.offWhen.value
      ) {
        row.isOff = true;
      }

      rows.push(row);
    }

    return rows;
  }
}

export default new UsedByServiceClass();
