import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What each note is read with: a public one, and a private one.
const PUBLIC_NOTE_SELECT: Select<IncidentPublicNote> = {
  _id: true,
  note: true,
  incidentId: true,
  projectId: true,
};

const PRIVATE_NOTE_SELECT: Select<IncidentInternalNote> = {
  _id: true,
  note: true,
  incidentId: true,
  projectId: true,
};

// What the incident of a note is read with.
const INCIDENT_SELECT: Select<Incident> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  },
  currentIncidentState: {
    name: true,
    color: true,
  },
  incidentSeverity: {
    name: true,
    color: true,
  },
  incidentNumber: true,
  incidentNumberWithPrefix: true,
};

RunCron(
  "IncidentOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the note as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [
        OwnerNotificationKind.IncidentPublicNotePosted,
        OwnerNotificationKind.IncidentInternalNotePosted,
      ],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const isPrivateNote: boolean =
          delivery.notification.kind ===
          OwnerNotificationKind.IncidentInternalNotePosted;

        const note: BaseModel | null = isPrivateNote
          ? await IncidentInternalNoteService.findOneById({
              id: delivery.notification.eventId,
              select: PRIVATE_NOTE_SELECT,
              props: {
                isRoot: true,
              },
            })
          : await IncidentPublicNoteService.findOneBy({
              query: {
                _id: delivery.notification.eventId,
                /*
                 * Published notes only, as the job's own read
                 * (PublicNotePublishedGateGuard): owners are never told of
                 * a note that is not published.
                 */
                isPublished: true,
              },
              select: PUBLIC_NOTE_SELECT,
              props: {
                isRoot: true,
              },
            });

        const incident: Incident | null = note
          ? await readIncident(delivery.notification.resourceId)
          : null;

        if (!note || !incident) {
          await delivery.giveUp(
            "the incident or its note is gone, or the note is no longer published",
          );
          return;
        }

        await notifyOwnersOfNote({
          note: note,
          isPrivateNote: isPrivateNote,
          incident: incident,
          delivery: delivery,
        });
      },
    });

    /*
     * Every note posted on an incident and not told of yet - the published
     * public ones, then the private ones - a page at a time, oldest first,
     * each taken by one run alone and told by the run that took it; the run
     * stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<IncidentPublicNote>({
      jobName: "IncidentOwner:SendsNotePostedEmail",
      service: IncidentPublicNoteService,
      notYetNotified: {
        isOwnerNotified: false,
        /*
         * Published notes only: a note waiting for approval was not
         * posted, so its owners hear of it once it is published. Taken only
         * while it is published, too: the take matches this as well.
         */
        isPublished: true,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: PUBLIC_NOTE_SELECT,
      deadline: deadline,
      readPage: readIncidentsOfPage,
      notify: async (input: {
        record: IncidentPublicNote;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfNote({
          note: input.record,
          isPrivateNote: false,
          page: input.page,
          take: input.take,
        });
      },
    });

    await OwnerNotificationBacklog.forEachToNotify<IncidentInternalNote>({
      jobName: "IncidentOwner:SendsNotePostedEmail",
      service: IncidentInternalNoteService,
      notYetNotified: {
        isOwnerNotified: false,
      },
      notified: {
        isOwnerNotified: true,
      },
      select: PRIVATE_NOTE_SELECT,
      deadline: deadline,
      readPage: readIncidentsOfPage,
      notify: async (input: {
        record: IncidentInternalNote;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfNote({
          note: input.record,
          isPrivateNote: true,
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
  note: IncidentPublicNote | IncidentInternalNote;
  isPrivateNote: boolean;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const note: IncidentPublicNote | IncidentInternalNote = data.note;
  const isPrivateNote: boolean = data.isPrivateNote;
  const incidentId: ObjectID | undefined = note.incidentId;

  // Read with the page's incidents.
  const incident: Incident | null = incidentId
    ? await data.page.once(
        incidentKey(incidentId),
        (): Promise<Incident | null> => {
          return readIncident(incidentId);
        },
      )
    : null;

  /*
   * Whom it is to tell, written before the take: a worker stopped from
   * here on leaves them to be told by a later run, and one stopped before
   * the take leaves the note to be read again.
   */
  const delivery: OwnerNotificationDelivery | null = incident
    ? await planOwnersOfNote({
        note: note,
        isPrivateNote: isPrivateNote,
        incident: incident,
        page: data.page,
      })
    : null;

  /*
   * Marked as notified before its owners are told, so a note whose
   * notification keeps failing is never read again on every run - one
   * whose incident is gone too. Taken by another run first (or a public
   * note no longer published): not this run's to tell.
   */
  if (!(await data.take())) {
    return;
  }

  if (!incident || !delivery) {
    return;
  }

  try {
    await notifyOwnersOfNote({
      note: note,
      isPrivateNote: isPrivateNote,
      incident: incident,
      delivery: delivery,
    });
  } catch (e) {
    logger.error("Error in sending incident note posted notification", {
      projectId: incident.projectId?.toString(),
      incidentId: incident.id?.toString(),
    });
    logger.error(e, {
      projectId: incident.projectId?.toString(),
      incidentId: incident.id?.toString(),
    });
  }
}

function incidentKey(incidentId: ObjectID): string {
  return `incident:${incidentId.toString()}`;
}

/*
 * The incidents of a page's notes, in one query: each is read once however
 * many of its notes the page has.
 */
async function readIncidentsOfPage(
  notes: Array<IncidentPublicNote | IncidentInternalNote>,
  page: OwnerNotificationPage,
): Promise<void> {
  const incidentIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const note of notes) {
    if (note.incidentId) {
      incidentIds.set(note.incidentId.toString(), note.incidentId);
    }
  }

  if (incidentIds.size === 0) {
    return;
  }

  const incidents: Array<Incident> = await IncidentService.findBy({
    query: {
      _id: QueryHelper.any(Array.from(incidentIds.values())),
    },
    select: INCIDENT_SELECT,
    limit: incidentIds.size,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  /*
   * One not found - gone since its note was read - is read on its own when
   * a note asks for it, as it would be without the page.
   */
  for (const each of incidents) {
    if (each.id) {
      page.prime<Incident | null>(incidentKey(each.id), each);
    }
  }
}

async function readIncident(incidentId: ObjectID): Promise<Incident | null> {
  return await IncidentService.findOneById({
    id: incidentId,
    props: {
      isRoot: true,
    },
    select: INCIDENT_SELECT,
  });
}

/*
 * Whom the note's notification tells - the incident's owners, or the
 * project's when it has none - written down before the note is taken
 * (OwnerNotificationDeliveries.plan). A failure to read them tells nobody,
 * as it did when it came after the take.
 */
async function planOwnersOfNote(data: {
  note: BaseModel;
  isPrivateNote: boolean;
  incident: Incident;
  // What the notes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<OwnerNotificationDelivery> {
  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await data.page.once(
      `owners:${data.incident.id!.toString()}`,
      (): Promise<Array<User>> => {
        return IncidentService.findOwners(data.incident.id!);
      },
    );

    if (owners.length === 0) {
      isProjectOwners = true;

      // find project owners.
      const projectId: ObjectID = data.note.getColumnValue(
        "projectId",
      ) as ObjectID;

      owners = await data.page.once(
        `projectOwners:${projectId.toString()}`,
        (): Promise<Array<User>> => {
          return ProjectService.getOwners(projectId);
        },
      );
    }
  } catch (e) {
    logger.error("Error in reading the owners of an incident's note", {
      projectId: data.incident.projectId?.toString(),
      incidentId: data.incident.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: data.isPrivateNote
        ? OwnerNotificationKind.IncidentInternalNotePosted
        : OwnerNotificationKind.IncidentPublicNotePosted,
      projectId: data.incident.projectId!,
      resourceId: data.incident.id!,
      eventId: data.note.id!,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Tells the delivery's owners that a note was posted on the incident, each
 * once (OwnerNotificationDelivery.tell), and says in the incident's feed
 * whom it reached - those a stopped run told first among them.
 */
async function notifyOwnersOfNote(data: {
  note: BaseModel;
  isPrivateNote: boolean;
  incident: Incident;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const note: BaseModel = data.note;
  const incident: Incident = data.incident;
  const delivery: OwnerNotificationDelivery = data.delivery;
  const isPrivateNote: boolean = data.isPrivateNote;

  if (!delivery.hasWorkToDo) {
    return;
  }

  let moreIncidentFeedInformationInMarkdown: string = "";

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const incidentNumberStr: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  const vars: Dictionary<string> = {
    incidentTitle: incident.title!,
    incidentNumber: incidentNumberStr,
    projectName: incident.project!.name!,
    currentState: incident.currentIncidentState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      incident.currentIncidentState?.color,
    ),
    note: await Markdown.convertToHTML(
      (note.getColumnValue("note")! as string) || "",
      MarkdownContentType.Email,
    ),
    // Every resource the incident's Affected Resources card lists.
    resourcesAffected: LinkedAffectedResources.getText({
      resources: await LinkedAffectedResources.readForIncident({
        service: IncidentService,
        projectId: incident.projectId!,
        incidentId: incident.id!,
      }),
      fallback: "None",
    }),
    incidentSeverity: incident.incidentSeverity!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "incidentSeverity",
      incident.incidentSeverity?.color,
    ),
    incidentViewLink: (
      await IncidentService.getIncidentLinkInDashboard(
        incident.projectId!,
        incident.id!,
      )
    ).toString(),
  };

  if (doesResourceHasOwners === true) {
    vars["isOwner"] = "true";
  }

  if (isPrivateNote) {
    vars["isPrivateNote"] = "true";
  }

  const incidentIdentifier: string =
    incident.incidentNumber !== undefined
      ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
      : incident.title!;

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreIncidentFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        OwnerNotificationFeedText.personName(user),
      );
  }

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerNotePosted,
          vars: vars,
          subject: `[Update Incident ${incidentNumberStr}] - ${incident.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New note posted on incident ${incidentIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on incident ${incidentIdentifier}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentNotePostedNotification({
            incidentTitle: incident.title!,
            projectName: incident.project!.name!,
            isPrivateNote: isPrivateNote,
            incidentViewLink: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            ...(incident.incidentNumber !== undefined && {
              incidentNumber: incident.incidentNumber,
            }),
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              incident_title: incident.title!,
              incident_number:
                incident.incidentNumber !== undefined
                  ? incident.incidentNumber.toString()
                  : "",
              incident_link: vars["incidentViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incident.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          incidentId: incident.id!,
          eventType,
        });
      },
    );

    if (isTold) {
      moreIncidentFeedInformationInMarkdown +=
        OwnerNotificationFeedText.notifiedLineMarkdown(
          OwnerNotificationFeedText.personName(user),
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

  const incidentFeedText: string = OwnerNotificationFeedText.notePosted({
    recordNoun: "incident",
    isProjectOwners: !doesResourceHasOwners,
    isPrivateNote: isPrivateNote,
  });

  await IncidentFeedService.createIncidentFeedItem({
    incidentId: incident.id!,
    projectId: incident.projectId!,
    incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: incidentFeedText,
    moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
