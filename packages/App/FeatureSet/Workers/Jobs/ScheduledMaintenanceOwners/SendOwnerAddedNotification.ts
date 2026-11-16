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
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the scheduledMaintenance the owners were added to is read with.
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
  "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the scheduled maintenance event as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ScheduledMaintenanceOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const scheduledMaintenance: ScheduledMaintenance | null =
          await readScheduledMaintenance(delivery.notification.resourceId);

        if (!scheduledMaintenance) {
          await delivery.giveUp("the scheduled maintenance event is gone");
          return;
        }

        await notifyOwnersAdded({
          scheduledMaintenance: scheduledMaintenance,
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
    await tellOwnersAdded<ScheduledMaintenance>({
      jobName: "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.ScheduledMaintenanceOwnerAdded,
      recordIdColumn: "scheduledMaintenanceId",
      teamService: ScheduledMaintenanceOwnerTeamService,
      userService: ScheduledMaintenanceOwnerUserService,
      recordService: ScheduledMaintenanceService,
      recordSelect: SCHEDULED_MAINTENANCE_SELECT,
      deadline: deadline,
      tell: async (
        record: ScheduledMaintenance,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          scheduledMaintenance: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readScheduledMaintenance(
  scheduledMaintenanceId: ObjectID,
): Promise<ScheduledMaintenance | null> {
  return await ScheduledMaintenanceService.findOneById({
    id: scheduledMaintenanceId,
    props: {
      isRoot: true,
    },
    select: SCHEDULED_MAINTENANCE_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * scheduled maintenance event, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  scheduledMaintenance: ScheduledMaintenance;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const scheduledMaintenance: ScheduledMaintenance = data.scheduledMaintenance;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const scheduledMaintenanceNumber: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  const vars: Dictionary<string> = {
    scheduledMaintenanceTitle: scheduledMaintenance.title!,
    scheduledMaintenanceNumber: scheduledMaintenanceNumber,
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

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Scheduled Maintenance ${scheduledMaintenanceNumber} - ${scheduledMaintenance.title}`,
          isSubjectLiteral: true,
        };

        const scheduledMaintenanceIdentifier: string =
          scheduledMaintenance.scheduledMaintenanceNumber !== undefined
            ? `${scheduledMaintenanceNumber} (${scheduledMaintenance.title})`
            : scheduledMaintenance.title!;

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the maintenance event - ${scheduledMaintenanceIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the maintenance event ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Scheduled Maintenance ${scheduledMaintenanceNumber} Owner`,
            body: `You have been added as the owner of the maintenance event: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION;

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
      });
    }
  }
}
