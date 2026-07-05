import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertService from "Common/Server/Services/AlertService";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertReminderRule from "Common/Models/DatabaseModels/AlertReminderRule";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertOwner:SendUnresolvedReminderNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all alerts where the next reminder notification is due.

    const alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        nextReminderNotificationAt: QueryHelper.lessThan(
          OneUptimeDate.getCurrentDate(),
        ),
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
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
        },
        currentAlertState: {
          name: true,
        },
        monitor: {
          name: true,
        },
        alertNumber: true,
        alertNumberWithPrefix: true,
        enableReminders: true,
        reminderNotificationSentCount: true,
      },
    });

    for (const alert of alerts) {
      try {
        await sendReminderForAlert(alert);
      } catch (error) {
        logger.error(`Error sending reminder for alert ${alert.id}: ${error}`, {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        });
      }
    }
  },
);

type SendReminderForAlertFunction = (alert: Alert) => Promise<void>;

const sendReminderForAlert: SendReminderForAlertFunction = async (
  alert: Alert,
): Promise<void> => {
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
    });

  const stopReminders: () => Promise<void> = async (): Promise<void> => {
    await AlertService.updateOneById({
      id: alertId,
      data: {
        nextReminderNotificationAt: null,
      },
      props: {
        isRoot: true,
      },
    });
  };

  if (
    !rule ||
    !rule.reminderIntervalInMinutes ||
    alert.enableReminders === false
  ) {
    return await stopReminders();
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
    return await stopReminders();
  }

  /*
   * Advance the next reminder time BEFORE sending notifications so a
   * failure mid-send does not cause duplicate reminders on the next run.
   */
  await AlertService.updateOneById({
    id: alertId,
    data: {
      nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        rule.reminderIntervalInMinutes,
      ),
      reminderNotificationSentCount:
        (alert.reminderNotificationSentCount || 0) + 1,
    },
    props: {
      isRoot: true,
    },
  });

  // now find owners.

  let doesResourceHasOwners: boolean = true;

  let owners: Array<User> = await AlertService.findOwners(alertId);

  if (owners.length === 0) {
    doesResourceHasOwners = false;

    // find project owners.
    owners = await ProjectService.getOwners(projectId);
  }

  if (owners.length === 0) {
    return;
  }

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

  let moreAlertFeedInformationInMarkdown: string = "";

  for (const user of owners) {
    const vars: Dictionary<string> = {
      alertTitle: alert.title!,
      alertNumber: alertNumberStr,
      projectName: alert.project!.name!,
      currentState: currentStateName,
      openDuration: openDuration,
      createdAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: openedAt,
        timezones: user.timezone ? [user.timezone] : [],
      }),
      alertDescription: await Markdown.convertToHTML(
        alert.description! || "",
        MarkdownContentType.Email,
      ),
      resourcesAffected: alert.monitor?.name || "None",
      alertSeverity: alert.alertSeverity?.name || "",
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
    };

    const sms: SMSMessage = {
      message: `This is a message from OneUptime. Reminder: Alert ${alertIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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
            alert.alertNumber !== undefined ? alert.alertNumber.toString() : "",
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

    moreAlertFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
      {
        userId: user.id!,
        projectId: projectId,
      },
    )}\n`;
  }

  const alertNumberDisplayValue: string =
    alert.alertNumberWithPrefix || "#" + alert.alertNumber!;

  await AlertFeedService.createAlertFeedItem({
    alertId: alertId,
    projectId: projectId,
    alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: `🔔 **Reminder sent to owners of [Alert ${alertNumberDisplayValue}](${alertViewLink})**: This alert is still **${currentStateName}** and has been open for **${openDuration}**.`,
    moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: true,
    },
  });
};
