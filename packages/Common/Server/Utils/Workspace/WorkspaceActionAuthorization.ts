import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AccessTokenService from "../../Services/AccessTokenService";
import DatabaseService from "../../Services/DatabaseService";
import ProjectService from "../../Services/ProjectService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserService from "../../Services/UserService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import ColumnWriteRefusedException from "../../Types/Database/Permissions/ColumnWriteRefusedException";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import Sort from "../../Types/Database/Sort";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CallerPlan from "../Billing/CallerPlan";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import logger from "../Logger";
import { shouldBypassRecordPrivacy } from "../PrivacyFilterUtil";
import { applyIncidentSelfPrivacyFilter } from "../Incident/IncidentPrivacyFilter";
import { applyAlertSelfPrivacyFilter } from "../Alert/AlertPrivacyFilter";
import { applyIncidentEpisodeSelfPrivacyFilter } from "../IncidentEpisode/IncidentEpisodePrivacyFilter";
import { applyAlertEpisodeSelfPrivacyFilter } from "../AlertEpisode/AlertEpisodePrivacyFilter";
import PrivateRecordWriteCheck from "../Permission/PrivateRecordWriteCheck";

/*
 * A resource a chat action is performed against: the incident being
 * acknowledged, the on-call policy being executed.
 */
export interface WorkspaceActionResource {
  // The service that owns the resource, e.g. IncidentService.
  service: DatabaseService<DatabaseBaseModel>;
  id: ObjectID;
  /*
   * What the action needs of the record besides its id - the state an
   * incident is in, say - read in the same read that checks the member may
   * read it (assertCanCreateAndRead), so nothing reads it again.
   */
  select?: Select<DatabaseBaseModel> | undefined;
}

// A table's rule for its private records, added to a query of it.
type SelfPrivacyFilter = <TQuery>(
  query: TQuery,
  props: DatabaseCommonInteractionProps,
) => TQuery;

/*
 * The tables that hold private records - an incident, an alert or an
 * episode marked private - by table name, with the rule every read of them
 * as a person follows: a private record is read only by its owners and by
 * those who see every private record of the project.
 */
const PRIVACY_FILTERS: Record<string, SelfPrivacyFilter> = {
  Incident: applyIncidentSelfPrivacyFilter,
  Alert: applyAlertSelfPrivacyFilter,
  IncidentEpisode: applyIncidentEpisodeSelfPrivacyFilter,
  AlertEpisode: applyAlertEpisodeSelfPrivacyFilter,
};

/*
 * Slack and Microsoft Teams actions (buttons, modals, cards, emoji reactions)
 * are signed by the workspace, not by a OneUptime session. The only link to a
 * OneUptime user is the WorkspaceUserAuthToken row written when that user
 * connected their chat account, and that row says nothing about what they may
 * do in the project today: it survives a downgrade to a read-only role, and it
 * used to survive removal from the project as well.
 *
 * So a chat action runs as the member the account is connected to, with the
 * props the dashboard would use for them (getProjectMemberProps), and what it
 * changes it changes with those props (WorkspaceMemberActions, the note
 * services' addNote): the write is held to the same rules as the API. Before
 * it, the action asks this class, for an answer it can tell them in their
 * own words before anything about the record is read out to them:
 *
 *   1. the user holds an accepted membership in the project, read from the
 *      database rather than from the permission cache,
 *   2. their project permissions allow creating the row the action writes.
 *      The dashboard writes that same row through the API with those
 *      permissions: an IncidentStateTimeline to acknowledge, resolve or change
 *      state, an IncidentPublicNote for a public note, an
 *      OnCallDutyPolicyExecutionLog to page an on-call policy, and so on,
 *   3. every resource the action names is one the user can read in THIS
 *      project, under their label, owner and privacy scoping.
 *
 * A refusal says what is actually wrong, and what to do about it, in words
 * the chat shows them (getUnreadableRefusal): the permission they lack, a
 * record that is private, one their access does not include, or one that
 * is not there at all - never "not found" for a record that is there.
 */
export default class WorkspaceActionAuthorization {
  public static readonly NOT_A_PROJECT_MEMBER_MESSAGE: string =
    "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.";

