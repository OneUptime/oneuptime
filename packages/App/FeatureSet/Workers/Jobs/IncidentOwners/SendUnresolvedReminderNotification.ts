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
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentReminderRule from "Common/Models/DatabaseModels/IncidentReminderRule";
import Label from "Common/Models/DatabaseModels/Label";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
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

const JOB_NAME: string = "IncidentOwner:SendUnresolvedReminderNotification";

// What a reminder is made of, read for each incident.
const INCIDENT_SELECT: Select<Incident> = {
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
    color: true,
  },
  labels: {
    _id: true,
  },
  currentIncidentState: {
    name: true,
    color: true,
  },
  incidentNumber: true,
  incidentNumberWithPrefix: true,
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
     * first, exactly them, while the incident is still to be reminded of
     * (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentReminder],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const incident: Incident | null = await IncidentService.findOneById({
          id: delivery.notification.resourceId,
          select: INCIDENT_SELECT,
          props: {
            isRoot: true,
          },
        });

        if (!incident) {
          await delivery.giveUp("the incident is gone");
          return;
        }

        /*
         * Late, so asked again: a reminder that an incident resolved since
         * is still open would be wrong. Not of a reminder that went out,
         * whose feed item alone is left to write (#8510).
         */
        if (
          !delivery.isFeedLeftUnwritten &&
          (await getReminderIntervalFor(incident)) === null
        ) {
          await delivery.giveUp("the incident's reminders stopped since");
          return;
        }

        await notifyOwnersOfReminder(incident, delivery);
      },
    });

    /*
     * Every incident whose reminder is due, a page at a time, the longest due
     * first, each moved on by one run alone, which tells of it; the run stops
     * at its deadline and the next carries on (OwnerReminderBacklog, issue
     * #9019).
     */
    await OwnerReminderBacklog.forEachDue<Incident>({
      jobName: JOB_NAME,
      service: IncidentService,
      select: INCIDENT_SELECT,
      deadline: deadline,
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        await sendReminderForIncident(input.record, input.reminder);
      },
    });
  },
);

/*
 * How often the incident is to be reminded of now, in minutes - or null
 * when it is not to be reminded of at all: no rule matches it any more, it
 * has reminders turned off, it is resolved, or it is acknowledged and its
 * rule stops there.
 */
