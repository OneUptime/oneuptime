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
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
RunCron(
  "AlertOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.

    const alertStateTimelines: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findAllBy({
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
          alertId: true,
          alertStateId: true,
          /*
           * WHY the state changed, in the same sentence the firing email
           * used. Populated on the autoresolve path by
           * MonitorAlert.resolveOpenAlert and on every other transition by
           * AlertService.changeAlertState. Without it the resolution email
           * said only that the state changed, and a reader could not tell a
           * real recovery from a monitor oscillating around its threshold.
           */
          rootCause: true,
          alertState: {
            name: true,
            color: true,
          },
        },
      });

    for (const alertStateTimeline of alertStateTimelines) {
      const alertId: ObjectID = alertStateTimeline.alertId!;

      if (!alertId) {
        continue;
      }

      // get alert

      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          projectId: true,
          description: true,
          monitor: {
            name: true,
          },
          alertNumber: true,
          alertNumberWithPrefix: true,
          alertSeverity: {
            name: true,
          },
          /*
           * The series this alert was raised for. Without it this email said
           * "Resources Affected: <the monitor's own name>" while the firing
           * email - which does select it - named the pod.
           */
          seriesLabels: true,
        },
      });

      if (!alert) {
        continue;
      }

      const alertState: AlertState = alertStateTimeline.alertState!;

      await AlertStateTimelineService.updateOneById({
        id: alertStateTimeline.id!,
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

      if (alertStateTimeline.alertId && alertStateTimeline.startsAt) {
        const previousTimeline: AlertStateTimeline | null =
          await AlertStateTimelineService.findOneBy({
            query: {
              alertId: alertStateTimeline.alertId,
              startsAt: QueryHelper.lessThan(alertStateTimeline.startsAt),
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

          /*
           * Calculate how long the alert was in the previous state
           * Use startsAt if available, otherwise fall back to createdAt
           */
          const previousStartTime: Date | undefined =
            previousTimeline.startsAt || previousTimeline.createdAt;
          const currentStartTime: Date | undefined =
            alertStateTimeline.startsAt || alertStateTimeline.createdAt;

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

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await AlertService.findOwners(alert.id!);

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(alertStateTimeline.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      let moreAlertFeedInformationInMarkdown: string = "";

      const alertNumberStr: string =
        alert.alertNumberWithPrefix ||
        (alert.alertNumber ? `#${alert.alertNumber}` : "");

      const alertDescriptionHtml: string = await Markdown.convertToHTML(
        alert.description! || "",
        MarkdownContentType.Email,
      );

      /*
       * Same formatter the created-alert email uses, so a firing and its
       * resolution name the same thing. A monitor without group-by has no
       * series labels and keeps the monitor-name fallback, which for it is
       * the correct answer.
       */
      const seriesSummary: string = SeriesLabelDisplay.buildInlineSummary(
        alert.seriesLabels,
      );

      const resourcesAffected: string =
        seriesSummary || alert.monitor?.name || "";

      /*
       * Assigned unconditionally, "" when the timeline row carries no root
       * cause: the template's guard is a presence check and a conditionally
       * ADDED key would still be a defined-but-blank row in some renderers.
       */
      const stateChangeRootCauseHtml: string = alertStateTimeline.rootCause
        ? await Markdown.convertToHTML(
            alertStateTimeline.rootCause,
            MarkdownContentType.Email,
          )
        : "";

      /*
       * Hoisted out of the owner loop: it is derived from the row's previous
       * state, which does not vary per owner. The preheader below needs it,
       * and computing it three times for three owners was never meaningful.
       */
      const previousStateDurationText: string =
        previousState?.name && previousStateDuration
          ? `Was ${previousState.name} for ${previousStateDuration}`
          : "";

      /*
       * The inbox preview line. Every one of a flap's resolve notifications
       * previewed as "Alert state has changed", so the list gave the reader
       * nothing to triage on; this makes the row say which state, for which
       * resource, and how long it sat in the previous one.
       *
       * Deliberately built from plain strings only. The root cause would be
       * the richest thing to put here, but it is Markdown and no client
       * renders markup in a preview line - it is in the body instead, under
       * "Root Cause".
       */
      const preheader: string = [
        alertState.name || "",
        resourcesAffected,
        previousStateDurationText,
      ]
        .filter((part: string) => {
          return Boolean(part);
        })
        .join(" · ")
        .slice(0, 160);

      for (const user of owners) {
        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alertNumberStr} (${alert.title})`
            : alert.title!;

        const vars: Dictionary<string> = {
          alertTitle: alert.title!,
          alertNumber: alertNumberStr,
          projectName: alertStateTimeline.project!.name!,
          currentState: alertState!.name!,
          currentStateColor: alertState!.color?.toString() || "#000000",
          previousState: previousState?.name || "",
          previousStateColor: previousState?.color?.toString() || "#6b7280",
          previousStateDurationText: previousStateDurationText,
          alertDescription: alertDescriptionHtml,
          resourcesAffected: resourcesAffected,
          stateChangeRootCause: stateChangeRootCauseHtml,
          preheader: preheader,
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: alertStateTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          alertSeverity: alert.alertSeverity!.name!,
          alertViewLink: (
            await AlertService.getAlertLinkInDashboard(
              alertStateTimeline.projectId!,
              alert.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerStateChanged,
          vars: vars,
          subject: `[${Text.uppercaseFirstLetter(
            alertState!.name!,
          )} Alert ${alertNumberStr}] - ${alert.title!}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Alert ${alertIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Alert ${
                alertIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert ${alertNumberStr} State Changed: ${alert.title}`,
            body: `Alert ${alertNumberStr} state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!.name!} in ${alertStateTimeline.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alertStateTimeline.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-state-changed",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_state: alertState!.name!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: alertStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          alertId: alert.id!,
          eventType,
        });

        moreAlertFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: alertStateTimeline.projectId!,
          },
        )})\n`;
      }

      const alertDisplayNumber: string =
        alert.alertNumberWithPrefix || "#" + alert.alertNumber!;
      const projectId: ObjectID = alert.projectId!;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Alert ${alertDisplayNumber}](${(await AlertService.getAlertLinkInDashboard(projectId, alertId)).toString()}).**: Owners have been notified about the state change of the alert because the alert state changed to **${alertState.name}**.`,
        moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
