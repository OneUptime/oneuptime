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
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a maintenance event is read with.
const SCHEDULED_MAINTENANCE_SELECT: Select<ScheduledMaintenance> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentScheduledMaintenanceState: {
    name: true,
    color: true,
  },
  scheduledMaintenanceNumber: true,
  scheduledMaintenanceNumberWithPrefix: true,
};

RunCron(
  "ScheduledMaintenanceOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ScheduledMaintenanceCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const scheduledMaintenance: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneById({
            id: delivery.notification.resourceId,
            select: SCHEDULED_MAINTENANCE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!scheduledMaintenance) {
          await delivery.giveUp("the scheduled maintenance event is gone");
          return;
        }

        await notifyOwnersOfMaintenanceCreated(scheduledMaintenance, delivery);
      },
    });

    // get all scheduled events of all the projects.
    const scheduledMaintenances: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          isOwnerNotifiedOfResourceCreation: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: SCHEDULED_MAINTENANCE_SELECT,
      });

    for (const scheduledMaintenance of scheduledMaintenances) {
      /*
       * Whom it is to tell - its owners, or the project's when it has none -
       * written before the take: a worker stopped from here on leaves them to
       * be told by a later run, and one stopped before the take leaves the
       * event to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.ScheduledMaintenanceCreated,
            projectId: scheduledMaintenance.projectId!,
            resourceId: scheduledMaintenance.id!,
            eventId: scheduledMaintenance.id!,
          },
          findOwners: () => {
            return ScheduledMaintenanceService.findOwners(
              scheduledMaintenance.id!,
            );
          },
          writesFeedItem: true,
        });

      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenance.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfMaintenanceCreated(scheduledMaintenance, delivery);
      } catch (e) {
        logger.error(
          "Error in sending scheduled maintenance created notification",
          {
            projectId: scheduledMaintenance.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
          },
        );
        logger.error(e, {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        });
      }
    }
  },
);

// A person told, as the event's feed names them.
function feedLine(user: User): string {
  return OwnerNotificationFeedText.notifiedLineMarkdown(
    OwnerNotificationFeedText.nameAndEmail({
      name: user.name?.toString(),
      email: user.email?.toString(),
    }),
  );
}

/*
 * Tells the delivery's owners that the maintenance event was created, each
 * once (OwnerNotificationDelivery.tell), and says in the event's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfMaintenanceCreated(
  scheduledMaintenance: ScheduledMaintenance,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  // Whom a run that stopped part way told already.
  let moreScheduledMaintenanceFeedInformationInMarkdown: string =
    delivery.toldEarlier.map(feedLine).join("");

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const scheduledMaintenanceNumberStr: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  const vars: Dictionary<string> = {
    scheduledMaintenanceTitle: scheduledMaintenance.title!,
    scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
    projectName: scheduledMaintenance.project!.name!,
    currentState: scheduledMaintenance.currentScheduledMaintenanceState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      scheduledMaintenance.currentScheduledMaintenanceState?.color,
    ),
    scheduledMaintenanceDescription: await Markdown.convertToHTML(
      scheduledMaintenance.description! || "",
      MarkdownContentType.Email,
    ),
    scheduledMaintenanceViewLink: (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        scheduledMaintenance.projectId!,
        scheduledMaintenance.id!,
      )
    ).toString(),
  };

  if (doesResourceHasOwners === true) {
    vars["isOwner"] = "true";
  }

  const scheduledMaintenanceIdentifier: string =
    scheduledMaintenance.scheduledMaintenanceNumber !== undefined
      ? `${scheduledMaintenanceNumberStr} (${scheduledMaintenance.title})`
      : scheduledMaintenance.title!;

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType:
            EmailTemplateType.ScheduledMaintenanceOwnerResourceCreated,
          vars: vars,
          subject: `[Created Scheduled Maintenance ${scheduledMaintenanceNumberStr}] - ${scheduledMaintenance.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New maintenance event created - ${scheduledMaintenanceIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New maintenance event created ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Scheduled Maintenance ${scheduledMaintenanceNumberStr} Created`,
            body: `New maintenance event created: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-created",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
                (scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                  "N/A"),
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenance.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          scheduledMaintenanceId: scheduledMaintenance.id!,
          eventType,
        });
      },
    );

    if (isTold) {
      moreScheduledMaintenanceFeedInformationInMarkdown += feedLine(user);
    }
  }

  /*
   * Written by the run that set out to tell the owners, or by the one that
   * took up the feed item a run that told them all left unwritten (#8510):
   * a run that found every owner told already writes none.
   */
  if (!delivery.isFeedItemToWrite) {
    return;
  }

  const scheduledMaintenanceFeedText: string =
    OwnerNotificationFeedText.created("maintenance event", {
      isProjectOwners: !doesResourceHasOwners,
    });

  await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
    scheduledMaintenanceId: scheduledMaintenance.id!,
    projectId: scheduledMaintenance.projectId!,
    scheduledMaintenanceFeedEventType:
      ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: scheduledMaintenanceFeedText,
    moreInformationInMarkdown:
      moreScheduledMaintenanceFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
