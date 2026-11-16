import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import PreviousTimelineEntries, {
  TimelineOf,
} from "../../Utils/PreviousTimelineEntries";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import Text from "Common/Types/Text";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";

import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each state change is read with.
const STATE_TIMELINE_SELECT: Select<AlertStateTimeline> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  projectId: true,
  project: {
    name: true,
  },
  alertId: true,
  alertStateId: true,
  /*
   * WHY the state changed, in the same sentence the firing email
   * used. Populated on the autoresolve path by
   * MonitorAlert.resolveOpenAlert and on every other transition by
   * AlertService.changeAlertState. Without it the resolution email
   * said only that the state changed, and a reader could not tell a
   * real recovery from a monitor oscillating around its threshold.
   */
  rootCause: true,
  alertState: {
    name: true,
    color: true,
  },
};

// What the alert of a state change is read with.
const ALERT_SELECT: Select<Alert> = {
  _id: true,
  title: true,
  projectId: true,
  description: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
  alertSeverity: {
    name: true,
    color: true,
  },
  /*
   * The series this alert was raised for. Without it this email said
   * "Resources Affected: <the monitor's own name>" while the firing
   * email - which does select it - named the pod.
   */
  seriesLabels: true,
};

/*
 * The entries a state change's previous one is read from, and what it is read
 * with: for "Was ... for ..." in its email (PreviousTimelineEntries).
 */
const TIMELINE: TimelineOf<AlertStateTimeline> = {
  service: AlertStateTimelineService,
  recordIdColumn: "alertId",
  select: {
    alertStateId: true,
    startsAt: true,
    createdAt: true,
  },
};

