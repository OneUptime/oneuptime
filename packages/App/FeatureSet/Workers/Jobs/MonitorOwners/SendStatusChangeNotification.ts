import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
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
import MonitorService, {
  MonitorDestinationInfo,
} from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each status change is read with: its monitor and status too.
const STATUS_TIMELINE_SELECT: Select<MonitorStatusTimeline> = {
  _id: true,
  projectId: true,
  createdAt: true,
  startsAt: true,
  monitorId: true,
  monitorStatusId: true,
  project: {
    name: true,
  },
  monitor: {
    _id: true,
    name: true,
    description: true,
    monitorType: true,
    monitorSteps: true,
  },
  monitorStatus: {
    name: true,
    color: true,
  },
  rootCause: true,
};

RunCron(
  "MonitorOwner:SendStatusChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the status change as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.MonitorStatusChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const monitorStatusTimeline: MonitorStatusTimeline | null =
          await MonitorStatusTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATUS_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!monitorStatusTimeline?.monitor) {
          await delivery.giveUp("the monitor or its status change is gone");
          return;
        }

        await notifyOwnersOfStatusChange(monitorStatusTimeline, delivery);
      },
    });

    // get all scheduled events of all the projects.

    const monitorStatusTimelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: STATUS_TIMELINE_SELECT,
      });

    for (const monitorStatusTimeline of monitorStatusTimelines) {
      const monitor: Monitor | undefined = monitorStatusTimeline.monitor;

      /*
       * Whom it is to tell - the monitor's owners, or the project's when it
       * has none - written before the take: a worker stopped from here on
       * leaves them to be told by a later run, and one stopped before the
       * take leaves the status change to be read again.
       */
      const delivery: OwnerNotificationDelivery | null = monitor
        ? await OwnerNotificationDeliveries.planForOwnersOf({
            notification: {
              kind: OwnerNotificationKind.MonitorStatusChanged,
              projectId: monitorStatusTimeline.projectId!,
              resourceId: monitor.id!,
              eventId: monitorStatusTimeline.id!,
            },
            findOwners: () => {
              return MonitorService.findOwners(monitor.id!);
            },
            writesFeedItem: false,
          })
        : null;

      await MonitorStatusTimelineService.updateOneById({
        id: monitorStatusTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!delivery) {
        continue;
      }

      try {
        await notifyOwnersOfStatusChange(monitorStatusTimeline, delivery);
      } catch (e) {
        logger.error("Error in sending monitor status change notification", {
          projectId: monitorStatusTimeline.projectId?.toString(),
          monitorId: monitor?.id?.toString(),
        });
        logger.error(e, {
          projectId: monitorStatusTimeline.projectId?.toString(),
          monitorId: monitor?.id?.toString(),
        });
      }
    }
  },
);

