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
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ProjectService from "Common/Server/Services/ProjectService";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each state change is read with: its event and state too.
const STATE_TIMELINE_SELECT: Select<ScheduledMaintenanceStateTimeline> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  projectId: true,
  project: {
    name: true,
  },
  scheduledMaintenanceId: true,
  scheduledMaintenance: {
    _id: true,
    title: true,
    description: true,
    projectId: true,
    scheduledMaintenanceNumber: true,
    scheduledMaintenanceNumberWithPrefix: true,
  },
  scheduledMaintenanceStateId: true,
  scheduledMaintenanceState: {
    name: true,
    color: true,
  },
};

RunCron(
  "ScheduledMaintenanceOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ScheduledMaintenanceStateChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline | null =
          await ScheduledMaintenanceStateTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATE_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        if (!scheduledMaintenanceStateTimeline?.scheduledMaintenance) {
          await delivery.giveUp(
            "the scheduled maintenance event or its state change is gone",
          );
          return;
        }

        await notifyOwnersOfStateChange({
          scheduledMaintenanceStateTimeline: scheduledMaintenanceStateTimeline,
          delivery: delivery,
          page: new OwnerNotificationPage(),
        });
      },
    });

    /*
     * Every state change nobody has been told about yet, a page at a time,
     * oldest first, each taken by one run alone and told by the run that
     * took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #7974).
     */
    await OwnerNotificationBacklog.forEachToNotify<ScheduledMaintenanceStateTimeline>(
      {
        jobName: "ScheduledMaintenanceOwner:SendStateChangeEmail",
        service: ScheduledMaintenanceStateTimelineService,
        notYetNotified: {
          isOwnerNotified: false,
        },
        notified: {
          isOwnerNotified: true,
        },
        select: STATE_TIMELINE_SELECT,
        deadline: deadline,
        notify: async (input: {
          record: ScheduledMaintenanceStateTimeline;
          page: OwnerNotificationPage;
          take: () => Promise<boolean>;
        }): Promise<void> => {
          await notifyOfStateChange({
            scheduledMaintenanceStateTimeline: input.record,
            page: input.page,
            take: input.take,
          });
        },
      },
    );
  },
);

/*
 * One state change read by the run: whom it tells planned, the state change
 * taken, and - when this run took it - its owners told.
 */
