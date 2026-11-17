import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import PreviousTimelineEntries, {
  TimelineOf,
} from "../../Utils/PreviousTimelineEntries";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import User from "Common/Models/DatabaseModels/User";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each state change is read with.
const STATE_TIMELINE_SELECT: Select<IncidentEpisodeStateTimeline> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  projectId: true,
  project: {
    name: true,
  },
  incidentEpisodeId: true,
  incidentStateId: true,
  incidentState: {
    name: true,
    color: true,
  },
};

// What the episode of a state change is read with.
const EPISODE_SELECT: Select<IncidentEpisode> = {
  _id: true,
  title: true,
  projectId: true,
  description: true,
  episodeNumber: true,
  episodeNumberWithPrefix: true,
  incidentSeverity: {
    name: true,
    color: true,
  },
};

/*
 * The entries a state change's previous one is read from, and what it is read
 * with: for "Was ... for ..." in its email (PreviousTimelineEntries).
 */
const TIMELINE: TimelineOf<IncidentEpisodeStateTimeline> = {
  service: IncidentEpisodeStateTimelineService,
  recordIdColumn: "incidentEpisodeId",
  select: {
    incidentStateId: true,
    startsAt: true,
    createdAt: true,
  },
};

RunCron(
  "IncidentEpisodeOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentEpisodeStateChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episodeStateTimeline: IncidentEpisodeStateTimeline | null =
          await IncidentEpisodeStateTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATE_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const episode: IncidentEpisode | null = episodeStateTimeline
          ? await readEpisode(delivery.notification.resourceId)
          : null;

        if (!episodeStateTimeline || !episode) {
          await delivery.giveUp(
            "the incident episode or its state change is gone",
          );
          return;
        }

        await notifyOwnersOfStateChange({
          episodeStateTimeline: episodeStateTimeline,
          episode: episode,
          delivery: delivery,
          page: new OwnerNotificationPage(),
        });
      },
    });

    /*
     * Every state change nobody has been told about yet, a page at a time,
     * oldest first, each taken by one run alone and told by the run that
     * took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #7974).
     */
    await OwnerNotificationBacklog.forEachToNotify<IncidentEpisodeStateTimeline>(
      {
        jobName: "IncidentEpisodeOwner:SendStateChangeEmail",
        service: IncidentEpisodeStateTimelineService,
        notYetNotified: {
          isOwnerNotified: false,
        },
        notified: {
          isOwnerNotified: true,
        },
        select: STATE_TIMELINE_SELECT,
        deadline: deadline,
        readPage: readPageOfStateChanges,
        notify: async (input: {
          record: IncidentEpisodeStateTimeline;
          page: OwnerNotificationPage;
          take: () => Promise<boolean>;
        }): Promise<void> => {
          await notifyOfStateChange({
            episodeStateTimeline: input.record,
            page: input.page,
            take: input.take,
          });
        },
      },
    );
  },
);

/*
 * One state change read by the run: whom it tells planned, the state change
 * taken, and - when this run took it - its owners told.
 */
