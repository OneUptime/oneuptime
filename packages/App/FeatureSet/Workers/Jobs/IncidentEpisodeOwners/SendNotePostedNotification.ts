import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
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
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import User from "Common/Models/DatabaseModels/User";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a note is read with.
const NOTE_SELECT: Select<IncidentEpisodeInternalNote> = {
  _id: true,
  note: true,
  incidentEpisodeId: true,
  projectId: true,
};

// What the episode of a note is read with.
const EPISODE_SELECT: Select<IncidentEpisode> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentIncidentState: {
    name: true,
    color: true,
  },
  incidentSeverity: {
    name: true,
    color: true,
  },
  episodeNumber: true,
  episodeNumberWithPrefix: true,
};

RunCron(
  "IncidentEpisodeOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentEpisodeInternalNotePosted],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const note: IncidentEpisodeInternalNote | null =
          await IncidentEpisodeInternalNoteService.findOneById({
            id: delivery.notification.eventId,
            select: NOTE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const episode: IncidentEpisode | null = note
          ? await readEpisode(delivery.notification.resourceId)
          : null;

        if (!note || !episode) {
          await delivery.giveUp("the incident episode or its note is gone");
          return;
        }

        await notifyOwnersOfNote({
          note: note,
          episode: episode,
          delivery: delivery,
        });
      },
    });

    const privateNotes: Array<IncidentEpisodeInternalNote> =
      await IncidentEpisodeInternalNoteService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: NOTE_SELECT,
      });

    for (const note of privateNotes) {
      // Get the incident episode
      const episode: IncidentEpisode | null = await readEpisode(
        note.incidentEpisodeId!,
      );

      /*
       * Whom it is to tell - the episode's owners, or the project's when it
       * has none - written before the take: a worker stopped from here on
       * leaves them to be told by a later run, and one stopped before the
       * take leaves the note to be read again.
       */
      const delivery: OwnerNotificationDelivery | null = episode
        ? await OwnerNotificationDeliveries.planForOwnersOf({
            notification: {
              kind: OwnerNotificationKind.IncidentEpisodeInternalNotePosted,
              projectId: episode.projectId!,
              resourceId: episode.id!,
              eventId: note.id!,
            },
            findOwners: () => {
              return IncidentEpisodeService.findOwners(episode.id!);
            },
            writesFeedItem: true,
          })
        : null;

      await IncidentEpisodeInternalNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!episode || !delivery) {
        continue;
      }

      try {
        await notifyOwnersOfNote({
          note: note,
          episode: episode,
          delivery: delivery,
        });
      } catch (e) {
        logger.error("Error in sending incident episode note notification", {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        });
        logger.error(e, {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        });
      }
    }
  },
);

async function readEpisode(
  episodeId: ObjectID,
): Promise<IncidentEpisode | null> {
  return await IncidentEpisodeService.findOneById({
    id: episodeId,
    props: {
      isRoot: true,
    },
    select: EPISODE_SELECT,
  });
}

// A person told, as the episode's feed names them.
function feedLineMarkdown(user: User): string {
  return OwnerNotificationFeedText.notifiedLineMarkdown(
    OwnerNotificationFeedText.nameAndEmail({
      name: user.name?.toString(),
      email: user.email?.toString(),
    }),
  );
}

/*
 * Tells the delivery's owners that a note was posted on the episode, each
 * once (OwnerNotificationDelivery.tell), and says in the episode's feed whom
 * it reached - those a stopped run told first among them.
 */
async function notifyOwnersOfNote(data: {
  note: IncidentEpisodeInternalNote;
  episode: IncidentEpisode;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const note: IncidentEpisodeInternalNote = data.note;
  const episode: IncidentEpisode = data.episode;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const episodeNumberStr: string =
    episode.episodeNumberWithPrefix ||
    (episode.episodeNumber ? `#${episode.episodeNumber}` : "");

  const episodeIdentifier: string =
    episode.episodeNumber !== undefined
      ? `${episodeNumberStr} (${episode.title})`
      : episode.title!;

  const vars: Dictionary<string> = {
    episodeTitle: episode.title!,
    episodeNumber: episodeNumberStr,
    projectName: episode.project!.name!,
    currentState: episode.currentIncidentState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      episode.currentIncidentState?.color,
    ),
    note: await Markdown.convertToHTML(
      note.note || "",
      MarkdownContentType.Email,
    ),
    episodeSeverity: episode.incidentSeverity?.name || "Not Set",
    ...EmailColorUtil.getTemplateVariables(
      "episodeSeverity",
      episode.incidentSeverity?.color,
    ),
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

  // Only private notes are posted on an episode.
  vars["isPrivateNote"] = "true";

  // Whom a run that stopped part way told already.
  let moreEpisodeFeedInformationInMarkdown: string = delivery.toldEarlier
    .map(feedLineMarkdown)
    .join("");

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentEpisodeOwnerNotePosted,
          vars: vars,
          subject: `[Update Incident Episode ${episodeNumberStr}] - ${episode.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New note posted on incident episode ${episodeIdentifier}.`,
          ),
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
      },
    );

    if (isTold) {
      moreEpisodeFeedInformationInMarkdown += feedLineMarkdown(user);
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

  const episodeFeedText: string = OwnerNotificationFeedText.notePosted({
    recordNoun: "incident episode",
    isProjectOwners: !doesResourceHasOwners,
    isPrivateNote: true,
  });

  await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
    incidentEpisodeId: episode.id!,
    projectId: episode.projectId!,
    incidentEpisodeFeedEventType:
      IncidentEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: episodeFeedText,
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
