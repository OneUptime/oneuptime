import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import PositiveNumber from "Common/Types/PositiveNumber";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { MarkdownText } from "Common/Utils/Markdown/FeedMarkdown";
import EmailColorUtil, {
  EmailColorPair,
} from "Common/Utils/Email/EmailColorUtil";
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
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
  OwnerNotificationOf,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import OwnersReachedByAPage from "Common/Server/Utils/Notification/OwnersReachedByAPage";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What the "Alert Created" notification is made of, read for each alert.
const ALERT_SELECT: Select<Alert> = {
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
    color: true,
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
};

RunCron(
  "AlertOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the alert as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const alert: Alert | null = await AlertService.findOneById({
          id: delivery.notification.resourceId,
          select: ALERT_SELECT,
          props: {
            isRoot: true,
          },
        });

        if (!alert) {
          await delivery.giveUp("the alert is gone");
          return;
        }

        await notifyOwnersOfAlert(alert, delivery);
      },
    });

    /*
     * Every alert whose owners are due to hear that it was created: let go
     * once its owners were in, a minute after its create, or held so long
     * that nobody will let it go (AlertService.findCreatedNotificationsDue,
     * CreatedNotificationHold).
     */
    const alerts: Array<Alert> = await AlertService.findCreatedNotificationsDue(
      {
        now: OneUptimeDate.getCurrentDate(),
        select: ALERT_SELECT,
      },
    );

    for (const alert of alerts) {
      /*
       * The run's deadline passed - its time limit, or its lease lost,
       * when another run may hold the lock: the alerts not reached are
       * still due, and the next run reads them (issue #8862).
       */
      if (deadline.hasPassed()) {
        break;
      }

      /*
       * Whom it is to tell, written before the take: a worker stopped from
       * here on leaves them to be told by a later run, and one stopped
       * before the take leaves the alert to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await planOwnersOfAlert(alert);

      /*
       * Mark the alert as notified first (matching the MonitorOwner worker) so
       * that a failure while building or sending the notification below can
       * never cause this alert to be re-picked on every cron run. Marked only
       * while it is as it was read: one another run took, or its create let
       * go of meanwhile, is not this run's to send (the next run reads the
       * one let go again) - so its owners are told once.
       */
      const isTaken: boolean =
        await AlertService.takeCreatedNotification(alert);

      if (!isTaken) {
        continue;
      }

      try {
        await notifyOwnersOfAlert(alert, delivery);
      } catch (e) {
        logger.error("Error in sending alert created resource notification", {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        });
        logger.error(e, {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        });
      }
    }
  },
);

/*
 * Whom the alert's "Alert Created" notification tells - its owners, or the
 * project's when it has none, but for those its on-call page reached
 * already - written down before the alert is taken
 * (OwnerNotificationDeliveries.plan). A failure to read them tells nobody,
 * as it did when it came after the take.
 */
async function planOwnersOfAlert(
  alert: Alert,
): Promise<OwnerNotificationDelivery> {
  const notification: OwnerNotificationOf = {
    kind: OwnerNotificationKind.AlertCreated,
    projectId: alert.projectId!,
    resourceId: alert.id!,
    eventId: alert.id!,
  };

  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await AlertService.findOwners(alert.id!);

    if (owners.length === 0) {
      isProjectOwners = true;
      owners = await ProjectService.getOwners(alert.projectId!);
    }
  } catch (e) {
    logger.error("Error in reading the owners of a created alert", {
      projectId: alert.projectId?.toString(),
      alertId: alert.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: notification,
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
    /*
     * Not those the alert's on-call page reached already: someone who is
     * on call and an owner is told of the alert once, not twice (#7987).
     */
    leaveOut: await OwnersReachedByAPage.findAmong({
      notification: notification,
      owners: owners,
    }),
  });
}

/*
 * Tells the delivery's owners that the alert was created, each once
 * (OwnerNotificationDelivery.tell), and says in the alert's feed whom it
 * reached - those a stopped run told first among them - and whom it left
 * out, as the alert's on-call page reached them already.
 */
