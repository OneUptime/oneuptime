import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import TeamService from "./TeamService";
import Team from "../../Models/DatabaseModels/Team";
import OnCallDutyPolicyEscalationRuleUser from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OnCallDutyPolicyEscalationRuleTeam from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import QueryHelper from "../Types/Database/QueryHelper";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import { FindWhere } from "../../Types/BaseDatabase/Query";
import QueryOperator from "../../Types/BaseDatabase/QueryOperator";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../Utils/Logger";
import ProductAnalytics from "../Utils/ProductAnalytics";
import OnCallDutyPolicyWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Green500 } from "../../Types/BrandColors";
import OnCallDutyPolicyLabelRuleEngineService from "./OnCallDutyPolicyLabelRuleEngineService";
import OnCallDutyPolicyOwnerRuleEngineService from "./OnCallDutyPolicyOwnerRuleEngineService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import TeamMemberService from "./TeamMemberService";
import CreateBy from "../Types/Database/CreateBy";
import CreatePermission from "../Types/Database/Permissions/CreatePermission";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../Types/PositiveNumber";
import { JSONObject } from "../../Types/JSON";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  FIRST_RESPONDER_KEYS,
  FirstResponderIds,
  FirstResponderKey,
  readFirstResponderIds,
} from "../../Types/OnCallDutyPolicy/FirstResponders";

// A join row of a new policy's first escalation rule, and its model.
interface FirstResponderJoin {
  modelType: { new (): BaseModel };
  row: BaseModel;
}

