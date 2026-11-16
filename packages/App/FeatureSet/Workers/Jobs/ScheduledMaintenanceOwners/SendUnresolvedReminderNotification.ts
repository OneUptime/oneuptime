import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceReminderStopState from "Common/Types/Reminder/ScheduledMaintenanceReminderStopState";
import { getReminderIntervalInMinutes } from "Common/Types/Reminder/ReminderInterval";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import Label from "Common/Models/DatabaseModels/Label";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import Select from "Common/Server/Types/Database/Select";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a maintenance event is read with.
const SCHEDULED_MAINTENANCE_SELECT: Select<ScheduledMaintenance> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  endsAt: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  labels: {
    _id: true,
  },
  currentScheduledMaintenanceState: {
    name: true,
    color: true,
  },
  scheduledMaintenanceNumber: true,
  scheduledMaintenanceNumberWithPrefix: true,
  enableReminders: true,
  reminderNotificationSentCount: true,
};

RunCron(
  "ScheduledMaintenanceOwner:SendUnresolvedReminderNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between moving the reminder on and the last owner (#8509) - told
     * first, exactly them, of that reminder, and the feed item a run that
     * told them all left unwritten (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ScheduledMaintenanceReminder],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const scheduledMaintenance: ScheduledMaintenance | null =
          await ScheduledMaintenanceService.findOneById({
            id: delivery.notification.resourceId,
            select: SCHEDULED_MAINTENANCE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!scheduledMaintenance) {
          await delivery.giveUp("the scheduled maintenance event is gone");
          return;
        }

        /*
         * Late, so asked again: a reminder of an event completed since would
         * be wrong. Not of a reminder that went out, whose feed item alone is
         * left to write (#8510).
         */
        if (
          !delivery.isFeedLeftUnwritten &&
          (await remindersStopFor(scheduledMaintenance))
        ) {
          await delivery.giveUp("the event's reminders stopped since");
          return;
        }

        await notifyOwnersOfReminder(scheduledMaintenance, delivery);
      },
    });

    // get all scheduled maintenances where the next reminder notification is due.

    const scheduledMaintenances: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findAllBy({
        query: {
          nextReminderNotificationAt: QueryHelper.lessThan(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: SCHEDULED_MAINTENANCE_SELECT,
      });

    for (const scheduledMaintenance of scheduledMaintenances) {
      try {
        await sendReminderForScheduledMaintenance(scheduledMaintenance);
      } catch (error) {
        logger.error(
          `Error sending reminder for scheduled maintenance ${scheduledMaintenance.id}: ${error}`,
          {
            projectId: scheduledMaintenance.projectId?.toString(),
            scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
          },
        );
      }
    }
  },
);

/*
 * The reminder rule an event follows, matched again on every send so rule
 * edits (interval, labels, enabled) apply to open events at once.
 */
async function matchRule(
  scheduledMaintenance: ScheduledMaintenance,
): Promise<ScheduledMaintenanceReminderRule | null> {
  return await ScheduledMaintenanceReminderRuleService.findMatchingRule({
    projectId: scheduledMaintenance.projectId!,
    labelIds: scheduledMaintenance.labels?.map((label: Label) => {
      return label.id!;
    }),
  });
}

/*
 * Whether the event's reminders stop now: no rule to follow, no interval a
 * reminder can follow, reminders turned off, or the event completed - or
 * ongoing, for a rule that stops on it.
 */
async function remindersStopFor(
  scheduledMaintenance: ScheduledMaintenance,
): Promise<boolean> {
  const rule: ScheduledMaintenanceReminderRule | null =
    await matchRule(scheduledMaintenance);

  if (
    !rule ||
    getReminderIntervalInMinutes(rule.reminderIntervalInMinutes) === null ||
    scheduledMaintenance.enableReminders === false
  ) {
    return true;
  }

  return await stopsOnItsState(scheduledMaintenance.id!, rule);
}

// Completed events never get reminders; ongoing ones not, when the rule says so.
async function stopsOnItsState(
  scheduledMaintenanceId: ObjectID,
  rule: ScheduledMaintenanceReminderRule,
): Promise<boolean> {
  let shouldStop: boolean =
    await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
      scheduledMaintenanceId: scheduledMaintenanceId,
    });

  if (
    !shouldStop &&
    rule.stopRemindersOnState === ScheduledMaintenanceReminderStopState.Ongoing
  ) {
    shouldStop =
      await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
        scheduledMaintenanceId: scheduledMaintenanceId,
      });
  }

  return shouldStop;
}

