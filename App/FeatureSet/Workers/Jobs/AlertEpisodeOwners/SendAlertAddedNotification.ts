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
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/AlertEpisodeMember";
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
  "AlertEpisodeOwner:SendAlertAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Find all episode-member rows we haven't yet notified owners about.
    const members: Array<AlertEpisodeMember> =
      await AlertEpisodeMemberService.findAllBy({
        query: {
          isOwnerNotifiedOfAlertAdded: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          projectId: true,
          alertId: true,
          alertEpisodeId: true,
          addedAt: true,
          addedBy: true,
          createdAt: true,
          addedByUser: {
            name: true,
            email: true,
          },
        },
      });

    for (const member of members) {
      const memberId: ObjectID = member.id!;
      const projectId: ObjectID | undefined = member.projectId;
      const alertId: ObjectID | undefined = member.alertId;
      const episodeId: ObjectID | undefined = member.alertEpisodeId;

      if (!projectId || !alertId || !episodeId) {
        // Bad data — mark as notified so we don't loop on it.
        await AlertEpisodeMemberService.updateOneById({
          id: memberId,
          data: {
            isOwnerNotifiedOfAlertAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      /*
       * Load the episode. We need its current alertCount so we can skip the
       * very first alert — that one is covered by the "episode created"
       * notification and we don't want to double-notify owners.
       */
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
            alertCount: true,
            project: {
              name: true,
            } as Select<Project>,
            currentAlertState: {
              name: true,
            } as Select<AlertState>,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
          },
        });

      if (!episode) {
        // Episode is gone — nothing to notify about.
        await AlertEpisodeMemberService.updateOneById({
          id: memberId,
          data: {
            isOwnerNotifiedOfAlertAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      /*
       * Mark as notified now so we never retry this member, even if all
       * subsequent steps fail.
       */
      await AlertEpisodeMemberService.updateOneById({
        id: memberId,
        data: {
          isOwnerNotifiedOfAlertAdded: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Skip the founding alert — the "episode created" notification already
       * covers it. If alertCount <= 1 the episode has just this one alert,
       * which means owners are already being notified via the creation flow.
       */
      const alertCount: number =
        typeof episode.alertCount === "number" ? episode.alertCount : 0;

      if (alertCount <= 1) {
        continue;
      }

      // Load alert details.
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          alertNumber: true,
          alertNumberWithPrefix: true,
          alertSeverity: {
            name: true,
          },
        },
      });

      if (!alert) {
        continue;
      }

      // Find owners — fall back to project owners if none are configured.
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> = await AlertEpisodeService.findOwners(episodeId);

      if (owners.length === 0) {
        doesResourceHasOwners = false;
        owners = await ProjectService.getOwners(projectId);
      }

      if (owners.length === 0) {
        continue;
      }

      const episodeNumberStr: string =
        episode.episodeNumberWithPrefix ||
        (episode.episodeNumber ? `#${episode.episodeNumber}` : "");
      const episodeDisplayNumber: string =
        episode.episodeNumberWithPrefix || "#" + episode.episodeNumber;
      const alertNumberStr: string =
        alert.alertNumberWithPrefix ||
        (alert.alertNumber ? `#${alert.alertNumber}` : "");

      const addedAtDate: Date =
        member.addedAt || member.createdAt || OneUptimeDate.getCurrentDate();

      let addedByLabel: string;
      if (
        member.addedByUser &&
        member.addedByUser.name &&
        member.addedByUser.email
      ) {
        addedByLabel = `${member.addedByUser.name.toString()} (${member.addedByUser.email.toString()})`;
      } else if (member.addedBy === AlertEpisodeMemberAddedBy.Rule) {
        addedByLabel = "Grouping rule";
      } else if (member.addedBy === AlertEpisodeMemberAddedBy.API) {
        addedByLabel = "API";
      } else if (member.addedBy === AlertEpisodeMemberAddedBy.Manual) {
        addedByLabel = "Manual";
      } else {
        addedByLabel = "OneUptime";
      }

      const episodeViewLink: string = (
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const alertViewLink: string = (
        await AlertService.getAlertLinkInDashboard(projectId, alertId)
      ).toString();

      const episodeFeedText: string = `🔔 **Owner Alert Added to Episode Notification Sent**:
      Notification sent to owners because alert ${alertNumberStr} was added to [Alert Episode ${episodeDisplayNumber}](${episodeViewLink}).`;
      const moreEpisodeFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        try {
          const vars: Dictionary<string> = {
            episodeTitle: episode.title!,
            episodeNumber: episodeNumberStr,
            projectName: episode.project!.name!,
            currentState: episode.currentAlertState?.name || "Not Set",
            alertTitle: alert.title!,
            alertNumber: alertNumberStr,
            alertSeverity: alert.alertSeverity?.name || "Not Set",
            addedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: addedAtDate,
              timezones: user.timezone ? [user.timezone] : [],
            }),
            addedBy: addedByLabel,
            alertViewLink: alertViewLink,
            episodeViewLink: episodeViewLink,
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.AlertEpisodeOwnerAlertAdded,
            vars: vars,
            subject: `[Alert ${alertNumberStr} added to Episode ${episodeNumberStr}] - ${alert.title!}`,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. Alert ${alertNumberStr} (${alert.title}) was added to alert episode ${episodeNumberStr} (${episode.title}). To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. Alert ${alertNumberStr} was added to alert episode ${episodeNumberStr}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: `Alert ${alertNumberStr} added to Episode ${episodeNumberStr}`,
              body: `Alert ${alertNumberStr} (${alert.title}) was added to alert episode ${episodeNumberStr} in ${episode.project!.name!}. Click to view details.`,
              clickAction: alertViewLink,
              tag: "alert-added-to-episode",
              requireInteraction: false,
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                episode_title: episode.title!,
                episode_number: episodeDisplayNumber,
                episode_link: episodeViewLink,
                alert_title: alert.title!,
                alert_number:
                  alert.alertNumberWithPrefix ||
                  (alert.alertNumber !== undefined
                    ? alert.alertNumber.toString()
                    : ""),
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            alertEpisodeId: episodeId,
            eventType,
          });
        } catch (e) {
          logger.error("Error in sending alert added to episode notification");
          logger.error(e);
        }
      }

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episodeId,
        projectId: projectId,
        alertEpisodeFeedEventType:
          AlertEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: episodeFeedText,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