/*
 * Tells the delivery's owners that the monitor's status changed, each once
 * (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersOfStatusChange(
  monitorStatusTimeline: MonitorStatusTimeline,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const monitor: Monitor = monitorStatusTimeline.monitor!;
  const monitorStatus: MonitorStatus = monitorStatusTimeline.monitorStatus!;

  // Fetch the previous status timeline entry
  let previousStatus: MonitorStatus | null = null;
  let previousStatusDuration: string = "";

  if (monitorStatusTimeline.monitorId && monitorStatusTimeline.startsAt) {
    const previousTimeline: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: {
          monitorId: monitorStatusTimeline.monitorId,
          startsAt: QueryHelper.lessThan(monitorStatusTimeline.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          monitorStatusId: true,
          startsAt: true,
          createdAt: true,
        },
      });

    if (previousTimeline?.monitorStatusId) {
      previousStatus = await MonitorStatusService.findOneById({
        id: previousTimeline.monitorStatusId,
        props: {
          isRoot: true,
        },
        select: {
          name: true,
          color: true,
        },
      });

      /*
       * Calculate how long the monitor was in the previous status
       * Use startsAt if available, otherwise fall back to createdAt
       */
      const previousStartTime: Date | undefined =
        previousTimeline.startsAt || previousTimeline.createdAt;
      const currentStartTime: Date | undefined =
        monitorStatusTimeline.startsAt || monitorStatusTimeline.createdAt;

      if (previousStartTime && currentStartTime) {
        logger.debug(
          `Calculating duration between ${previousStartTime.toISOString()} and ${currentStartTime.toISOString()}`,
        );

        const durationInSeconds: number = OneUptimeDate.getDifferenceInSeconds(
          currentStartTime,
          previousStartTime,
        );
        previousStatusDuration =
          OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
            durationInSeconds,
          );

        logger.debug(`Previous status duration: ${previousStatusDuration}`);
      }
    }
  }

  // Get monitor destination info using the helper function
  const destinationInfo: MonitorDestinationInfo =
    MonitorService.getMonitorDestinationInfo(monitor);

  /*
   * These values do not vary per owner, so compute them once per status
   * timeline instead of once per owner notification.
   */
  const monitorDescriptionHtml: string = await Markdown.convertToHTML(
    monitor.description! || "",
    MarkdownContentType.Email,
  );

  const monitorViewLink: string = (
    await MonitorService.getMonitorLinkInDashboard(
      monitorStatusTimeline.projectId!,
      monitor.id!,
    )
  ).toString();

  const rootCauseHtml: string =
    (await Markdown.convertToHTML(
      monitorStatusTimeline.rootCause || "",
      MarkdownContentType.Email,
    )) || "";

  for (const user of delivery.owners) {
    await delivery.tell(user, async (): Promise<void> => {
      // Build the "Was X for Y" string
      const previousStatusDurationText: string =
        previousStatus?.name && previousStatusDuration
          ? `Was ${previousStatus.name} for ${previousStatusDuration}`
          : "";

      const vars: Dictionary<string> = {
        monitorName: monitor.name!,
        projectName: monitorStatusTimeline.project!.name!,
        currentStatus: monitorStatus!.name!,
        ...EmailColorUtil.getTemplateVariables(
          "currentStatus",
          monitorStatus!.color,
        ),
        previousStatus: previousStatus?.name || "",
        ...EmailColorUtil.getTemplateVariables(
          "previousStatus",
          previousStatus?.color,
        ),
        previousStatusDurationText: previousStatusDurationText,
        monitorDescription: monitorDescriptionHtml,
        statusChangedAt:
          OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: monitorStatusTimeline.createdAt!,
            timezones: user.timezone ? [user.timezone] : [],
          }),
        monitorViewLink: monitorViewLink,
        rootCause: rootCauseHtml,
        monitorDestination: destinationInfo.monitorDestination,
        requestType: destinationInfo.requestType,
        monitorType: destinationInfo.monitorType,
      };

      if (!delivery.isProjectOwners) {
        vars["isOwner"] = "true";
      }

      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.MonitorOwnerStatusChanged,
        vars: vars,
        subject: `[${monitorStatus!.name!} Monitor] ${
          monitor.name || "Monitor"
        }`,
        isSubjectLiteral: true,
      };

      const sms: SMSMessage = {
        message: buildNotificationSms(
          `${
            monitor.name || "Monitor"
          } status changed${previousStatus ? ` from ${previousStatus.name}` : ""} to ${monitorStatus!
            .name!}.`,
        ),
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. ${
              monitor.name || "Monitor"
            } status changed${previousStatus ? ` from ${previousStatus.name}` : ""} to ${monitorStatus!
              .name!}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      };

      const pushNotificationParams: {
        monitorName: string;
        projectName: string;
        newStatus: string;
        previousStatus?: string;
        monitorViewLink: string;
        monitorId?: string;
        projectId?: string;
      } = {
        monitorName: monitor.name || "Monitor",
        projectName: monitorStatusTimeline.project!.name!,
        newStatus: monitorStatus!.name!,
        monitorViewLink: vars["monitorViewLink"] || "",
        monitorId: monitor.id!.toString(),
        projectId: monitorStatusTimeline.projectId!.toString(),
      };

      if (previousStatus?.name) {
        pushNotificationParams.previousStatus = previousStatus.name;
      }

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createMonitorStatusChangedNotification(
          pushNotificationParams,
        );

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            monitor_name: monitor.name || "Monitor",
            monitor_status: monitorStatus!.name!,
            monitor_link: vars["monitorViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: user.id!,
        projectId: monitorStatusTimeline.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        whatsAppMessage,
        eventType,
        monitorId: monitor.id!,
      });
    });
  }
}
