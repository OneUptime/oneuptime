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
import AlertEpisodeInternalNoteService from "Common/Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import User from "Common/Models/DatabaseModels/User";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertEpisodeOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const privateNotes: Array<AlertEpisodeInternalNote> =
      await AlertEpisodeInternalNoteService.findAllBy({
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
          alertEpisodeId: true,
          projectId: true,
        },
      });

    const privateNoteIds: Array<string> = privateNotes.map(
      (note: AlertEpisodeInternalNote) => {
        return note._id!;
      },
    );

    for (const note of privateNotes) {
      await AlertEpisodeInternalNoteService.updateOneById({
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

      // Get the alert episode
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
          id: note.getColumnValue("alertEpisodeId")! as ObjectID,
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
            episodeNumber: true,
          },
        });

      if (!episode) {
        continue;
      }

      // Find owners
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> = await AlertEpisodeService.findOwners(
        note.getColumnValue("alertEpisodeId")! as ObjectID,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;
        // Fall back to project owners
        owners = await ProjectService.getOwners(
          note.getColumnValue("projectId") as ObjectID,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      const episodeIdentifier: string =
        episode.episodeNumber !== undefined
          ? `#${episode.episodeNumber} (${episode.title})`
          : episode.title!;

      const vars: Dictionary<string> = {
        episodeTitle: episode.title!,
        projectName: episode.project!.name!,
        currentState: episode.currentAlertState!.name!,
        note: await Markdown.convertToHTML(
          (note.getColumnValue("note")! as string) || "",
          MarkdownContentType.Email,
        ),
        episodeSeverity: episode.alertSeverity?.name || "Not Set",
        episodeViewLink: (
          await AlertEpisodeService.getEpisodeLinkInDashboard(
            episode.projectId!,
            episode.id!,
          )
        ).toString(),
      };

      if (doesResourceHasOwners === true) {
        vars["isOwner"] = "true";
      }

      if (privateNoteIds.includes(note._id!)) {
        vars["isPrivateNote"] = "true";
      }

      let moreEpisodeFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerNotePosted,
          vars: vars,
          subject: "[Alert Episode Update] " + episode.title,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New note posted on alert episode ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on alert episode ${episodeIdentifier}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Note Posted: ${episode.title}`,
            body: `A new note has been posted on alert episode in ${episode.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertEpisodeService.getEpisodeLinkInDashboard(
                episode.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "alert-episode-note-posted",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              episode_link: vars["episodeViewLink"] || "",
              episode_number:
                episode.episodeNumber !== undefined
                  ? episode.episodeNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: episode.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          alertEpisodeId: episode.id!,
          eventType,
        });

        moreEpisodeFeedInformationInMarkdown += `**Notified:** ${user.name} (${user.email})\n`;
      }

      const projectId: ObjectID = episode.projectId!;
      const episodeId: ObjectID = episode.id!;
      const episodeNumber: number = episode.episodeNumber!;

      const episodeFeedText: string = `🔔 **Owners Notified because private note is posted** Owners have been notified about the new private note posted on the [Alert Episode ${episodeNumber}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}).`;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id!,
        projectId: episode.projectId!,
        alertEpisodeFeedEventType:
          AlertEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: episodeFeedText,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
