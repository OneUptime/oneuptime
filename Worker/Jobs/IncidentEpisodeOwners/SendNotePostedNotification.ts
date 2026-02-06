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
import IncidentEpisodeInternalNoteService from "Common/Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import User from "Common/Models/DatabaseModels/User";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentEpisodeOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const privateNotes: Array<IncidentEpisodeInternalNote> =
      await IncidentEpisodeInternalNoteService.findAllBy({
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
          incidentEpisodeId: true,
          projectId: true,
        },
      });

    const privateNoteIds: Array<string> = privateNotes.map(
      (note: IncidentEpisodeInternalNote) => {
        return note._id!;
      },
    );

    for (const note of privateNotes) {
      await IncidentEpisodeInternalNoteService.updateOneById({
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

      // Get the incident episode
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: note.getColumnValue("incidentEpisodeId")! as ObjectID,
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
            currentIncidentState: {
              name: true,
            },
            incidentSeverity: {
              name: true,
            },
            episodeNumber: true,
            episodeNumberWithPrefix: true,
          },
        });

      if (!episode) {
        continue;
      }

      // Find owners
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> = await IncidentEpisodeService.findOwners(
        note.getColumnValue("incidentEpisodeId")! as ObjectID,
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

      const episodeNumberStr: string = episode.episodeNumberWithPrefix
        || (episode.episodeNumber
          ? `#${episode.episodeNumber}`
          : "");

      const episodeIdentifier: string =
        episode.episodeNumber !== undefined
          ? `${episodeNumberStr} (${episode.title})`
          : episode.title!;

      const vars: Dictionary<string> = {
        episodeTitle: episode.title!,
        episodeNumber: episodeNumberStr,
        projectName: episode.project!.name!,
        currentState: episode.currentIncidentState!.name!,
        note: await Markdown.convertToHTML(
          (note.getColumnValue("note")! as string) || "",
          MarkdownContentType.Email,
        ),
        episodeSeverity: episode.incidentSeverity?.name || "Not Set",
        episodeViewLink: (
          await IncidentEpisodeService.getEpisodeLinkInDashboard(
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
          templateType: EmailTemplateType.IncidentEpisodeOwnerNotePosted,
          vars: vars,
          subject: `[Incident Episode ${episodeNumberStr} Update] - ${episode.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New note posted on incident episode ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on incident episode ${episodeIdentifier}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Incident Episode ${episodeNumberStr} Note Posted: ${episode.title}`,
            body: `A new note has been posted on incident episode ${episodeNumberStr} in ${episode.project!.name!}. Click to view details.`,
            clickAction: (
              await IncidentEpisodeService.getEpisodeLinkInDashboard(
                episode.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "incident-episode-note-posted",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              episode_link: vars["episodeViewLink"] || "",
              episode_number:
                episode.episodeNumberWithPrefix ||
                (episode.episodeNumber !== undefined
                  ? episode.episodeNumber.toString()
                  : ""),
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
          incidentEpisodeId: episode.id!,
          eventType,
        });

        moreEpisodeFeedInformationInMarkdown += `**Notified:** ${user.name} (${user.email})\n`;
      }

      const projectId: ObjectID = episode.projectId!;
      const episodeId: ObjectID = episode.id!;
      const episodeDisplayNumber: string = episode.episodeNumberWithPrefix || '#' + episode.episodeNumber;

      const episodeFeedText: string = `🔔 **Owners Notified because private note is posted** Owners have been notified about the new private note posted on the [Incident Episode ${episodeDisplayNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}).`;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: episodeFeedText,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
