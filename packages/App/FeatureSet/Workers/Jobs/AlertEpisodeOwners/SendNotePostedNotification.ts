import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ProjectService from "Common/Server/Services/ProjectService";
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
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
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

    /*
     * Every note posted on an alert episode and not told of yet, a page at
     * a time, oldest first, each taken by one run alone and told by the run
     * that took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<AlertEpisodeInternalNote>({
      jobName: "AlertEpisodeOwner:SendsNotePostedEmail",
      service: AlertEpisodeInternalNoteService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: NOTE_SELECT,
      deadline: deadline,
      readPage: readEpisodesOfPage,
      notify: async (input: {
        record: AlertEpisodeInternalNote;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfNote({
          note: input.record,
          page: input.page,
          take: input.take,
        });
      },
    });
  },
);

/*
 * One note read by the run: whom it tells planned, the note taken, and -
 * when this run took it - its owners told.
 */
async function notifyOfNote(data: {
  note: AlertEpisodeInternalNote;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const note: AlertEpisodeInternalNote = data.note;
  const episodeId: ObjectID | undefined = note.alertEpisodeId;

  // Read with the page's episodes.
  const episode: AlertEpisode | null = episodeId
    ? await data.page.once(
        episodeKey(episodeId),
        (): Promise<AlertEpisode | null> => {
          return readEpisode(episodeId);
        },
      )
    : null;

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
        // Each read once for every note of the page.
        findOwners: (): Promise<Array<User>> => {
          return data.page.once(`owners:${episode.id!.toString()}`, () => {
            return AlertEpisodeService.findOwners(episode.id!);
          });
        },
        findProjectOwners: (): Promise<Array<User>> => {
          return data.page.once(
            `projectOwners:${episode.projectId!.toString()}`,
            () => {
              return ProjectService.getOwners(episode.projectId!);
            },
          );
        },
        writesFeedItem: true,
      })
    : null;

  /*
   * Marked as notified before its owners are told, so a note whose
   * notification keeps failing is never read again on every run - one
   * whose episode is gone too. Taken by another run first: that run tells
   * them.
   */
  if (!(await data.take())) {
    return;
  }

  if (!episode || !delivery) {
    return;
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

function episodeKey(episodeId: ObjectID): string {
  return `episode:${episodeId.toString()}`;
}

/*
 * The episodes of a page's notes, in one query: each is read once however
 * many of its notes the page has.
 */
async function readEpisodesOfPage(
  notes: Array<AlertEpisodeInternalNote>,
  page: OwnerNotificationPage,
): Promise<void> {
  const episodeIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const note of notes) {
    if (note.alertEpisodeId) {
      episodeIds.set(note.alertEpisodeId.toString(), note.alertEpisodeId);
    }
  }

  if (episodeIds.size === 0) {
    return;
  }

  const episodes: Array<AlertEpisode> = await AlertEpisodeService.findBy({
    query: {
      _id: QueryHelper.any(Array.from(episodeIds.values())),
    },
    select: EPISODE_SELECT,
    limit: episodeIds.size,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  /*
   * One not found - gone since its note was read - is read on its own when
   * a note asks for it, as it would be without the page.
   */
  for (const each of episodes) {
    if (each.id) {
      page.prime<AlertEpisode | null>(episodeKey(each.id), each);
    }
  }
}

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
function feedLineMarkdown(user: User): string {
  return OwnerNotificationFeedText.notifiedLineMarkdown(
    OwnerNotificationFeedText.personName({
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
    .map(feedLineMarkdown)
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