RunCron(
  "AlertOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the state change as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertStateChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const alertStateTimeline: AlertStateTimeline | null =
          await AlertStateTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATE_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const alert: Alert | null = alertStateTimeline
          ? await readAlert(delivery.notification.resourceId)
          : null;

        if (!alertStateTimeline || !alert) {
          await delivery.giveUp("the alert or its state change is gone");
          return;
        }

        await notifyOwnersOfStateChange({
          alertStateTimeline: alertStateTimeline,
          alert: alert,
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
    await OwnerNotificationBacklog.forEachToNotify<AlertStateTimeline>({
      jobName: "AlertOwner:SendStateChangeEmail",
      service: AlertStateTimelineService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: STATE_TIMELINE_SELECT,
      deadline: deadline,
      readPage: readPageOfStateChanges,
      notify: async (input: {
        record: AlertStateTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfStateChange({
          alertStateTimeline: input.record,
          page: input.page,
          take: input.take,
        });
      },
    });
  },
);

/*
 * One state change read by the run: whom it tells planned, the state change
 * taken, and - when this run took it - its owners told.
 */
async function notifyOfStateChange(data: {
  alertStateTimeline: AlertStateTimeline;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const alertStateTimeline: AlertStateTimeline = data.alertStateTimeline;
  const alertId: ObjectID | undefined = alertStateTimeline.alertId;

  const alert: Alert | null = alertId
    ? await data.page.once(alertKey(alertId), (): Promise<Alert | null> => {
        return readAlert(alertId);
      })
    : null;

  /*
   * The alert is gone: nobody can be told of its state change. Taken all
   * the same, so no run reads it again.
   */
  if (!alert) {
    await data.take();
    return;
  }

  /*
   * Whom it is to tell, written before the take: a worker stopped from
   * here on leaves them to be told by a later run, and one stopped before
   * the take leaves the state change to be read again.
   */
  const delivery: OwnerNotificationDelivery = await planOwnersOfStateChange({
    alertStateTimeline: alertStateTimeline,
    alert: alert,
    page: data.page,
  });

  // Taken by another run first, or gone: that run tells the owners.
  if (!(await data.take())) {
    return;
  }

  try {
    await notifyOwnersOfStateChange({
      alertStateTimeline: alertStateTimeline,
      alert: alert,
      delivery: delivery,
      page: data.page,
    });
  } catch (e) {
    logger.error("Error in sending alert state change notification", {
      projectId: alert.projectId?.toString(),
      alertId: alert.id?.toString(),
    });
    logger.error(e, {
      projectId: alert.projectId?.toString(),
      alertId: alert.id?.toString(),
    });
  }
}

function alertKey(alertId: ObjectID): string {
  return `alert:${alertId.toString()}`;
}

/*
 * What every state change of a page needs, read once for the page: the
 * alerts they are of (readAlertsOfPage), and the entry before each
 * (PreviousTimelineEntries: two reads per alert with more than one of
 * them on the page, instead of one per state change).
 */
async function readPageOfStateChanges(
  entries: Array<AlertStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  await readAlertsOfPage(entries, page);

  await PreviousTimelineEntries.readForPage({
    ...TIMELINE,
    entries: entries,
    page: page,
  });
}

/*
 * The alerts of a page's state changes, in one query: each is read once
 * however many of its state changes the page has.
 */
async function readAlertsOfPage(
  alertStateTimelines: Array<AlertStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  const alertIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const alertStateTimeline of alertStateTimelines) {
    if (alertStateTimeline.alertId) {
      alertIds.set(
        alertStateTimeline.alertId.toString(),
        alertStateTimeline.alertId,
      );
    }
  }

  if (alertIds.size === 0) {
    return;
  }

  const alerts: Array<Alert> = await AlertService.findBy({
    query: {
      _id: QueryHelper.any(Array.from(alertIds.values())),
    },
    select: ALERT_SELECT,
    limit: alertIds.size,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  /*
   * One not found - gone since its state change was read - is read on its
   * own when a record asks for it, as it would be without the page.
   */
  for (const each of alerts) {
    if (each.id) {
      page.prime<Alert | null>(alertKey(each.id), each);
    }
  }
}

async function readAlert(alertId: ObjectID): Promise<Alert | null> {
  return await AlertService.findOneById({
    id: alertId,
    props: {
      isRoot: true,
    },
    select: ALERT_SELECT,
  });
}

/*
 * Whom the state change's notification tells - the alert's owners, or the
 * project's when it has none - written down before the state change is
 * taken (OwnerNotificationDeliveries.plan). A failure to read them tells
 * nobody, as it did when it came after the take.
 */
async function planOwnersOfStateChange(data: {
  alertStateTimeline: AlertStateTimeline;
  alert: Alert;
  // Each read once for every state change of the page.
  page: OwnerNotificationPage;
}): Promise<OwnerNotificationDelivery> {
  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await data.page.once(
      `owners:${data.alert.id!.toString()}`,
      (): Promise<Array<User>> => {
        return AlertService.findOwners(data.alert.id!);
      },
    );

    if (owners.length === 0) {
      isProjectOwners = true;

      // find project owners.
      owners = await data.page.once(
        `projectOwners:${data.alertStateTimeline.projectId!.toString()}`,
        (): Promise<Array<User>> => {
          return ProjectService.getOwners(data.alertStateTimeline.projectId!);
        },
      );
    }
  } catch (e) {
    logger.error("Error in reading the owners of an alert's state change", {
      projectId: data.alert.projectId?.toString(),
      alertId: data.alert.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: OwnerNotificationKind.AlertStateChanged,
      projectId: data.alertStateTimeline.projectId!,
      resourceId: data.alert.id!,
      eventId: data.alertStateTimeline.id!,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Tells the delivery's owners that the alert's state changed, each once
 * (OwnerNotificationDelivery.tell), and says in the alert's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfStateChange(data: {
  alertStateTimeline: AlertStateTimeline;
  alert: Alert;
  delivery: OwnerNotificationDelivery;
  // What the state changes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<void> {
  const alertStateTimeline: AlertStateTimeline = data.alertStateTimeline;
  const alert: Alert = data.alert;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const alertState: AlertState = alertStateTimeline.alertState!;

  // Fetch the previous state timeline entry
  let previousState: AlertState | null = null;
  let previousStateDuration: string = "";

  if (alertStateTimeline.alertId && alertStateTimeline.startsAt) {
    const previousTimeline: AlertStateTimeline | null =
      // Read with the page's other state changes of the alert, or on its own (#8863).
      await PreviousTimelineEntries.of({
        ...TIMELINE,
        entry: alertStateTimeline,
        page: data.page,
      });

    if (previousTimeline?.alertStateId) {
      const previousStateId: ObjectID = previousTimeline.alertStateId;

      // A project's few states, each read once for the page.
      previousState = await data.page.once(
        `alertState:${previousStateId.toString()}`,
        (): Promise<AlertState | null> => {
          return AlertStateService.findOneById({
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
       * Calculate how long the alert was in the previous state
       * Use startsAt if available, otherwise fall back to createdAt
       */
      const previousStartTime: Date | undefined =
        previousTimeline.startsAt || previousTimeline.createdAt;
      const currentStartTime: Date | undefined =
        alertStateTimeline.startsAt || alertStateTimeline.createdAt;

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

  let moreAlertFeedInformationInMarkdown: string = "";

  const alertNumberStr: string =
    alert.alertNumberWithPrefix ||
    (alert.alertNumber ? `#${alert.alertNumber}` : "");

  const alertDescriptionHtml: string = await Markdown.convertToHTML(
    alert.description! || "",
    MarkdownContentType.Email,
  );

  /*
   * Same list the created-alert email uses, so a firing and its
   * resolution name the same thing: the series in the monitor's place
   * (a monitor without group-by has no series labels and keeps its own
   * name), then everything else the Affected Resources card lists.
   */
  const resourcesAffected: string = LinkedAffectedResources.getText({
    // Read once for every state change of the alert on the page.
    resources: await data.page.once(
      `resourcesAffected:${alert.id!.toString()}`,
      (): Promise<Array<LinkedAffectedResource>> => {
        return LinkedAffectedResources.readForAlert({
          service: AlertService,
          projectId: alert.projectId!,
          alertId: alert.id!,
        });
      },
    ),
    seriesSummary: SeriesLabelDisplay.buildInlineSummary(alert.seriesLabels),
    fallback: "",
  });

  /*
   * Assigned unconditionally, "" when the timeline row carries no root
   * cause: the template's guard is a presence check and a conditionally
   * ADDED key would still be a defined-but-blank row in some renderers.
   */
  const stateChangeRootCauseHtml: string = alertStateTimeline.rootCause
    ? await Markdown.convertToHTML(
        alertStateTimeline.rootCause,
        MarkdownContentType.Email,
      )
    : "";

  /*
   * Hoisted out of the owner loop: it is derived from the row's previous
   * state, which does not vary per owner. The preheader below needs it,
   * and computing it three times for three owners was never meaningful.
   */
  const previousStateDurationText: string =
    previousState?.name && previousStateDuration
      ? `Was ${previousState.name} for ${previousStateDuration}`
      : "";

  /*
   * The inbox preview line. Every one of a flap's resolve notifications
   * previewed as "Alert state has changed", so the list gave the reader
   * nothing to triage on; this makes the row say which state, for which
   * resource, and how long it sat in the previous one.
   *
   * Deliberately built from plain strings only. The root cause would be
   * the richest thing to put here, but it is Markdown and no client
   * renders markup in a preview line - it is in the body instead, under
   * "Root Cause".
   */
  const preheader: string = [
    alertState.name || "",
    resourcesAffected,
    previousStateDurationText,
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
        await UserService.getUserMarkdownString({
          userId: user.id!,
          projectId: alertStateTimeline.projectId!,
        }),
      );
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alertNumberStr} (${alert.title})`
            : alert.title!;

        const vars: Dictionary<string> = {
          alertTitle: alert.title!,
          alertNumber: alertNumberStr,
          projectName: alertStateTimeline.project!.name!,
          currentState: alertState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            alertState!.color,
          ),
          previousState: previousState?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "previousState",
            previousState?.color,
          ),
          previousStateDurationText: previousStateDurationText,
          alertDescription: alertDescriptionHtml,
          resourcesAffected: resourcesAffected,
          stateChangeRootCause: stateChangeRootCauseHtml,
          preheader: preheader,
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: alertStateTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          alertSeverity: alert.alertSeverity!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "alertSeverity",
            alert.alertSeverity?.color,
          ),
          alertViewLink: (
            await AlertService.getAlertLinkInDashboard(
              alertStateTimeline.projectId!,
              alert.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerStateChanged,
          vars: vars,
          subject: `[${Text.uppercaseFirstLetter(
            alertState!.name!,
          )} Alert ${alertNumberStr}] - ${alert.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Alert ${alertIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
              .name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Alert ${
                alertIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert ${alertNumberStr} State Changed: ${alert.title}`,
            body: `Alert ${alertNumberStr} state changed${previousState ? ` from ${previousState.name}` : ""} to ${alertState!.name!} in ${alertStateTimeline.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alertStateTimeline.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-state-changed",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_state: alertState!.name!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: alertStateTimeline.projectId!,
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
          await UserService.getUserMarkdownString({
            userId: user.id!,
            projectId: alertStateTimeline.projectId!,
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

  await AlertFeedService.createAlertFeedItem({
    alertId: alert.id!,
    projectId: alert.projectId!,
    alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: OwnerNotificationFeedText.stateChanged({
      isProjectOwners: !doesResourceHasOwners,
      recordNoun: "alert",
      stateName: alertState.name,
    }),
    moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
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
