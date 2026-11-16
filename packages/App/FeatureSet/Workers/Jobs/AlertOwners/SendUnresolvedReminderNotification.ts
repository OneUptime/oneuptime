import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerReminderBacklog, {
  DueReminder,
} from "../../Utils/OwnerReminderBacklog";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import { getReminderIntervalInMinutes } from "Common/Types/Reminder/ReminderInterval";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertService from "Common/Server/Services/AlertService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import Label from "Common/Models/DatabaseModels/Label";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import { NotificationRuleUpdateKind } from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";

const JOB_NAME: string = "AlertOwner:SendUnresolvedReminderNotification";

// What a reminder is made of, read for each alert.
const ALERT_SELECT: Select<Alert> = {
  _id: true,
  createdAt: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  alertSeverityId: true,
  alertSeverity: {
    name: true,
    color: true,
  },
  labels: {
    _id: true,
  },
  currentAlertState: {
    name: true,
    color: true,
  },
  /*
   * The series a grouped monitor raised this alert for, named in the
   * monitor's place under Resources Affected, as the created email does.
   */
  seriesLabels: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
  enableReminders: true,
  nextReminderNotificationAt: true,
  reminderNotificationSentCount: true,
};

RunCron(
  JOB_NAME,
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between moving the reminder on and the last owner (#8199) - told
     * first, exactly them, while the alert is still to be reminded of
     * (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertReminder],
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

        /*
         * Late, so asked again: a reminder that an alert resolved since is
         * still open would be wrong. Not of a reminder that went out, whose
         * feed item alone is left to write (#8510).
         */
        if (
          !delivery.isFeedLeftUnwritten &&
          (await getReminderIntervalFor(alert)) === null
        ) {
          await delivery.giveUp("the alert's reminders stopped since");
          return;
        }

        await notifyOwnersOfReminder(alert, delivery);
      },
    });

    /*
     * Every alert whose reminder is due, a page at a time, the longest due
     * first, each moved on by one run alone, which tells of it; the run stops
     * at its deadline and the next carries on (OwnerReminderBacklog, issue
     * #9019).
     */
    await OwnerReminderBacklog.forEachDue<Alert>({
      jobName: JOB_NAME,
      service: AlertService,
      select: ALERT_SELECT,
      deadline: deadline,
      remind: async (input: {
        record: Alert;
        reminder: DueReminder<Alert>;
      }): Promise<void> => {
        await sendReminderForAlert(input.record, input.reminder);
      },
    });
  },
);

/*
 * How often the alert is to be reminded of now, in minutes - or null when
 * it is not to be reminded of at all: no rule matches it any more, it has
 * reminders turned off, it is resolved, or it is acknowledged and its rule
 * stops there.
 */
async function getReminderIntervalFor(alert: Alert): Promise<number | null> {
  const alertId: ObjectID = alert.id!;
  const projectId: ObjectID = alert.projectId!;

  /*
   * Re-match the reminder rule on every send so rule edits
   * (interval, severities, enabled) apply to open alerts immediately.
   */
  const rule: AlertReminderRule | null =
    await AlertReminderRuleService.findMatchingRule({
      projectId: projectId,
      alertSeverityId: alert.alertSeverityId,
      labelIds: alert.labels?.map((label: Label) => {
        return label.id!;
      }),
    });

  /*
   * A rule with no interval a reminder can follow - none, or one below a
   * minute, which only a rule saved before the check can hold - reminds
   * nobody, rather than every minute (Types/Reminder/ReminderInterval).
   */
  const intervalInMinutes: number | null = getReminderIntervalInMinutes(
    rule?.reminderIntervalInMinutes,
  );

  if (!rule || intervalInMinutes === null || alert.enableReminders === false) {
    return null;
  }

  // Resolved alerts never get reminders.
  let shouldStop: boolean = await AlertService.isAlertResolved({
    alertId: alertId,
  });

  if (
    !shouldStop &&
    rule.stopRemindersOnState === ReminderStopState.Acknowledged
  ) {
    shouldStop = await AlertService.isAlertAcknowledged({
      alertId: alertId,
    });
  }

  if (shouldStop) {
    return null;
  }

  return intervalInMinutes;
}

type SendReminderForAlertFunction = (
  alert: Alert,
  reminder: DueReminder<Alert>,
) => Promise<void>;

const sendReminderForAlert: SendReminderForAlertFunction = async (
  alert: Alert,
  reminder: DueReminder<Alert>,
): Promise<void> => {
  const intervalInMinutes: number | null = await getReminderIntervalFor(alert);

  if (intervalInMinutes === null) {
    await reminder.stop();
    return;
  }

  /*
   * Whom this reminder is to tell, written before the reminder is moved
   * on: a worker stopped from here on leaves them to be told by a later
   * run, and one stopped before the move leaves the reminder due.
   */
  const delivery: OwnerNotificationDelivery = await planOwnersOfReminder({
    alert: alert,
    reminderNumber: reminder.number,
  });

  /*
   * Moved on before anybody is told, so a failure mid-send does not send
   * the reminder again on the next run - and by one compare-and-set, so of
   * two runs at once only the one that moved it tells of it.
   */
  if (!(await reminder.send(intervalInMinutes))) {
    return;
  }

  await notifyOwnersOfReminder(alert, delivery);
};

