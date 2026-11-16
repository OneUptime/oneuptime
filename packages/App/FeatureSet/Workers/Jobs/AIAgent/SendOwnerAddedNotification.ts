import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
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
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import AIAgentService from "Common/Server/Services/AIAgentService";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the aiAgent the owners were added to is read with.
const AI_AGENT_SELECT: Select<AIAgent> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
};

RunCron(
  "AIAgentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
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

    /*
     * Every record's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between records at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<AIAgent>({
      jobName: "AIAgentOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.AIAgentOwnerAdded,
      recordIdColumn: "aiAgentId",
      teamService: AIAgentOwnerTeamService,
      userService: AIAgentOwnerUserService,
      recordService: AIAgentService,
      recordSelect: AI_AGENT_SELECT,
      deadline: deadline,
      tell: async (
        record: AIAgent,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          aiAgent: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readAIAgent(aiAgentId: ObjectID): Promise<AIAgent | null> {
  return await AIAgentService.findOneById({
    id: aiAgentId,
    props: {
      isRoot: true,
    },
    select: AI_AGENT_SELECT,
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
