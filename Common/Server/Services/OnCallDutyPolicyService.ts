import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
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
import logger from "../Utils/Logger";
import OnCallDutyPolicyWorkspaceMessages from "../Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Green500 } from "../../Types/BrandColors";

export class Service extends DatabaseService<OnCallDutyPolicy> {
  public constructor() {
    super(OnCallDutyPolicy);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<OnCallDutyPolicy>,
    createdItem: OnCallDutyPolicy,
  ): Promise<OnCallDutyPolicy> {
    if (!createdItem.id) {
      throw new BadDataException("On Call Policy id not found.");
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
        "triggeredByAlertId is required when userNotificationEventType is IncidentCreated",
      );
    }

    const policy: OnCallDutyPolicy | null = await this.findOneById({
      id: policyId,
      select: {
        _id: true,
        projectId: true,
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

    // add policy log.
    const log: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();

    log.projectId = policy.projectId!;
    log.onCallDutyPolicyId = policyId;
    log.userNotificationEventType = options.userNotificationEventType;
    log.statusMessage = "Scheduled.";
    log.status = OnCallDutyPolicyStatus.Scheduled;

    if (options.triggeredByIncidentId) {
      log.triggeredByIncidentId = options.triggeredByIncidentId;
    }

    if (options.triggeredByAlertId) {
      log.triggeredByAlertId = options.triggeredByAlertId;
    }

    if (options.triggeredByAlertEpisodeId) {
      log.triggeredByAlertEpisodeId = options.triggeredByAlertEpisodeId;
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
