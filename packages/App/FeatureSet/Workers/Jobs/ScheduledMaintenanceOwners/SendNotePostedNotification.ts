import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import ProjectService from "Common/Server/Services/ProjectService";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ScheduledMaintenanceInternalNoteService from "Common/Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "Common/Models/DatabaseModels/User";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "Common/Types/BrandColors";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// A note, public or private, as the job tells of it.
interface NotePosted {
  id: ObjectID;
  note: string;
  scheduledMaintenanceId: ObjectID;
  projectId: ObjectID;
  isPrivateNote: boolean;
}

// What a note of either kind is read with.
const NOTE_SELECT: Select<ScheduledMaintenancePublicNote> = {
  _id: true,
  note: true,
  scheduledMaintenanceId: true,
  projectId: true,
};

// What the event of a note is read with.
const SCHEDULED_MAINTENANCE_SELECT: Select<ScheduledMaintenance> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentScheduledMaintenanceState: {
    name: true,
    color: true,
  },
  scheduledMaintenanceNumber: true,
  scheduledMaintenanceNumberWithPrefix: true,
};

function notePosted(
  note: ScheduledMaintenancePublicNote | ScheduledMaintenanceInternalNote,
  isPrivateNote: boolean,
): NotePosted {
  return {
    id: note.id!,
    note: note.note || "",
    scheduledMaintenanceId: note.scheduledMaintenanceId!,
    projectId: note.projectId!,
    isPrivateNote: isPrivateNote,
  };
}

RunCron(
  "ScheduledMaintenanceOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, and the feed item a run that told them all left unwritten
     * (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [
        OwnerNotificationKind.ScheduledMaintenancePublicNotePosted,
        OwnerNotificationKind.ScheduledMaintenanceInternalNotePosted,
      ],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const isPrivateNote: boolean =
          delivery.notification.kind ===
          OwnerNotificationKind.ScheduledMaintenanceInternalNotePosted;

        const found:
          | ScheduledMaintenancePublicNote
          | ScheduledMaintenanceInternalNote
          | null = isPrivateNote
          ? await ScheduledMaintenanceInternalNoteService.findOneById({
              id: delivery.notification.eventId,
              select: NOTE_SELECT,
              props: {
                isRoot: true,
              },
            })
          : await ScheduledMaintenancePublicNoteService.findOneBy({
              query: {
                _id: delivery.notification.eventId,
                /*
                 * Published notes only, as the job's own read: owners are
                 * never told of a note that is not published.
                 */
                isPublished: true,
              },
              select: NOTE_SELECT,
              props: {
                isRoot: true,
              },
            });

        const scheduledMaintenance: ScheduledMaintenance | null = found
          ? await readScheduledMaintenance(delivery.notification.resourceId)
          : null;

        if (!found || !scheduledMaintenance) {
          await delivery.giveUp(
            "the scheduled maintenance event or its note is gone, or the note is no longer published",
          );
          return;
        }

        await notifyOwnersOfNote({
          note: notePosted(found, isPrivateNote),
          scheduledMaintenance: scheduledMaintenance,
          delivery: delivery,
        });
      },
    });

    /*
     * Every note posted on a maintenance event and not told of yet - the
     * published public ones, then the private ones - a page at a time,
     * oldest first, each taken by one run alone and told by the run that
     * took it; the run stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<ScheduledMaintenancePublicNote>(
      {
        jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
        service: ScheduledMaintenancePublicNoteService,
        notYetNotified: {
          isOwnerNotified: false,
          /*
           * Published notes only: a note waiting for approval was not
           * posted, so its owners hear of it once it is published. Taken
           * only while it is published, too: the take matches this as well.
           */
          isPublished: true,
        },
        notified: {
          isOwnerNotified: true,
        },
        select: NOTE_SELECT,
        deadline: deadline,
        readPage: readScheduledMaintenancesOfPage,
        notify: async (input: {
          record: ScheduledMaintenancePublicNote;
          page: OwnerNotificationPage;
          take: () => Promise<boolean>;
        }): Promise<void> => {
          await notifyOfNote({
            note: notePosted(input.record, false),
            page: input.page,
            take: input.take,
          });
        },
      },
    );

    await OwnerNotificationBacklog.forEachToNotify<ScheduledMaintenanceInternalNote>(
      {
        jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
        service: ScheduledMaintenanceInternalNoteService,
        notYetNotified: {
          isOwnerNotified: false,
        },
        notified: {
          isOwnerNotified: true,
        },
        select: NOTE_SELECT as Select<ScheduledMaintenanceInternalNote>,
        deadline: deadline,
        readPage: readScheduledMaintenancesOfPage,
        notify: async (input: {
          record: ScheduledMaintenanceInternalNote;
          page: OwnerNotificationPage;
          take: () => Promise<boolean>;
        }): Promise<void> => {
          await notifyOfNote({
            note: notePosted(input.record, true),
            page: input.page,
            take: input.take,
          });
        },
      },
    );
  },
);

