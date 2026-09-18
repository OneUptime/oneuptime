import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AIAgentOwnerTeamService from "Common/Server/Services/AIAgentOwnerTeamService";
import AIAgentOwnerUserService from "Common/Server/Services/AIAgentOwnerUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import AIAgentOwnerTeam from "Common/Models/DatabaseModels/AIAgentOwnerTeam";
import AIAgentOwnerUser from "Common/Models/DatabaseModels/AIAgentOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import AIAgentService from "Common/Server/Services/AIAgentService";

RunCron(
  "AIAgentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const aiAgentOwnerTeams: Array<AIAgentOwnerTeam> =
      await AIAgentOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          aiAgentId: true,
          teamId: true,
        },
      });

    const aiAgentOwnersMap: Dictionary<Array<User>> = {};

    for (const aiAgentOwnerTeam of aiAgentOwnerTeams) {
      const aiAgentId: ObjectID = aiAgentOwnerTeam.aiAgentId!;
      const teamId: ObjectID = aiAgentOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (aiAgentOwnersMap[aiAgentId.toString()] === undefined) {
        aiAgentOwnersMap[aiAgentId.toString()] = [];
      }

      for (const user of users) {
        (aiAgentOwnersMap[aiAgentId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await AIAgentOwnerTeamService.updateOneById({
        id: aiAgentOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const aiAgentOwnerUsers: Array<AIAgentOwnerUser> =
      await AIAgentOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          aiAgentId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const aiAgentOwnerUser of aiAgentOwnerUsers) {
      const aiAgentId: ObjectID = aiAgentOwnerUser.aiAgentId!;
      const user: User = aiAgentOwnerUser.user!;

      if (aiAgentOwnersMap[aiAgentId.toString()] === undefined) {
        aiAgentOwnersMap[aiAgentId.toString()] = [];
      }

      (aiAgentOwnersMap[aiAgentId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await AIAgentOwnerUserService.updateOneById({
        id: aiAgentOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const aiAgentId in aiAgentOwnersMap) {
      if (!aiAgentOwnersMap[aiAgentId]) {
        continue;
      }

      if ((aiAgentOwnersMap[aiAgentId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = aiAgentOwnersMap[aiAgentId] as Array<User>;

      // get AI agent details
      const aiAgent: AIAgent | null = await AIAgentService.findOneById({
        id: new ObjectID(aiAgentId),
        props: {
          isRoot: true,
        },

        select: {
          _id: true,
          name: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
        },
      });

      if (!aiAgent) {
        continue;
      }

      const vars: Dictionary<string> = {
        aiAgentName: aiAgent.name!,
        aiAgentDescription: aiAgent.description || "No description provided",
        projectName: aiAgent.project!.name!,
        viewAIAgentLink: (
          await AIAgentService.getLinkInDashboard(
            aiAgent.projectId!,
            aiAgent.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AIAgentOwnerAdded,
          vars: vars,
          subject: "[AI Agent] Owner of " + aiAgent.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the AI agent: ${aiAgent.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the AI agent: ${aiAgent.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as AI Agent Owner",
            body: `You have been added as the owner of the AI agent: ${aiAgent.name!}. Click to view details.`,
            clickAction: (
              await AIAgentService.getLinkInDashboard(
                aiAgent.projectId!,
                aiAgent.id!,
              )
            ).toString(),
            tag: "ai-agent-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              ai_agent_name: aiAgent.name!,
              ai_agent_link: vars["viewAIAgentLink"] || "",
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
      }
    }
  },
);
