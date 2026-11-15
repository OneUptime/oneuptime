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
import AlertEpisodeOwnerTeamService from "Common/Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "Common/Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  OwnerRowAdded,
  ownersToTell,
  planOwnersAdded,
} from "../../Utils/OwnersAdded";

RunCron(
  "AlertEpisodeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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

    const episodeOwnerTeams: Array<AlertEpisodeOwnerTeam> =
      await AlertEpisodeOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertEpisodeId: true,
          teamId: true,
        },
      });

    const episodeOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const episodeOwnerTeam of episodeOwnerTeams) {
      const alertEpisodeId: ObjectID = episodeOwnerTeam.alertEpisodeId!;
      const teamId: ObjectID = episodeOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (episodeOwnersMap[alertEpisodeId.toString()] === undefined) {
        episodeOwnersMap[alertEpisodeId.toString()] = [];
      }

      (
        episodeOwnersMap[alertEpisodeId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: episodeOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const episodeOwnerUsers: Array<AlertEpisodeOwnerUser> =
      await AlertEpisodeOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertEpisodeId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const episodeOwnerUser of episodeOwnerUsers) {
      const alertEpisodeId: ObjectID = episodeOwnerUser.alertEpisodeId!;
      const user: User = episodeOwnerUser.user!;

      if (episodeOwnersMap[alertEpisodeId.toString()] === undefined) {
        episodeOwnersMap[alertEpisodeId.toString()] = [];
      }

      (
        episodeOwnersMap[alertEpisodeId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: episodeOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const alertEpisodeId in episodeOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        episodeOwnersMap[alertEpisodeId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const episode: AlertEpisode | null = await readAlertEpisode(
        new ObjectID(alertEpisodeId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = episode
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.AlertEpisodeOwnerAdded,
            projectId: episode.projectId!,
            resourceId: episode.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose alert episode is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await AlertEpisodeOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await AlertEpisodeOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!episode) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          episode: episode,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error(
          "Error in sending alert episode owner added notification",
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

async function readAlertEpisode(
  alertEpisodeId: ObjectID,
): Promise<AlertEpisode | null> {
  return await AlertEpisodeService.findOneById({
    id: alertEpisodeId,
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
        color: true,
      },
      alertSeverity: {
        name: true,
        color: true,
      },
      episodeNumber: true,
      episodeNumberWithPrefix: true,
    },
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
