import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import { MarkdownText } from "Common/Utils/Markdown/FeedMarkdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
  OwnerNotificationOf,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import OwnersReachedByAPage from "Common/Server/Utils/Notification/OwnersReachedByAPage";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What the "Incident Created" notification is made of, read for each incident.
const INCIDENT_SELECT: Select<Incident> = {
  _id: true,
  title: true,
  description: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
  remediationNotes: true,
  currentIncidentState: {
    name: true,
    color: true,
  } as Select<IncidentState>,
  incidentSeverity: {
    name: true,
    color: true,
  },
  rootCause: true,
  createdByProbe: {
    name: true,
  },
  createdByUser: {
    name: true,
    email: true,
  },
  incidentNumber: true,
  incidentNumberWithPrefix: true,
};

RunCron(
  "IncidentOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the incident as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentCreated],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const incident: Incident | null = await IncidentService.findOneById({
          id: delivery.notification.resourceId,
          select: INCIDENT_SELECT,
          props: {
            isRoot: true,
          },
        });

        if (!incident) {
          await delivery.giveUp("the incident is gone");
          return;
        }

        await notifyOwnersOfIncident(incident, delivery);
      },
    });

    /*
     * Every incident whose owners are due to hear that it was created: let
     * go once its owners were in, a minute after its create, or held so
     * long that nobody will let it go (IncidentService
     * .findCreatedNotificationsDue, CreatedNotificationHold).
     */
    const incidents: Array<Incident> =
      await IncidentService.findCreatedNotificationsDue({
        now: OneUptimeDate.getCurrentDate(),
        select: INCIDENT_SELECT,
      });

    for (const incident of incidents) {
      /*
       * The run's deadline passed - its time limit, or its lease lost,
       * when another run may hold the lock: the incidents not reached are
       * still due, and the next run reads them (issue #8862).
       */
      if (deadline.hasPassed()) {
        break;
      }

      /*
       * Whom it is to tell, written before the take: a worker stopped from
       * here on leaves them to be told by a later run, and one stopped
       * before the take leaves the incident to be read again.
       */
      const delivery: OwnerNotificationDelivery =
        await planOwnersOfIncident(incident);

      /*
       * Mark the incident as notified first (matching the MonitorOwner worker)
       * so that a failure while building or sending the notification below can
       * never cause this incident to be re-picked on every cron run. Marked
       * only while it is as it was read: one another run took, or its create
       * let go of meanwhile, is not this run's to send (the next run reads
       * the one let go again) - so its owners are told once.
       */
      const isTaken: boolean =
        await IncidentService.takeCreatedNotification(incident);

      if (!isTaken) {
        continue;
      }

      try {
        await notifyOwnersOfIncident(incident, delivery);
      } catch (e) {
        logger.error(
          "Error in sending incident created resource notification",
          {
            projectId: incident.projectId?.toString(),
            incidentId: incident.id?.toString(),
          },
        );
        logger.error(e, {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });
      }
    }
  },
);

/*
 * Whom the incident's "Incident Created" notification tells - its owners,
 * or the project's when it has none, but for those its on-call page reached
 * already - written down before the incident is taken
 * (OwnerNotificationDeliveries.plan). A failure to read them tells nobody,
 * as it did when it came after the take.
 */
async function planOwnersOfIncident(
  incident: Incident,
): Promise<OwnerNotificationDelivery> {
  const notification: OwnerNotificationOf = {
    kind: OwnerNotificationKind.IncidentCreated,
    projectId: incident.projectId!,
    resourceId: incident.id!,
    eventId: incident.id!,
  };

  let owners: Array<User> = [];
  let isProjectOwners: boolean = false;

  try {
    owners = await IncidentService.findOwners(incident.id!);

    if (owners.length === 0) {
      isProjectOwners = true;
      owners = await ProjectService.getOwners(incident.projectId!);
    }
  } catch (e) {
    logger.error("Error in reading the owners of a created incident", {
      projectId: incident.projectId?.toString(),
      incidentId: incident.id?.toString(),
    });
    logger.error(e);
    owners = [];
  }

  return await OwnerNotificationDeliveries.plan({
    notification: notification,
    owners: owners,
    isProjectOwners: isProjectOwners,
    writesFeedItem: true,
    /*
     * Not those the incident's on-call page reached already: someone who
     * is on call and an owner is told of the incident once, not twice
     * (#7987).
     */
    leaveOut: await OwnersReachedByAPage.findAmong({
      notification: notification,
      owners: owners,
    }),
  });
}

