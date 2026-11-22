import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertInternalNoteService from "Common/Server/Services/AlertInternalNoteService";
import AlertService from "Common/Server/Services/AlertService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import SeriesLabelDisplay from "Common/Types/Monitor/SeriesContext/SeriesLabelDisplay";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import User from "Common/Models/DatabaseModels/User";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Blue500 } from "Common/Types/BrandColors";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each note is read with.
const NOTE_SELECT: Select<AlertInternalNote> = {
  _id: true,
  note: true,
  alertId: true,
  projectId: true,
};

// What the alert of a note is read with.
const ALERT_SELECT: Select<Alert> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentAlertState: {
    name: true,
    color: true,
  },
  alertSeverity: {
    name: true,
    color: true,
  },
  /*
   * The series a grouped monitor raised this alert for, named in the
   * monitor's place under Resources Affected, as the created email does.
   */
  seriesLabels: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
};

RunCron(
  "AlertOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the note as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertInternalNotePosted],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const note: AlertInternalNote | null =
          await AlertInternalNoteService.findOneById({
            id: delivery.notification.eventId,
            select: NOTE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const alert: Alert | null = note
          ? await readAlert(delivery.notification.resourceId)
          : null;

        if (!note || !alert) {
          await delivery.giveUp("the alert or its note is gone");
          return;
        }

        await notifyOwnersOfNote({
          note: note,
          alert: alert,
          delivery: delivery,
        });
      },
    });

    /*
     * Every note posted on an alert and not told of yet, a page at a time,
     * oldest first, each taken by one run alone and told by the run that
     * took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<AlertInternalNote>({
      jobName: "AlertOwner:SendsNotePostedEmail",
      service: AlertInternalNoteService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: NOTE_SELECT,
      deadline: deadline,
      readPage: readAlertsOfPage,
      notify: async (input: {
        record: AlertInternalNote;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfNote({
          note: input.record,
          page: input.page,
          take: input.take,
        });
      },
    });
  },
);

/*
 * One note read by the run: whom it tells planned, the note taken, and -
 * when this run took it - its owners told.
 */
async function notifyOfNote(data: {
  note: AlertInternalNote;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const note: AlertInternalNote = data.note;
  const alertId: ObjectID | undefined = note.alertId;

  // Read with the page's alerts.
  const alert: Alert | null = alertId
    ? await data.page.once(alertKey(alertId), (): Promise<Alert | null> => {
        return readAlert(alertId);
      })
    : null;

  /*
   * Whom it is to tell, written before the take: a worker stopped from
   * here on leaves them to be told by a later run, and one stopped before
   * the take leaves the note to be read again.
   */
  const delivery: OwnerNotificationDelivery | null = alert
    ? await planOwnersOfNote({ note: note, alert: alert, page: data.page })
    : null;

  /*
   * Marked as notified before its owners are told, so a note whose
   * notification keeps failing is never read again on every run - one
   * whose alert is gone too. Taken by another run first: that run tells
   * them.
   */
  if (!(await data.take())) {
    return;
  }

  if (!alert || !delivery) {
    return;
  }

  try {
    await notifyOwnersOfNote({
      note: note,
      alert: alert,
      delivery: delivery,
    });
  } catch (e) {
    logger.error("Error in sending alert note posted notification", {
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
 * The alerts of a page's notes, in one query: each is read once however
 * many of its notes the page has.
 */
async function readAlertsOfPage(
  notes: Array<AlertInternalNote>,
  page: OwnerNotificationPage,
): Promise<void> {
  const alertIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const note of notes) {
    if (note.alertId) {
      alertIds.set(note.alertId.toString(), note.alertId);
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
   * One not found - gone since its note was read - is read on its own when
   * a note asks for it, as it would be without the page.
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
 * Whom the note's notification tells - the alert's owners, or the project's
 * when it has none - written down before the note is taken
 * (OwnerNotificationDeliveries.plan). A failure to read them tells nobody,
 * as it did when it came after the take.
 */
async function planOwnersOfNote(data: {
  note: AlertInternalNote;
  alert: Alert;
  // What the notes of one page read once, for all of them.
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
        `projectOwners:${data.note.projectId!.toString()}`,
        (): Promise<Array<User>> => {
          return ProjectService.getOwners(data.note.projectId!);
        },
      );
    }
  } catch (e) {
    logger.error("Error in reading the owners of an alert's note", {
      projectId: data.alert.projectId?.toString(),
      alertId: data.alert.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: OwnerNotificationKind.AlertInternalNotePosted,
      projectId: data.alert.projectId!,
      resourceId: data.alert.id!,
      eventId: data.note.id!,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Tells the delivery's owners that a note was posted on the alert, each
 * once (OwnerNotificationDelivery.tell), and says in the alert's feed whom
 * it reached - those a stopped run told first among them.
 */
async function notifyOwnersOfNote(data: {
  note: AlertInternalNote;
  alert: Alert;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const note: AlertInternalNote = data.note;
  const alert: Alert = data.alert;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const alertIdentifier: string =
    alert.alertNumber !== undefined
      ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
      : alert.title!;

  const alertNumberStr: string =
    alert.alertNumberWithPrefix ||
    (alert.alertNumber ? `#${alert.alertNumber}` : "");

  const vars: Dictionary<string> = {
    alertTitle: alert.title!,
    alertNumber: alertNumberStr,
    projectName: alert.project!.name!,
    currentState: alert.currentAlertState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      alert.currentAlertState?.color,
    ),
    note: await Markdown.convertToHTML(
      note.note || "",
      MarkdownContentType.Email,
    ),
    // Every resource the alert's Affected Resources card lists.
    resourcesAffected: LinkedAffectedResources.getText({
      resources: await LinkedAffectedResources.readForAlert({
        service: AlertService,
        projectId: alert.projectId!,
        alertId: alert.id!,
      }),
      seriesSummary: SeriesLabelDisplay.buildInlineSummary(alert.seriesLabels),
      fallback: "None",
    }),
    alertSeverity: alert.alertSeverity!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "alertSeverity",
      alert.alertSeverity?.color,
    ),
    alertViewLink: (
      await AlertService.getAlertLinkInDashboard(alert.projectId!, alert.id!)
    ).toString(),
  };

  if (doesResourceHasOwners === true) {
    vars["isOwner"] = "true";
  }

  // Every note this job tells of is private: an alert has no public notes.
  vars["isPrivateNote"] = "true";

  let moreAlertFeedInformationInMarkdown: string = "";

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreAlertFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        OwnerNotificationFeedText.personName({
          name: user.name?.toString(),
          email: user.email?.toString(),
        }),
      );
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerNotePosted,
          vars: vars,
          subject: `[Update Alert ${alertNumberStr}] - ${alert.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New note posted on alert ${alertIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on alert ${alertIdentifier}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Alert ${alertNumberStr} Note Posted: ${alert.title}`,
            body: `A new note has been posted on alert ${alertNumberStr} in ${alert.project!.name!}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-note-posted",
            requireInteraction: true,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: alert.projectId!,
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
          OwnerNotificationFeedText.personName({
            name: user.name?.toString(),
            email: user.email?.toString(),
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

  const alertFeedText: string = OwnerNotificationFeedText.notePosted({
    recordNoun: "alert",
    isProjectOwners: !doesResourceHasOwners,
    isPrivateNote: true,
  });

  await AlertFeedService.createAlertFeedItem({
    alertId: alert.id!,
    projectId: alert.projectId!,
    alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: alertFeedText,
    moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
