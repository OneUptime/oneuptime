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
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertEpisodeOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Get all alert episodes that need owner notification
    const episodes: Array<AlertEpisode> = await AlertEpisodeService.findAllBy({
      query: {
        isOwnerNotifiedOfEpisodeCreation: false,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
        _id: true,
        title: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        } as Select<Project>,
        currentAlertState: {
          name: true,
        } as Select<AlertState>,
        alertSeverity: {
          name: true,
        },
        createdByUser: {
          name: true,
          email: true,
        },
        episodeNumber: true,
        createdAt: true,
      },
    });

    for (const episode of episodes) {
      const projectId: ObjectID = episode.projectId!;
      const episodeId: ObjectID = episode.id!;
      const episodeNumber: number = episode.episodeNumber!;

      const episodeFeedText: string = `🔔 **Owner Alert Episode Created Notification Sent**:
      Notification sent to owners because [Alert Episode ${episodeNumber}](${(await AlertEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)).toString()}) was created.`;
      let moreEpisodeFeedInformationInMarkdown: string = "";

      const episodeCreatedDate: Date = episode.createdAt!;

      await AlertEpisodeService.updateOneById({
        id: episode.id!,
        data: {
          isOwnerNotifiedOfEpisodeCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      // Find owners
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> = await AlertEpisodeService.findOwners(
        episode.id!,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;
        // Fall back to project owners
        owners = await ProjectService.getOwners(episode.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      let declaredBy: string = "OneUptime";

      if (
        episode.createdByUser &&
        episode.createdByUser.name &&
        episode.createdByUser.email
      ) {
        declaredBy = `${episode.createdByUser.name.toString()} (${episode.createdByUser.email.toString()})`;
      }

      const episodeNumberStr: string = episode.episodeNumber
        ? `#${episode.episodeNumber}`
        : "";

      for (const user of owners) {
        try {
          const episodeIdentifier: string =
            episode.episodeNumber !== undefined
              ? `${episodeNumberStr} (${episode.title})`
              : episode.title!;

          const vars: Dictionary<string> = {
            episodeTitle: episode.title!,
            episodeNumber: episodeNumberStr,
            projectName: episode.project!.name!,
            currentState: episode.currentAlertState!.name!,
            episodeDescription: await Markdown.convertToHTML(
              episode.description! || "",
              MarkdownContentType.Email,
            ),
            episodeSeverity: episode.alertSeverity?.name || "Not Set",
            declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
              {
                date: episodeCreatedDate,
                timezones: user.timezone ? [user.timezone] : [],
              },
            ),
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
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. New alert episode created: ${episodeIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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
                episode_number: episodeNumber.toString(),
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

          moreEpisodeFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
        } catch (e) {
          logger.error(
            "Error in sending alert episode created resource notification",
          );
          logger.error(e);
        }
      }

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id!,
        projectId: episode.projectId!,
        alertEpisodeFeedEventType:
          AlertEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: episodeFeedText,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
