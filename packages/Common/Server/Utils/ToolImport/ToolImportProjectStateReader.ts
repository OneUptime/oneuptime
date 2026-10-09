import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ToolImportRecord from "../../../Models/DatabaseModels/ToolImportRecord";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getToolImportSourceDefinition } from "../../../Types/ToolImport/ToolImportCatalog";
import {
  getToolImportMonitorMatchKey,
  TOOL_IMPORT_MONITOR_TYPES,
} from "../../../Types/ToolImport/ToolImportMonitorBuilder";
import ResolvedStateUtil from "../../../Utils/ResolvedState";
import { StateListType } from "../../../Utils/StateOrder";
import {
  InviteTeam,
  InviteTeamPermissionRow,
  pickDefaultInviteTeam,
} from "../../../Types/Team/DefaultInviteTeamRule";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import { ToolImportInviteTeam } from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import {
  AllowedActiveMonitorCountInFreePlan,
  AllowedStatusPageCountInFreePlan,
  AllowedSubscribersCountInFreePlan,
  IsBillingEnabled,
} from "../../EnvironmentConfig";
import DatabaseService from "../../Services/DatabaseService";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import IncidentRoleService from "../../Services/IncidentRoleService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorService from "../../Services/MonitorService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import PayAsYouGoBillingService from "../../Services/PayAsYouGoBillingService";
import ServiceService from "../../Services/ServiceService";
import StatusPageService from "../../Services/StatusPageService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import TeamService from "../../Services/TeamService";
import ToolImportRecordService from "../../Services/ToolImportRecordService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../Types/Database/Permissions/Index";
import BillingPermissions from "../../Types/Database/Permissions/BillingPermission";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  normalizeImportName,
  ToolImportAccess,
  ToolImportExistingMonitor,
  ToolImportExistingRecord,
  ToolImportPlanRoom,
  ToolImportPreviousRecord,
  ToolImportProjectState,
} from "./ToolImportPlanner";

/*
 * WHAT THE PROJECT ALREADY HAS, AND WHAT THE PERSON MAY DO IN IT.
 *
 * The two inputs of the planner that come from OneUptime rather than from
 * the other tool. The project's records are read as OneUptime (root),
 * pinned to the project - only their ids and names, to match by - and what
 * the person may create is asked of the same permission and plan checks
 * their own creates go through (ModelPermission.checkCreatePermissions, with
 * the project's plan on their props). Nothing here writes.
 */

// The records each kind of item becomes, and the services they are read with.
interface KindTarget {
  service: DatabaseService<BaseModel>;
  // Every table a create of this kind writes, for the permission check.
  createModels: Array<DatabaseBaseModelType>;
  /*
   * False for a kind whose records have no name to match by (a status
   * page's subscribers): it is read its own way (readState).
   */
  isMatchedByName?: boolean | undefined;
}

function serviceOf<T extends BaseModel>(
  service: DatabaseService<T>,
): DatabaseService<BaseModel> {
  return service as unknown as DatabaseService<BaseModel>;
}

export const TOOL_IMPORT_KIND_TARGETS: Record<
  Exclude<ToolImportResourceKind, ToolImportResourceKind.Person>,
  KindTarget
