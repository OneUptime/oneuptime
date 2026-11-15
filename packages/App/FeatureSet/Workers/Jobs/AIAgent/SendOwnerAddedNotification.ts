import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
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
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  OwnerRowAdded,
  ownersToTell,
  planOwnersAdded,
} from "../../Utils/OwnersAdded";

RunCron(
  "AIAgentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the AI agent as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AIAgentOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const aiAgent: AIAgent | null = await readAIAgent(
          delivery.notification.resourceId,
        );

        if (!aiAgent) {
          await delivery.giveUp("the AI agent is gone");
          return;
        }

        await notifyOwnersAdded({
          aiAgent: aiAgent,
          deliveries: [delivery],
        });
      },
    });

    const aiAgentOwnerTeams: Array<AIAgentOwnerTeam> =
      await AIAgentOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          aiAgentId: true,
          teamId: true,
        },
      });

    const aiAgentOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const aiAgentOwnerTeam of aiAgentOwnerTeams) {
      const aiAgentId: ObjectID = aiAgentOwnerTeam.aiAgentId!;
      const teamId: ObjectID = aiAgentOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (aiAgentOwnersMap[aiAgentId.toString()] === undefined) {
        aiAgentOwnersMap[aiAgentId.toString()] = [];
      }

      (aiAgentOwnersMap[aiAgentId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: aiAgentOwnerTeam.id!,
        isTeam: true,
        users: users,
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
        skip: 0,
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

      (aiAgentOwnersMap[aiAgentId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: aiAgentOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const aiAgentId in aiAgentOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> = aiAgentOwnersMap[aiAgentId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const aiAgent: AIAgent | null = await readAIAgent(
        new ObjectID(aiAgentId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = aiAgent
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.AIAgentOwnerAdded,
            projectId: aiAgent.projectId!,
            resourceId: aiAgent.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose AI agent is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await AIAgentOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await AIAgentOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!aiAgent) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          aiAgent: aiAgent,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending AI agent owner added notification", {
          projectId: aiAgent.projectId?.toString(),
          aiAgentId: aiAgent.id?.toString(),
        });
        logger.error(e, {
          projectId: aiAgent.projectId?.toString(),
          aiAgentId: aiAgent.id?.toString(),
        });
      }
    }
  },
);

async function readAIAgent(aiAgentId: ObjectID): Promise<AIAgent | null> {
  return await AIAgentService.findOneById({
    id: aiAgentId,
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
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * AI agent, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  aiAgent: AIAgent;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const aiAgent: AIAgent = data.aiAgent;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const vars: Dictionary<string> = {
    aiAgentName: aiAgent.name!,
    aiAgentDescription: aiAgent.description || "No description provided",
    projectName: aiAgent.project!.name!,
    viewAIAgentLink: (
      await AIAgentService.getLinkInDashboard(aiAgent.projectId!)
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AIAgentOwnerAdded,
          vars: vars,
          subject: "[AI Agent] Owner of " + aiAgent.name,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the AI agent: ${aiAgent.name!}.`,
          ),
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
              await AIAgentService.getLinkInDashboard(aiAgent.projectId!)
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
      });
    }
  }
}