  /*
   * What a record is answered with, after "You do not have permission to
   * <action>: ", when the member may read records of its kind but their
   * access does not include this one - their role is limited to some
   * labels, or to what they or their teams own, or a team of theirs is
   * blocked from it. The record is the one the chat showed them: that it is
   * there is nothing new to them, and nothing else about it is told.
   */
  public static getNotIncludedReason(noun: string): string {
    return `your access in this project does not include this ${noun}. Ask a project admin for access to it.`;
  }

  /*
   * The same, for a private record (an incident, an alert or an episode)
   * the member is not an owner of: only its owners, and the project's
   * owners and admins, see it.
   */
  public static getPrivateReason(noun: string): string {
    return `this ${noun} is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner.`;
  }

  /*
   * The same, for a private record the member sees - they own it, or a team
   * of theirs does - but may not change this way: a private incident, alert
   * or episode is changed only with the permissions of the teams that own it
   * and of the people named as its owners (PrivateRecordPermission), and
   * none of those lets them. Another of their teams' permission reaches none
   * of it.
   */
  public static getPrivateWriteReason(noun: string): string {
    return `this ${noun} is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this. Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.`;
  }

  /*
   * What a record that is not in the project at all is answered with, after
   * "Could not <action>: ": deleted since the message was posted, say.
   */
  public static getNotFoundReason(noun: string): string {
    return `the ${noun} was not found. It may have been deleted.`;
  }

  @CaptureSpan()
  public static async isProjectMember(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const teamIds: Array<ObjectID> = await this.getAcceptedTeamIds(data);
    return teamIds.length > 0;
  }