/*
 * Whom the reminder tells - the alert's owners, or the project's when it
 * has none - written down before the reminder is moved on
 * (OwnerNotificationDeliveries.plan): the reminder's number tells one
 * reminder from the next. A failure to read them tells nobody, as it did
 * when it came after the move.
 */
async function planOwnersOfReminder(data: {
  alert: Alert;
  reminderNumber: number;
}): Promise<OwnerNotificationDelivery> {
  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await AlertService.findOwners(data.alert.id!);

    if (owners.length === 0) {
      isProjectOwners = true;

      // find project owners.
      owners = await ProjectService.getOwners(data.alert.projectId!);
    }
  } catch (e) {
    logger.error("Error in reading the owners of an alert to remind", {
      projectId: data.alert.projectId?.toString(),
      alertId: data.alert.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: OwnerNotificationKind.AlertReminder,
      projectId: data.alert.projectId!,
      resourceId: data.alert.id!,
      eventId: data.alert.id!,
      occurrence: data.reminderNumber,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Reminds the delivery's owners that the alert is still open, each once
 * (OwnerNotificationDelivery.tell), and says in the alert's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfReminder(
  alert: Alert,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const alertId: ObjectID = alert.id!;
  const projectId: ObjectID = alert.projectId!;

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const openedAt: Date = alert.createdAt!;

  const openDuration: string =
    OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
      OneUptimeDate.getDifferenceInSeconds(
        OneUptimeDate.getCurrentDate(),
        openedAt,
      ),
    );

  const alertNumberStr: string =
    alert.alertNumberWithPrefix ||
    (alert.alertNumber ? `#${alert.alertNumber}` : "");

  const currentStateName: string = alert.currentAlertState?.name || "Open";

  const alertViewLink: string = (
    await AlertService.getAlertLinkInDashboard(projectId, alertId)
  ).toString();

  // Every resource the alert's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    resources: await LinkedAffectedResources.readForAlert({
      service: AlertService,
      projectId: projectId,
      alertId: alertId,
    }),
    seriesSummary: SeriesLabelDisplay.buildInlineSummary(alert.seriesLabels),
    fallback: "None",
  });

  let moreAlertFeedInformationInMarkdown: string = "";

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreAlertFeedInformationInMarkdown += mdText`**Notified:** ${await UserService.getUserMarkdownString(
      {
        userId: user.id!,
        projectId: projectId,
      },
    )}\n`;
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const vars: Dictionary<string> = {
          alertTitle: alert.title!,
          alertNumber: alertNumberStr,
          projectName: alert.project!.name!,
          currentState: currentStateName,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            alert.currentAlertState?.color,
          ),
          openDuration: openDuration,
          createdAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: openedAt,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          alertDescription: await Markdown.convertToHTML(
            alert.description! || "",
            MarkdownContentType.Email,
          ),
          resourcesAffected: resourcesAffected,
          alertSeverity: alert.alertSeverity?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "alertSeverity",
            alert.alertSeverity?.color,
          ),
          alertViewLink: alertViewLink,
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alertNumberStr} (${alert.title})`
            : alert.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerUnresolvedReminder,
          vars: vars,
          subject: `[Reminder] Alert ${alertNumberStr} is still ${currentStateName} - ${alert.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Reminder: Alert ${alertIdentifier} is still ${currentStateName} and has been open for ${openDuration}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Reminder: Alert ${alertIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Reminder: Alert ${alertNumberStr} is still open`,
            body: `${alert.title!} is still ${currentStateName}. Open for ${openDuration}.`,
            clickAction: alertViewLink,
            tag: "alert-reminder",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_REMINDER_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_state: currentStateName,
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
              elapsed_time: openDuration,
              alert_link: alertViewLink,
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
          alertId: alertId,
          eventType,
        });
      },
    );

    if (isTold) {
      moreAlertFeedInformationInMarkdown += mdText`**Notified:** ${await UserService.getUserMarkdownString(
        {
          userId: user.id!,
          projectId: projectId,
        },
      )}\n`;
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

  const alertNumberDisplayValue: string =
    alert.alertNumberWithPrefix || "#" + alert.alertNumber!;

  await AlertFeedService.createAlertFeedItem({
    alertId: alertId,
    projectId: projectId,
    alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown:
      mdText`🔔 **Reminder sent to owners of [Alert ${alertNumberDisplayValue}](${alertViewLink})**: This alert is still **${currentStateName}** and has been open for **${openDuration}**.`.toString(),
    moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
    /*
     * Posted to the alert's channels as a reminder, a box of its own on a
     * rule's Updates step (issue #7938): named here, so no other owner
     * notice is ever posted as one.
     */
    workspaceNotification: {
      sendWorkspaceNotification: true,
      updateKinds: [NotificationRuleUpdateKind.Reminders],
    },
  });

  await delivery.feedItemWritten();
}
