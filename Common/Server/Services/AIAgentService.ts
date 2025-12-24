import User from "../../Models/DatabaseModels/User";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import Model, {
  AIAgentConnectionStatus,
} from "../../Models/DatabaseModels/AIAgent";
import AIAgentOwnerUser from "../../Models/DatabaseModels/AIAgentOwnerUser";
import AIAgentOwnerUserService from "./AIAgentOwnerUserService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import AIAgentOwnerTeam from "../../Models/DatabaseModels/AIAgentOwnerTeam";
import AIAgentOwnerTeamService from "./AIAgentOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import BadDataException from "../../Types/Exception/BadDataException";
import ProjectService from "./ProjectService";
import Dictionary from "../../Types/Dictionary";
import OneUptimeDate from "../../Types/Date";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import logger from "../Utils/Logger";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import { SMSMessage } from "../../Types/SMS/SMS";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import UpdateBy from "../Types/Database/UpdateBy";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { IsBillingEnabled } from "../EnvironmentConfig";
import GlobalCache from "../Infrastructure/GlobalCache";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public async saveLastAliveInCache(
    aiAgentId: ObjectID,
    lastAlive: Date,
  ): Promise<void> {
    if (!aiAgentId) {
      throw new BadDataException("aiAgentId is required");
    }

    try {
      await GlobalCache.setString(
        "ai-agent-last-alive",
        aiAgentId.toString(),
        OneUptimeDate.toString(lastAlive),
      );
    } catch (err) {
      logger.error("Error in saving last alive in cache");
      logger.error(err);
    }
  }

  public async shouldSaveLastAlive(aiAgentId: ObjectID): Promise<boolean> {
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      // before we hit the database, we need to check if the lastAlive was updated in Global Cache.
      const previousLastAliveCheck: string | null = await GlobalCache.getString(
        "ai-agent-last-alive",
        aiAgentId.toString(),
      );

      if (!previousLastAliveCheck) {
        await this.saveLastAliveInCache(aiAgentId, now);
        return true;
      }

      const previousLastAliveCheckDate: Date | null = OneUptimeDate.fromString(
        previousLastAliveCheck,
      );

      // if this date is within 30 seconds of current date, then we will not update the last alive.
      if (previousLastAliveCheckDate) {
        const diff: number = OneUptimeDate.getDifferenceInSeconds(
          now,
          previousLastAliveCheckDate,
        );

        if (diff < 30) {
          return false;
        }
      }

      await this.saveLastAliveInCache(aiAgentId, now);
    } catch (err) {
      // failed to hit the cache, so we will hit the database
      logger.error("Error in getting last alive from cache");
      logger.error(err);
    }

    return true;
  }

  public async updateLastAlive(aiAgentId: ObjectID): Promise<void> {
    if (!aiAgentId) {
      throw new BadDataException("aiAgentId is required");
    }

    const shouldSaveLastAlive: boolean =
      await this.shouldSaveLastAlive(aiAgentId);

    if (!shouldSaveLastAlive) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    await this.updateOneById({
      id: aiAgentId,
      data: {
        lastAlive: now,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    if (!createBy.data.aiAgentVersion) {
      createBy.data.aiAgentVersion = new Version("1.0.0");
    }

    return { createBy: createBy, carryForward: [] };
  }

  @CaptureSpan()
  public async getOwners(aiAgentId: ObjectID): Promise<Array<User>> {
    if (!aiAgentId) {
      throw new BadDataException("aiAgentId is required");
    }

    const ownerUsers: Array<AIAgentOwnerUser> =
      await AIAgentOwnerUserService.findBy({
        query: {
          aiAgentId: aiAgentId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<AIAgentOwnerTeam> =
      await AIAgentOwnerTeamService.findBy({
        query: {
          aiAgentId: aiAgentId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: AIAgentOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: AIAgentOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: any = {
      aiAgentsToNotifyOwners: [],
    };

    if (updateBy.data.connectionStatus && updateBy.query._id) {
      const aiAgents: Array<Model> = await this.findBy({
        query: updateBy.query,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          connectionStatus: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
      });

      const aiAgentsToNotifyOwners: Array<Model> = aiAgents.filter(
        (aiAgent: Model) => {
          return (
            aiAgent.connectionStatus &&
            aiAgent.connectionStatus !== updateBy.data.connectionStatus
          );
        },
      );

      carryForward.aiAgentsToNotifyOwners = aiAgentsToNotifyOwners;
    }

    return { updateBy: updateBy, carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (
      onUpdate.carryForward &&
      onUpdate.carryForward.aiAgentsToNotifyOwners.length > 0
    ) {
      for (const aiAgent of onUpdate.carryForward.aiAgentsToNotifyOwners) {
        await this.notifyOwnersOnStatusChange({
          aiAgentId: aiAgent.id!,
        });
      }
    }

    return Promise.resolve(onUpdate);
  }

  @CaptureSpan()
  public async notifyOwnersOnStatusChange(data: {
    aiAgentId: ObjectID;
  }): Promise<void> {
    const aiAgent: Model | null = await this.findOneById({
      id: data.aiAgentId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        lastAlive: true,
        connectionStatus: true,
        isGlobalAIAgent: true,
        name: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
      },
    });

    if (!aiAgent || !aiAgent.id) {
      throw new BadDataException("AI Agent not found");
    }

    if (!aiAgent.projectId) {
      return; // might be global AI agent. Do not notify.
    }

    if (aiAgent.isGlobalAIAgent && IsBillingEnabled) {
      return; // do not notify for global AI agents.
    }

    // notify the AI agent owner
    let owners: Array<User> = await this.getOwners(aiAgent.id!);

    let doesResourceHasOwners: boolean = true;

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(aiAgent.projectId!);
    }

    if (owners.length === 0) {
      return; // no owners to notify.
    }

    const connectionStatus: string =
      aiAgent.connectionStatus === AIAgentConnectionStatus.Connected
        ? "Connected"
        : "Disconnected";

    for (const user of owners) {
      try {
        const vars: Dictionary<string> = {
          title: `${aiAgent.name} is ${connectionStatus}`,
          aiAgentName: aiAgent.name || "AI Agent",
          aiAgentDescription: aiAgent.description || "No description provided",
          projectName: aiAgent.project?.name || "Project",
          aiAgentStatus: connectionStatus || "Unknown",
          lastAlive: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: aiAgent.lastAlive || OneUptimeDate.getCurrentDate(),
            timezones: user.timezone ? [user.timezone] : [],
          }),
          viewAIAgentsLink: (
            await this.getLinkInDashboard(aiAgent.projectId!, aiAgent.id!)
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AIAgentConnectionStatusChange,
          vars: vars,
          subject: `[AI Agent ${connectionStatus}] ${aiAgent.name}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. AI Agent ${aiAgent.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. AI Agent ${aiAgent.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessageParams: {
          aiAgentName: string;
          projectName: string;
          connectionStatus: string;
          clickAction?: string;
        } = {
          aiAgentName: aiAgent.name!,
          projectName: aiAgent.project?.name || "Project",
          connectionStatus: connectionStatus,
        };

        if (vars["viewAIAgentsLink"]) {
          pushMessageParams.clickAction = vars["viewAIAgentsLink"];
        }

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createAIAgentStatusChangedNotification(
            pushMessageParams,
          );

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              ai_agent_name: aiAgent.name!,
              ai_agent_status: connectionStatus,
              ai_agent_link: vars["viewAIAgentsLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: aiAgent.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      } catch (e) {
        logger.error(
          "Error in sending AI agent status changed resource notification",
        );
        logger.error(e);
      }
    }
  }

  @CaptureSpan()
  public async getLinkInDashboard(
    projectId: ObjectID,
    aiAgentId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/settings/ai-agents/${aiAgentId.toString()}`,
    );
  }
}

export default new Service();