  /*
   * The props a chat user acts with in a project, built the way the dashboard
   * builds them for a signed-in request: global permission, tenant permission
   * and accepted team ids (for the Owned permission scope). Throws
   * NotAuthorizedException when the user is not a member of the project.
   */
  @CaptureSpan()
  public static async getProjectMemberProps(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps> {
    const { userId, projectId } = data;

    /*
     * Membership comes straight from TeamMember. Neither the tenant permission
     * cache (Redis) nor TeamMemberService.getTeamIdsForUser (in-process) is
     * guaranteed to have seen a removal made through another process.
     */
    const userTeamIds: Array<ObjectID> = await this.getAcceptedTeamIds(data);

    if (userTeamIds.length === 0) {
      throw new NotAuthorizedException(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    }

    /*
     * A project a master admin blocked: a member acts in it from chat no
     * more than from the dashboard, and is told why - as a refusal, which
     * the chat answers in the member's own words, where any other error
     * would read "try again in a minute". Asked after membership, so
     * somebody who is not a member is told only that.
     */
    if (await ProjectService.isProjectBlocked(projectId)) {
      throw new NotAuthorizedException(ExceptionMessages.ProjectBlocked);
    }

    /*
     * A person a master admin blocked: blocking ends their sessions, but
     * their memberships and chat links stay, so without this they went on
     * acknowledging incidents, paging on-call and asking OneUptime AI from
     * Slack and Microsoft Teams - as an MCP client of theirs may not
     * (McpDelegationAuthorization, McpOAuthGrantAccess).
     */
    if (await UserService.isUserBlocked(userId)) {
      throw new NotAuthorizedException(ExceptionMessages.UserBlocked);
    }

    const userGlobalAccessPermission: UserGlobalAccessPermission | null =
      await AccessTokenService.getUserGlobalAccessPermission(userId);

    const userTenantAccessPermission: UserTenantAccessPermission | null =
      await AccessTokenService.getUserTenantAccessPermission(
        userId,
        projectId,
        {
          userGlobalAccessPermission: userGlobalAccessPermission,
        },
      );

    if (!userTenantAccessPermission) {
      throw new NotAuthorizedException(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    }

    return await WorkspaceActionAuthorization.withProjectPlan({
      userId: userId,
      tenantId: projectId,
      userGlobalAccessPermission: userGlobalAccessPermission || undefined,
      userTenantAccessPermission: {
        [projectId.toString()]: userTenantAccessPermission,
      },
      userTeamIds: userTeamIds,
    });
  }

  /*
   * The member's props with their project's plan, as a dashboard request
   * carries it (CommonAPI, CallerPlan.withPlan): on OneUptime Cloud every
   * plan check an action meets - in DatabaseService and in a service's own
   * check alike, such as the one a page from chat makes before anything is
   * read (OnCallPageService) - reads the plan from them. Props without it
   * are refused wherever a plan decides ("OneUptime could not confirm which
   * plan this project is on"), which paging from Slack was, for every
   * project on Cloud. Billing off: the props come back as they are.
   *
   * A plan that cannot be read refuses the action with that sentence, as
   * every API request of the project is refused then - never "any plan".
   */
  private static async withProjectPlan(
    props: DatabaseCommonInteractionProps,
  ): Promise<DatabaseCommonInteractionProps> {
    try {
      return await CallerPlan.withPlan(props);
    } catch (err) {
      logger.error("Could not read the plan of a project for a chat action.", {
        projectId: props.tenantId?.toString(),
      });
      logger.error(err, { projectId: props.tenantId?.toString() });

      throw new NotAuthorizedException(CallerPlan.PLAN_UNKNOWN_MESSAGE);
    }
  }

  /*
   * Throws NotAuthorizedException, with a message fit to show the user in
   * chat, unless `props` may create a `modelType` row and read every one of
   * `resources` in props.tenantId. `action` completes "You do not have
   * permission to ...", e.g. "acknowledge this incident".
   */
  @CaptureSpan()
  public static async assertCanCreate(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    action: string;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<void> {
    await this.assertCanCreateAndRead(data);
  }

  /*
   * assertCanCreate, handing back the records it read to check `resources`
   * - one per resource, in the order given, each with the columns its
   * `select` asks for - so the action that follows writes from them instead
   * of reading them again (WorkspaceMemberActions.authorize).
   */
  @CaptureSpan()
  public static async assertCanCreateAndRead(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    action: string;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<Array<DatabaseBaseModel>> {
    const { props, modelType, action } = data;
    const projectId: ObjectID | undefined = props.tenantId;

    if (!props.userId || !projectId) {
      throw new NotAuthorizedException(
        `You do not have permission to ${action}.`,
      );
    }

    try {
      /*
       * Checked on the project's plan where a plan decides the create, as
       * the create itself is (CallerPlan) - never on "no plan".
       */
      ModelPermission.checkCreatePermissions(
        modelType,
        new modelType(),
        await CallerPlan.withPlanFor({
          props: props,
          modelType: modelType,
          type: DatabaseRequestType.Create,
        }),
      );
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          `You do not have permission to ${action}. ${err.message}`,
        );
      }

      throw err;
    }

    const readableResources: Array<DatabaseBaseModel> = [];

    for (const resource of data.resources || []) {
      let readableResource: DatabaseBaseModel | null = null;
      let readError: unknown = undefined;

      try {
        readableResource = await resource.service.findOneBy({
          query: {
            _id: resource.id.toString(),
            projectId: projectId,
          } as Query<DatabaseBaseModel>,
          select: {
            ...(resource.select || {}),
            _id: true,
          } as Select<DatabaseBaseModel>,
          props: props,
        });
      } catch (err) {
        if (!(err instanceof NotAuthorizedException)) {
          throw err;
        }

        readError = err;
      }

      if (!readableResource) {
        throw await WorkspaceActionAuthorization.getUnreadableRefusal({
          action: action,
          service: resource.service,
          id: resource.id,
          props: props,
          readError: readError,
        });
      }

      // A private record they see, that this row is no write of theirs on.
      await WorkspaceActionAuthorization.assertReachesPrivateRecord({
        props: props,
        modelType: modelType,
        type: DatabaseRequestType.Create,
        service: resource.service,
        id: resource.id,
        action: action,
      });

      readableResources.push(readableResource);
    }

    return readableResources;
  }

  /*
   * Throws NotAuthorizedException, worded for the chat, when `type` on
   * `modelType` - a private incident, alert or episode itself, or a part of
   * one: its state timeline, a note, a role - would not reach the record
   * `id` of `service`'s kind for this member, who may read it: it is
   * private, and neither they nor a team of theirs granting the write owns
   * it (PrivateRecordWriteCheck). The write itself is held to the same rule;
   * asked first, the member is told why before anything is written. A write
   * of anything else is not this rule's to answer.
   */
  @CaptureSpan()
  public static async assertReachesPrivateRecord(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    service: DatabaseService<DatabaseBaseModel>;
    id: ObjectID;
    action: string;
  }): Promise<void> {
    const reaches: boolean = await PrivateRecordWriteCheck.reaches({
      modelType: data.modelType,
      type: data.type,
      recordService: data.service,
      recordId: data.id,
      props: data.props,
    });

    if (reaches) {
      return;
    }

    const noun: string = (
      data.service.getModel().singularName || "record"
    ).toLowerCase();

    throw new NotAuthorizedException(
      `You do not have permission to ${data.action}: ${WorkspaceActionAuthorization.getPrivateWriteReason(noun)}`,
    );
  }

  /*
   * THE REFUSAL OF A RECORD THE MEMBER COULD NOT READ, saying what is
   * actually wrong and what to do (a record of the project in `props`):
   *
   *   - their role may not read records of its kind at all: the read's own
   *     refusal, which names the permissions that would let them;
   *   - it is not in the project: not found - it may have been deleted;
   *   - it is private, and they are not one of its owners: so, and who to
   *     ask to add them;
   *   - otherwise their access does not include it - limited to some
   *     labels, or to what they or their teams own: so, and to ask a
   *     project admin.
   *
   * `readError` is the member's read's own refusal, when it threw one. Only
   * the record's id and its project are read here, as OneUptime: nothing
   * the member may not read is told to them. A refusal of the read for the
   * plan is the plan's refusal, as it was thrown.
   */
  @CaptureSpan()
  public static async getUnreadableRefusal<
    TBaseModel extends DatabaseBaseModel,
  >(data: {
    // Completes "You do not have permission to ...": "acknowledge this incident".
    action: string;
    service: DatabaseService<TBaseModel>;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
    readError?: unknown;
  }): Promise<Error> {
    const props: DatabaseCommonInteractionProps = data.props;
    const service: DatabaseService<DatabaseBaseModel> =
      data.service as unknown as DatabaseService<DatabaseBaseModel>;
    const projectId: ObjectID | undefined = props.tenantId;

    if (data.readError instanceof PaymentRequiredException) {
      return data.readError;
    }

    if (data.readError instanceof NotAuthorizedException) {
      return new NotAuthorizedException(
        `You do not have permission to ${data.action}. ${data.readError.message}`,
      );
    }

    const noun: string = (
      service.getModel().singularName || "record"
    ).toLowerCase();

    if (!projectId) {
      return new NotAuthorizedException(
        `You do not have permission to ${data.action}.`,
      );
    }

    const query: Query<DatabaseBaseModel> = {
      _id: data.id.toString(),
      projectId: projectId,
    } as Query<DatabaseBaseModel>;

    const record: DatabaseBaseModel | null = await service.findOneBy({
      query: query,
      select: {
        _id: true,
      } as Select<DatabaseBaseModel>,
      props: {
        isRoot: true,
      },
    });

    if (!record) {
      return new NotAuthorizedException(
        `Could not ${data.action}: ${WorkspaceActionAuthorization.getNotFoundReason(noun)}`,
      );
    }

    const privacyFilter: SelfPrivacyFilter | undefined =
      PRIVACY_FILTERS[service.getModel().tableName || ""];

    if (privacyFilter && !shouldBypassRecordPrivacy(props)) {
      // Read as OneUptime under the member's rule for private records.
      const visible: DatabaseBaseModel | null = await service.findOneBy({
        query: privacyFilter(
          {
            _id: data.id.toString(),
            projectId: projectId,
          } as Query<DatabaseBaseModel>,
          props,
        ),
        select: {
          _id: true,
        } as Select<DatabaseBaseModel>,
        props: {
          isRoot: true,
        },
      });

      if (!visible) {
        return new NotAuthorizedException(
          `You do not have permission to ${data.action}: ${WorkspaceActionAuthorization.getPrivateReason(noun)}`,
        );
      }
    }

    return new NotAuthorizedException(
      `You do not have permission to ${data.action}: ${WorkspaceActionAuthorization.getNotIncludedReason(noun)}`,
    );
  }

  /*
   * Throws NotAuthorizedException, worded for the chat, unless `props` may
   * change the columns `data` names on `modelType` rows in props.tenantId -
   * the table's update permission, each column's, and the plan where a plan
   * decides it - as the update itself would check them: an incident's
   * severity or custom fields, from chat. `action` completes "You do not
   * have permission to ...", e.g. "change the severity of this incident".
   * A column their role may not write is refused the same way: to the API
   * it is bad data (ColumnWriteRefusedException), to a member pressing a
   * button it is a permission they lack. Which rows they may change - their
   * labels and owners - the update itself holds them to.
   */
  @CaptureSpan()
  public static async assertCanUpdate(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    data: Record<string, unknown>;
    action: string;
  }): Promise<void> {
    const { props, modelType, action } = data;
    const projectId: ObjectID | undefined = props.tenantId;

    if (!props.userId || !projectId) {
      throw new NotAuthorizedException(
        `You do not have permission to ${action}.`,
      );
    }

    try {
      await ModelPermission.checkUpdateQueryPermissions(
        modelType,
        {
          projectId: projectId,
        } as Query<DatabaseBaseModel>,
        data.data as never,
        props,
      );
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof ColumnWriteRefusedException
      ) {
        throw new NotAuthorizedException(
          `You do not have permission to ${action}. ${err.message}`,
        );
      }

      throw err;
    }
  }