export class Service extends DatabaseService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }

  /*
   * WHO GETS PAGED FIRST.
   *
   * A policy created with first responders in its misc data (the create
   * form's "Who gets paged first?", or an API caller) gets its first
   * escalation rule straight away: Level 1, paging them, waiting 30 minutes
   * for an acknowledgement before the next level - what adding that rule on
   * the Escalation Rules page would have made. With nobody to page, nothing
   * changes: the policy is created without rules, as it always was.
   *
   * The rule is added after the whole create, not in onCreateSuccess: by then
   * the creator owns the policy (DatabaseService.create adds them as an owner
   * after the success hook), so a teammate whose access is limited to the
   * policies they own may add its rules - the rule is created as them, with
   * the same checks, plan limits and notifications as adding it by hand.
   *
   * What can be checked before anything is saved is checked first: the
   * picks' shape, whether the caller may add escalation rules and those
   * responders, and whether every responder belongs to this project. A
   * refused pick refuses the create, so nobody gets a policy that pages
   * nobody when they asked for someone. What fails after the policy is
   * saved is logged, and the policy is kept: it shows on its Escalation
   * Rules page that it has no rules yet.
   */
  @CaptureSpan()
  public override async create(
    createBy: CreateBy<OnCallDutyPolicy>,
  ): Promise<OnCallDutyPolicy> {
    const firstResponders: FirstResponderIds | null = createBy.props
      .ignoreHooks
      ? null
      : readFirstResponderIds(createBy.miscDataProps);

    if (firstResponders) {
      await this.checkFirstRespondersCanBePaged({
        responders: firstResponders,
        projectId: createBy.props.tenantId || createBy.data.projectId,
        props: createBy.props,
      });
    }

    const createdPolicy: OnCallDutyPolicy = await super.create(createBy);

    if (firstResponders) {
      await this.addFirstEscalationRule({
        policy: createdPolicy,
        responders: firstResponders,
        props: createBy.props,
      });
    }

    return createdPolicy;
  }

  /*
   * Refuses first responders that could not be paged, before the policy is
   * saved. Throws; returns nothing.
   */
  @CaptureSpan()
  public async checkFirstRespondersCanBePaged(data: {
    responders: FirstResponderIds;
    projectId: ObjectID | undefined | null;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException(
        "A project is required to page someone from a new on-call policy.",
      );
    }

    const projectId: ObjectID = new ObjectID(data.projectId.toString());

    /*
     * The caller adds the rule and its responders themselves, so they need
     * the permissions adding them by hand needs. The same check the rule's
     * own create runs first (OnCallDutyPolicyChildService), made now so a
     * refusal saves nothing. It passes root and master admin callers through
     * itself.
     */
    const rule: OnCallDutyPolicyEscalationRule = this.getFirstEscalationRule({
      projectId: projectId,
      // Not known yet; any id checks the same column permissions.
      onCallDutyPolicyId: ObjectID.getZeroObjectID(),
    });

    CreatePermission.checkCreatePermissions(
      OnCallDutyPolicyEscalationRule,
      rule,
      data.props,
    );

    for (const key of FIRST_RESPONDER_KEYS) {
      if (data.responders[key].length === 0) {
        continue;
      }

      const join: FirstResponderJoin = this.getFirstResponderJoin({
        key: key,
        projectId: projectId,
        props: data.props,
      });

      CreatePermission.checkCreatePermissions(
        join.modelType,
        join.row,
        data.props,
      );
    }

    // Every responder must be this project's own.
    await this.checkFirstRespondersAreInProject({
      responders: data.responders,
      projectId: projectId,
    });
  }

  /*
   * A join row of the first rule as the rule service writes it for one kind
   * of responder (addUser, addTeam, addOnCallSchedules), with placeholder
   * ids: what the permission check reads is which columns are written.
   */
  private getFirstResponderJoin(data: {
    key: FirstResponderKey;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): FirstResponderJoin {
    const placeholderId: ObjectID = ObjectID.getZeroObjectID();

    let join: FirstResponderJoin;

    if (data.key === "onCallSchedules") {
      const row: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      row.onCallDutyPolicyScheduleId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleSchedule, row };
    } else if (data.key === "teams") {
      const row: OnCallDutyPolicyEscalationRuleTeam =
        new OnCallDutyPolicyEscalationRuleTeam();
      row.teamId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleTeam, row };
    } else {
      const row: OnCallDutyPolicyEscalationRuleUser =
        new OnCallDutyPolicyEscalationRuleUser();
      row.userId = placeholderId;
      join = { modelType: OnCallDutyPolicyEscalationRuleUser, row };
    }

    join.row.setColumnValue("projectId", data.projectId);
    join.row.setColumnValue("onCallDutyPolicyId", placeholderId);
    join.row.setColumnValue("onCallDutyPolicyEscalationRuleId", placeholderId);

    if (data.props.userId) {
      join.row.setColumnValue("createdByUserId", data.props.userId);
    }

    return join;
  }

  /*
   * Teams and on-call schedules of this project, and people who are members
   * of it (a TeamMember row of the project, the list the picker offers). An
   * id that is not - another project's team, a stranger, a deleted schedule
   * - refuses the create rather than page someone outside the project.
   */
  private async checkFirstRespondersAreInProject(data: {
    responders: FirstResponderIds;
    projectId: ObjectID;
  }): Promise<void> {
    const { responders, projectId } = data;

    if (responders.teams.length > 0) {
      const teamsInProject: PositiveNumber = await TeamService.countBy({
        query: {
          _id: QueryHelper.any(responders.teams),
          projectId: projectId,
        },
        props: {
          isRoot: true,
        },
      });

      if (teamsInProject.toNumber() !== responders.teams.length) {
        throw new BadDataException(
          "Some of the teams picked to be paged first are not in this project.",
        );
      }
    }

    if (responders.onCallSchedules.length > 0) {
      const schedulesInProject: PositiveNumber =
        await OnCallDutyPolicyScheduleService.countBy({
          query: {
            _id: QueryHelper.any(responders.onCallSchedules),
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });

      if (schedulesInProject.toNumber() !== responders.onCallSchedules.length) {
        throw new BadDataException(
          "Some of the on-call schedules picked to be paged first are not in this project.",
        );
      }
    }

    if (responders.users.length > 0) {
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: QueryHelper.any(responders.users),
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const members: Set<string> = new Set<string>(
        memberships
          .map((membership: TeamMember): string => {
            return membership.userId?.toString().toLowerCase() || "";
          })
          .filter(Boolean),
      );

      const strangers: Array<string> = responders.users.filter(
        (userId: string): boolean => {
          return !members.has(userId);
        },
      );

      if (strangers.length > 0) {
        throw new BadDataException(
          "Some of the people picked to be paged first are not members of this project.",
        );
      }
    }
  }

  // The first rule as it is created: what the Add Escalation Rule dialog sends.
  private getFirstEscalationRule(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
  }): OnCallDutyPolicyEscalationRule {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();

    rule.projectId = data.projectId;
    rule.onCallDutyPolicyId = data.onCallDutyPolicyId;
    rule.escalateAfterInMinutes = DEFAULT_ESCALATE_AFTER_IN_MINUTES;

    /*
     * No name and no order: the rule service puts it first and calls it
     * after its level, "Level 1" - as it does any rule created without them.
     */
    return rule;
  }

  /*
   * Adds the first escalation rule of a policy just created, paging the
   * first responders. Never throws: the policy is saved already.
   */
  @CaptureSpan()
  public async addFirstEscalationRule(data: {
    policy: OnCallDutyPolicy;
    responders: FirstResponderIds;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const policyId: ObjectID | null | undefined = data.policy.id;
    const projectId: ObjectID | undefined = data.policy.projectId;

    try {
      if (!policyId || !projectId) {
        throw new BadDataException(
          "The new on-call policy has no id or project.",
        );
      }

      /*
       * The responders go to the rule as its own create takes them: the
       * rule's create hook turns these lists into its join rows.
       */
      const miscDataProps: JSONObject = {
        onCallSchedules: data.responders.onCallSchedules.map(
          (id: string): ObjectID => {
            return new ObjectID(id);
          },
        ),
        teams: data.responders.teams.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        users: data.responders.users.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      };

      await OnCallDutyPolicyEscalationRuleService.create({
        data: this.getFirstEscalationRule({
          projectId: new ObjectID(projectId.toString()),
          onCallDutyPolicyId: new ObjectID(policyId.toString()),
        }),
        miscDataProps: miscDataProps,
        props: data.props,
      });
    } catch (error) {
      logger.error(
        `Error adding the first escalation rule of a new on-call policy in OnCallDutyPolicyService.addFirstEscalationRule: ${error}`,
        {
          projectId: projectId?.toString(),
          onCallDutyPolicyId: policyId?.toString(),
        } as LogAttributes,
      );
    }
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<OnCallDutyPolicy>,
    createdItem: OnCallDutyPolicy,
  ): Promise<OnCallDutyPolicy> {
    if (!createdItem.id) {
      throw new BadDataException("On Call Policy id not found.");
    }

    // Activation event for marketing funnels.
    ProductAnalytics.captureForUser({
      userId: onCreate.createBy.props.userId || createdItem.createdByUserId,
      event: "server/on_call_policy_created",
      properties: {
        project_id: createdItem.projectId?.toString() || "",
      },
    });

    if (createdItem.projectId) {
      try {
        await OnCallDutyPolicyLabelRuleEngineService.applyRulesToOnCallDutyPolicy(
          createdItem,
        );
        await OnCallDutyPolicyOwnerRuleEngineService.applyRulesToOnCallDutyPolicy(
          createdItem,
        );
      } catch (error) {
        logger.error(
          `Error applying on-call duty policy rules in OnCallDutyPolicyService.onCreateSuccess: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            onCallDutyPolicyId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      }
    }

    const onCallPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: createdItem.id,
      select: {
        projectId: true,
        name: true,
        description: true,
        labels: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!onCallPolicy) {
      throw new BadDataException("On Call Policy not found.");
    }

    const createdByUserId: ObjectID | undefined | null =
      createdItem.createdByUserId || createdItem.createdByUser?.id;

    let feedInfoInMarkdown: string = `#### 📞 On Call Policy Created: 
              
**${onCallPolicy.name || "No name provided."}**:
    
${onCallPolicy.description || "No description provided."}
        
`;

    if (onCallPolicy?.labels && onCallPolicy.labels.length > 0) {
      feedInfoInMarkdown += `🏷️ **Labels**:\n`;

      for (const label of onCallPolicy.labels) {
        feedInfoInMarkdown += `- ${label.name}\n`;
      }

      feedInfoInMarkdown += `\n\n`;
    }

    // send message to workspaces - slack, teams,   etc.
    const workspaceResult: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await OnCallDutyPolicyWorkspaceMessages.createChannelsAndInviteUsersToChannels(
        {
          projectId: onCallPolicy.projectId!,
          onCallDutyPolicyId: onCallPolicy.id!,
          onCallDutyPolicyName: onCallPolicy.name!,
        },
      );

    if (workspaceResult && workspaceResult.channelsCreated?.length > 0) {
      // update incident with these channels.
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          postUpdatesToWorkspaceChannels: workspaceResult.channelsCreated || [],
        },
        props: {
          isRoot: true,
        },
      });
    }

    const onCallDutyPolicyCreateMessageBlocks: Array<MessageBlocksByWorkspaceType> =
      await OnCallDutyPolicyWorkspaceMessages.getOnCallDutyPolicyCreateMessageBlocks(
        {
          onCallDutyPolicyId: createdItem.id!,
          projectId: createdItem.projectId!,
        },
      );

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: createdItem.id!,
      projectId: createdItem.projectId!,
      onCallDutyPolicyFeedEventType:
        OnCallDutyPolicyFeedEventType.OnCallDutyPolicyCreated,
      displayColor: Green500,
      feedInfoInMarkdown: feedInfoInMarkdown,
      userId: createdByUserId || undefined,
      workspaceNotification: {
        appendMessageBlocks: onCallDutyPolicyCreateMessageBlocks,
        sendWorkspaceNotification: true,
      },
    });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicy>,
  ): Promise<OnDelete<OnCallDutyPolicy>> {
    if (deleteBy.query._id) {
      let projectId: FindWhere<ObjectID> | QueryOperator<ObjectID> | undefined =
        deleteBy.query.projectId || deleteBy.props.tenantId;

      if (!projectId) {
        // fetch this onCallDutyPolicy from the database to get the projectId.
        const onCallDutyPolicy: OnCallDutyPolicy | null =
          await this.findOneById({
            id: new ObjectID(deleteBy.query._id as string) as ObjectID,
            select: {
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!onCallDutyPolicy) {
          throw new BadDataException("OnCallDutyPolicy not found.");
        }

        if (!onCallDutyPolicy.id) {
          throw new BadDataException("OnCallDutyPolicy id not found.");
        }

        projectId = onCallDutyPolicy.projectId!;
      }

      try {
        await WorkspaceNotificationRuleService.archiveWorkspaceChannels({
          projectId: projectId as ObjectID,
          notificationFor: {
            onCallDutyPolicyId: new ObjectID(
              deleteBy.query._id as string,
            ) as ObjectID,
          },
          sendMessageBeforeArchiving: {
            _type: "WorkspacePayloadMarkdown",
            text: `🗑️ This on-call policy is deleted. The channel is being archived.`,
          },
        });
      } catch (error) {
        logger.error(
          `Error while archiving workspace channels for onCallDutyPolicy ${deleteBy.query._id}: ${error}`,
          { projectId: (projectId as ObjectID)?.toString() } as LogAttributes,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async getWorkspaceChannelForOnCallDutyPolicy(data: {
    onCallDutyPolicyId: ObjectID;
    workspaceType?: WorkspaceType | null;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    const onCallDutyPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: data.onCallDutyPolicyId,
      select: {
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!onCallDutyPolicy) {
      throw new BadDataException("OnCallDutyPolicy not found.");
    }

    return (onCallDutyPolicy.postUpdatesToWorkspaceChannels || []).filter(
      (channel: NotificationRuleWorkspaceChannel) => {
        if (!data.workspaceType) {
          return true;
        }

        return channel.workspaceType === data.workspaceType;
      },
    );
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyLinkInDashboard(
    projectId: ObjectID,
    onCallDutyPolicyId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}`,
    );
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyName(data: {
    onCallDutyPolicyId: ObjectID;
  }): Promise<string | null> {
    const { onCallDutyPolicyId } = data;

    const onCallDutyPolicy: OnCallDutyPolicy | null = await this.findOneById({
      id: onCallDutyPolicyId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return onCallDutyPolicy && onCallDutyPolicy.name
      ? onCallDutyPolicy.name.toString()
      : null;
  }

  @CaptureSpan()
  public async executePolicy(
    policyId: ObjectID,
    options: {
      triggeredByIncidentId?: ObjectID | undefined;
      triggeredByAlertId?: ObjectID | undefined;
      triggeredByAlertEpisodeId?: ObjectID | undefined;
      triggeredByIncidentEpisodeId?: ObjectID | undefined;
      userNotificationEventType: UserNotificationEventType;
    },
  ): Promise<void> {
    // execute this policy

    if (
      UserNotificationEventType.IncidentCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentId
    ) {
      throw new BadDataException(
        "triggeredByIncidentId is required when userNotificationEventType is IncidentCreated",
      );
    }

    if (
      UserNotificationEventType.AlertCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertId
    ) {
      throw new BadDataException(
        "triggeredByAlertId is required when userNotificationEventType is AlertCreated",
      );
    }

    if (
      UserNotificationEventType.AlertEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByAlertEpisodeId
    ) {
      throw new BadDataException(
        "triggeredByAlertEpisodeId is required when userNotificationEventType is AlertEpisodeCreated",
      );
    }

    if (
      UserNotificationEventType.IncidentEpisodeCreated ===
        options.userNotificationEventType &&
      !options.triggeredByIncidentEpisodeId
    ) {
      throw new BadDataException(
        "triggeredByIncidentEpisodeId is required when userNotificationEventType is IncidentEpisodeCreated",
      );
    }

    const policy: OnCallDutyPolicy | null = await this.findOneById({
      id: policyId,
      select: {
        _id: true,
        projectId: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!policy) {
      throw new BadDataException(
        `On-Call Duty Policy with id ${policyId.toString()} not found`,
      );
    }

    /*
     * An archived policy pages no one. Its execution log is still written -
     * with the reason, and without the hooks that would start escalating or
     * post "started executing" to the incident - so the incident's on-call
     * tab says why nobody was paged instead of showing nothing.
     */
    const isPolicyArchived: boolean = policy.isArchived === true;

    // add policy log.
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    log.projectId = policy.projectId!;
    log.onCallDutyPolicyId = policyId;
    log.userNotificationEventType = options.userNotificationEventType;
    log.statusMessage = isPolicyArchived
      ? ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE
      : "Scheduled.";
    log.status = isPolicyArchived
      ? OnCallDutyPolicyStatus.Error
      : OnCallDutyPolicyStatus.Scheduled;

    if (options.triggeredByIncidentId) {
      log.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      log.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      log.triggeredByAlertEpisodeId = options.triggeredByAlertEpisodeId;
    }

    if (options.triggeredByIncidentEpisodeId) {
      log.triggeredByIncidentEpisodeId = options.triggeredByIncidentEpisodeId;
    }

    if (isPolicyArchived) {
      logger.debug(
        `On-call policy ${policyId.toString()} is archived. Recording a skipped execution instead of paging.`,
        { projectId: policy.projectId?.toString() } as LogAttributes,
      );

      // The repeat counter onBeforeCreate would otherwise have seeded.
      log.onCallPolicyExecutionRepeatCount = 1;

      await OnCallDutyPolicyExecutionLogService.create({
        data: log,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      return;
    }

    await OnCallDutyPolicyExecutionLogService.create({
      data: log,
      props: {
        isRoot: true,
      },
    });
  }

  public async getOnCallPoliciesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<{
    escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser>;
    escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam>;
    escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule>;
  }> {
    // get all schedules where user is on call duty.
    const onCallSchedules: Array<OnCallDutyPolicySchedule> =
      await OnCallDutyPolicyScheduleService.getOnCallSchedulesWhereUserIsOnCallDuty(
        data,
      );

    const teams: Array<Team> = await TeamService.getTeamsUserIsAPartOf({
      userId: data.userId,
      projectId: data.projectId,
    });

    // get escalationPolicies by user, team and schedule.
    const escalationRulesByUser: Array<OnCallDutyPolicyEscalationRuleUser> =
      await OnCallDutyPolicyEscalationRuleUserService.findBy({
        query: {
          userId: data.userId!,
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // do the same for teams.
    const escalationRulesByTeam: Array<OnCallDutyPolicyEscalationRuleTeam> =
      await OnCallDutyPolicyEscalationRuleTeamService.findBy({
        query: {
          teamId: QueryHelper.any(
            teams.map((team: Team) => {
              return team.id!;
            }),
          ),
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          team: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // do the same for schedules.
    const escalationRulesBySchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: QueryHelper.any(
            onCallSchedules.map((schedule: OnCallDutyPolicySchedule) => {
              return schedule.id!;
            }),
          ),
          projectId: data.projectId!,
        },
        select: {
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicySchedule: {
            name: true,
            _id: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return {
      escalationRulesByUser: escalationRulesByUser,
      escalationRulesByTeam: escalationRulesByTeam,
      escalationRulesBySchedule: escalationRulesBySchedule,
    };
  }
}
export default new Service();
