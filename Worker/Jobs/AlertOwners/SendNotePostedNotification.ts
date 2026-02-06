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
import AlertInternalNoteService from "Common/Server/Services/AlertInternalNoteService";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const privateNotes: Array<AlertInternalNote> =
      await AlertInternalNoteService.findAllBy({
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
          alertId: true,
          projectId: true,
        },
      });

    const privateNoteIds: Array<string> = privateNotes.map(
      (note: AlertInternalNote) => {
        return note._id!;
      },
    );

    for (const note of privateNotes) {
      await AlertInternalNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const notes: Array<BaseModel> = [...privateNotes];

    for (const noteObject of notes) {
      const note: BaseModel = noteObject as BaseModel;

      // get all scheduled events of all the projects.
      const alert: Alert | null = await AlertService.findOneById({
        id: note.getColumnValue("alertId")! as ObjectID,
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
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          monitor: {
            name: true,
          },
          alertNumber: true,
          alertNumberWithPrefix: true,
        },
      });

      if (!alert) {
        continue;
      }

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await AlertService.findOwners(
        note.getColumnValue("alertId")! as ObjectID,
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

      const alertIdentifier: string =
        alert.alertNumber !== undefined
          ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
          : alert.title!;

      const alertNumberStr: string =
        alert.alertNumberWithPrefix ||
        (alert.alertNumber ? `#${alert.alertNumber}` : "");

      const vars: Dictionary<string> = {
        alertTitle: alert.title!,
        alertNumber: alertNumberStr,
        projectName: alert.project!.name!,
        currentState: alert.currentAlertState!.name!,
        note: await Markdown.convertToHTML(
          (note.getColumnValue("note")! as string) || "",
          MarkdownContentType.Email,
        ),
        resourcesAffected: alert.monitor?.name || "None",
        alertSeverity: alert.alertSeverity!.name!,
        alertViewLink: (
          await AlertService.getAlertLinkInDashboard(
            alert.projectId!,
            alert.id!,
          )
        ).toString(),
      };

      if (doesResourceHasOwners === true) {
        vars["isOwner"] = "true";
      }

      if (privateNoteIds.includes(note._id!)) {
        vars["isPrivateNote"] = "true";
      }

      let moreAlertFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerNotePosted,
          vars: vars,
          subject: `[Alert ${alertNumberStr} Update] - ${alert.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New note posted on alert ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on alert ${alertIdentifier}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert ${alertNumberStr} Note Posted: ${alert.title}`,
            body: `A new note has been posted on alert ${alertNumberStr} in ${alert.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-note-posted",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: alert.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          alertId: alert.id!,
          eventType,
        });

        moreAlertFeedInformationInMarkdown += `**Notified:** ${user.name} (${user.email})\n`;
      }

      const projectId: ObjectID = alert.projectId!;
      const alertId: ObjectID = alert.id!;
      const alertDisplayNumber: string =
        alert.alertNumberWithPrefix || "#" + alert.alertNumber!;

      const alertFeedText: string = `🔔 **Owners Notified because private note is posted** Owners have been notified about the new private note posted on the [Alert ${alertDisplayNumber}](${(await AlertService.getAlertLinkInDashboard(projectId, alertId)).toString()}).`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: alertFeedText,
        moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }
  },
);
