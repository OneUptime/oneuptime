import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ProjectService from "Common/Server/Services/ProjectService";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
  OwnerNotificationOf,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import OwnersReachedByAPage from "Common/Server/Utils/Notification/OwnersReachedByAPage";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { MarkdownText } from "Common/Utils/Markdown/FeedMarkdown";

// What an episode is read with.
const EPISODE_SELECT: Select<AlertEpisode> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
  currentAlertState: {
    name: true,
    color: true,
  } as Select<AlertState>,
  alertSeverity: {
    name: true,
    color: true,
  },
  createdByUser: {
    name: true,
    email: true,
  },
  episodeNumber: true,
  episodeNumberWithPrefix: true,
  createdAt: true,
};

RunCron(
  "AlertEpisodeOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertEpisodeCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episode: AlertEpisode | null =
          await AlertEpisodeService.findOneById({
            id: delivery.notification.resourceId,
            select: EPISODE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!episode) {
          await delivery.giveUp("the alert episode is gone");
          return;
        }

        await notifyOwnersOfEpisodeCreated(episode, delivery);
      },
    });

    /*
     * Every episode whose owners have not been told it was created, a page at a
     * time, oldest first, each taken by one run alone and told by the run
     * that took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<AlertEpisode>({
      jobName: "AlertEpisodeOwner:SendCreatedResourceEmail",
      service: AlertEpisodeService,
      notYetNotified: {
        isOwnerNotifiedOfEpisodeCreation: false,
      },
      notified: {
        isOwnerNotifiedOfEpisodeCreation: true,
      },
      select: EPISODE_SELECT,
      deadline: deadline,
      notify: async (input: {
        record: AlertEpisode;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        const episode: AlertEpisode = input.record;
        const notification: OwnerNotificationOf = {
          kind: OwnerNotificationKind.AlertEpisodeCreated,
          projectId: episode.projectId!,
          resourceId: episode.id!,
          eventId: episode.id!,
        };

        /*
         * Whom it is to tell - its owners, or the project's when it has none -
         * written before the take: a worker stopped from here on leaves them to
         * be told by a later run, and one stopped before the take leaves the
         * episode to be read again.
         */
        const delivery: OwnerNotificationDelivery =
          await OwnerNotificationDeliveries.planForOwnersOf({
            notification: notification,
            findOwners: () => {
              return AlertEpisodeService.findOwners(episode.id!);
            },
            // Read once for every record of the page.
            findProjectOwners: (): Promise<Array<User>> => {
              return input.page.once(
                `projectOwners:${episode.projectId!.toString()}`,
                () => {
                  return ProjectService.getOwners(episode.projectId!);
                },
              );
            },
            writesFeedItem: true,
            /*
             * Not those the episode's on-call page reached already: someone
             * who is on call and an owner is told of the episode once, not
             * twice (#7987).
             */
            findOwnersToLeaveOut: (
              owners: Array<User>,
            ): Promise<Array<User>> => {
              return OwnersReachedByAPage.findAmong({
                notification: notification,
                owners: owners,
              });
            },
          });

        /*
         * Taken - marked notified, by one hook-free compare-and-set - before
         * its owners are told, so one whose notification keeps failing is
         * never read again on every run. Taken by another run first: that run
         * tells them.
         */
        if (!(await input.take())) {
          return;
        }

        try {
          await notifyOwnersOfEpisodeCreated(episode, delivery);
        } catch (e) {
          logger.error(
            "Error in sending alert episode created resource notification",
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
      },
    });
  },
);

// A person, as the episode's feed names them: "Ana Lopez (ana@acme.com)".
function personMarkdown(user: User): MarkdownText {
  return OwnerNotificationFeedText.personName({
    name: user.name?.toString(),
    email: user.email?.toString(),
  });
}

// A person told, as the episode's feed names them.
function feedLineMarkdown(user: User): string {
  return OwnerNotificationFeedText.notifiedLineMarkdown(personMarkdown(user));
}

/*
 * Tells the delivery's owners that the episode was created, each once
 * (OwnerNotificationDelivery.tell), and says in the episode's feed whom it
 * reached - those a stopped run told first among them - and whom it left
 * out, as the episode's on-call page reached them already.
 */
async function notifyOwnersOfEpisodeCreated(
  episode: AlertEpisode,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const episodeDisplayNumber: string =
    episode.episodeNumberWithPrefix || "#" + episode.episodeNumber;

  // Whom a run that stopped part way told already.
  let moreEpisodeFeedInformationInMarkdown: string = delivery.toldEarlier
    .map(feedLineMarkdown)
    .join("");

  const episodeCreatedDate: Date = episode.createdAt!;

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  let declaredBy: string = "OneUptime";

  if (
    episode.createdByUser &&
    episode.createdByUser.name &&
    episode.createdByUser.email
  ) {
    declaredBy = `${episode.createdByUser.name.toString()} (${episode.createdByUser.email.toString()})`;
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

        const vars: Dictionary<string> = {
          episodeTitle: episode.title!,
          episodeNumber: episodeNumberStr,
          projectName: episode.project!.name!,
          currentState: episode.currentAlertState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            episode.currentAlertState?.color,
          ),
          episodeDescription: await Markdown.convertToHTML(
            episode.description! || "",
            MarkdownContentType.Email,
          ),
          episodeSeverity: episode.alertSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.alertSeverity?.color,
          ),
          declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: episodeCreatedDate,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          declaredBy: declaredBy,
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

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerResourceCreated,
          vars: vars,
          subject: `[New Alert Episode ${episodeNumberStr}] - ${episode.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New alert episode created: ${episodeIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New alert episode created: ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert Episode ${episodeNumberStr} Created: ${episode.title}`,
            body: `A new alert episode ${episodeNumberStr} has been created in ${episode.project!.name!}. Click to view details.`,
            clickAction: vars["episodeViewLink"] || "",
            tag: "alert-episode-created",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              project_name: episode.project!.name!,
              episode_link: vars["episodeViewLink"] || "",
              episode_number: episodeDisplayNumber,
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

  // Whom it left out, named apart from those notified (OwnersReachedByAPage).
  moreEpisodeFeedInformationInMarkdown +=
    OwnerNotificationFeedText.reachedByPageMarkdown(
      delivery.leftOut.map(personMarkdown),
    );

  await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
    alertEpisodeId: episode.id!,
    projectId: episode.projectId!,
    alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: OwnerNotificationFeedText.created("alert episode", {
      isProjectOwners: !doesResourceHasOwners,
    }),
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
