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
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import MonitorService, {
  MonitorDestinationInfo,
} from "Common/Server/Services/MonitorService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the monitor the owners were added to is read with.
const MONITOR_SELECT: Select<Monitor> = {
  _id: true,
  name: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentMonitorStatus: {
    name: true,
    color: true,
  },
  monitorType: true,
  monitorSteps: true,
};

RunCron(
  "MonitorOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the monitor as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.MonitorOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const monitor: Monitor | null = await readMonitor(
          delivery.notification.resourceId,
        );

        if (!monitor) {
          await delivery.giveUp("the monitor is gone");
          return;
        }

        await notifyOwnersAdded({
          monitor: monitor,
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
    await tellOwnersAdded<Monitor>({
      jobName: "MonitorOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.MonitorOwnerAdded,
      recordIdColumn: "monitorId",
      teamService: MonitorOwnerTeamService,
      userService: MonitorOwnerUserService,
      recordService: MonitorService,
      recordSelect: MONITOR_SELECT,
      deadline: deadline,
      tell: async (
        record: Monitor,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          monitor: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readMonitor(monitorId: ObjectID): Promise<Monitor | null> {
  return await MonitorService.findOneById({
    id: monitorId,
    props: {
      isRoot: true,
    },
    select: MONITOR_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * monitor, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  monitor: Monitor;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const monitor: Monitor = data.monitor;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  // Get monitor destination info using the helper function
  const destinationInfo: MonitorDestinationInfo =
    MonitorService.getMonitorDestinationInfo(monitor);

  const vars: Dictionary<string> = {
    monitorName: monitor.name!,
    projectName: monitor.project!.name!,
    currentStatus: monitor.currentMonitorStatus!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentStatus",
      monitor.currentMonitorStatus?.color,
    ),
    monitorDescription: await Markdown.convertToHTML(
      monitor.description! || "",
      MarkdownContentType.Email,
    ),
    monitorViewLink: (
      await MonitorService.getMonitorLinkInDashboard(
        monitor.projectId!,
        monitor.id!,
      )
    ).toString(),
    monitorDestination: destinationInfo.monitorDestination,
    requestType: destinationInfo.requestType,
    monitorType: destinationInfo.monitorType,
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorOwnerAdded,
          vars: vars,
          subject: "You have been added as the owner of the monitor.",
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the monitor - ${monitor.name}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the monitor ${monitor.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Monitor Owner",
            body: `You have been added as the owner of the monitor: ${monitor.name}. Click to view details.`,
            clickAction: (
              await MonitorService.getMonitorLinkInDashboard(
                monitor.projectId!,
                monitor.id!,
              )
            ).toString(),
            tag: "monitor-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              monitor_name: monitor.name!,
              monitor_link: vars["monitorViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitor.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
          monitorId: monitor.id!,
        });
      });
    }
  }
}
