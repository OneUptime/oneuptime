import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "ScheduledMaintenanceOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentScheduledMaintenanceState: {
            name: true,
          },
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
        },
      });

    for (const scheduledMaintenance of scheduledMaintenances) {
      let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenance.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await ScheduledMaintenanceService.findOwners(
        scheduledMaintenance.id!,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          scheduledMaintenance.projectId!,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      const scheduledMaintenanceNumberStr: string =
        scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
        (scheduledMaintenance.scheduledMaintenanceNumber
          ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
          : "");

      const vars: Dictionary<string> = {
        scheduledMaintenanceTitle: scheduledMaintenance.title!,
        scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
        projectName: scheduledMaintenance.project!.name!,
        currentState:
          scheduledMaintenance.currentScheduledMaintenanceState!.name!,
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

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType:
            EmailTemplateType.ScheduledMaintenanceOwnerResourceCreated,
          vars: vars,
          subject: `[Scheduled Maintenance ${scheduledMaintenanceNumberStr} Created] - ${scheduledMaintenance.title!}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New scheduled maintenance event created - ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New scheduled maintenance event created ${scheduledMaintenanceIdentifier}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Scheduled Maintenance ${scheduledMaintenanceNumberStr} Created`,
            body: `New scheduled maintenance created: ${scheduledMaintenanceIdentifier}. Click to view details.`,
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

        moreScheduledMaintenanceFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
      }

      const projectId: ObjectID = scheduledMaintenance.projectId!;
      const scheduledMaintenanceId: ObjectID = scheduledMaintenance.id!;
      const scheduledMaintenanceDisplayNumber: string =
        scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
        "#" + scheduledMaintenance.scheduledMaintenanceNumber;

      const scheduledMaintenanceFeedText: string = `🔔 **Owner Scheduled Maintenance Created Notification Sent**:
      Notification sent to owners because [Scheduled Maintenance ${scheduledMaintenanceDisplayNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()}) was created.`;

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
    }
  },
);
