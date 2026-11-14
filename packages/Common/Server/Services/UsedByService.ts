import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../Models/DatabaseModels/Alert";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import Incident from "../../Models/DatabaseModels/Incident";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorGroup from "../../Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import Service from "../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "../../Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Workflow from "../../Models/DatabaseModels/Workflow";
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
import {
  USED_BY_PREVIEW_ROW_COUNT,
  UsedByGroup,
  UsedByPage,
  UsedByRecordKind,
  UsedByRelation,
  UsedByRelationDescription,
  UsedByRow,
  UsedBySummary,
  getUsedByRelations,
  normalizeUsedByPageSize,
  normalizeUsedBySkip,
} from "../../Types/UsedBy/UsedBy";
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
import AlertService from "./AlertService";
import DashboardService from "./DashboardService";
import DatabaseService from "./DatabaseService";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
import LabelService from "./LabelService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorGroupService from "./MonitorGroupService";
import MonitorService from "./MonitorService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import ServiceService from "./ServiceService";
import StatusPageService from "./StatusPageService";
import TeamService from "./TeamService";
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
 * READS STAY BOUNDED, however many records refer to one: per relation one
 * COUNT as OneUptime, one COUNT as the reader (skipped when the total is
 * 0), and the first USED_BY_PREVIEW_ROW_COUNT rows (skipped when the
 * reader may see none). The rest of a relation is read a page at a time
 * (getPage), at most USED_BY_MAX_PAGE_SIZE rows. A reference is written as
 * a condition on the referring row's own id - `_id IN (SELECT ... FROM
 * <join table> WHERE <column> = :id)` - never as a join, so a count is one
 * row per record and a page never repeats one.
 *
 * Archived records are left out wherever a model can be archived: they
 * are retired, hidden from their lists, and change nothing.
 */

export const USED_BY_ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

export interface UsedByReadContext {
  projectId: ObjectID;
  recordId: ObjectID;
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
 * How one relation is read for one record. A plain relation is a query on
 * `service`'s model; a relation that cannot be one query (the incidents a
 * status page shows, which only IncidentStatusPageScope decides) gives
 * `count` and `find` instead, each handed the props to read with.
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
}

export interface UsedByRelationDefinition {
  relation: UsedByRelation;
  getPlan: (context: UsedByReadContext) => Promise<UsedByReadPlan>;
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

// A plain relation: the rows of `service` matching `query`, by name.
function plainPlan(data: {
  service: DatabaseService<BaseModel>;
  query: Dictionary<unknown> | null;
  nameColumn?: string | undefined;
  numberColumn?: string | undefined;
  sort?: Sort<BaseModel> | undefined;
  getDetails?: UsedByReadPlan["getDetails"];
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
  };
}

/*
 * The escalation rules of each policy that page the record, by policy id:
 * "Primary, Second line", in the order the rules escalate. Read with the
 * reader's props; a rule they may not read is left out.
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

  const rows: Array<BaseModel> = await data.service.findBy({
    query: asQuery({
      projectId: data.context.projectId,
      [data.recordColumn]: data.context.recordId,
      onCallDutyPolicyId: QueryHelper.any(data.rowIds),
    }),
    select: {
      onCallDutyPolicyId: true,
      onCallDutyPolicyEscalationRule: {
        name: true,
        order: true,
      },
    } as Select<BaseModel>,
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: data.props,
  });

  const rulesByPolicy: Dictionary<Array<{ name: string; order: number }>> = {};

  for (const row of rows) {
    const policyId: string = String(
      (row as unknown as Dictionary<unknown>)["onCallDutyPolicyId"] || "",
    );
    const rule: Dictionary<unknown> | undefined = (
      row as unknown as Dictionary<unknown>
    )["onCallDutyPolicyEscalationRule"] as Dictionary<unknown> | undefined;
    const name: string = String(rule?.["name"] || "").trim();

    if (!policyId || !name) {
      continue;
    }

    const rules: Array<{ name: string; order: number }> =
      rulesByPolicy[policyId] || [];

    if (
      !rules.some((each: { name: string; order: number }): boolean => {
        return each.name === name;
      })
    ) {
      rules.push({ name: name, order: Number(rule?.["order"]) || 0 });
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

// The ids of the monitor groups a monitor is in, read as OneUptime.
async function getMonitorGroupIdsOf(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const rows: Array<MonitorGroupResource> =
    await MonitorGroupResourceService.findBy({
      query: {
        projectId: context.projectId,
        monitorId: context.recordId,
      },
      select: {
        monitorGroupId: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: USED_BY_ROOT_PROPS,
    });

  return rows
    .map((row: MonitorGroupResource): ObjectID | undefined => {
      return row.monitorGroupId;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });
}

// The ids of the monitors watching a service, read as OneUptime.
async function getMonitorIdsWatching(
  context: UsedByReadContext,
): Promise<Array<ObjectID>> {
  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: asQuery<Monitor>({
      projectId: context.projectId,
      isArchived: false,
      _id: listHoldsAny(Monitor, "services", [context.recordId]),
    }),
    select: {
      _id: true,
    },
    skip: 0,
    limit: LIMIT_PER_PROJECT,
    props: USED_BY_ROOT_PROPS,
  });

  return monitors
    .map((monitor: Monitor): ObjectID | null => {
      return monitor.id;
    })
    .filter((id: ObjectID | null): id is ObjectID => {
      return Boolean(id);
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

// The team owns these: the records of `ownerTeamModel` that name it.
function ownedByTeam(data: {
  service: DatabaseService<BaseModel>;
  ownerTeamModel: ModelType;
  ownerColumn: string;
}): (context: UsedByReadContext) => Promise<UsedByReadPlan> {
  return async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
    return plainPlan({
      service: data.service,
      query: {
        _id: namedByRowsReferencing({
          joinModel: data.ownerTeamModel,
          ownerColumn: data.ownerColumn,
          referenceColumn: "teamId",
          values: [context.recordId],
        }),
      },
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
        _id: listHoldsAny(data.modelType, "labels", [context.recordId]),
      },
      nameColumn: data.nameColumn,
      numberColumn: data.numberColumn,
      sort: data.sort,
    });
  };
}

const NEWEST_FIRST: Sort<BaseModel> = {
  createdAt: SortOrder.Descending,
};

const SOONEST_FIRST: Sort<BaseModel> = {
  startsAt: SortOrder.Ascending,
} as Sort<BaseModel>;

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
                values: [context.recordId],
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
            values: [context.recordId],
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
          _id: listHoldsAny(ServiceLevelObjective, "monitors", [
            context.recordId,
          ]),
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
                _id: listHoldsAny(ScheduledMaintenance, "monitors", [
                  context.recordId,
                ]),
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
          _id: listHoldsAny(Monitor, "dependsOnMonitors", [context.recordId]),
        },
      });
    },
  },
  [UsedByRelation.MonitorWorkflows]: {
    relation: UsedByRelation.MonitorWorkflows,
    // A step's arguments hold the monitor's id: its text holds the id.
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      return plainPlan({
        service: asService(WorkflowService),
        query: {
          graph: QueryHelper.textContainsAnyOf([context.recordId.toString()]),
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
        query: DashboardService.getQueryForLayoutsNaming(context.recordId),
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
            values: [context.recordId],
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
          _id: listHoldsAny(Monitor, "services", [context.recordId]),
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
     * at all.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: context.recordId,
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
                statusPageId: context.recordId,
              })
            ).monitorsOnStatusPage
          : [];

      const plan: UsedByReadPlan = {
        service: asService(IncidentService),
        query: null,
        nameColumn: "title",
        numberColumn: "incidentNumberWithPrefix",
        sort: NEWEST_FIRST,
      };

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
     * The maintenance in progress or coming up that the page shows: named
     * on it, visible on status pages and published by now - and only while
     * the page shows scheduled maintenance at all.
     */
    getPlan: async (context: UsedByReadContext): Promise<UsedByReadPlan> => {
      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: context.recordId,
          select: {
            _id: true,
            showScheduledMaintenanceEventsOnStatusPage: true,
          },
          props: USED_BY_ROOT_PROPS,
        },
      );

      const stateIds: Array<ObjectID> =
        statusPage && statusPage.showScheduledMaintenanceEventsOnStatusPage
          ? await getUpcomingOrOngoingStateIds(context)
          : [];

      return plainPlan({
        service: asService(ScheduledMaintenanceService),
        query:
          stateIds.length > 0
            ? (StatusPageVisibilityQuery.shownScheduledMaintenance(
                asQuery<ScheduledMaintenance>({
                  _id: listHoldsAny(ScheduledMaintenance, "statusPages", [
                    context.recordId,
                  ]),
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
            values: [context.recordId],
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
    getPlan: ownedByTeam({
      service: asService(MonitorService),
      ownerTeamModel: MonitorOwnerTeam,
      ownerColumn: "monitorId",
    }),
  },
  [UsedByRelation.TeamOwnedStatusPages]: {
    relation: UsedByRelation.TeamOwnedStatusPages,
    getPlan: ownedByTeam({
      service: asService(StatusPageService),
      ownerTeamModel: StatusPageOwnerTeam,
      ownerColumn: "statusPageId",
    }),
  },
  [UsedByRelation.TeamOwnedServices]: {
    relation: UsedByRelation.TeamOwnedServices,
    getPlan: ownedByTeam({
      service: asService(ServiceService),
      ownerTeamModel: ServiceOwnerTeam,
      ownerColumn: "serviceId",
    }),
  },
  [UsedByRelation.TeamOwnedOnCallPolicies]: {
    relation: UsedByRelation.TeamOwnedOnCallPolicies,
    getPlan: ownedByTeam({
      service: asService(OnCallDutyPolicyService),
      ownerTeamModel: OnCallDutyPolicyOwnerTeam,
      ownerColumn: "onCallDutyPolicyId",
    }),
  },
  [UsedByRelation.TeamOwnedSchedules]: {
    relation: UsedByRelation.TeamOwnedSchedules,
    getPlan: ownedByTeam({
      service: asService(OnCallDutyPolicyScheduleService),
      ownerTeamModel: OnCallDutyPolicyScheduleOwnerTeam,
      ownerColumn: "onCallDutyPolicyScheduleId",
    }),
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
          const plan: UsedByReadPlan = await this.getPlan(
            description.relation,
            context,
          );
          const counts: { count: number; hiddenCount: number } =
            await this.countRelation(plan, context);

          return {
            relation: description.relation,
            rowKind: description.rowKind,
            count: counts.count,
            hiddenCount: counts.hiddenCount,
            rows:
              counts.count > 0
                ? await this.findRows({
                    plan: plan,
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
    const plan: UsedByReadPlan = await this.getPlan(data.relation, context);
    const counts: { count: number; hiddenCount: number } =
      await this.countRelation(plan, context);

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
          ? await this.findRows({
              plan: plan,
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
    const service: DatabaseService<BaseModel> | undefined =
      USED_BY_RECORD_SERVICES[data.recordKind];

    if (!service) {
      throw new BadDataException(
        `${data.recordKind} is not a kind of record that shows what uses it. Ask about a monitor, an on-call schedule, a service, a status page, a team or a label.`,
      );
    }

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
        "This record was not found in the project, or you may not read it. Check the link, or ask a project admin for access.",
      );
    }

    return {
      projectId: data.projectId,
      recordId: data.recordId,
      props: data.props,
      now: data.now || new Date(),
    };
  }

  private async getPlan(
    relation: UsedByRelation,
    context: UsedByReadContext,
  ): Promise<UsedByReadPlan> {
    const definition: UsedByRelationDefinition | undefined =
      USED_BY_RELATION_DEFINITIONS[relation];

    if (!definition) {
      throw new ServerException(
        `${relation} has no definition of how it is read. Add it to USED_BY_RELATION_DEFINITIONS.`,
      );
    }

    return await definition.getPlan(context);
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

    if (plan.numberColumn) {
      select[plan.numberColumn] = true;
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

    const ids: Array<ObjectID> = models
      .map((model: BaseModel): ObjectID | null => {
        return model.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

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

      rows.push(row);
    }

    return rows;
  }
}

export default new UsedByServiceClass();