type SendReminderForScheduledMaintenanceFunction = (
  scheduledMaintenance: ScheduledMaintenance,
) => Promise<void>;

const sendReminderForScheduledMaintenance: SendReminderForScheduledMaintenanceFunction =
  async (scheduledMaintenance: ScheduledMaintenance): Promise<void> => {
    const scheduledMaintenanceId: ObjectID = scheduledMaintenance.id!;
    const projectId: ObjectID = scheduledMaintenance.projectId!;

    /*
     * Re-match the reminder rule on every send so rule edits
     * (interval, labels, enabled) apply to open scheduled maintenances immediately.
     */
    const rule: ScheduledMaintenanceReminderRule | null =
      await matchRule(scheduledMaintenance);

    const stopReminders: () => Promise<void> = async (): Promise<void> => {
      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenanceId,
        data: {
          nextReminderNotificationAt: null,
        },
        props: {
          isRoot: true,
        },
      });
    };

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
      scheduledMaintenance.enableReminders === false
    ) {
      return await stopReminders();
    }

    /*
     * If this rule does not remind while the event is still scheduled and the
     * event has not started yet, defer the reminder until the event starts
     * instead of notifying owners about an event that has not begun.
     */
    if (
      !rule.remindWhileScheduled &&
      scheduledMaintenance.startsAt &&
      OneUptimeDate.isInTheFuture(scheduledMaintenance.startsAt)
    ) {
      await ScheduledMaintenanceService.updateOneById({
        id: scheduledMaintenanceId,
        data: {
          nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
            scheduledMaintenance.startsAt,
            intervalInMinutes,
          ),
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }

    if (await stopsOnItsState(scheduledMaintenanceId, rule)) {
      return await stopReminders();
    }

    const reminderNumber: number =
      (scheduledMaintenance.reminderNotificationSentCount || 0) + 1;

    /*
     * Whom this reminder is to tell - the event's owners, or the project's
     * when it has none - written before the reminder is moved on: a worker
     * stopped from here on leaves them to be told by a later run, and one
     * stopped before leaves the reminder due, to be sent by the next run.
     */
    const delivery: OwnerNotificationDelivery =
      await OwnerNotificationDeliveries.planForOwnersOf({
        notification: {
          kind: OwnerNotificationKind.ScheduledMaintenanceReminder,
          projectId: projectId,
          resourceId: scheduledMaintenanceId,
          eventId: scheduledMaintenanceId,
          occurrence: reminderNumber,
        },
        findOwners: () => {
          return ScheduledMaintenanceService.findOwners(scheduledMaintenanceId);
        },
        writesFeedItem: true,
      });

    /*
     * Advance the next reminder time BEFORE sending notifications so a
     * failure mid-send does not cause duplicate reminders on the next run.
     */
    await ScheduledMaintenanceService.updateOneById({
      id: scheduledMaintenanceId,
      data: {
        nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          intervalInMinutes,
        ),
        reminderNotificationSentCount: reminderNumber,
      },
      props: {
        isRoot: true,
      },
    });

    await notifyOwnersOfReminder(scheduledMaintenance, delivery);
  };