> = {
  [ToolImportResourceKind.Team]: {
    service: serviceOf(TeamService),
    createModels: [Team],
  },
  [ToolImportResourceKind.Service]: {
    service: serviceOf(ServiceService),
    createModels: [ServiceModel],
  },
  [ToolImportResourceKind.IncidentSeverity]: {
    service: serviceOf(IncidentSeverityService),
    createModels: [IncidentSeverity],
  },
  [ToolImportResourceKind.IncidentState]: {
    service: serviceOf(IncidentStateService),
    createModels: [IncidentState],
  },
  [ToolImportResourceKind.IncidentRole]: {
    service: serviceOf(IncidentRoleService),
    createModels: [IncidentRole],
  },
  [ToolImportResourceKind.IncidentCustomField]: {
    service: serviceOf(IncidentCustomFieldService),
    createModels: [IncidentCustomField],
  },
  [ToolImportResourceKind.OnCallSchedule]: {
    service: serviceOf(OnCallDutyPolicyScheduleService),
    createModels: [
      OnCallDutyPolicySchedule,
      OnCallDutyPolicyScheduleLayer,
      OnCallDutyPolicyScheduleLayerUser,
    ],
  },
  [ToolImportResourceKind.OnCallPolicy]: {
    service: serviceOf(OnCallDutyPolicyService),
    createModels: [OnCallDutyPolicy, OnCallDutyPolicyEscalationRule],
  },
  [ToolImportResourceKind.Monitor]: {
    service: serviceOf(MonitorService),
    createModels: [Monitor],
  },
  [ToolImportResourceKind.StatusPage]: {
    service: serviceOf(StatusPageService),
    createModels: [StatusPage, StatusPageGroup, StatusPageResource],
  },
  [ToolImportResourceKind.StatusPageSubscriber]: {
    service: serviceOf(StatusPageSubscriberService),
    createModels: [StatusPageSubscriber],
    isMatchedByName: false,
  },
};

// Every kind's target but people's, which are matched by email.
function getKindTargets(
  kinds: ReadonlyArray<ToolImportResourceKind> | undefined,
): Array<[ToolImportResourceKind, KindTarget]> {
  return (
    Object.entries(TOOL_IMPORT_KIND_TARGETS) as Array<
      [ToolImportResourceKind, KindTarget]
    >
  ).filter(([kind]: [ToolImportResourceKind, KindTarget]): boolean => {
    return !kinds || kinds.includes(kind);
  });
}

