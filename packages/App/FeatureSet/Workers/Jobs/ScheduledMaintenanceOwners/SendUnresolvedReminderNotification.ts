import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenanceReminderStopState from "Common/Types/Reminder/ScheduledMaintenanceReminderStopState";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "ScheduledMaintenanceOwner:SendUnresolvedReminderNotification",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
        select: {
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
          },
          monitors: {
            name: true,
          },
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
          enableReminders: true,
          reminderNotificationSentCount: true,
        },
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
      await ScheduledMaintenanceReminderRuleService.findMatchingRule({
        projectId: projectId,
        labelIds: scheduledMaintenance.labels?.map((label: Label) => {
          return label.id!;
        }),
      });

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

    if (
      !rule ||
      !rule.reminderIntervalInMinutes ||
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
            rule.reminderIntervalInMinutes,
          ),
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }

    // Completed scheduled maintenances never get reminders.
    let shouldStop: boolean =
      await ScheduledMaintenanceService.isScheduledMaintenanceCompleted({
        scheduledMaintenanceId: scheduledMaintenanceId,
      });

    if (
      !shouldStop &&
      rule.stopRemindersOnState ===
        ScheduledMaintenanceReminderStopState.Ongoing
    ) {
      shouldStop =
        await ScheduledMaintenanceService.isScheduledMaintenanceOngoing({
          scheduledMaintenanceId: scheduledMaintenanceId,
        });
    }

    if (shouldStop) {
      return await stopReminders();
    }

    /*
     * Advance the next reminder time BEFORE sending notifications so a
     * failure mid-send does not cause duplicate reminders on the next run.
     */
    await ScheduledMaintenanceService.updateOneById({
      id: scheduledMaintenanceId,
      data: {
        nextReminderNotificationAt: OneUptimeDate.addRemoveMinutes(
          OneUptimeDate.getCurrentDate(),
          rule.reminderIntervalInMinutes,
        ),
        reminderNotificationSentCount:
          (scheduledMaintenance.reminderNotificationSentCount || 0) + 1,
      },
      props: {
        isRoot: true,
      },
    });

    // now find owners.

    let doesResourceHasOwners: boolean = true;

    let owners: Array<User> = await ScheduledMaintenanceService.findOwners(
      scheduledMaintenanceId,
    );

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(projectId);
    }

    if (owners.length === 0) {
      return;
    }

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

    const resourcesAffected: string =
      scheduledMaintenance
        .monitors!.map((monitor: Monitor) => {
          return monitor.name!;
        })
        .join(", ") || "";

    const scheduledMaintenanceNumberStr: string =
      scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
      (scheduledMaintenance.scheduledMaintenanceNumber
        ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
        : "");

    const currentStateName: string =
      scheduledMaintenance.currentScheduledMaintenanceState?.name ||
      "Scheduled";

    const scheduledMaintenanceViewLink: string = (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        projectId,
        scheduledMaintenanceId,
      )
    ).toString();

    let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

    for (const user of owners) {
      const vars: Dictionary<string> = {
        scheduledMaintenanceTitle: scheduledMaintenance.title!,
        scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
        projectName: scheduledMaintenance.project!.name!,
        currentState: currentStateName,
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
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. Reminder: Scheduled maintenance ${scheduledMaintenanceIdentifier} is still ${currentStateName} and has been open for ${openDuration}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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

      moreScheduledMaintenanceFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
        {
          userId: user.id!,
          projectId: projectId,
        },
      )}\n`;
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
      feedInfoInMarkdown: `🔔 **Reminder sent to owners of [Scheduled Maintenance ${scheduledMaintenanceDisplayNumber}](${scheduledMaintenanceViewLink})**: This scheduled maintenance is still **${currentStateName}** and has been open for **${openDuration}**.`,
      moreInformationInMarkdown:
        moreScheduledMaintenanceFeedInformationInMarkdown,
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });
  };
