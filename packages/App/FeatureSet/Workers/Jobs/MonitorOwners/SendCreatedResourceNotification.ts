import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
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
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a monitor is read with.
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
  "MonitorOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.MonitorCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: delivery.notification.resourceId,
          select: MONITOR_SELECT,
          props: {
            isRoot: true,
          },
        });

        if (!monitor) {
          await delivery.giveUp("the monitor is gone");
          return;
        }

        await notifyOwnersOfMonitorCreated(monitor, delivery);
      },
    });

    // get all scheduled events of all the projects.
    const monitors: Array<Monitor> = await MonitorService.findAllBy({
      query: {
        isOwnerNotifiedOfResourceCreation: false,
      },
      props: {
        isRoot: true,
      },
      select: MONITOR_SELECT,
    });

    for (const monitor of monitors) {
      /*
       * Whom it is to tell - its owners, or the project's when it has none -
       * written before the take: a worker stopped from here on leaves them to
       * be told by a later run, and one stopped before the take leaves the
       * monitor to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.MonitorCreated,
            projectId: monitor.projectId!,
            resourceId: monitor.id!,
            eventId: monitor.id!,
          },
          findOwners: () => {
            return MonitorService.findOwners(monitor.id!);
          },
          writesFeedItem: false,
        });

      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfMonitorCreated(monitor, delivery);
      } catch (e) {
        logger.error("Error in sending monitor created notification", {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        });
        logger.error(e, {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        });
      }
    }
  },
);

/*
 * Tells the delivery's owners that the monitor was created, each once
 * (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersOfMonitorCreated(
  monitor: Monitor,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
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

  if (!delivery.isProjectOwners) {
    vars["isOwner"] = "true";
  }

  for (const user of delivery.owners) {
    await delivery.tell(user, async (): Promise<void> => {
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorOwnerResourceCreated,
        vars: vars,
        subject: "[Created Monitor] " + monitor.name!,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(`New monitor created - ${monitor.name}.`),
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. New monitor was created ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createMonitorCreatedNotification({
          monitorName: monitor.name!,
          monitorId: monitor.id!.toString(),
        });

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION;

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