/*
 * Tells the delivery's owners that the maintenance event is still open, each
 * once (OwnerNotificationDelivery.tell), and says in the event's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfReminder(
  scheduledMaintenance: ScheduledMaintenance,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const scheduledMaintenanceId: ObjectID = scheduledMaintenance.id!;
  const projectId: ObjectID = scheduledMaintenance.projectId!;
  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  /*
   * Use startsAt when the event has already started, otherwise fall back to
   * createdAt for measuring how long the event has been open.
   */
  const openedAt: Date =
    scheduledMaintenance.startsAt &&
    OneUptimeDate.isInThePast(scheduledMaintenance.startsAt)
      ? scheduledMaintenance.startsAt
      : scheduledMaintenance.createdAt!;

  const openDuration: string =
    OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
      OneUptimeDate.getDifferenceInSeconds(
        OneUptimeDate.getCurrentDate(),
        openedAt,
      ),
    );

  // Every resource the event's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    resources: await LinkedAffectedResources.readForScheduledMaintenance({
      service: ScheduledMaintenanceService,
      projectId: projectId,
      scheduledMaintenanceId: scheduledMaintenanceId,
    }),
    fallback: "",
  });

  const scheduledMaintenanceNumberStr: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  const currentStateName: string =
    scheduledMaintenance.currentScheduledMaintenanceState?.name || "Scheduled";

  const scheduledMaintenanceViewLink: string = (
    await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
      projectId,
      scheduledMaintenanceId,
    )
  ).toString();

  // A person told, as the event's feed names them.
  const feedLineMarkdown: (user: User) => Promise<string> = async (
    user: User,
  ): Promise<string> => {
    return mdText`**Notified:** ${await UserService.getUserMarkdownString({
      userId: user.id!,
      projectId: projectId,
    })}\n`.toString();
  };

  let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreScheduledMaintenanceFeedInformationInMarkdown +=
      await feedLineMarkdown(user);
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const vars: Dictionary<string> = {
          scheduledMaintenanceTitle: scheduledMaintenance.title!,
          scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
          projectName: scheduledMaintenance.project!.name!,
          currentState: currentStateName,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            scheduledMaintenance.currentScheduledMaintenanceState?.color,
          ),
          openDuration: openDuration,
          openedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: openedAt,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          scheduledMaintenanceDescription: await Markdown.convertToHTML(
            scheduledMaintenance.description! || "",
            MarkdownContentType.Email,
          ),
          resourcesAffected: resourcesAffected || "None",
          scheduledMaintenanceViewLink: scheduledMaintenanceViewLink,
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const scheduledMaintenanceIdentifier: string =
          scheduledMaintenance.scheduledMaintenanceNumber !== undefined
            ? `${scheduledMaintenanceNumberStr} (${scheduledMaintenance.title})`
            : scheduledMaintenance.title!;

        const emailMessage: EmailEnvelope = {
          templateType:
            EmailTemplateType.ScheduledMaintenanceOwnerUnresolvedReminder,
          vars: vars,
          subject: `[Reminder] Scheduled Maintenance ${scheduledMaintenanceNumberStr} is still ${currentStateName} - ${scheduledMaintenance.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Reminder: Scheduled maintenance ${scheduledMaintenanceIdentifier} is still ${currentStateName} and has been open for ${openDuration}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Reminder: Scheduled maintenance ${scheduledMaintenanceIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Reminder: Scheduled Maintenance ${scheduledMaintenanceNumberStr} is still open`,
            body: `${scheduledMaintenance.title!} is still ${currentStateName}. Open for ${openDuration}.`,
            clickAction: scheduledMaintenanceViewLink,
            tag: "scheduled-maintenance-reminder",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_REMINDER_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              event_state: currentStateName,
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumber !== undefined
                  ? scheduledMaintenance.scheduledMaintenanceNumber.toString()
                  : "",
              elapsed_time: openDuration,
              event_link: scheduledMaintenanceViewLink,
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
          scheduledMaintenanceId: scheduledMaintenanceId,
          eventType,
        });
      },
    );

    if (isTold) {
      moreScheduledMaintenanceFeedInformationInMarkdown +=
        await feedLineMarkdown(user);
    }
  }

  /*
   * Written by the run that set out to tell the owners, or by the one that
   * took up the feed item a run that told them all left unwritten (#8510):
   * a run that found every owner told already writes none.
   */
  if (!delivery.isFeedItemToWrite) {
    return;
  }

  const scheduledMaintenanceDisplayNumber: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    "#" + scheduledMaintenance.scheduledMaintenanceNumber!;

  await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
    scheduledMaintenanceId: scheduledMaintenanceId,
    projectId: projectId,
    scheduledMaintenanceFeedEventType:
      ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown:
      mdText`🔔 **Reminder sent to owners of [Scheduled Maintenance ${scheduledMaintenanceDisplayNumber}](${scheduledMaintenanceViewLink})**: This scheduled maintenance is still **${currentStateName}** and has been open for **${openDuration}**.`.toString(),
    moreInformationInMarkdown:
      moreScheduledMaintenanceFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: true,
    },
  });

  await delivery.feedItemWritten();
}