async function getReminderIntervalFor(
  incident: Incident,
): Promise<number | null> {
  const incidentId: ObjectID = incident.id!;
  const projectId: ObjectID = incident.projectId!;

  /*
   * Re-match the reminder rule on every send so rule edits
   * (interval, severities, labels, enabled) apply to open incidents immediately.
   */
  const rule: IncidentReminderRule | null =
    await IncidentReminderRuleService.findMatchingRule({
      projectId: projectId,
      incidentSeverityId: incident.incidentSeverityId,
      labelIds: incident.labels?.map((label: Label) => {
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

  if (
    !rule ||
    intervalInMinutes === null ||
    incident.enableReminders === false
  ) {
    return null;
  }

  // Resolved incidents never get reminders.
  let shouldStop: boolean = await IncidentService.isIncidentResolved({
    incidentId: incidentId,
  });

  if (
    !shouldStop &&
    rule.stopRemindersOnState === ReminderStopState.Acknowledged
  ) {
    shouldStop = await IncidentService.isIncidentAcknowledged({
      incidentId: incidentId,
    });
  }

  if (shouldStop) {
    return null;
  }

  return intervalInMinutes;
}

type SendReminderForIncidentFunction = (
  incident: Incident,
  reminder: DueReminder<Incident>,
) => Promise<void>;

const sendReminderForIncident: SendReminderForIncidentFunction = async (
  incident: Incident,
  reminder: DueReminder<Incident>,
): Promise<void> => {
  const intervalInMinutes: number | null =
    await getReminderIntervalFor(incident);

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
    incident: incident,
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

  await notifyOwnersOfReminder(incident, delivery);
};

/*
 * Whom the reminder tells - the incident's owners, or the project's when it
 * has none - written down before the reminder is moved on
 * (OwnerNotificationDeliveries.plan): the reminder's number tells one
 * reminder from the next. A failure to read them tells nobody, as it did
 * when it came after the move.
 */
async function planOwnersOfReminder(data: {
  incident: Incident;
  reminderNumber: number;
}): Promise<OwnerNotificationDelivery> {
  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await IncidentService.findOwners(data.incident.id!);

    if (owners.length === 0) {
      isProjectOwners = true;

      // find project owners.
      owners = await ProjectService.getOwners(data.incident.projectId!);
    }
  } catch (e) {
    logger.error("Error in reading the owners of an incident to remind", {
      projectId: data.incident.projectId?.toString(),
      incidentId: data.incident.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: OwnerNotificationKind.IncidentReminder,
      projectId: data.incident.projectId!,
      resourceId: data.incident.id!,
      eventId: data.incident.id!,
      occurrence: data.reminderNumber,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Reminds the delivery's owners that the incident is still open, each once
 * (OwnerNotificationDelivery.tell), and says in the incident's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfReminder(
  incident: Incident,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const incidentId: ObjectID = incident.id!;
  const projectId: ObjectID = incident.projectId!;

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const openedAt: Date = incident.declaredAt || incident.createdAt!;

  const openDuration: string =
    OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
      OneUptimeDate.getDifferenceInSeconds(
        OneUptimeDate.getCurrentDate(),
        openedAt,
      ),
    );

  // Every resource the incident's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    resources: await LinkedAffectedResources.readForIncident({
      service: IncidentService,
      projectId: projectId,
      incidentId: incidentId,
    }),
    fallback: "",
  });

  const incidentNumberStr: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  const currentStateName: string =
    incident.currentIncidentState?.name || "Open";

  const incidentViewLink: string = (
    await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)
  ).toString();

  /*
   * The description does not vary per owner, so convert it once per incident
   * instead of once per owner notification.
   */
  const incidentDescriptionHtml: string = await Markdown.convertToHTML(
    incident.description! || "",
    MarkdownContentType.Email,
  );

  let moreIncidentFeedInformationInMarkdown: string = "";

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreIncidentFeedInformationInMarkdown += mdText`**Notified:** ${await UserService.getUserMarkdownString(
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
          incidentTitle: incident.title!,
          incidentNumber: incidentNumberStr,
          projectName: incident.project!.name!,
          currentState: currentStateName,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            incident.currentIncidentState?.color,
          ),
          openDuration: openDuration,
          declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: openedAt,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          incidentDescription: incidentDescriptionHtml,
          resourcesAffected: resourcesAffected || "None",
          incidentSeverity: incident.incidentSeverity?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "incidentSeverity",
            incident.incidentSeverity?.color,
          ),
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
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Reminder: Incident ${incidentIdentifier} is still ${currentStateName} and has been open for ${openDuration}.`,
          ),
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
      },
    );

    if (isTold) {
      moreIncidentFeedInformationInMarkdown += mdText`**Notified:** ${await UserService.getUserMarkdownString(
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

  const incidentNumberDisplayValue: string =
    incident.incidentNumberWithPrefix || "#" + incident.incidentNumber!;

  await IncidentFeedService.createIncidentFeedItem({
    incidentId: incidentId,
    projectId: projectId,
    incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown:
      mdText`🔔 **Reminder sent to owners of [Incident ${incidentNumberDisplayValue}](${incidentViewLink})**: This incident is still **${currentStateName}** and has been open for **${openDuration}**.`.toString(),
    moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
    /*
     * Posted to the incident's channels as a reminder, a box of its own on
     * a rule's Updates step (issue #7938): named here, so no other owner
     * notice is ever posted as one.
     */
    workspaceNotification: {
      sendWorkspaceNotification: true,
      updateKinds: [NotificationRuleUpdateKind.Reminders],
    },
  });

  await delivery.feedItemWritten();
}
