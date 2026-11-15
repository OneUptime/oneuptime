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
import AlertEpisodeInternalNoteService from "Common/Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import User from "Common/Models/DatabaseModels/User";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
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
const NOTE_SELECT: Select<AlertEpisodeInternalNote> = {
  _id: true,
  note: true,
  alertEpisodeId: true,
  projectId: true,
};

// What the episode of a note is read with.
const EPISODE_SELECT: Select<AlertEpisode> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentAlertState: {
    name: true,
    color: true,
  },
  alertSeverity: {
    name: true,
    color: true,
  },
  episodeNumber: true,
  episodeNumberWithPrefix: true,
};

RunCron(
  "AlertEpisodeOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertEpisodeInternalNotePosted],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const note: AlertEpisodeInternalNote | null =
          await AlertEpisodeInternalNoteService.findOneById({
            id: delivery.notification.eventId,
            select: NOTE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const episode: AlertEpisode | null = note
          ? await readEpisode(delivery.notification.resourceId)
          : null;

        if (!note || !episode) {
          await delivery.giveUp("the alert episode or its note is gone");
          return;
        }

        await notifyOwnersOfNote({
          note: note,
          episode: episode,
          delivery: delivery,
        });
      },
    });

    const privateNotes: Array<AlertEpisodeInternalNote> =
      await AlertEpisodeInternalNoteService.findAllBy({
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
      // Get the alert episode
      const episode: AlertEpisode | null = await readEpisode(
        note.alertEpisodeId!,
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
              kind: OwnerNotificationKind.AlertEpisodeInternalNotePosted,
              projectId: episode.projectId!,
              resourceId: episode.id!,
              eventId: note.id!,
            },
            findOwners: () => {
              return AlertEpisodeService.findOwners(episode.id!);
            },
            writesFeedItem: true,
          })
        : null;

      await AlertEpisodeInternalNoteService.updateOneById({
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
        logger.error("Error in sending alert episode note notification", {
          projectId: episode.projectId?.toString(),
          alertEpisodeId: episode.id?.toString(),
        });
        logger.error(e, {
          projectId: episode.projectId?.toString(),
          alertEpisodeId: episode.id?.toString(),
        });
      }
    }
  },
);

async function readEpisode(episodeId: ObjectID): Promise<AlertEpisode | null> {
  return await AlertEpisodeService.findOneById({
    id: episodeId,
    props: {
      isRoot: true,
    },
    select: EPISODE_SELECT,
  });
}

// A person told, as the episode's feed names them.
function feedLine(user: User): string {
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
  note: AlertEpisodeInternalNote;
  episode: AlertEpisode;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const note: AlertEpisodeInternalNote = data.note;
  const episode: AlertEpisode = data.episode;
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
    currentState: episode.currentAlertState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      episode.currentAlertState?.color,
    ),
    note: await Markdown.convertToHTML(
      note.note || "",
      MarkdownContentType.Email,
    ),
    episodeSeverity: episode.alertSeverity?.name || "Not Set",
    ...EmailColorUtil.getTemplateVariables(
      "episodeSeverity",
      episode.alertSeverity?.color,
    ),
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

  // Only private notes are posted on an episode.
  vars["isPrivateNote"] = "true";

  // Whom a run that stopped part way told already.
  let moreEpisodeFeedInformationInMarkdown: string = delivery.toldEarlier
    .map(feedLine)
    .join("");

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerNotePosted,
          vars: vars,
          subject: `[Update Alert Episode ${episodeNumberStr}] - ${episode.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New note posted on alert episode ${episodeIdentifier}.`,
          ),
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
            title: `Alert Episode ${episodeNumberStr} Note Posted: ${episode.title}`,
            body: `A new note has been posted on alert episode ${episodeNumberStr} in ${episode.project!.name!}. Click to view details.`,
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
          alertEpisodeId: episode.id!,
          eventType,
        });
      },
    );

    if (isTold) {
      moreEpisodeFeedInformationInMarkdown += feedLine(user);
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
    recordNoun: "alert episode",
    isProjectOwners: !doesResourceHasOwners,
    isPrivateNote: true,
  });

  await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
    alertEpisodeId: episode.id!,
    projectId: episode.projectId!,
    alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: episodeFeedText,
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
