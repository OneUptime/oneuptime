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
import IncidentEpisodeOwnerTeamService from "Common/Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "Common/Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
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
  "IncidentEpisodeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the incident episode as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentEpisodeOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episode: IncidentEpisode | null = await readIncidentEpisode(
          delivery.notification.resourceId,
        );

        if (!episode) {
          await delivery.giveUp("the incident episode is gone");
          return;
        }

        await notifyOwnersAdded({
          episode: episode,
          deliveries: [delivery],
        });
      },
    });

    const episodeOwnerTeams: Array<IncidentEpisodeOwnerTeam> =
      await IncidentEpisodeOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          incidentEpisodeId: true,
          teamId: true,
        },
      });

    const episodeOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const episodeOwnerTeam of episodeOwnerTeams) {
      const incidentEpisodeId: ObjectID = episodeOwnerTeam.incidentEpisodeId!;
      const teamId: ObjectID = episodeOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (episodeOwnersMap[incidentEpisodeId.toString()] === undefined) {
        episodeOwnersMap[incidentEpisodeId.toString()] = [];
      }

      (
        episodeOwnersMap[incidentEpisodeId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: episodeOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const episodeOwnerUsers: Array<IncidentEpisodeOwnerUser> =
      await IncidentEpisodeOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          incidentEpisodeId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const episodeOwnerUser of episodeOwnerUsers) {
      const incidentEpisodeId: ObjectID = episodeOwnerUser.incidentEpisodeId!;
      const user: User = episodeOwnerUser.user!;

      if (episodeOwnersMap[incidentEpisodeId.toString()] === undefined) {
        episodeOwnersMap[incidentEpisodeId.toString()] = [];
      }

      (
        episodeOwnersMap[incidentEpisodeId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: episodeOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const incidentEpisodeId in episodeOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        episodeOwnersMap[incidentEpisodeId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const episode: IncidentEpisode | null = await readIncidentEpisode(
        new ObjectID(incidentEpisodeId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = episode
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.IncidentEpisodeOwnerAdded,
            projectId: episode.projectId!,
            resourceId: episode.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose incident episode is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await IncidentEpisodeOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await IncidentEpisodeOwnerUserService.updateOneById({
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
          "Error in sending incident episode owner added notification",
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

async function readIncidentEpisode(
  incidentEpisodeId: ObjectID,
): Promise<IncidentEpisode | null> {
  return await IncidentEpisodeService.findOneById({
    id: incidentEpisodeId,
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
        color: true,
      },
      incidentSeverity: {
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
 * incident episode, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  episode: IncidentEpisode;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const episode: IncidentEpisode = data.episode;

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
    episodeViewLink: (
      await IncidentEpisodeService.getEpisodeLinkInDashboard(
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
          templateType: EmailTemplateType.IncidentEpisodeOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Incident Episode ${episodeNumber} - ${episode.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the incident episode ${episodeIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the incident episode ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Incident Episode ${episodeNumber} Owner`,
            body: `You have been added as the owner of the incident episode ${episodeIdentifier}. Click to view details.`,
            clickAction: (
              await IncidentEpisodeService.getEpisodeLinkInDashboard(
                episode.projectId!,
                episode.id!,
              )
            ).toString(),
            tag: "incident-episode-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION;

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
      });
    }
  }
}
