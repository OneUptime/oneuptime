import RunCron from "../../Utils/Cron";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceInternalNoteService from "Common/Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "ScheduledMaintenanceOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const publicNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
          projectId: true,
        },
      });

    const privateNotes: Array<ScheduledMaintenanceInternalNote> =
      await ScheduledMaintenanceInternalNoteService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          note: true,
          scheduledMaintenanceId: true,
          projectId: true,
        },
      });

    const privateNoteIds: Array<string> = privateNotes.map(
      (note: ScheduledMaintenancePublicNote) => {
        return note._id!;
      },
    );

    for (const note of publicNotes) {
      await ScheduledMaintenancePublicNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    for (const note of privateNotes) {
      await ScheduledMaintenanceInternalNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const notes: Array<BaseModel> = [...publicNotes, ...privateNotes];

    for (const noteObject of notes) {
      let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

      const note: BaseModel = noteObject as BaseModel;

      // get all scheduled events of all the projects.
      const scheduledMaintenance: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: note.getColumnValue("scheduledMaintenanceId")! as ObjectID,
          props: {
            isRoot: true,
          },
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
          },
        });

      if (!scheduledMaintenance) {
        continue;
      }

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await ScheduledMaintenanceService.findOwners(
        note.getColumnValue("scheduledMaintenanceId")! as ObjectID,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          note.getColumnValue("projectId") as ObjectID,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      const scheduledMaintenanceNumberStr: string = scheduledMaintenance.scheduledMaintenanceNumber
        ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
        : "";

      const vars: Dictionary<string> = {
        scheduledMaintenanceTitle: scheduledMaintenance.title!,
        scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
        projectName: scheduledMaintenance.project!.name!,
        currentState:
          scheduledMaintenance.currentScheduledMaintenanceState!.name!,
        note: await Markdown.convertToHTML(
          (note.getColumnValue("note")! as string) || "",
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

      if (privateNoteIds.includes(note._id!)) {
        vars["isPrivateNote"] = "true";
      }

      const scheduledMaintenanceIdentifier: string =
        scheduledMaintenance.scheduledMaintenanceNumber !== undefined
          ? `${scheduledMaintenanceNumberStr} (${scheduledMaintenance.title})`
          : scheduledMaintenance.title!;

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerNotePosted,
          vars: vars,
          subject: `[Scheduled Maintenance ${scheduledMaintenanceNumberStr} Update] - ${scheduledMaintenance.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New note posted on scheduled maintenance event - ${scheduledMaintenanceIdentifier}. To view this note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on scheduled maintenance event ${scheduledMaintenanceIdentifier}. To view this note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Scheduled Maintenance ${scheduledMaintenanceNumberStr} Note Posted`,
            body: `New note posted on scheduled maintenance: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-note-posted",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                "N/A",
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

        moreScheduledMaintenanceFeedInformationInMarkdown += `**Notified:** ${user.name} (${user.email})\n`;
      }

      const isPrivateNote: boolean = privateNoteIds.includes(
        note._id!.toString(),
      );

      const projectId: ObjectID = scheduledMaintenance.projectId!;
      const scheduledMaintenanceId: ObjectID = scheduledMaintenance.id!;
      const scheduledMaintenanceNumber: number =
        scheduledMaintenance.scheduledMaintenanceNumber!; // scheduledMaintenance number is not null here.

      const scheduledMaintenanceFeedText: string = `🔔 **Owners Notified because ${isPrivateNote ? "private" : "public"} note is posted** Owners have been notified about the new ${isPrivateNote ? "private" : "public"} note posted on the [Scheduled Maintenance ${scheduledMaintenanceNumber}](${(await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(projectId, scheduledMaintenanceId)).toString()}).`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id!,
        projectId: scheduledMaintenance.projectId!,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
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
