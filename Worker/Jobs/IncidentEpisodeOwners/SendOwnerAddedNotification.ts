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
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentEpisodeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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

    const episodeOwnersMap: Dictionary<Array<User>> = {};

    for (const episodeOwnerTeam of episodeOwnerTeams) {
      const episodeId: ObjectID = episodeOwnerTeam.incidentEpisodeId!;
      const teamId: ObjectID = episodeOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (episodeOwnersMap[episodeId.toString()] === undefined) {
        episodeOwnersMap[episodeId.toString()] = [];
      }

      for (const user of users) {
        (episodeOwnersMap[episodeId.toString()] as Array<User>).push(user);
      }

      // Mark this as notified
      await IncidentEpisodeOwnerTeamService.updateOneById({
        id: episodeOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
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
      const episodeId: ObjectID = episodeOwnerUser.incidentEpisodeId!;
      const user: User = episodeOwnerUser.user!;

      if (episodeOwnersMap[episodeId.toString()] === undefined) {
        episodeOwnersMap[episodeId.toString()] = [];
      }

      (episodeOwnersMap[episodeId.toString()] as Array<User>).push(user);

      // Mark this as notified
      await IncidentEpisodeOwnerUserService.updateOneById({
        id: episodeOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // Send email to all of these users
    for (const episodeId in episodeOwnersMap) {
      if (!episodeOwnersMap[episodeId]) {
        continue;
      }

      if ((episodeOwnersMap[episodeId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = episodeOwnersMap[episodeId] as Array<User>;

      // Get the incident episode
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: new ObjectID(episodeId),
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
            },
            incidentSeverity: {
              name: true,
            },
            episodeNumber: true,
            episodeNumberWithPrefix: true,
          },
        });

      if (!episode) {
        continue;
      }

      const episodeNumber: string =
        episode.episodeNumberWithPrefix ||
        (episode.episodeNumber ? `#${episode.episodeNumber}` : "");

      const vars: Dictionary<string> = {
        episodeTitle: episode.title!,
        episodeNumber: episodeNumber,
        projectName: episode.project!.name!,
        currentState: episode.currentIncidentState!.name!,
        episodeDescription: await Markdown.convertToHTML(
          episode.description! || "",
          MarkdownContentType.Email,
        ),
        episodeSeverity: episode.incidentSeverity?.name || "Not Set",
        episodeViewLink: (
          await IncidentEpisodeService.getEpisodeLinkInDashboard(
            episode.projectId!,
            episode.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const episodeIdentifier: string =
          episode.episodeNumber !== undefined
            ? `${episodeNumber} (${episode.title})`
            : episode.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentEpisodeOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Incident Episode ${episodeNumber} - ${episode.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the incident episode ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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
      }
    }
  },
);
