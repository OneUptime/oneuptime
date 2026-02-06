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
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentEpisodeOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Get all state timelines that need owner notification
    const episodeStateTimelines: Array<IncidentEpisodeStateTimeline> =
      await IncidentEpisodeStateTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
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
        },
      });

    for (const episodeStateTimeline of episodeStateTimelines) {
      const episodeId: ObjectID = episodeStateTimeline.incidentEpisodeId!;

      if (!episodeId) {
        continue;
      }

      // Get the incident episode
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: episodeId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            title: true,
            projectId: true,
            description: true,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
            incidentSeverity: {
              name: true,
            },
          },
        });

      if (!episode) {
        continue;
      }

      const incidentState: IncidentState = episodeStateTimeline.incidentState!;

      await IncidentEpisodeStateTimelineService.updateOneById({
        id: episodeStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Fetch the previous state timeline entry
      let previousState: IncidentState | null = null;
      let previousStateDuration: string = "";

      if (
        episodeStateTimeline.incidentEpisodeId &&
        episodeStateTimeline.startsAt
      ) {
        const previousTimeline: IncidentEpisodeStateTimeline | null =
          await IncidentEpisodeStateTimelineService.findOneBy({
            query: {
              incidentEpisodeId: episodeStateTimeline.incidentEpisodeId,
              startsAt: QueryHelper.lessThan(episodeStateTimeline.startsAt),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              incidentStateId: true,
              startsAt: true,
              createdAt: true,
            },
          });

        if (previousTimeline?.incidentStateId) {
          previousState = await IncidentStateService.findOneById({
            id: previousTimeline.incidentStateId,
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
            const durationInSeconds: number =
              OneUptimeDate.getDifferenceInSeconds(
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

      // Find owners
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> = await IncidentEpisodeService.findOwners(
        episode.id!,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;
        owners = await ProjectService.getOwners(
          episodeStateTimeline.projectId!,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      let moreEpisodeFeedInformationInMarkdown: string = "";

      const episodeNumberStr: string = episode.episodeNumberWithPrefix
        || (episode.episodeNumber
          ? `#${episode.episodeNumber}`
          : "");

      for (const user of owners) {
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
          currentStateColor: incidentState!.color?.toString() || "#000000",
          previousState: previousState?.name || "",
          previousStateColor: previousState?.color?.toString() || "#6b7280",
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
          subject: `[Incident Episode ${episodeNumberStr} ${Text.uppercaseFirstLetter(
            incidentState!.name!,
          )}] - ${episode.title!}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Incident Episode ${episodeIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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

        moreEpisodeFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: episodeStateTimeline.projectId!,
          },
        )}\n`;
      }

      const episodeDisplayNumber: string = episode.episodeNumberWithPrefix || '#' + episode.episodeNumber;
      const projectId: ObjectID = episode.projectId!;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id!,
        projectId: episode.projectId!,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Incident Episode ${episodeDisplayNumber}](${(await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}).**: Owners have been notified about the state change of the incident episode because the episode state changed to **${incidentState.name}**.`,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
