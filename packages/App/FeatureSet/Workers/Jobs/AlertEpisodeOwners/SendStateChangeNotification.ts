import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
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
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "Common/Server/Services/AlertEpisodeStateTimelineService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each state change is read with.
const STATE_TIMELINE_SELECT: Select<AlertEpisodeStateTimeline> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  projectId: true,
  project: {
    name: true,
  },
  alertEpisodeId: true,
  alertStateId: true,
  alertState: {
    name: true,
    color: true,
  },
};

// What the episode of a state change is read with.
const EPISODE_SELECT: Select<AlertEpisode> = {
  _id: true,
  title: true,
  projectId: true,
  description: true,
  episodeNumber: true,
  episodeNumberWithPrefix: true,
  alertSeverity: {
    name: true,
    color: true,
  },
};

RunCron(
  "AlertEpisodeOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertEpisodeStateChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episodeStateTimeline: AlertEpisodeStateTimeline | null =
          await AlertEpisodeStateTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATE_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const episode: AlertEpisode | null = episodeStateTimeline
          ? await readEpisode(delivery.notification.resourceId)
          : null;

        if (!episodeStateTimeline || !episode) {
          await delivery.giveUp(
            "the alert episode or its state change is gone",
          );
          return;
        }

        await notifyOwnersOfStateChange({
          episodeStateTimeline: episodeStateTimeline,
          episode: episode,
          delivery: delivery,
        });
      },
    });

    // Get all state timelines that need owner notification
    const episodeStateTimelines: Array<AlertEpisodeStateTimeline> =
      await AlertEpisodeStateTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: STATE_TIMELINE_SELECT,
      });

    for (const episodeStateTimeline of episodeStateTimelines) {
      const episodeId: ObjectID = episodeStateTimeline.alertEpisodeId!;

      if (!episodeId) {
        continue;
      }

      // Get the alert episode
      const episode: AlertEpisode | null = await readEpisode(episodeId);

      if (!episode) {
        continue;
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
            kind: OwnerNotificationKind.AlertEpisodeStateChanged,
            projectId: episodeStateTimeline.projectId!,
            resourceId: episode.id!,
            eventId: episodeStateTimeline.id!,
          },
          findOwners: () => {
            return AlertEpisodeService.findOwners(episode.id!);
          },
          writesFeedItem: true,
        });

      await AlertEpisodeStateTimelineService.updateOneById({
        id: episodeStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfStateChange({
          episodeStateTimeline: episodeStateTimeline,
          episode: episode,
          delivery: delivery,
        });
      } catch (e) {
        logger.error(
          "Error in sending alert episode state change notification",
          {
            projectId: episode.projectId?.toString(),
            alertEpisodeId: episode.id?.toString(),
          },
        );
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

/*
 * Tells the delivery's owners that the episode's state changed, each once
 * (OwnerNotificationDelivery.tell), and says in the episode's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfStateChange(data: {
  episodeStateTimeline: AlertEpisodeStateTimeline;
  episode: AlertEpisode;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const episodeStateTimeline: AlertEpisodeStateTimeline =
    data.episodeStateTimeline;
  const episode: AlertEpisode = data.episode;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const alertState: AlertState = episodeStateTimeline.alertState!;

  // Fetch the previous state timeline entry
  let previousState: AlertState | null = null;
  let previousStateDuration: string = "";

  if (episodeStateTimeline.alertEpisodeId && episodeStateTimeline.startsAt) {
    const previousTimeline: AlertEpisodeStateTimeline | null =
      await AlertEpisodeStateTimelineService.findOneBy({
        query: {
          alertEpisodeId: episodeStateTimeline.alertEpisodeId,
          startsAt: QueryHelper.lessThan(episodeStateTimeline.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          startsAt: true,
          createdAt: true,
        },
      });

    if (previousTimeline?.alertStateId) {
      previousState = await AlertStateService.findOneById({
        id: previousTimeline.alertStateId,
        props: {
          isRoot: true,
        },
        select: {
          name: true,
          color: true,
        },
      });

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
          currentState: alertState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            alertState!.color,
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
          episodeSeverity: episode.alertSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.alertSeverity?.color,
          ),
          episodeViewLink: (
            await AlertEpisodeService.getEpisodeLinkInDashboard(
              episodeStateTimeline.projectId!,
              episode.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerStateChanged,
          vars: vars,
          subject: `[${Text.uppercaseFirstLetter(
            alertState!.name!,
          )} Alert Episode ${episodeNumberStr}] - ${episode.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Alert Episode ${episodeIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
              .name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Alert Episode ${
                episodeIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert Episode ${episodeNumberStr} State Changed: ${episode.title}`,
            body: `Alert episode ${episodeNumberStr} state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!.name!} in ${episodeStateTimeline.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertEpisodeService.getEpisodeLinkInDashboard(
                episodeStateTimeline.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "alert-episode-state-changed",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              episode_state: alertState!.name!,
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
          alertEpisodeId: episode.id!,
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

  await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
    alertEpisodeId: episode.id!,
    projectId: episode.projectId!,
    alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: OwnerNotificationFeedText.stateChanged({
      isProjectOwners: !doesResourceHasOwners,
      recordNoun: "alert episode",
      stateName: alertState.name,
    }),
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