async function notifyOfStateChange(data: {
  scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
    data.scheduledMaintenanceStateTimeline;
  const page: OwnerNotificationPage = data.page;

  const scheduledMaintenance: ScheduledMaintenance | undefined =
    scheduledMaintenanceStateTimeline.scheduledMaintenance;

  /*
   * Whom it is to tell - the event's owners, or the project's when it
   * has none - written before the take: a worker stopped from here on
   * leaves them to be told by a later run, and one stopped before the
   * take leaves the state change to be read again.
   */
  const delivery: OwnerNotificationDelivery | null = scheduledMaintenance
    ? await OwnerNotificationDeliveries.planForOwnersOf({
        notification: {
          kind: OwnerNotificationKind.ScheduledMaintenanceStateChanged,
          projectId: scheduledMaintenanceStateTimeline.projectId!,
          resourceId: scheduledMaintenance.id!,
          eventId: scheduledMaintenanceStateTimeline.id!,
        },
        // Each read once for every state change of the page.
        findOwners: (): Promise<Array<User>> => {
          return page.once(
            `owners:${scheduledMaintenance.id!.toString()}`,
            () => {
              return ScheduledMaintenanceService.findOwners(
                scheduledMaintenance.id!,
              );
            },
          );
        },
        findProjectOwners: (): Promise<Array<User>> => {
          return page.once(
            `projectOwners:${scheduledMaintenanceStateTimeline.projectId!.toString()}`,
            () => {
              return ProjectService.getOwners(
                scheduledMaintenanceStateTimeline.projectId!,
              );
            },
          );
        },
        writesFeedItem: true,
      })
    : null;

  // Taken by another run first, or gone: that run tells the owners.
  if (!(await data.take())) {
    return;
  }

  if (!delivery) {
    return;
  }

  try {
    await notifyOwnersOfStateChange({
      scheduledMaintenanceStateTimeline: scheduledMaintenanceStateTimeline,
      delivery: delivery,
      page: page,
    });
  } catch (e) {
    logger.error(
      "Error in sending scheduled maintenance state change notification",
      {
        projectId: scheduledMaintenanceStateTimeline.projectId?.toString(),
        scheduledMaintenanceId: scheduledMaintenance?.id?.toString(),
      },
    );
    logger.error(e, {
      projectId: scheduledMaintenanceStateTimeline.projectId?.toString(),
      scheduledMaintenanceId: scheduledMaintenance?.id?.toString(),
    });
  }
}

/*
 * Tells the delivery's owners that the maintenance event's state changed,
 * each once (OwnerNotificationDelivery.tell), and says in the event's feed
 * whom it reached - those a stopped run told first among them.
 */
async function notifyOwnersOfStateChange(data: {
  scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline;
  delivery: OwnerNotificationDelivery;
  // What the state changes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<void> {
  const scheduledMaintenanceStateTimeline: ScheduledMaintenanceStateTimeline =
    data.scheduledMaintenanceStateTimeline;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  let moreScheduledMaintenanceFeedInformationInMarkdown: string = "";

  const scheduledMaintenance: ScheduledMaintenance =
    scheduledMaintenanceStateTimeline.scheduledMaintenance!;
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    scheduledMaintenanceStateTimeline.scheduledMaintenanceState!;

  // Fetch the previous state timeline entry
  let previousState: ScheduledMaintenanceState | null = null;
  let previousStateDuration: string = "";

  if (
    scheduledMaintenanceStateTimeline.scheduledMaintenanceId &&
    scheduledMaintenanceStateTimeline.startsAt
  ) {
    const previousTimeline: ScheduledMaintenanceStateTimeline | null =
      await ScheduledMaintenanceStateTimelineService.findOneBy({
        query: {
          scheduledMaintenanceId:
            scheduledMaintenanceStateTimeline.scheduledMaintenanceId,
          startsAt: QueryHelper.lessThan(
            scheduledMaintenanceStateTimeline.startsAt,
          ),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          scheduledMaintenanceStateId: true,
          startsAt: true,
          createdAt: true,
        },
      });

    if (previousTimeline?.scheduledMaintenanceStateId) {
      const previousStateId: ObjectID =
        previousTimeline.scheduledMaintenanceStateId;

      // A project's few states, each read once for the page.
      previousState = await data.page.once(
        `scheduledMaintenanceState:${previousStateId.toString()}`,
        (): Promise<ScheduledMaintenanceState | null> => {
          return ScheduledMaintenanceStateService.findOneById({
            id: previousStateId,
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
       * Calculate how long the scheduled maintenance was in the previous state
       * Use startsAt if available, otherwise fall back to createdAt
       */
      const previousStartTime: Date | undefined =
        previousTimeline.startsAt || previousTimeline.createdAt;
      const currentStartTime: Date | undefined =
        scheduledMaintenanceStateTimeline.startsAt ||
        scheduledMaintenanceStateTimeline.createdAt;

      if (previousStartTime && currentStartTime) {
        const durationInSeconds: number = OneUptimeDate.getDifferenceInSeconds(
          currentStartTime,
          previousStartTime,
        );
        previousStateDuration =
          OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
            durationInSeconds,
          );
      }
    }
  }

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreScheduledMaintenanceFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        await UserService.getUserMarkdownString({
          userId: user.id!,
          projectId: scheduledMaintenanceStateTimeline.projectId!,
        }),
      );
  }

  const scheduledMaintenanceNumberStr: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        // Build the "Was X for Y" string
        const previousStateDurationText: string =
          previousState?.name && previousStateDuration
            ? `Was ${previousState.name} for ${previousStateDuration}`
            : "";

        const vars: Dictionary<string> = {
          scheduledMaintenanceTitle: scheduledMaintenance.title!,
          scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
          projectName: scheduledMaintenanceStateTimeline.project!.name!,
          currentState: scheduledMaintenanceState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            scheduledMaintenanceState!.color,
          ),
          previousState: previousState?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "previousState",
            previousState?.color,
          ),
          previousStateDurationText: previousStateDurationText,
          scheduledMaintenanceDescription: await Markdown.convertToHTML(
            scheduledMaintenance.description! || "",
            MarkdownContentType.Email,
          ),
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: scheduledMaintenanceStateTimeline.startsAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          scheduledMaintenanceViewLink: (
            await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
              scheduledMaintenanceStateTimeline.projectId!,
              scheduledMaintenance.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerStateChanged,
          vars: vars,
          subject: `[${Text.uppercaseFirstLetter(
            scheduledMaintenanceState!.name!,
          )} Scheduled Maintenance ${scheduledMaintenanceNumberStr}] - ${scheduledMaintenance.title}`,
          isSubjectLiteral: true,
        };

        const scheduledMaintenanceIdentifier: string =
          scheduledMaintenance.scheduledMaintenanceNumber !== undefined
            ? `${scheduledMaintenanceNumberStr} (${scheduledMaintenance.title})`
            : scheduledMaintenance.title!;

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Maintenance event - ${scheduledMaintenanceIdentifier}, state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!
              .name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Maintenance event ${scheduledMaintenanceIdentifier} state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!
                .name!}. To view this event, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Scheduled Maintenance ${scheduledMaintenanceNumberStr} State Changed`,
            body: `Maintenance event ${scheduledMaintenanceIdentifier} state changed${previousState ? ` from ${previousState.name}` : ""} to ${scheduledMaintenanceState!.name!}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-state-changed",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              event_state: scheduledMaintenanceState!.name!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
                (scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                  "N/A"),
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenanceStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          scheduledMaintenanceId: scheduledMaintenance.id!,
          eventType,
        });
      },
    );

    if (isTold) {
      moreScheduledMaintenanceFeedInformationInMarkdown +=
        OwnerNotificationFeedText.notifiedLineMarkdown(
          await UserService.getUserMarkdownString({
            userId: user.id!,
            projectId: scheduledMaintenanceStateTimeline.projectId!,
          }),
        );
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

  await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
    scheduledMaintenanceId: scheduledMaintenance.id!,
    projectId: scheduledMaintenance.projectId!,
    scheduledMaintenanceFeedEventType:
      ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: OwnerNotificationFeedText.stateChanged({
      isProjectOwners: !doesResourceHasOwners,
      recordNoun: "maintenance event",
      stateName: scheduledMaintenanceState.name,
    }),
    moreInformationInMarkdown:
      moreScheduledMaintenanceFeedInformationInMarkdown,
    /*
     * The feed only. That the owners were told is a side effect of the
     * state change, which the channel was told of itself: posting it to
     * Slack and Microsoft Teams said the same change twice.
     */
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
