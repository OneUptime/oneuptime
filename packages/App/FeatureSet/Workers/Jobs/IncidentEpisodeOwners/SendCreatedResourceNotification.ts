import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What an episode is read with.
const EPISODE_SELECT: Select<IncidentEpisode> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
  currentIncidentState: {
    name: true,
    color: true,
  } as Select<IncidentState>,
  incidentSeverity: {
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
  "IncidentEpisodeOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentEpisodeCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episode: IncidentEpisode | null =
          await IncidentEpisodeService.findOneById({
            id: delivery.notification.resourceId,
            select: EPISODE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!episode) {
          await delivery.giveUp("the incident episode is gone");
          return;
        }

        await notifyOwnersOfEpisodeCreated(episode, delivery);
      },
    });

    // Get all incident episodes that need owner notification
    const episodes: Array<IncidentEpisode> =
      await IncidentEpisodeService.findAllBy({
        query: {
          isOwnerNotifiedOfEpisodeCreation: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: EPISODE_SELECT,
      });

    for (const episode of episodes) {
      /*
       * Whom it is to tell - its owners, or the project's when it has none -
       * written before the take: a worker stopped from here on leaves them to
       * be told by a later run, and one stopped before the take leaves the
       * episode to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.IncidentEpisodeCreated,
            projectId: episode.projectId!,
            resourceId: episode.id!,
            eventId: episode.id!,
          },
          findOwners: () => {
            return IncidentEpisodeService.findOwners(episode.id!);
          },
          writesFeedItem: true,
        });

      await IncidentEpisodeService.updateOneById({
        id: episode.id!,
        data: {
          isOwnerNotifiedOfEpisodeCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfEpisodeCreated(episode, delivery);
      } catch (e) {
        logger.error(
          "Error in sending incident episode created resource notification",
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
  },
);

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
 * Tells the delivery's owners that the episode was created, each once
 * (OwnerNotificationDelivery.tell), and says in the episode's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfEpisodeCreated(
  episode: IncidentEpisode,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const episodeDisplayNumber: string =
    episode.episodeNumberWithPrefix || "#" + episode.episodeNumber;

  // Whom a run that stopped part way told already.
  let moreEpisodeFeedInformationInMarkdown: string = delivery.toldEarlier
    .map(feedLine)
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
          currentState: episode.currentIncidentState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            episode.currentIncidentState?.color,
          ),
          episodeDescription: await Markdown.convertToHTML(
            episode.description! || "",
            MarkdownContentType.Email,
          ),
          episodeSeverity: episode.incidentSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.incidentSeverity?.color,
          ),
          declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: episodeCreatedDate,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          declaredBy: declaredBy,
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

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentEpisodeOwnerResourceCreated,
          vars: vars,
          subject: `[New Incident Episode ${episodeNumberStr}] - ${episode.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New incident episode created: ${episodeIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New incident episode created: ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Incident Episode ${episodeNumberStr} Created: ${episode.title}`,
            body: `A new incident episode ${episodeNumberStr} has been created in ${episode.project!.name!}. Click to view details.`,
            clickAction: vars["episodeViewLink"] || "",
            tag: "incident-episode-created",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION;

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
          incidentEpisodeId: episode.id!,
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

  await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
    incidentEpisodeId: episode.id!,
    projectId: episode.projectId!,
    incidentEpisodeFeedEventType:
      IncidentEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: OwnerNotificationFeedText.created("incident episode", {
      isProjectOwners: !doesResourceHasOwners,
    }),
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
