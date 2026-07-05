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
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentOwner:SendUnresolvedReminderNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all incidents where the next reminder notification is due.

    const incidents: Array<Incident> = await IncidentService.findAllBy({
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
        declaredAt: true,
        title: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
        incidentSeverityId: true,
        incidentSeverity: {
          name: true,
        },
        currentIncidentState: {
          name: true,
        },
        monitors: {
          name: true,
        },
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        enableReminders: true,
        reminderNotificationSentCount: true,
      },
    });

    for (const incident of incidents) {
      try {
        await sendReminderForIncident(incident);
      } catch (error) {
        logger.error(
          `Error sending reminder for incident ${incident.id}: ${error}`,
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );
      }
    }
  },
);

type SendReminderForIncidentFunction = (incident: Incident) => Promise<void>;

const sendReminderForIncident: SendReminderForIncidentFunction = async (
  incident: Incident,
): Promise<void> => {
  const incidentId: ObjectID = incident.id!;
  const projectId: ObjectID = incident.projectId!;

  /*
   * Re-match the reminder rule on every send so rule edits
   * (interval, severities, enabled) apply to open incidents immediately.
   */
  const rule: IncidentReminderRule | null =
    await IncidentReminderRuleService.findMatchingRule({
      projectId: projectId,
      incidentSeverityId: incident.incidentSeverityId,
    });

  const stopReminders: () => Promise<void> = async (): Promise<void> => {
    await IncidentService.updateOneById({
      id: incidentId,
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
    incident.enableReminders === false
  ) {
    return await stopReminders();
  }

  // Resolved incidents never get reminders.
  let shouldStop: boolean = await IncidentService.isIncidentResolved({
    incidentId: incidentId,
  });

  if (!shouldStop && rule.stopRemindersOnState === ReminderStopState.Acknowledged) {
    shouldStop = await IncidentService.isIncidentAcknowledged({
      incidentId: incidentId,
    });
  }

  if (shouldStop) {
    return await stopReminders();
  }

  /*
   * Advance the next reminder time BEFORE sending notifications so a
   * failure mid-send does not cause duplicate reminders on the next run.
   */
  await IncidentService.updateOneById({
    id: incidentId,
    data: {
      nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        rule.reminderIntervalInMinutes,
      ),
      reminderNotificationSentCount:
        (incident.reminderNotificationSentCount || 0) + 1,
    },
    props: {
      isRoot: true,
    },
  });

  // now find owners.

  let doesResourceHasOwners: boolean = true;

  let owners: Array<User> = await IncidentService.findOwners(incidentId);

  if (owners.length === 0) {
    doesResourceHasOwners = false;

    // find project owners.
    owners = await ProjectService.getOwners(projectId);
  }

  if (owners.length === 0) {
    return;
  }

  const openedAt: Date = incident.declaredAt || incident.createdAt!;

  const openDuration: string =
    OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
      OneUptimeDate.getDifferenceInSeconds(
        OneUptimeDate.getCurrentDate(),
        openedAt,
      ),
    );

  const resourcesAffected: string =
    incident
      .monitors!.map((monitor: Monitor) => {
        return monitor.name!;
      })
      .join(", ") || "";

  const incidentNumberStr: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  const currentStateName: string =
    incident.currentIncidentState?.name || "Open";

  const incidentViewLink: string = (
    await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)
  ).toString();

  let moreIncidentFeedInformationInMarkdown: string = "";

  for (const user of owners) {
    const vars: Dictionary<string> = {
      incidentTitle: incident.title!,
      incidentNumber: incidentNumberStr,
      projectName: incident.project!.name!,
      currentState: currentStateName,
      openDuration: openDuration,
      declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: openedAt,
        timezones: user.timezone ? [user.timezone] : [],
      }),
      incidentDescription: await Markdown.convertToHTML(
        incident.description! || "",
        MarkdownContentType.Email,
      ),
      resourcesAffected: resourcesAffected || "None",
      incidentSeverity: incident.incidentSeverity?.name || "",
      incidentViewLink: incidentViewLink,
    };

    if (doesResourceHasOwners === true) {
      vars["isOwner"] = "true";
    }

    const incidentIdentifier: string =
      incident.incidentNumber !== undefined
        ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
        : incident.title!;

    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.IncidentOwnerUnresolvedReminder,
      vars: vars,
      subject: `[Reminder] Incident ${incidentNumberStr} is still ${currentStateName} - ${incident.title!}`,
    };

    const sms: SMSMessage = {
      message: `This is a message from OneUptime. Reminder: Incident ${incidentIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. Reminder: Incident ${incidentIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
        },
      ],
    };

    const pushMessage: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: `Reminder: Incident ${incidentNumberStr} is still open`,
        body: `${incident.title!} is still ${currentStateName}. Open for ${openDuration}.`,
        clickAction: incidentViewLink,
        tag: "incident-reminder",
        requireInteraction: true,
      });

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION;

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType,
        templateVariables: {
          incident_title: incident.title!,
          incident_state: currentStateName,
          incident_number:
            incident.incidentNumber !== undefined
              ? incident.incidentNumber.toString()
              : "",
          elapsed_time: openDuration,
          incident_link: incidentViewLink,
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
      incidentId: incidentId,
      eventType,
    });

    moreIncidentFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
      {
        userId: user.id!,
        projectId: projectId,
      },
    )}\n`;
  }

  const incidentNumberDisplayValue: string =
    incident.incidentNumberWithPrefix || "#" + incident.incidentNumber!;

  await IncidentFeedService.createIncidentFeedItem({
    incidentId: incidentId,
    projectId: projectId,
    incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: `🔔 **Reminder sent to owners of [Incident ${incidentNumberDisplayValue}](${incidentViewLink})**: This incident is still **${currentStateName}** and has been open for **${openDuration}**.`,
    moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: true,
    },
  });
};