export default class ToolImportProjectStateReader {
  public static async readState(data: {
    projectId: ObjectID;
    source: ToolImportSource;
  }): Promise<ToolImportProjectState> {
    // Only what this tool's import can bring over is read and matched.
    const kinds: Array<ToolImportResourceKind> = getToolImportSourceDefinition(
      data.source,
    ).kinds;

    const memberUserIdsByEmail: Map<string, string> =
      await this.readMembersByEmail(data.projectId);

    const existingByKind: Map<
      ToolImportResourceKind,
      Array<ToolImportExistingRecord>
    > = new Map<ToolImportResourceKind, Array<ToolImportExistingRecord>>();

    for (const [kind, target] of getKindTargets(kinds)) {
      if (target.isMatchedByName === false) {
        continue;
      }

      existingByKind.set(
        kind,
        await this.readNamedRecords(target.service, data.projectId),
      );
    }

    const existingMonitors: Array<ToolImportExistingMonitor> = kinds.includes(
      ToolImportResourceKind.Monitor,
    )
      ? await this.readExistingMonitors(data.projectId)
      : [];

    let subscriberEmailsByStatusPageId: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    if (kinds.includes(ToolImportResourceKind.StatusPageSubscriber)) {
      const subscribers: {
        records: Array<ToolImportExistingRecord>;
        emailsByStatusPageId: Map<string, Set<string>>;
      } = await this.readExistingSubscribers(data.projectId);

      existingByKind.set(
        ToolImportResourceKind.StatusPageSubscriber,
        subscribers.records,
      );
      subscriberEmailsByStatusPageId = subscribers.emailsByStatusPageId;
    }

    const states: Array<IncidentState> = await IncidentStateService.findBy({
      query: { projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        isCreatedState: true,
        isResolvedState: true,
        order: true,
        createdAt: true,
      },
      sort: { order: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const roles: Array<IncidentRole> = await IncidentRoleService.findBy({
      query: { projectId: data.projectId, isPrimaryRole: true },
      select: { _id: true, name: true },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    const toExisting: (
      record:
        | { _id?: string | undefined; name?: string | undefined }
        | undefined,
    ) => ToolImportExistingRecord | null = (
      record:
        | { _id?: string | undefined; name?: string | undefined }
        | undefined,
    ): ToolImportExistingRecord | null => {
      return record?._id
        ? { id: record._id.toString(), name: record.name || "" }
        : null;
    };

    return {
      memberUserIdsByEmail: memberUserIdsByEmail,
      existingByKind: existingByKind,
      createdIncidentState: toExisting(
        states.find((state: IncidentState): boolean => {
          return Boolean(state.isCreatedState);
        }),
      ),
      // Where Resolve moves an incident: the one rule the services use.
      resolvedIncidentState: toExisting(
        ResolvedStateUtil.getResolvedState({
          list: StateListType.IncidentState,
          states: states,
        }) || undefined,
      ),
      primaryIncidentRole: toExisting(roles[0]),
      previousRecords: await this.readPreviousRecords({
        projectId: data.projectId,
        source: data.source,
        memberUserIds: new Set<string>(memberUserIdsByEmail.values()),
        existingByKind: existingByKind,
      }),
      existingMonitors: existingMonitors,
      subscriberEmailsByStatusPageId: subscriberEmailsByStatusPageId,
    };
  }

  /*
   * The project's monitors of the types an import creates, with what each
   * checks - for matching an imported check to the same monitor
   * (getToolImportMonitorMatchKey) - read as OneUptime.
   */
  public static async readExistingMonitors(
    projectId: ObjectID,
  ): Promise<Array<ToolImportExistingMonitor>> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: projectId,
        monitorType: QueryHelper.any(
          TOOL_IMPORT_MONITOR_TYPES as Array<MonitorType>,
        ),
      },
      select: {
        _id: true,
        name: true,
        monitorType: true,
        monitorSteps: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return monitors
      .filter((monitor: Monitor): boolean => {
        return Boolean(monitor._id && monitor.monitorType);
      })
      .map((monitor: Monitor): ToolImportExistingMonitor => {
        return {
          id: monitor._id!.toString(),
          name: monitor.name || "",
          monitorType: monitor.monitorType!,
          addressKey: this.getAddressKeyOf(monitor),
        };
      });
  }

  // What a monitor of the project checks, as an imported check would say it.
  public static getAddressKeyOf(monitor: Monitor): string | null {
    let steps: MonitorSteps | null = null;

    try {
      steps = monitor.monitorSteps
        ? MonitorSteps.fromJSON(
            monitor.monitorSteps as unknown as MonitorSteps | JSONObject,
          )
        : null;
    } catch {
      steps = null;
    }

    const step: MonitorStep | undefined =
      steps?.data?.monitorStepsInstanceArray[0];

    if (!step?.data) {
      return null;
    }

    if (monitor.monitorType === MonitorType.DNS) {
      return getToolImportMonitorMatchKey({
        monitorType: monitor.monitorType,
        destination: step.data.dnsMonitor?.queryName,
        dnsRecordType: step.data.dnsMonitor?.recordType,
      });
    }

    return getToolImportMonitorMatchKey({
      monitorType: monitor.monitorType || null,
      destination: step.data.monitorDestination?.toString(),
      port: step.data.monitorDestinationPort
        ? Number(step.data.monitorDestinationPort.toString())
        : undefined,
    });
  }

  /*
   * The project's status page subscribers by email - every one, as a
   * record an earlier import may have made, and each page's emails, for
   * matching someone who already follows the page - read as OneUptime.
   */
  private static async readExistingSubscribers(projectId: ObjectID): Promise<{
    records: Array<ToolImportExistingRecord>;
    emailsByStatusPageId: Map<string, Set<string>>;
  }> {
    const subscribers: Array<StatusPageSubscriber> =
      await StatusPageSubscriberService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          statusPageId: true,
          subscriberEmail: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const records: Array<ToolImportExistingRecord> = [];
    const emailsByStatusPageId: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const subscriber of subscribers) {
      if (!subscriber._id) {
        continue;
      }

      const email: string =
        subscriber.subscriberEmail?.toString().trim().toLowerCase() || "";

      records.push({ id: subscriber._id.toString(), name: email });

      if (email && subscriber.statusPageId) {
        const pageId: string = subscriber.statusPageId.toString().toLowerCase();
        const emails: Set<string> =
          emailsByStatusPageId.get(pageId) || new Set<string>();

        emails.add(email);
        emailsByStatusPageId.set(pageId, emails);
      }
    }

    return { records: records, emailsByStatusPageId: emailsByStatusPageId };
  }

  // Everyone with a membership in the project, invitations included, by email.
  public static async readMembersByEmail(
    projectId: ObjectID,
  ): Promise<Map<string, string>> {
    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: { projectId: projectId },
      select: {
        userId: true,
        user: {
          email: true,
        },
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const byEmail: Map<string, string> = new Map<string, string>();

    for (const membership of memberships) {
      const email: string = membership.user?.email?.toString() || "";

      if (email && membership.userId) {
        byEmail.set(email.trim().toLowerCase(), membership.userId.toString());
      }
    }

    return byEmail;
  }

  private static async readNamedRecords(
    service: DatabaseService<BaseModel>,
    projectId: ObjectID,
  ): Promise<Array<ToolImportExistingRecord>> {
    const records: Array<BaseModel> = await service.findBy({
      query: { projectId: projectId } as never,
      select: { _id: true, name: true } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    return records
      .map((record: BaseModel): ToolImportExistingRecord => {
        return {
          id: record._id?.toString() || "",
          name:
            ((record as unknown as Record<string, unknown>)["name"] as
              | string
              | undefined) || "",
        };
      })
      .filter((record: ToolImportExistingRecord): boolean => {
        return Boolean(record.id && normalizeImportName(record.name));
      });
  }

  /*
   * Every record an earlier import of this tool brought over, and whether
   * it is still in the project: a person while they are a member, any other
   * record while it exists.
   */
  private static async readPreviousRecords(data: {
    projectId: ObjectID;
    source: ToolImportSource;
    memberUserIds: Set<string>;
    existingByKind: Map<
      ToolImportResourceKind,
      Array<ToolImportExistingRecord>
    >;
  }): Promise<Array<ToolImportPreviousRecord>> {
    const records: Array<ToolImportRecord> =
      await ToolImportRecordService.findBy({
        query: { projectId: data.projectId, source: data.source },
        select: {
          kind: true,
          sourceId: true,
          recordId: true,
          isComplete: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const existingIds: Map<ToolImportResourceKind, Set<string>> = new Map<
      ToolImportResourceKind,
      Set<string>
    >();

    for (const [kind, existing] of data.existingByKind) {
      existingIds.set(
        kind,
        new Set<string>(
          existing.map((record: ToolImportExistingRecord): string => {
            return record.id.toLowerCase();
          }),
        ),
      );
    }

    const memberIds: Set<string> = new Set<string>(
      [...data.memberUserIds].map((id: string): string => {
        return id.toLowerCase();
      }),
    );

    return records
      .filter((record: ToolImportRecord): boolean => {
        return Boolean(record.kind && record.sourceId && record.recordId);
      })
      .map((record: ToolImportRecord): ToolImportPreviousRecord => {
        const kind: ToolImportResourceKind = record.kind!;
        const recordId: string = record.recordId!.toString();
        const stillExists: boolean =
          kind === ToolImportResourceKind.Person
            ? memberIds.has(recordId.toLowerCase())
            : Boolean(existingIds.get(kind)?.has(recordId.toLowerCase()));

        return {
          kind: kind,
          sourceId: record.sourceId!,
          recordId: recordId,
          isComplete: record.isComplete !== false,
          stillExists: stillExists,
        };
      });
  }

  /*
   * What the person may do: for each kind, whether they may create it (or
   * why not - their permissions, or the project's plan), whether they may
   * invite people, and the teams they could invite people to.
   */
  public static async readAccess(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // The kinds the tool brings over; all of them when not given.
    kinds?: Array<ToolImportResourceKind> | undefined;
  }): Promise<ToolImportAccess> {
    const createRefusals: Map<ToolImportResourceKind, ToolImportNote | null> =
      new Map<ToolImportResourceKind, ToolImportNote | null>();

    for (const [kind, target] of getKindTargets(undefined)) {
      createRefusals.set(
        kind,
        this.getCreateRefusal(target.createModels, data.props),
      );
    }

    const isOnFreePlan: boolean = Boolean(
      IsBillingEnabled &&
        !data.props.isRoot &&
        !data.props.isMasterAdmin &&
        data.props.currentPlan === PlanType.Free,
    );

    const brings: (kind: ToolImportResourceKind) => boolean = (
      kind: ToolImportResourceKind,
    ): boolean => {
      return !data.kinds || data.kinds.includes(kind);
    };

    const planRoomByKind: Map<ToolImportResourceKind, ToolImportPlanRoom> =
      isOnFreePlan
        ? await this.readFreePlanRoom({
            projectId: data.projectId,
            kinds: [
              ToolImportResourceKind.Monitor,
              ToolImportResourceKind.StatusPage,
              ToolImportResourceKind.StatusPageSubscriber,
            ].filter(brings),
          })
        : new Map<ToolImportResourceKind, ToolImportPlanRoom>();

    /*
     * On a billed install, a monitor that is checked has usage charges
     * even on the Free plan, so a project needs a payment method - or a
     * paid plan - to make one (MonitorService.onBeforeCreate). Asked here
     * the way that create asks, so the preview says it up front.
     */
    let checkedMonitorRefusal: ToolImportNote | null = null;

    if (
      IsBillingEnabled &&
      !data.props.isRoot &&
      brings(ToolImportResourceKind.Monitor) &&
      !(await PayAsYouGoBillingService.canUsePayAsYouGo(data.projectId))
    ) {
      checkedMonitorRefusal = makeToolImportNote(
        ToolImportNoteCode.MonitorNeedsPaymentMethod,
      );
    }

    let inviteRefusal: ToolImportNote | null = this.getCreateRefusal(
      [TeamMember],
      data.props,
    );

    /*
     * A project on the Free plan has room for one member, its owner: an
     * invitation would be refused, so none is offered.
     */
    if (!inviteRefusal && isOnFreePlan) {
      inviteRefusal = makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
        plan: PlanType.Growth,
      });
    }

    const inviteTeams: {
      teams: Array<ToolImportInviteTeam>;
      defaultId: string | null;
    } = inviteRefusal
      ? { teams: [], defaultId: null }
      : await this.readInviteTeams(data);

    return {
      createRefusals: createRefusals,
      inviteRefusal: inviteRefusal,
      inviteTeams: inviteTeams.teams,
      defaultInviteTeamId: inviteTeams.defaultId,
      isLimitedToOneLevelPerPolicy: isOnFreePlan,
      planRoomByKind: planRoomByKind,
      checkedMonitorRefusal: checkedMonitorRefusal,
    };
  }

  /*
   * How many more monitors that are checked, status pages and subscribers
   * the Free plan has room for in the project, counted exactly as their
   * own creates count them (MonitorService, StatusPageService and
   * StatusPageSubscriberService onBeforeCreate).
   */
  private static async readFreePlanRoom(data: {
    projectId: ObjectID;
    kinds: Array<ToolImportResourceKind>;
  }): Promise<Map<ToolImportResourceKind, ToolImportPlanRoom>> {
    const room: Map<ToolImportResourceKind, ToolImportPlanRoom> = new Map<
      ToolImportResourceKind,
      ToolImportPlanRoom
    >();

    const roomOf: (limit: number, used: PositiveNumber) => ToolImportPlanRoom = (
      limit: number,
      used: PositiveNumber,
    ): ToolImportPlanRoom => {
      return { room: Math.max(0, limit - used.toNumber()), limit: limit };
    };

    if (data.kinds.includes(ToolImportResourceKind.Monitor)) {
      room.set(
        ToolImportResourceKind.Monitor,
        roomOf(
          AllowedActiveMonitorCountInFreePlan,
          await MonitorService.countBy({
            query: {
              projectId: data.projectId,
              monitorType: QueryHelper.any(
                MonitorTypeHelper.getActiveMonitorTypes(),
              ),
            },
            props: { isRoot: true },
          }),
        ),
      );
    }

    if (data.kinds.includes(ToolImportResourceKind.StatusPage)) {
      room.set(
        ToolImportResourceKind.StatusPage,
        roomOf(
          AllowedStatusPageCountInFreePlan,
          await StatusPageService.countBy({
            query: { projectId: data.projectId },
            props: { isRoot: true },
          }),
        ),
      );
    }

    if (data.kinds.includes(ToolImportResourceKind.StatusPageSubscriber)) {
      room.set(
        ToolImportResourceKind.StatusPageSubscriber,
        roomOf(
          AllowedSubscribersCountInFreePlan,
          await StatusPageSubscriberService.countBy({
            query: { projectId: data.projectId },
            props: { isRoot: true },
          }),
        ),
      );
    }

    return room;
  }

  /*
   * Null when the person may create every one of these tables, else why
   * not: their permissions (NoPermission), or the plan a table needs
   * (NeedsPlan, naming it).
   */
  public static getCreateRefusal(
    modelTypes: Array<DatabaseBaseModelType>,
    props: DatabaseCommonInteractionProps,
  ): ToolImportNote | null {
    for (const modelType of modelTypes) {
      try {
        ModelPermission.checkCreatePermissions(
          modelType,
          new modelType(),
          props,
        );
      } catch (error) {
        if (error instanceof PaymentRequiredException) {
          const plan: string | null = BillingPermissions.getRequiredPlan(
            new modelType(),
            DatabaseRequestType.Create,
          );

          return makeToolImportNote(ToolImportNoteCode.NeedsPlan, {
            plan: plan || "",
          });
        }

        if (error instanceof NotAuthorizedException) {
          return makeToolImportNote(ToolImportNoteCode.NoPermission);
        }

        throw error;
      }
    }

    return null;
  }

  /*
   * The teams the person could add someone to - every row of a team is
   * handed on with it, so only teams whose rows they could grant
   * (TeamPermissionService.findTeamsCallerCannotGrant) - and the one picked
   * to start with: the project's members team, by the rule every invitation
   * follows (DefaultInviteTeamRule).
   */
  private static async readInviteTeams(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    teams: Array<ToolImportInviteTeam>;
    defaultId: string | null;
  }> {
    const teams: Array<Team> = await TeamService.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true, createdAt: true },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const teamIds: Array<ObjectID> = teams
      .filter((team: Team): boolean => {
        return Boolean(team.id);
      })
      .map((team: Team): ObjectID => {
        return team.id!;
      });

    const refused: Set<string> = new Set<string>(
      (
        await TeamPermissionService.findTeamsCallerCannotGrant({
          teamIds: teamIds,
          projectId: data.projectId,
          props: data.props,
        })
      ).map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    const grantable: Array<InviteTeam> = teams
      .filter((team: Team): boolean => {
        return (
          Boolean(team.id) && !refused.has(team.id!.toString().toLowerCase())
        );
      })
      .map((team: Team): InviteTeam => {
        return { id: team.id!.toString(), name: team.name || "" };
      });

    const permissionRows: Array<TeamPermission> =
      await TeamPermissionService.findBy({
        query: { projectId: data.projectId },
        select: {
          teamId: true,
          permission: true,
          isBlockPermission: true,
          scope: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

    const defaultTeam: InviteTeam | null = pickDefaultInviteTeam({
      teams: grantable,
      permissionRows: permissionRows
        .filter((row: TeamPermission): boolean => {
          return Boolean(row.teamId && row.permission);
        })
        .map((row: TeamPermission): InviteTeamPermissionRow => {
          return {
            teamId: row.teamId!.toString(),
            permission: row.permission as Permission,
            isBlockPermission: Boolean(row.isBlockPermission),
            scope: row.scope,
          };
        }),
      // Every team left is one the person may hand on.
      canGrantAll: (): boolean => {
        return true;
      },
    });

    const ordered: Array<InviteTeam> = defaultTeam
      ? [
          defaultTeam,
          ...grantable.filter((team: InviteTeam): boolean => {
            return team.id !== defaultTeam.id;
          }),
        ]
      : grantable;

    return {
      teams: ordered.map((team: InviteTeam): ToolImportInviteTeam => {
        return { id: team.id, name: team.name };
      }),
      defaultId: defaultTeam?.id || null,
    };
  }
}
