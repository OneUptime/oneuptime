import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
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
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
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

RunCron(
  "AlertOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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
        });
      },
    });

    // get all scheduled events of all the projects.

    const alertStateTimelines: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: STATE_TIMELINE_SELECT,
      });

    for (const alertStateTimeline of alertStateTimelines) {
      const alertId: ObjectID = alertStateTimeline.alertId!;

      if (!alertId) {
        continue;
      }

      // get alert

      const alert: Alert | null = await readAlert(alertId);

      if (!alert) {
        continue;
      }

      /*
       * Whom it is to tell, written before the take: a worker stopped from
       * here on leaves them to be told by a later run, and one stopped
       * before the take leaves the state change to be read again.
       */
      const delivery: OwnerNotificationDelivery = await planOwnersOfStateChange(
        {
          alertStateTimeline: alertStateTimeline,
          alert: alert,
        },
      );

      await AlertStateTimelineService.updateOneById({
        id: alertStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      try {
        await notifyOwnersOfStateChange({
          alertStateTimeline: alertStateTimeline,
          alert: alert,
          delivery: delivery,
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
  },
);

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
}): Promise<OwnerNotificationDelivery> {
  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await AlertService.findOwners(data.alert.id!);

    if (owners.length === 0) {
      isProjectOwners = true;

      // find project owners.
      owners = await ProjectService.getOwners(
        data.alertStateTimeline.projectId!,
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
}): Promise<void> {
  const alertStateTimeline: AlertStateTimeline = data.alertStateTimeline;
  const alert: Alert = data.alert;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (delivery.owners.length === 0) {
    return;
  }

  const alertState: AlertState = alertStateTimeline.alertState!;

  // Fetch the previous state timeline entry
  let previousState: AlertState | null = null;
  let previousStateDuration: string = "";

  if (alertStateTimeline.alertId && alertStateTimeline.startsAt) {
    const previousTimeline: AlertStateTimeline | null =
      await AlertStateTimelineService.findOneBy({
        query: {
          alertId: alertStateTimeline.alertId,
          startsAt: QueryHelper.lessThan(alertStateTimeline.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          startsAt: true,
          createdAt: true,
        },
      });

    if (previousTimeline?.alertStateId) {
      previousState = await AlertStateService.findOneById({
        id: previousTimeline.alertStateId,
        props: {
          isRoot: true,
        },
        select: {
          name: true,
          color: true,
        },
      });

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
    resources: await LinkedAffectedResources.readForAlert({
      service: AlertService,
      projectId: alert.projectId!,
      alertId: alert.id!,
    }),
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

  // Every owner was told already: the run that told them said so.
  if (!delivery.hasSetOutToTellAnyone) {
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
}