async function notifyOwnersOfAlert(
  alert: Alert,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const projectId: ObjectID = alert.projectId!;
  const alertId: ObjectID = alert.id!;

  let moreAlertFeedInformationInMarkdown: string = "";

  const alertIdentifiedDate: Date = await AlertService.getAlertIdentifiedDate(
    alert.id!,
  );

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

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
   *
   * The rest of what the alert's Affected Resources card lists - hosts,
   * clusters, services, SLOs - follows, so an alert with no monitor at
   * all (an SLO burn-rate alert) still names what it is about.
   */
  const resourceNames: Array<string> = LinkedAffectedResources.getNames({
    resources: await LinkedAffectedResources.readForAlert({
      service: AlertService,
      projectId: projectId,
      alertId: alertId,
    }),
    seriesSummary: SeriesLabelDisplay.buildInlineSummary(alert.seriesLabels),
  });

  const resourcesAffected: string = resourceNames.join(", ") || "None";

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
    return;
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
   * The badge's name takes the nearest shade of it that reads on white.
   * The fallback, for a severity with no usable colour, is the same slate
   * the detail rows use.
   */
  const severityColors: EmailColorPair = EmailColorUtil.getColorPair(
    alert.alertSeverity?.color,
  ) || {
    color: "#64748b",
    textColor: "#64748b",
  };

  /*
   * Named separately from the affected resource, because they are
   * different things - except for an ungrouped monitor, where
   * resourcesAffected already names the monitor and a Monitor row would
   * print it twice.
   */
  const monitorNameRaw: string = alert.monitor?.name || "";
  const monitorName: string = resourceNames.includes(monitorNameRaw.trim())
    ? ""
    : monitorNameRaw;

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

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreAlertFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        OwnerNotificationFeedText.personName({
          name: user.name?.toString(),
          email: user.email?.toString(),
        }),
      );
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
            : alert.title!;

        const vars: Dictionary<string> = {
          alertTitle: alert.title!,
          alertNumber: alertNumberStr,
          projectName: alert.project!.name!,
          currentState: alert.currentAlertState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            alert.currentAlertState?.color,
          ),
          alertDescription: alertDescriptionHtml,
          resourcesAffected: resourcesAffected,
          alertSeverity: alert.alertSeverity!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "alertSeverity",
            alert.alertSeverity?.color,
          ),
          declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: alertIdentifiedDate,
            timezones: user.timezone ? [user.timezone] : [],
          }),
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
          severityColor: severityColors.color,
          severityTextColor: severityColors.textColor,
          preheader: preheader,
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerResourceCreated,
          vars: vars,
          subject: `[New Alert ${alertNumberStr}] - ${alert.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New alert created: ${alertIdentifier}.`,
          ),
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
      },
    );

    if (isTold) {
      moreAlertFeedInformationInMarkdown +=
        OwnerNotificationFeedText.notifiedLineMarkdown(
          OwnerNotificationFeedText.personName({
            name: user.name?.toString(),
            email: user.email?.toString(),
          }),
        );
    }
  }

  /*
   * Written by the run that set out to tell the owners, or by the one
   * that took up the feed item a run that told them all left unwritten
   * (#8510): a run that found every owner told already writes none.
   */
  if (!delivery.isFeedItemToWrite) {
    return;
  }

  // Whom it left out, named apart from those notified (OwnersReachedByAPage).
  moreAlertFeedInformationInMarkdown +=
    OwnerNotificationFeedText.reachedByPageMarkdown(
      delivery.leftOut.map((user: User): MarkdownText => {
        return OwnerNotificationFeedText.personName({
          name: user.name?.toString(),
          email: user.email?.toString(),
        });
      }),
    );

  await AlertFeedService.createAlertFeedItem({
    alertId: alert.id!,
    projectId: alert.projectId!,
    alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: OwnerNotificationFeedText.created("alert", {
      isProjectOwners: !doesResourceHasOwners,
    }),
    moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
    /*
     * The feed only. That the owners were told is a side effect of the
     * alert's creation, which the channel was told of itself.
     */
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