  /*
   * getProjectMemberProps followed by assertCanCreate. Returns the user's
   * props so the caller can pass them on to anything else it writes.
   */
  @CaptureSpan()
  public static async authorize(data: {
    userId: ObjectID;
    projectId: ObjectID;
    modelType: DatabaseBaseModelType;
    action: string;
    resources?: Array<WorkspaceActionResource> | undefined;
  }): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps =
      await this.getProjectMemberProps({
        userId: data.userId,
        projectId: data.projectId,
      });

    await this.assertCanCreate({
      props: props,
      modelType: data.modelType,
      action: data.action,
      resources: data.resources,
    });

    return props;
  }

  /*
   * THE RECORDS A CHAT FORM OFFERS ITS USER: the severities, monitors,
   * monitor statuses, on-call policies and labels a "new incident" form
   * lists, the monitors and labels of a "new maintenance event" form, the
   * on-call policies an "execute on-call policy" form lists. They are read
   * with that user's own props (getProjectMemberProps), as the dashboard
   * reads the same lists for them - in the project, under their labels,
   * owners and blocks - so a form never names a record its user could not
   * pick in OneUptime. A user who may not read that kind of record at all
   * (or whose plan does not include it) is offered none of it: the read is
   * refused, and answered with an empty list. Anything else that fails is
   * the caller's to answer. What the user then submits is checked by the
   * create itself, made with the same props.
   */
  @CaptureSpan()
  public static async findReadable<TBaseModel extends DatabaseBaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    props: DatabaseCommonInteractionProps;
    query: Query<TBaseModel>;
    select: Select<TBaseModel>;
    sort?: Sort<TBaseModel> | undefined;
    limit: number;
  }): Promise<Array<TBaseModel>> {
    try {
      return await data.service.findBy({
        query: data.query,
        select: data.select,
        sort: data.sort,
        limit: data.limit,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (WorkspaceActionAuthorization.isReadRefusal(err)) {
        return [];
      }

      throw err;
    }
  }

  /*
   * How many records of a kind a chat form's user may read (findReadable's
   * count): for a form that lists the first ones and says how many it left
   * out. A refused read counts none.
   */
  @CaptureSpan()
  public static async countReadable<
    TBaseModel extends DatabaseBaseModel,
  >(data: {
    service: DatabaseService<TBaseModel>;
    props: DatabaseCommonInteractionProps;
    query: Query<TBaseModel>;
  }): Promise<number> {
    try {
      return (
        await data.service.countBy({
          query: data.query,
          props: data.props,
        })
      ).toNumber();
    } catch (err) {
      if (WorkspaceActionAuthorization.isReadRefusal(err)) {
        return 0;
      }

      throw err;
    }
  }

  // A read refused for its caller: no permission, or not on the plan.
  public static isReadRefusal(err: unknown): boolean {
    return (
      err instanceof NotAuthorizedException ||
      err instanceof PaymentRequiredException
    );
  }

  private static async getAcceptedTeamIds(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        hasAcceptedInvitation: true,
      },
      select: {
        teamId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const teamIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const membership of memberships) {
      const teamId: ObjectID | undefined = membership.teamId;

      if (teamId && !seen.has(teamId.toString())) {
        seen.add(teamId.toString());
        teamIds.push(teamId);
      }
    }

    return teamIds;
  }
}