/*
 * Tells the delivery's owners that the incident was created, each once
 * (OwnerNotificationDelivery.tell), and says in the incident's feed whom it
 * reached - those a stopped run told first among them - and whom it left
 * out, as the incident's on-call page reached them already.
 */
async function notifyOwnersOfIncident(
  incident: Incident,
  delivery: OwnerNotificationDelivery,
): Promise<void> {
  if (!delivery.hasWorkToDo) {
    return;
  }

  const projectId: ObjectID = incident.projectId!;
  const incidentId: ObjectID = incident.id!;
  const incidentNumber: number = incident.incidentNumber!;

  let moreIncidentFeedInformationInMarkdown: string = "";

  const incidentIdentifiedDate: Date =
    await IncidentService.getIncidentIdentifiedDate(incident.id!);

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  let declaredBy: string = "OneUptime";

  if (incident.createdByProbe && incident.createdByProbe.name) {
    declaredBy = incident.createdByProbe.name;
  }

  if (
    incident.createdByUser &&
    incident.createdByUser.name &&
    incident.createdByUser.email
  ) {
    declaredBy = `${incident.createdByUser.name.toString()} (${incident.createdByUser.email.toString()})`;
  }

  const incidentNumberStr: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  /*
   * These values do not vary per owner, so convert them once per incident
   * instead of once per owner notification. A conversion failure must
   * stay contained to this incident, like every other failure in this loop.
   */
  let incidentDescriptionHtml: string = "";
  let remediationNotesHtml: string = "";
  let rootCauseHtml: string = "";

  try {
    incidentDescriptionHtml = await Markdown.convertToHTML(
      incident.description! || "",
      MarkdownContentType.Email,
    );

    remediationNotesHtml =
      (await Markdown.convertToHTML(
        incident.remediationNotes! || "",
        MarkdownContentType.Email,
      )) || "";

    rootCauseHtml =
      (await Markdown.convertToHTML(
        incident.rootCause || "No root cause identified for this incident",
        MarkdownContentType.Email,
      )) || "";
  } catch (e) {
    logger.error("Error in sending incident created resource notification");
    logger.error(e);
    return;
  }

  // Every resource the incident's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    resources: await LinkedAffectedResources.readForIncident({
      service: IncidentService,
      projectId: projectId,
      incidentId: incidentId,
    }),
    fallback: "None",
  });

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
        const vars: Dictionary<string> = {
          incidentTitle: incident.title!,
          incidentNumber: incidentNumberStr,
          projectName: incident.project!.name!,
          currentState: incident.currentIncidentState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            incident.currentIncidentState?.color,
          ),
          incidentDescription: incidentDescriptionHtml,
          resourcesAffected: resourcesAffected,
          incidentSeverity: incident.incidentSeverity!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "incidentSeverity",
            incident.incidentSeverity?.color,
          ),
          declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: incidentIdentifiedDate,
            timezones: user.timezone ? [user.timezone] : [],
          }),
          declaredBy: declaredBy,
          remediationNotes: remediationNotesHtml,
          rootCause: rootCauseHtml,
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

        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerResourceCreated,
          vars: vars,
          subject: `[New Incident ${incidentNumberStr}] - ${incident.title!}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `New incident created: ${incidentIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New incident created: ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentCreatedNotification({
            incidentTitle: incident.title!,
            projectName: incident.project!.name!,
            incidentViewLink: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            ...(incident.incidentNumber !== undefined && {
              incidentNumber: incident.incidentNumber,
            }),
            incidentId: incident.id!.toString(),
            projectId: incident.projectId!.toString(),
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              incident_title: incident.title!,
              project_name: incident.project!.name!,
              incident_link: vars["incidentViewLink"] || "",
              incident_number: incidentNumber.toString(),
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

  // Whom it left out, named apart from those notified (OwnersReachedByAPage).
  moreIncidentFeedInformationInMarkdown +=
    OwnerNotificationFeedText.reachedByPageMarkdown(
      delivery.leftOut.map((user: User): MarkdownText => {
        return OwnerNotificationFeedText.personName(user);
      }),
    );

  await IncidentFeedService.createIncidentFeedItem({
    incidentId: incident.id!,
    projectId: incident.projectId!,
    incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: OwnerNotificationFeedText.created("incident", {
      isProjectOwners: !doesResourceHasOwners,
    }),
    moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
    workspaceNotification: {
      sendWorkspaceNotification: false,
    },
  });

  await delivery.feedItemWritten();
}