/*
 * One note read by the run: whom it tells planned, the note taken, and -
 * when this run took it - its owners told.
 */
async function notifyOfNote(data: {
  note: NotePosted;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const note: NotePosted = data.note;

  // Read with the page's events.
  const scheduledMaintenance: ScheduledMaintenance | null =
    note.scheduledMaintenanceId
      ? await data.page.once(
          scheduledMaintenanceKey(note.scheduledMaintenanceId),
          (): Promise<ScheduledMaintenance | null> => {
            return readScheduledMaintenance(note.scheduledMaintenanceId);
          },
        )
      : null;

  /*
   * Whom it is to tell - the event's owners, or the project's when it has
   * none - written before the take: a worker stopped from here on leaves
   * them to be told by a later run, and one stopped before the take leaves
   * the note to be read again.
   */
  const delivery: OwnerNotificationDelivery | null = scheduledMaintenance
    ? await OwnerNotificationDeliveries.planForOwnersOf({
        notification: {
          kind: note.isPrivateNote
            ? OwnerNotificationKind.ScheduledMaintenanceInternalNotePosted
            : OwnerNotificationKind.ScheduledMaintenancePublicNotePosted,
          projectId: note.projectId,
          resourceId: scheduledMaintenance.id!,
          eventId: note.id,
        },
        // Each read once for every note of the page.
        findOwners: (): Promise<Array<User>> => {
          return data.page.once(
            `owners:${scheduledMaintenance.id!.toString()}`,
            () => {
              return ScheduledMaintenanceService.findOwners(
                scheduledMaintenance.id!,
              );
            },
          );
        },
        findProjectOwners: (): Promise<Array<User>> => {
          return data.page.once(
            `projectOwners:${note.projectId.toString()}`,
            () => {
              return ProjectService.getOwners(note.projectId);
            },
          );
        },
        writesFeedItem: true,
      })
    : null;

  /*
   * Marked as notified before its owners are told, so a note whose
   * notification keeps failing is never read again on every run - one
   * whose event is gone too. Taken by another run first (or a public note
   * no longer published): not this run's to tell.
   */
  if (!(await data.take())) {
    return;
  }

  if (!scheduledMaintenance || !delivery) {
    return;
  }

  try {
    await notifyOwnersOfNote({
      note: note,
      scheduledMaintenance: scheduledMaintenance,
      delivery: delivery,
    });
  } catch (e) {
    logger.error("Error in sending scheduled maintenance note notification", {
      projectId: scheduledMaintenance.projectId?.toString(),
      scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
    });
    logger.error(e, {
      projectId: scheduledMaintenance.projectId?.toString(),
      scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
    });
  }
}

function scheduledMaintenanceKey(scheduledMaintenanceId: ObjectID): string {
  return `scheduledMaintenance:${scheduledMaintenanceId.toString()}`;
}

/*
 * The events of a page's notes, in one query: each is read once however
 * many of its notes the page has.
 */
async function readScheduledMaintenancesOfPage(
  notes: Array<
    ScheduledMaintenancePublicNote | ScheduledMaintenanceInternalNote
  >,
  page: OwnerNotificationPage,
): Promise<void> {
  const ids: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const note of notes) {
    if (note.scheduledMaintenanceId) {
      ids.set(
        note.scheduledMaintenanceId.toString(),
        note.scheduledMaintenanceId,
      );
    }
  }

  if (ids.size === 0) {
    return;
  }

  const scheduledMaintenances: Array<ScheduledMaintenance> =
    await ScheduledMaintenanceService.findBy({
      query: {
        _id: QueryHelper.any(Array.from(ids.values())),
      },
      select: SCHEDULED_MAINTENANCE_SELECT,
      limit: ids.size,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

  /*
   * One not found - gone since its note was read - is read on its own when
   * a note asks for it, as it would be without the page.
   */
  for (const each of scheduledMaintenances) {
    if (each.id) {
      page.prime<ScheduledMaintenance | null>(
        scheduledMaintenanceKey(each.id),
        each,
      );
    }
  }
}

async function readScheduledMaintenance(
  scheduledMaintenanceId: ObjectID,
): Promise<ScheduledMaintenance | null> {
  return await ScheduledMaintenanceService.findOneById({
    id: scheduledMaintenanceId,
    props: {
      isRoot: true,
    },
    select: SCHEDULED_MAINTENANCE_SELECT,
  });
}

// A person told, as the event's feed names them.
function feedLineMarkdown(user: User): string {
  return OwnerNotificationFeedText.notifiedLineMarkdown(
    OwnerNotificationFeedText.personName(user),
  );
}

/*
 * Tells the delivery's owners that a note was posted on the maintenance
 * event, each once (OwnerNotificationDelivery.tell), and says in the event's
 * feed whom it reached - those a stopped run told first among them.
 */
async function notifyOwnersOfNote(data: {
  note: NotePosted;
  scheduledMaintenance: ScheduledMaintenance;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const note: NotePosted = data.note;
  const scheduledMaintenance: ScheduledMaintenance = data.scheduledMaintenance;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  // Whom a run that stopped part way told already.
  let moreScheduledMaintenanceFeedInformationInMarkdown: string =
    delivery.toldEarlier.map(feedLineMarkdown).join("");

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const scheduledMaintenanceNumberStr: string =
    scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
    (scheduledMaintenance.scheduledMaintenanceNumber
      ? `#${scheduledMaintenance.scheduledMaintenanceNumber}`
      : "");

  const vars: Dictionary<string> = {
    scheduledMaintenanceTitle: scheduledMaintenance.title!,
    scheduledMaintenanceNumber: scheduledMaintenanceNumberStr,
    projectName: scheduledMaintenance.project!.name!,
    currentState: scheduledMaintenance.currentScheduledMaintenanceState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      scheduledMaintenance.currentScheduledMaintenanceState?.color,
    ),
    note: await Markdown.convertToHTML(
      note.note || "",
      MarkdownContentType.Email,
    ),
    scheduledMaintenanceViewLink: (
      await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
        scheduledMaintenance.projectId!,
        scheduledMaintenance.id!,
      )
    ).toString(),
  };

  if (doesResourceHasOwners === true) {
    vars["isOwner"] = "true";
  }

  if (note.isPrivateNote) {
    vars["isPrivateNote"] = "true";
  }

  const scheduledMaintenanceIdentifier: string =
    scheduledMaintenance.scheduledMaintenanceNumber !== undefined
      ? `${scheduledMaintenanceNumberStr} (${scheduledMaintenance.title})`
      : scheduledMaintenance.title!;

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ScheduledMaintenanceOwnerNotePosted,
          vars: vars,
          subject: `[Update Scheduled Maintenance ${scheduledMaintenanceNumberStr}] - ${scheduledMaintenance.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New note posted on maintenance event - ${scheduledMaintenanceIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on maintenance event ${scheduledMaintenanceIdentifier}. To view this note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Scheduled Maintenance ${scheduledMaintenanceNumberStr} Note Posted`,
            body: `New note posted on maintenance event: ${scheduledMaintenanceIdentifier}. Click to view details.`,
            clickAction: (
              await ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard(
                scheduledMaintenance.projectId!,
                scheduledMaintenance.id!,
              )
            ).toString(),
            tag: "scheduled-maintenance-note-posted",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              event_title: scheduledMaintenance.title!,
              maintenance_link: vars["scheduledMaintenanceViewLink"] || "",
              event_number:
                scheduledMaintenance.scheduledMaintenanceNumberWithPrefix ||
                (scheduledMaintenance.scheduledMaintenanceNumber?.toString() ??
                  "N/A"),
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: scheduledMaintenance.projectId!,
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
        feedLineMarkdown(user);
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

  const scheduledMaintenanceFeedText: string =
    OwnerNotificationFeedText.notePosted({
      recordNoun: "maintenance event",
      isProjectOwners: !doesResourceHasOwners,
      isPrivateNote: note.isPrivateNote,
    });

  await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
    scheduledMaintenanceId: scheduledMaintenance.id!,
    projectId: scheduledMaintenance.projectId!,
    scheduledMaintenanceFeedEventType:
      ScheduledMaintenanceFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: scheduledMaintenanceFeedText,
    moreInformationInMarkdown:
      moreScheduledMaintenanceFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
