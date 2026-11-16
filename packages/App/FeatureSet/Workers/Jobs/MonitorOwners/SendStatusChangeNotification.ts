import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
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
import ProjectService from "Common/Server/Services/ProjectService";
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
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import User from "Common/Models/DatabaseModels/User";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

/*
 * What each status change is read with: its status too. Not its monitor -
 * a monitor's steps are a large jsonb, and a flapping monitor has many
 * status changes on a page: each monitor of a page is read once, in one
 * query for the page (readMonitorsOfPage), issue #7974.
 */
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
  monitorStatus: {
    name: true,
    color: true,
  },
  rootCause: true,
};

// What the monitor of a status change is read with.
const MONITOR_SELECT: Select<Monitor> = {
  _id: true,
  name: true,
  description: true,
  monitorType: true,
  // For its destination (MonitorService.getMonitorDestinationInfo).
  monitorSteps: true,
};

RunCron(
  "MonitorOwner:SendStatusChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
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

        const monitor: Monitor | null = monitorStatusTimeline?.monitorId
          ? await readMonitor(monitorStatusTimeline.monitorId)
          : null;

        if (!monitorStatusTimeline || !monitor) {
          await delivery.giveUp("the monitor or its status change is gone");
          return;
        }

        await notifyOwnersOfStatusChange({
          monitorStatusTimeline: monitorStatusTimeline,
          monitor: monitor,
          delivery: delivery,
          page: new OwnerNotificationPage(),
        });
      },
    });

    /*
     * Every status change nobody has been told about yet, a page at a time,
     * oldest first, each taken by one run alone and told by the run that
     * took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #7974).
     */
    await OwnerNotificationBacklog.forEachToNotify<MonitorStatusTimeline>({
      jobName: "MonitorOwner:SendStatusChangeEmail",
      service: MonitorStatusTimelineService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: STATUS_TIMELINE_SELECT,
      deadline: deadline,
      readPage: readMonitorsOfPage,
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        const monitorStatusTimeline: MonitorStatusTimeline = input.record;
        const page: OwnerNotificationPage = input.page;

        const monitor: Monitor | null = monitorStatusTimeline.monitorId
          ? await page.once(
              monitorKey(monitorStatusTimeline.monitorId),
              (): Promise<Monitor | null> => {
                return readMonitor(monitorStatusTimeline.monitorId!);
              },
            )
          : null;

        /*
         * Whom it is to tell - the monitor's owners, or the project's when
         * it has none - written before the take: a worker stopped from here
         * on leaves them to be told by a later run, and one stopped before
         * the take leaves the status change to be read again. Each read
         * once for every status change of the page.
         */
        const delivery: OwnerNotificationDelivery | null = monitor
          ? await OwnerNotificationDeliveries.planForOwnersOf({
              notification: {
                kind: OwnerNotificationKind.MonitorStatusChanged,
                projectId: monitorStatusTimeline.projectId!,
                resourceId: monitor.id!,
                eventId: monitorStatusTimeline.id!,
              },
              findOwners: (): Promise<Array<User>> => {
                return page.once(`owners:${monitor.id!.toString()}`, () => {
                  return MonitorService.findOwners(monitor.id!);
                });
              },
              findProjectOwners: (): Promise<Array<User>> => {
                return page.once(
                  `projectOwners:${monitorStatusTimeline.projectId!.toString()}`,
                  () => {
                    return ProjectService.getOwners(
                      monitorStatusTimeline.projectId!,
                    );
                  },
                );
              },
              writesFeedItem: false,
            })
          : null;

        // Taken by another run first, or gone: that run tells the owners.
        if (!(await input.take())) {
          return;
        }

        if (!delivery || !monitor) {
          return;
        }

        try {
          await notifyOwnersOfStatusChange({
            monitorStatusTimeline: monitorStatusTimeline,
            monitor: monitor,
            delivery: delivery,
            page: page,
          });
        } catch (e) {
          logger.error("Error in sending monitor status change notification", {
            projectId: monitorStatusTimeline.projectId?.toString(),
            monitorId: monitor.id?.toString(),
          });
          logger.error(e, {
            projectId: monitorStatusTimeline.projectId?.toString(),
            monitorId: monitor.id?.toString(),
          });
        }
      },
    });
  },
);

function monitorKey(monitorId: ObjectID): string {
  return `monitor:${monitorId.toString()}`;
}

async function readMonitor(monitorId: ObjectID): Promise<Monitor | null> {
  return await MonitorService.findOneById({
    id: monitorId,
    select: MONITOR_SELECT,
    props: {
      isRoot: true,
    },
  });
}

/*
 * The monitors of a page's status changes, in one query: each is read once
 * however many of its status changes the page has.
 */
async function readMonitorsOfPage(
  monitorStatusTimelines: Array<MonitorStatusTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  const monitorIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const monitorStatusTimeline of monitorStatusTimelines) {
    if (monitorStatusTimeline.monitorId) {
      monitorIds.set(
        monitorStatusTimeline.monitorId.toString(),
        monitorStatusTimeline.monitorId,
      );
    }
  }

  if (monitorIds.size === 0) {
    return;
  }

  const monitors: Array<Monitor> = await MonitorService.findBy({
    query: {
      _id: QueryHelper.any(Array.from(monitorIds.values())),
    },
    select: MONITOR_SELECT,
    limit: monitorIds.size,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  /*
   * One not found - gone since its state change was read - is read on its
   * own when a record asks for it, as it would be without the page.
   */
  for (const each of monitors) {
    if (each.id) {
      page.prime<Monitor | null>(monitorKey(each.id), each);
    }
  }
}

/*
 * Tells the delivery's owners that the monitor's status changed, each once
 * (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersOfStatusChange(data: {
  monitorStatusTimeline: MonitorStatusTimeline;
  monitor: Monitor;
  delivery: OwnerNotificationDelivery;
  // What the status changes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<void> {
  const monitorStatusTimeline: MonitorStatusTimeline =
    data.monitorStatusTimeline;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const monitor: Monitor = data.monitor;
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
      const previousStatusId: ObjectID = previousTimeline.monitorStatusId;

      // A project's few statuses, each read once for the page.
      previousStatus = await data.page.once(
        `monitorStatus:${previousStatusId.toString()}`,
        (): Promise<MonitorStatus | null> => {
          return MonitorStatusService.findOneById({
            id: previousStatusId,
            props: {
              isRoot: true,
            },
            select: {
              name: true,
              color: true,
            },
          });
        },
      );

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