async function notifyOfStateChange(data: {
  episodeStateTimeline: IncidentEpisodeStateTimeline;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const episodeStateTimeline: IncidentEpisodeStateTimeline =
    data.episodeStateTimeline;
  const episodeId: ObjectID | undefined =
    episodeStateTimeline.incidentEpisodeId;
  const page: OwnerNotificationPage = data.page;

  const episode: IncidentEpisode | null = episodeId
    ? await page.once(
        episodeKey(episodeId),
        (): Promise<IncidentEpisode | null> => {
          return readEpisode(episodeId);
        },
      )
    : null;

  /*
   * The episode is gone: nobody can be told of its state change. Taken
   * all the same, so no run reads it again.
   */
  if (!episode) {
    await data.take();
    return;
  }

  /*
   * Whom it is to tell - the episode's owners, or the project's when it
   * has none - written before the take: a worker stopped from here on
   * leaves them to be told by a later run, and one stopped before the
   * take leaves the state change to be read again.
   */
  const delivery: OwnerNotificationDelivery =
    await OwnerNotificationDeliveries.planForOwnersOf({
      notification: {
        kind: OwnerNotificationKind.IncidentEpisodeStateChanged,
        projectId: episodeStateTimeline.projectId!,
        resourceId: episode.id!,
        eventId: episodeStateTimeline.id!,
      },
      // Each read once for every state change of the page.
      findOwners: (): Promise<Array<User>> => {
        return page.once(`owners:${episode.id!.toString()}`, () => {
          return IncidentEpisodeService.findOwners(episode.id!);
        });
      },
      findProjectOwners: (): Promise<Array<User>> => {
        return page.once(
          `projectOwners:${episodeStateTimeline.projectId!.toString()}`,
          () => {
            return ProjectService.getOwners(episodeStateTimeline.projectId!);
          },
        );
      },
      writesFeedItem: true,
    });

  // Taken by another run first, or gone: that run tells the owners.
  if (!(await data.take())) {
    return;
  }

  try {
    await notifyOwnersOfStateChange({
      episodeStateTimeline: episodeStateTimeline,
      episode: episode,
      delivery: delivery,
      page: page,
    });
  } catch (e) {
    logger.error(
      "Error in sending incident episode state change notification",
      {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      },
    );
    logger.error(e, {
      projectId: episode.projectId?.toString(),
      incidentEpisodeId: episode.id?.toString(),
    });
  }
}

function episodeKey(episodeId: ObjectID): string {
  return `episode:${episodeId.toString()}`;
}

/*
 * What every state change of a page needs, read once for the page: the
 * episodes they are of (readEpisodesOfPage), and the entry before each
 * (PreviousTimelineEntries: two reads per episode with more than one of
 * them on the page, instead of one per state change).
 */
async function readPageOfStateChanges(
  entries: Array<IncidentEpisodeStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  await readEpisodesOfPage(entries, page);

  await PreviousTimelineEntries.readForPage({
    ...TIMELINE,
    entries: entries,
    page: page,
  });
}

/*
 * The episodes of a page's state changes, in one query: each is read once
 * however many of its state changes the page has.
 */
async function readEpisodesOfPage(
  episodeStateTimelines: Array<IncidentEpisodeStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  const episodeIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const episodeStateTimeline of episodeStateTimelines) {
    if (episodeStateTimeline.incidentEpisodeId) {
      episodeIds.set(
        episodeStateTimeline.incidentEpisodeId.toString(),
        episodeStateTimeline.incidentEpisodeId,
      );
    }
  }

  if (episodeIds.size === 0) {
    return;
  }

  const episodes: Array<IncidentEpisode> = await IncidentEpisodeService.findBy({
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
   * One not found - gone since its state change was read - is read on its
   * own when a record asks for it, as it would be without the page.
   */
  for (const each of episodes) {
    if (each.id) {
      page.prime<IncidentEpisode | null>(episodeKey(each.id), each);
    }
  }
}

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

/*
 * Tells the delivery's owners that the episode's state changed, each once
 * (OwnerNotificationDelivery.tell), and says in the episode's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfStateChange(data: {
  episodeStateTimeline: IncidentEpisodeStateTimeline;
  episode: IncidentEpisode;
  delivery: OwnerNotificationDelivery;
  // What the state changes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<void> {
  const episodeStateTimeline: IncidentEpisodeStateTimeline =
    data.episodeStateTimeline;
  const episode: IncidentEpisode = data.episode;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const incidentState: IncidentState = episodeStateTimeline.incidentState!;

  // Fetch the previous state timeline entry
  let previousState: IncidentState | null = null;
  let previousStateDuration: string = "";

  if (episodeStateTimeline.incidentEpisodeId && episodeStateTimeline.startsAt) {
    const previousTimeline: IncidentEpisodeStateTimeline | null =
      // Read with the page's other state changes of the episode, or on its own (#8863).
      await PreviousTimelineEntries.of({
        ...TIMELINE,
        entry: episodeStateTimeline,
        page: data.page,
      });

    if (previousTimeline?.incidentStateId) {
      const previousStateId: ObjectID = previousTimeline.incidentStateId;

      // A project's few states, each read once for the page.
      previousState = await data.page.once(
        `incidentState:${previousStateId.toString()}`,
        (): Promise<IncidentState | null> => {
          return IncidentStateService.findOneById({
            id: previousStateId,
            props: {
              isRoot: true,
            },
            select: {
              name: true,
              color: true,
            },
          });
        },
      );

      const previousStartTime: Date | undefined =
        previousTimeline.startsAt || previousTimeline.createdAt;
      const currentStartTime: Date | undefined =
        episodeStateTimeline.startsAt || episodeStateTimeline.createdAt;

      if (previousStartTime && currentStartTime) {
        const durationInSeconds: number = OneUptimeDate.getDifferenceInSeconds(
          currentStartTime,
          previousStartTime,
        );
        previousStateDuration =
          OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
            durationInSeconds,
          );
      }
    }
  }

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  let moreEpisodeFeedInformationInMarkdown: string = "";

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreEpisodeFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        await UserService.getUserMarkdownString({
          userId: user.id!,
          projectId: episodeStateTimeline.projectId!,
        }),
      );
  }

  const episodeNumberStr: string =
    episode.episodeNumberWithPrefix ||
    (episode.episodeNumber ? `#${episode.episodeNumber}` : "");

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const episodeIdentifier: string =
          episode.episodeNumber !== undefined
            ? `${episodeNumberStr} (${episode.title})`
            : episode.title!;

        // Build the "Was X for Y" string
        const previousStateDurationText: string =
          previousState?.name && previousStateDuration
            ? `Was ${previousState.name} for ${previousStateDuration}`
            : "";

        const vars: Dictionary<string> = {
          episodeTitle: episode.title!,
          episodeNumber: episodeNumberStr,
          projectName: episodeStateTimeline.project!.name!,
          currentState: incidentState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            incidentState!.color,
          ),
          previousState: previousState?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "previousState",
            previousState?.color,
          ),
          previousStateDurationText: previousStateDurationText,
          episodeDescription: await Markdown.convertToHTML(
            episode.description! || "",
            MarkdownContentType.Email,
          ),
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: episodeStateTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          episodeSeverity: episode.incidentSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.incidentSeverity?.color,
          ),
          episodeViewLink: (
            await IncidentEpisodeService.getEpisodeLinkInDashboard(
              episodeStateTimeline.projectId!,
              episode.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentEpisodeOwnerStateChanged,
          vars: vars,
          subject: `[${Text.uppercaseFirstLetter(
            incidentState!.name!,
          )} Incident Episode ${episodeNumberStr}] - ${episode.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Incident Episode ${episodeIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
              .name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Incident Episode ${
                episodeIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Incident Episode ${episodeNumberStr} State Changed: ${episode.title}`,
            body: `Incident episode ${episodeNumberStr} state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!.name!} in ${episodeStateTimeline.project!.name!}. Click to view details.`,
            clickAction: (
              await IncidentEpisodeService.getEpisodeLinkInDashboard(
                episodeStateTimeline.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "incident-episode-state-changed",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              episode_state: incidentState!.name!,
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
          projectId: episodeStateTimeline.projectId!,
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
      moreEpisodeFeedInformationInMarkdown +=
        OwnerNotificationFeedText.notifiedLineMarkdown(
          await UserService.getUserMarkdownString({
            userId: user.id!,
            projectId: episodeStateTimeline.projectId!,
          }),
        );
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

  await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
    incidentEpisodeId: episode.id!,
    projectId: episode.projectId!,
    incidentEpisodeFeedEventType:
      IncidentEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: OwnerNotificationFeedText.stateChanged({
      isProjectOwners: !doesResourceHasOwners,
      recordNoun: "incident episode",
      stateName: incidentState.name,
    }),
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
