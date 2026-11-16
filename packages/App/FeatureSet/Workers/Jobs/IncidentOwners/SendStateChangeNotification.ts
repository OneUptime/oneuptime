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
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
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
const STATE_TIMELINE_SELECT: Select<IncidentStateTimeline> = {
  _id: true,
  createdAt: true,
  startsAt: true,
  projectId: true,
  project: {
    name: true,
  },
  incidentId: true,
  incidentStateId: true,
  incidentState: {
    name: true,
    color: true,
  },
};

// What the incident of a state change is read with.
const INCIDENT_SELECT: Select<Incident> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  incidentNumber: true,
  incidentNumberWithPrefix: true,
  incidentSeverity: {
    name: true,
    color: true,
  },
};

/*
 * The entries a state change's previous one is read from, and what it is read
 * with: for "Was ... for ..." in its email (PreviousTimelineEntries).
 */
const TIMELINE: TimelineOf<IncidentStateTimeline> = {
  service: IncidentStateTimelineService,
  recordIdColumn: "incidentId",
  select: {
    incidentStateId: true,
    startsAt: true,
    createdAt: true,
  },
};

RunCron(
  "IncidentOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the state change as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentStateChanged],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const incidentStateTimeline: IncidentStateTimeline | null =
          await IncidentStateTimelineService.findOneById({
            id: delivery.notification.eventId,
            select: STATE_TIMELINE_SELECT,
            props: {
              isRoot: true,
            },
          });

        const incident: Incident | null = incidentStateTimeline
          ? await readIncident(delivery.notification.resourceId)
          : null;

        if (!incidentStateTimeline || !incident) {
          await delivery.giveUp("the incident or its state change is gone");
          return;
        }

        await notifyOwnersOfStateChange({
          incidentStateTimeline: incidentStateTimeline,
          incident: incident,
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
    await OwnerNotificationBacklog.forEachToNotify<IncidentStateTimeline>({
      jobName: "IncidentOwner:SendStateChangeEmail",
      service: IncidentStateTimelineService,
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
        record: IncidentStateTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfStateChange({
          incidentStateTimeline: input.record,
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
  incidentStateTimeline: IncidentStateTimeline;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const incidentStateTimeline: IncidentStateTimeline =
    data.incidentStateTimeline;
  const incidentId: ObjectID | undefined = incidentStateTimeline.incidentId;

  const incident: Incident | null = incidentId
    ? await data.page.once(
        incidentKey(incidentId),
        (): Promise<Incident | null> => {
          return readIncident(incidentId);
        },
      )
    : null;

  /*
   * The incident is gone: nobody can be told of its state change. Taken all
   * the same, so no run reads it again.
   */
  if (!incident) {
    await data.take();
    return;
  }

  /*
   * Whom it is to tell, written before the take: a worker stopped from
   * here on leaves them to be told by a later run, and one stopped before
   * the take leaves the state change to be read again.
   */
  const delivery: OwnerNotificationDelivery = await planOwnersOfStateChange({
    incidentStateTimeline: incidentStateTimeline,
    incident: incident,
    page: data.page,
  });

  // Taken by another run first, or gone: that run tells the owners.
  if (!(await data.take())) {
    return;
  }

  try {
    await notifyOwnersOfStateChange({
      incidentStateTimeline: incidentStateTimeline,
      incident: incident,
      delivery: delivery,
      page: data.page,
    });
  } catch (e) {
    logger.error("Error in sending incident state change notification", {
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
 * What every state change of a page needs, read once for the page: the
 * incidents they are of (readIncidentsOfPage), and the entry before each
 * (PreviousTimelineEntries: two reads per incident with more than one of
 * them on the page, instead of one per state change).
 */
async function readPageOfStateChanges(
  entries: Array<IncidentStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  await readIncidentsOfPage(entries, page);

  await PreviousTimelineEntries.readForPage({
    ...TIMELINE,
    entries: entries,
    page: page,
  });
}

/*
 * The incidents of a page's state changes, in one query: each is read once
 * however many of its state changes the page has.
 */
async function readIncidentsOfPage(
  incidentStateTimelines: Array<IncidentStateTimeline>,
  page: OwnerNotificationPage,
): Promise<void> {
  const incidentIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const incidentStateTimeline of incidentStateTimelines) {
    if (incidentStateTimeline.incidentId) {
      incidentIds.set(
        incidentStateTimeline.incidentId.toString(),
        incidentStateTimeline.incidentId,
      );
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
   * One not found - gone since its state change was read - is read on its
   * own when a record asks for it, as it would be without the page.
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
 * Whom the state change's notification tells - the incident's owners, or
 * the project's when it has none - written down before the state change is
 * taken (OwnerNotificationDeliveries.plan). A failure to read them tells
 * nobody, as it did when it came after the take.
 */
async function planOwnersOfStateChange(data: {
  incidentStateTimeline: IncidentStateTimeline;
  incident: Incident;
  // Each read once for every state change of the page.
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
      owners = await data.page.once(
        `projectOwners:${data.incidentStateTimeline.projectId!.toString()}`,
        (): Promise<Array<User>> => {
          return ProjectService.getOwners(
            data.incidentStateTimeline.projectId!,
          );
        },
      );
    }
  } catch (e) {
    logger.error("Error in reading the owners of an incident's state change", {
      projectId: data.incident.projectId?.toString(),
      incidentId: data.incident.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: {
      kind: OwnerNotificationKind.IncidentStateChanged,
      projectId: data.incidentStateTimeline.projectId!,
      resourceId: data.incident.id!,
      eventId: data.incidentStateTimeline.id!,
    },
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
  });
}

/*
 * Tells the delivery's owners that the incident's state changed, each once
 * (OwnerNotificationDelivery.tell), and says in the incident's feed whom it
 * reached - those a stopped run told first among them.
 */
async function notifyOwnersOfStateChange(data: {
  incidentStateTimeline: IncidentStateTimeline;
  incident: Incident;
  delivery: OwnerNotificationDelivery;
  // What the state changes of one page read once, for all of them.
  page: OwnerNotificationPage;
}): Promise<void> {
  const incidentStateTimeline: IncidentStateTimeline =
    data.incidentStateTimeline;
  const incident: Incident = data.incident;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  let moreIncidentFeedInformationInMarkdown: string = "";

  const incidentState: IncidentState = incidentStateTimeline.incidentState!;

  // Fetch the previous state timeline entry
  let previousState: IncidentState | null = null;
  let previousStateDuration: string = "";

  if (incidentStateTimeline.incidentId && incidentStateTimeline.startsAt) {
    const previousTimeline: IncidentStateTimeline | null =
      // Read with the page's other state changes of the incident, or on its own (#8863).
      await PreviousTimelineEntries.of({
        ...TIMELINE,
        entry: incidentStateTimeline,
        page: data.page,
      });

    if (previousTimeline?.incidentStateId) {
      const previousStateId: ObjectID = previousTimeline.incidentStateId;

      // A project's few states, each read once for the page.
      previousState = await data.page.once(
        `incidentState:${previousStateId.toString()}`,
        (): Promise<IncidentState | null> => {
          return IncidentStateService.findOneById({
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
       * Calculate how long the incident was in the previous state
       * Use startsAt if available, otherwise fall back to createdAt
       */
      const previousStartTime: Date | undefined =
        previousTimeline.startsAt || previousTimeline.createdAt;
      const currentStartTime: Date | undefined =
        incidentStateTimeline.startsAt || incidentStateTimeline.createdAt;

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

  // Every resource the incident's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    // Read once for every state change of the incident on the page.
    resources: await data.page.once(
      `resourcesAffected:${incident.id!.toString()}`,
      (): Promise<Array<LinkedAffectedResource>> => {
        return LinkedAffectedResources.readForIncident({
          service: IncidentService,
          projectId: incident.projectId!,
          incidentId: incident.id!,
        });
      },
    ),
    fallback: "",
  });

  const incidentNumberStr: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  const incidentDescriptionHtml: string = await Markdown.convertToHTML(
    incident.description! || "",
    MarkdownContentType.Email,
  );

  // Whom a run that stopped part way told already.
  for (const user of delivery.toldEarlier) {
    moreIncidentFeedInformationInMarkdown +=
      OwnerNotificationFeedText.notifiedLineMarkdown(
        await UserService.getUserMarkdownString({
          userId: user.id!,
          projectId: incidentStateTimeline.projectId!,
        }),
      );
  }

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
          incidentTitle: incident.title!,
          incidentNumber: incidentNumberStr,
          projectName: incidentStateTimeline.project!.name!,
          currentState: incidentState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            incidentState!.color,
          ),
          previousState: previousState?.name || "",
          ...EmailColorUtil.getTemplateVariables(
            "previousState",
            previousState?.color,
          ),
          previousStateDurationText: previousStateDurationText,
          incidentDescription: incidentDescriptionHtml,
          resourcesAffected: resourcesAffected || "None",
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: incidentStateTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          incidentSeverity: incident.incidentSeverity!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "incidentSeverity",
            incident.incidentSeverity?.color,
          ),
          incidentViewLink: (
            await IncidentService.getIncidentLinkInDashboard(
              incidentStateTimeline.projectId!,
              incident.id!,
            )
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const subjectLine: string = `[${Text.uppercaseFirstLetter(incidentState!.name!)} Incident ${incidentNumberStr}] - ${incident.title!}`;

        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerStateChanged,
          vars: vars,
          subject: subjectLine,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `Incident ${incidentIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
              .name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Incident ${
                incidentIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushNotificationParams: {
          incidentTitle: string;
          projectName: string;
          newState: string;
          previousState?: string;
          incidentViewLink: string;
          incidentNumber?: number;
          incidentId?: string;
          projectId?: string;
        } = {
          incidentTitle: incident.title!,
          projectName: incidentStateTimeline.project!.name!,
          newState: incidentState!.name!,
          incidentViewLink: vars["incidentViewLink"] || "",
          ...(incident.incidentNumber !== undefined && {
            incidentNumber: incident.incidentNumber,
          }),
          incidentId: incident.id!.toString(),
          projectId: incident.projectId!.toString(),
        };

        if (previousState?.name) {
          pushNotificationParams.previousState = previousState.name;
        }

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentStateChangedNotification(
            pushNotificationParams,
          );

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              incident_title: incident.title!,
              incident_state: incidentState!.name!,
              incident_number:
                incident.incidentNumber !== undefined
                  ? incident.incidentNumber.toString()
                  : "",
              incident_link: vars["incidentViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incidentStateTimeline.projectId!,
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
          await UserService.getUserMarkdownString({
            userId: user.id!,
            projectId: incidentStateTimeline.projectId!,
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

  await IncidentFeedService.createIncidentFeedItem({
    incidentId: incident.id!,
    projectId: incident.projectId!,
    incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
    displayColor: Blue500,
    feedInfoInMarkdown: OwnerNotificationFeedText.stateChanged({
      isProjectOwners: !doesResourceHasOwners,
      recordNoun: "incident",
      stateName: incidentState.name,
    }),
    moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
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
