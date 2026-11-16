import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeOwnerTeamService from "Common/Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "Common/Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { ownersToTell, tellOwnersAdded } from "../../Utils/OwnersAdded";

// What the episode the owners were added to is read with.
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
  "AlertEpisodeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the alert episode as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertEpisodeOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episode: AlertEpisode | null = await readAlertEpisode(
          delivery.notification.resourceId,
        );

        if (!episode) {
          await delivery.giveUp("the alert episode is gone");
          return;
        }

        await notifyOwnersAdded({
          episode: episode,
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every record's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between records at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<AlertEpisode>({
      jobName: "AlertEpisodeOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.AlertEpisodeOwnerAdded,
      recordIdColumn: "alertEpisodeId",
      teamService: AlertEpisodeOwnerTeamService,
      userService: AlertEpisodeOwnerUserService,
      recordService: AlertEpisodeService,
      recordSelect: EPISODE_SELECT,
      deadline: deadline,
      tell: async (
        record: AlertEpisode,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          episode: record,
          deliveries: deliveries,
        });
      },
    });
  },
);

async function readAlertEpisode(
  alertEpisodeId: ObjectID,
): Promise<AlertEpisode | null> {
  return await AlertEpisodeService.findOneById({
    id: alertEpisodeId,
    props: {
      isRoot: true,
    },
    select: EPISODE_SELECT,
  });
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * alert episode, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  episode: AlertEpisode;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const episode: AlertEpisode = data.episode;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const episodeNumber: string =
    episode.episodeNumberWithPrefix ||
    (episode.episodeNumber ? `#${episode.episodeNumber}` : "");

  const vars: Dictionary<string> = {
    episodeTitle: episode.title!,
    episodeNumber: episodeNumber,
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
    episodeViewLink: (
      await AlertEpisodeService.getEpisodeLinkInDashboard(
        episode.projectId!,
        episode.id!,
      )
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const episodeIdentifier: string =
          episode.episodeNumber !== undefined
            ? `${episodeNumber} (${episode.title})`
            : episode.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Alert Episode ${episodeNumber} - ${episode.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the alert episode ${episodeIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the alert episode ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Alert Episode ${episodeNumber} Owner`,
            body: `You have been added as the owner of the alert episode ${episodeIdentifier}. Click to view details.`,
            clickAction: (
              await AlertEpisodeService.getEpisodeLinkInDashboard(
                episode.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "alert-episode-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION;

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
      });
    }
  }
}
