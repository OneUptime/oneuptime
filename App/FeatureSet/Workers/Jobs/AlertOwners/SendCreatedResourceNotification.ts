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
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import PositiveNumber from "Common/Types/PositiveNumber";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        isOwnerNotifiedOfAlertCreation: false,
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
        monitorId: true,
        project: {
          name: true,
        } as Select<Project>,
        remediationNotes: true,
        currentAlertState: {
          name: true,
        } as Select<AlertState>,
        alertSeverity: {
          name: true,
          /*
           * The severity's OWN colour, so the badge is the severity the
           * project defined rather than a guess from its sort order. A
           * project may define any number of severities with any names.
           */
          color: true,
        },
        rootCause: true,
        monitor: {
          name: true,
        },
        createdByProbe: {
          name: true,
        },
        createdByUser: {
          name: true,
          email: true,
        },
        alertNumber: true,
        alertNumberWithPrefix: true,
        /*
         * The attribute key/values that identify the series this alert was
         * raised for, e.g. {resource.k8s.pod.name: checkout-7d9f-2xk}.
         * Without selecting it the email had no way to name the thing that
         * actually broke, and fell back to printing the monitor's own name
         * as the "Resources Affected".
         */
        seriesLabels: true,
        /*
         * The identity of the CONDITION that fired: which criteria, and for a
         * grouped metric monitor which series. This is the same pair
         * MonitorAlert dedupes an already-open alert on, so counting rows
         * that share it counts re-fires of THIS condition and nothing else.
         */
        seriesFingerprint: true,
        createdCriteriaId: true,
      },
    });

    for (const alert of alerts) {
      const projectId: ObjectID = alert.projectId!;
      const alertId: ObjectID = alert.id!;
      const alertDisplayNumber: string =
        alert.alertNumberWithPrefix || "#" + alert.alertNumber!;

      /*
       * Mark the alert as notified first (matching the MonitorOwner worker) so
       * that a failure while building or sending the notification below can
       * never cause this alert to be re-picked on every cron run.
       */
      await AlertService.updateOneById({
        id: alert.id!,
        data: {
          isOwnerNotifiedOfAlertCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      const alertFeedText: string = `🔔 **Owner Alert Created Notification Sent**:
      Notification sent to owners because [Alert ${alertDisplayNumber}](${(await AlertService.getAlertLinkInDashboard(projectId, alertId)).toString()}) was created.`;
      let moreAlertFeedInformationInMarkdown: string = "";

      const alertIdentifiedDate: Date =
        await AlertService.getAlertIdentifiedDate(alert.id!);

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await AlertService.findOwners(alert.id!);

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(alert.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      let declaredBy: string = "OneUptime";

      if (alert.createdByProbe && alert.createdByProbe.name) {
        declaredBy = alert.createdByProbe.name;
      }

      if (
        alert.createdByUser &&
        alert.createdByUser.name &&
        alert.createdByUser.email
      ) {
        declaredBy = `${alert.createdByUser.name.toString()} (${alert.createdByUser.email.toString()})`;
      }

      const alertNumberStr: string =
        alert.alertNumberWithPrefix ||
        (alert.alertNumber ? `#${alert.alertNumber}` : "");

      /*
       * What actually broke.
       *
       * A grouped metric monitor raises one alert per breaching series, and
       * the series identity is on the row — the dashboard renders it under
       * "Affected Resource". The email used to print `alert.monitor.name`
       * here, so a per-pod alert said "Resources Affected: oneuptime-test -
       * Pod CPU Saturating Container Limit", naming the monitor twice and
       * the pod not at all.
       *
       * `buildInlineSummary` is the same formatter the alert TITLE uses, so
       * the two agree. Monitors without group-by have no series labels and
       * keep the previous monitor-name fallback, which for them is the
       * correct answer.
       */
      const seriesSummary: string = SeriesLabelDisplay.buildInlineSummary(
        alert.seriesLabels,
      );

      const resourcesAffected: string =
        seriesSummary || alert.monitor?.name || "None";

      /*
       * These values do not vary per owner, so convert them once per alert
       * instead of once per owner notification. A conversion failure must
       * stay contained to this alert, like every other failure in this loop.
       */
      let alertDescriptionHtml: string = "";
      let remediationNotesHtml: string = "";
      let rootCauseHtml: string = "";

      try {
        alertDescriptionHtml = await Markdown.convertToHTML(
          alert.description! || "",
          MarkdownContentType.Email,
        );

        remediationNotesHtml =
          (await Markdown.convertToHTML(
            alert.remediationNotes! || "",
            MarkdownContentType.Email,
          )) || "";

        rootCauseHtml =
          (await Markdown.convertToHTML(
            alert.rootCause || "No root cause identified for this alert",
            MarkdownContentType.Email,
          )) || "";
      } catch (e) {
        logger.error("Error in sending alert created resource notification");
        logger.error(e);
        continue;
      }

      /*
       * HOW MANY TIMES THIS EXACT CONDITION HAS FIRED RECENTLY.
       *
       * A criteria whose recovery threshold sits on top of its firing
       * threshold oscillates, and every oscillation is a new alert row and a
       * new email. Email nineteen is byte-identical to email one, so the
       * reader concludes the product is broken rather than that the monitor
       * is flapping.
       *
       * The counted key is (monitorId, createdCriteriaId, seriesFingerprint) -
       * the same triple MonitorAlert uses to decide an alert for this
       * condition is already open. Matching on only one half would fold two
       * different criteria on the same pod into one number, and the banner
       * claims "this condition", not "this monitor". All three columns carry
       * @Index() on the Alert model, so this is one indexed count per alert,
       * not per owner.
       *
       * An alert with no condition identity at all (manually raised, or a
       * criteria with no id) is skipped rather than counted monitor-wide:
       * "5 unrelated conditions fired once" must not render as "this
       * condition fired 5 times".
       *
       * Best effort. A failure here must cost the alert its banner, never its
       * email, which is why it is caught and the count falls back to 1.
       */
      let repeatCount: number = 1;

      const hasConditionIdentity: boolean = Boolean(
        alert.seriesFingerprint || alert.createdCriteriaId,
      );

      if (alert.monitorId && hasConditionIdentity) {
        try {
          const windowStart: Date = OneUptimeDate.addRemoveHours(
            OneUptimeDate.getCurrentDate(),
            -2,
          );

          const seriesQuery: Record<string, unknown> = {
            monitorId: alert.monitorId,
            createdAt: QueryHelper.greaterThan(windowStart),
          };

          if (alert.createdCriteriaId) {
            seriesQuery["createdCriteriaId"] = alert.createdCriteriaId;
          }

          if (alert.seriesFingerprint) {
            seriesQuery["seriesFingerprint"] = alert.seriesFingerprint;
          }

          const count: PositiveNumber = await AlertService.countBy({
            query: seriesQuery,
            props: {
              isRoot: true,
            },
          });

          /*
           * The current alert is itself in the counted set, so the number
           * reads as an ordinal. It can still come back 0 for a backlogged
           * alert whose createdAt predates the window.
           */
          repeatCount = count.toNumber() || 1;
        } catch (e) {
          logger.error(e);
        }
      }

      /*
       * Three, not two. Two firings in two hours is a busy day; three or more
       * is a pattern, and the banner has to be rare enough that its presence
       * means something.
       */
      const flapWarning: string =
        repeatCount > 2
          ? `This condition has fired ${repeatCount} times in the last 2 hours. The monitor may be flapping — review the criteria thresholds before treating this as a new event.`
          : "";

      /*
       * The severity's own colour, not a mapping onto a fixed palette: the
       * row already carries the answer, and severities are project-defined.
       * The fallback is the same slate the detail rows use.
       */
      const severityColor: string =
        alert.alertSeverity?.color?.toString() || "#64748b";

      /*
       * Named separately from the affected resource, because they are
       * different things - except for an ungrouped monitor, where
       * resourcesAffected already IS the monitor name and a Monitor row would
       * print it twice.
       */
      const monitorNameRaw: string = alert.monitor?.name || "";
      const monitorName: string =
        monitorNameRaw === resourcesAffected ? "" : monitorNameRaw;

      /*
       * THE INBOX PREVIEW LINE.
       *
       * Plain text, because no mail client renders markup here, and rootCause
       * reaches the body as marked() output. Without this every one of a
       * flap's notifications previewed as the same boilerplate sentence, so
       * the inbox list gave the reader nothing to triage on. Capped at 160
       * characters, which is roughly what Gmail shows.
       */
      const preheader: string = [
        Markdown.convertToPlainText(alert.rootCause || ""),
        resourcesAffected,
        flapWarning ? `${repeatCount} firings in 2h` : "",
      ]
        .filter((part: string) => {
          return Boolean(part);
        })
        .join(" · ")
        .slice(0, 160);

      for (const user of owners) {
        try {
          const alertIdentifier: string =
            alert.alertNumber !== undefined
              ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
              : alert.title!;

          const vars: Dictionary<string> = {
            alertTitle: alert.title!,
            alertNumber: alertNumberStr,
            projectName: alert.project!.name!,
            currentState: alert.currentAlertState!.name!,
            alertDescription: alertDescriptionHtml,
            resourcesAffected: resourcesAffected,
            alertSeverity: alert.alertSeverity!.name!,
            declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
              {
                date: alertIdentifiedDate,
                timezones: user.timezone ? [user.timezone] : [],
              },
            ),
            declaredBy: declaredBy,
            remediationNotes: remediationNotesHtml,
            rootCause: rootCauseHtml,
            alertViewLink: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            flapWarning: flapWarning,
            monitorName: monitorName,
            severityBadgeText: alert.alertSeverity!.name!,
            severityColor: severityColor,
            preheader: preheader,
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.AlertOwnerResourceCreated,
            vars: vars,
            subject: `[New Alert ${alertNumberStr}] - ${alert.title!}`,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. New alert created: ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. New alert created: ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createAlertCreatedNotification({
              alertTitle: alert.title!,
              projectName: alert.project!.name!,
              alertViewLink: vars["alertViewLink"] || "",
              ...(alert.alertNumber !== undefined && {
                alertNumber: alert.alertNumber,
              }),
              alertId: alert.id!.toString(),
              projectId: alert.projectId!.toString(),
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                alert_title: alert.title!,
                project_name: alert.project!.name!,
                alert_link: vars["alertViewLink"] || "",
                alert_number: alert.alertNumber!.toString(),
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: alert.projectId!,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            alertId: alert.id!,
            eventType,
          });

          moreAlertFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
        } catch (e) {
          logger.error("Error in sending alert created resource notification");
          logger.error(e);
        }
      }

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: alertFeedText,
        moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
