import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

/*
 * Cap the number of alerts we list inline in the email body. Anything beyond
 * this gets summarized as "and N more" so the email stays readable.
 */
const MAX_ALERTS_IN_EMAIL: number = 25;

RunCron(
  "AlertEpisodeOwner:SendAlertAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Find every member row that hasn't been rolled into a notification yet.
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
          createdAt: true,
        },
      });

    if (members.length === 0) {
      return;
    }

    /*
     * Group members by episode so each owner gets ONE email per episode per
     * cron tick, no matter how many alerts landed.
     */
    const membersByEpisode: Dictionary<Array<AlertEpisodeMember>> = {};

    for (const member of members) {
      if (!member.alertEpisodeId) {
        // Bad data — mark so we never reprocess.
        await AlertEpisodeMemberService.updateOneById({
          id: member.id!,
          data: {
            isOwnerNotifiedOfAlertAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      const key: string = member.alertEpisodeId.toString();
      if (!membersByEpisode[key]) {
        membersByEpisode[key] = [];
      }
      (membersByEpisode[key] as Array<AlertEpisodeMember>).push(member);
    }

    for (const episodeIdStr of Object.keys(membersByEpisode)) {
      const episodeMembers: Array<AlertEpisodeMember> = membersByEpisode[
        episodeIdStr
      ] as Array<AlertEpisodeMember>;

      if (episodeMembers.length === 0) {
        continue;
      }

      const episodeId: ObjectID = new ObjectID(episodeIdStr);
      const projectId: ObjectID | undefined = episodeMembers[0]!.projectId;

      /*
       * Mark everything in this batch as notified upfront. If the rest of
       * this iteration fails we don't want to retry-spam owners on the next
       * cron tick.
       */
      for (const member of episodeMembers) {
        await AlertEpisodeMemberService.updateOneById({
          id: member.id!,
          data: {
            isOwnerNotifiedOfAlertAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
      }

      if (!projectId) {
        continue;
      }

      // Load episode metadata for the email.
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
        continue;
      }

      // Load every added alert in one query.
      const alertIds: Array<ObjectID> = episodeMembers
        .map((m: AlertEpisodeMember) => {
          return m.alertId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      if (alertIds.length === 0) {
        continue;
      }

      const alerts: Array<Alert> = await AlertService.findBy({
        query: {
          _id: QueryHelper.any(alertIds),
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: alertIds.length,
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

      if (alerts.length === 0) {
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

      const alertCountInBatch: number = alerts.length;

      /*
       * Map alertId -> addedAt for the in-email list. Some members may have
       * had no addedAt (defensive), so we fall back to createdAt.
       */
      const addedAtByAlertId: Dictionary<Date> = {};
      for (const member of episodeMembers) {
        if (member.alertId) {
          addedAtByAlertId[member.alertId.toString()] =
            member.addedAt ||
            member.createdAt ||
            OneUptimeDate.getCurrentDate();
        }
      }

      /*
       * Sort alerts by addedAt ascending so newest-at-bottom; truncate if
       * the batch is huge.
       */
      const sortedAlerts: Array<Alert> = [...alerts].sort(
        (a: Alert, b: Alert) => {
          const aTime: number = (
            addedAtByAlertId[a.id!.toString()] || new Date(0)
          ).getTime();
          const bTime: number = (
            addedAtByAlertId[b.id!.toString()] || new Date(0)
          ).getTime();
          return aTime - bTime;
        },
      );

      const truncated: boolean = sortedAlerts.length > MAX_ALERTS_IN_EMAIL;
      const alertsToShow: Array<Alert> = truncated
        ? sortedAlerts.slice(0, MAX_ALERTS_IN_EMAIL)
        : sortedAlerts;
      const remainingCount: number = truncated
        ? sortedAlerts.length - MAX_ALERTS_IN_EMAIL
        : 0;

      const episodeViewLink: string = (
        await AlertEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const episodeFeedText: string = `🔔 **Owner Alerts Added to Episode Notification Sent**:
      Notification sent to owners because ${alertCountInBatch} alert(s) were added to [Alert Episode ${episodeDisplayNumber}](${episodeViewLink}).`;
      let moreEpisodeFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        try {
          /*
           * Build the per-alert list for the HBS template. addedAt is
           * pre-formatted per-recipient because timezone is per-user.
           */
          const alertsForTemplate: Array<JSONObject> = await Promise.all(
            alertsToShow.map(async (alert: Alert): Promise<JSONObject> => {
              const alertLink: string = (
                await AlertService.getAlertLinkInDashboard(projectId, alert.id!)
              ).toString();

              const alertNumberStr: string =
                alert.alertNumberWithPrefix ||
                (alert.alertNumber ? `#${alert.alertNumber}` : "");

              return {
                alertTitle: alert.title || "",
                alertNumber: alertNumberStr,
                alertSeverity: alert.alertSeverity?.name || "Not Set",
                addedAt:
                  OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                    date:
                      addedAtByAlertId[alert.id!.toString()] ||
                      OneUptimeDate.getCurrentDate(),
                    timezones: user.timezone ? [user.timezone] : [],
                  }),
                alertViewLink: alertLink,
              };
            }),
          );

          const vars: Dictionary<string | JSONObject> = {
            episodeTitle: episode.title!,
            episodeNumber: episodeNumberStr,
            projectName: episode.project!.name!,
            currentState: episode.currentAlertState?.name || "Not Set",
            alertCount: alertCountInBatch.toString(),
            alertCountLabel: alertCountInBatch === 1 ? "alert" : "alerts",
            remainingCount: remainingCount.toString(),
            hasMore: remainingCount > 0 ? "true" : "false",
            alerts: alertsForTemplate as unknown as JSONObject,
            episodeViewLink: episodeViewLink,
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const subjectAlertLabel: string =
            alertCountInBatch === 1
              ? `1 new alert`
              : `${alertCountInBatch} new alerts`;

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.AlertEpisodeOwnerAlertAdded,
            vars: vars,
            subject: `[Episode ${episodeNumberStr}] ${subjectAlertLabel} added - ${episode.title!}`,
          };

          const summaryLine: string =
            alertCountInBatch === 1
              ? `1 new alert was added to alert episode ${episodeNumberStr} (${episode.title}).`
              : `${alertCountInBatch} new alerts were added to alert episode ${episodeNumberStr} (${episode.title}).`;

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. ${summaryLine} To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. ${summaryLine} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: `${subjectAlertLabel} added to Episode ${episodeNumberStr}`,
              body: `${summaryLine} Click to view the episode.`,
              clickAction: episodeViewLink,
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
                alert_count: alertCountInBatch.toString(),
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

          moreEpisodeFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email}) — ${alertCountInBatch} alert(s)\n`;
        } catch (e) {
          logger.error(
            "Error in sending alert-added-to-episode batch notification",
            {
              projectId: projectId?.toString(),
              alertEpisodeId: episodeId?.toString(),
              batchSize: alertCountInBatch,
            },
          );
          logger.error(e, {
            projectId: projectId?.toString(),
            alertEpisodeId: episodeId?.toString(),
          });
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
