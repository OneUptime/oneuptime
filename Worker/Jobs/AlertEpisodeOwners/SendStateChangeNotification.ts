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
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertEpisodeOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
        select: {
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
        },
      });

    for (const episodeStateTimeline of episodeStateTimelines) {
      const episodeId: ObjectID = episodeStateTimeline.alertEpisodeId!;

      if (!episodeId) {
        continue;
      }

      // Get the alert episode
      const episode: AlertEpisode | null =
        await AlertEpisodeService.findOneById({
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
            alertSeverity: {
              name: true,
            },
          },
        });

      if (!episode) {
        continue;
      }

      const alertState: AlertState = episodeStateTimeline.alertState!;

      await AlertEpisodeStateTimelineService.updateOneById({
        id: episodeStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Fetch the previous state timeline entry
      let previousState: AlertState | null = null;
      let previousStateDuration: string = "";

      if (
        episodeStateTimeline.alertEpisodeId &&
        episodeStateTimeline.startsAt
      ) {
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
      let owners: Array<User> = await AlertEpisodeService.findOwners(
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
          currentState: alertState!.name!,
          currentStateColor: alertState!.color?.toString() || "#000000",
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
          episodeSeverity: episode.alertSeverity?.name || "Not Set",
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
          subject: `[Alert Episode ${episodeNumberStr} ${Text.uppercaseFirstLetter(
            alertState!.name!,
          )}] - ${episode.title!}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Alert Episode ${episodeIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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

        moreEpisodeFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: episodeStateTimeline.projectId!,
          },
        )}\n`;
      }

      const episodeDisplayNumber: string = episode.episodeNumberWithPrefix || '#' + episode.episodeNumber;
      const projectId: ObjectID = episode.projectId!;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id!,
        projectId: episode.projectId!,
        alertEpisodeFeedEventType:
          AlertEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Alert Episode ${episodeDisplayNumber}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}).**: Owners have been notified about the state change of the alert episode because the episode state changed to **${alertState.name}**.`,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
