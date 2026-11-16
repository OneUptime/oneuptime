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
import IncidentMemberService from "Common/Server/Services/IncidentMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What a member row is read with.
const MEMBER_SELECT: Select<IncidentMember> = {
  _id: true,
  incidentId: true,
  userId: true,
  incidentRoleId: true,
  user: {
    email: true,
    name: true,
  },
};

// What the incident of a member row is read with.
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

/*
 * One member row not notified yet: the person it assigned, and the role
 * they are told of. Each row is a notification of its own (#8573): someone
 * assigned twice, in two roles, is told of each.
 */
interface MemberAssigned {
  memberRowId: ObjectID;
  user: User;
  roleName: string;
}

RunCron(
  "IncidentMember:SendMemberAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The people a run that stopped part way left untold - a worker killed
     * between marking the rows and the last person (#8573) - told first,
     * exactly them, of the role their row gives them now
     * (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentMemberAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const incidentMember: IncidentMember | null =
          await IncidentMemberService.findOneById({
            id: delivery.notification.eventId,
            select: MEMBER_SELECT,
            props: {
              isRoot: true,
            },
          });

        const incident: Incident | null = incidentMember
          ? await readIncident(delivery.notification.resourceId)
          : null;

        if (!incidentMember || !incident) {
          await delivery.giveUp("the incident or the assignment is gone");
          return;
        }

        await notifyMembersAssigned({
          incident: incident,
          assignments: [
            {
              memberRowId: incidentMember.id!,
              user: userOf(incidentMember),
              roleName: await roleNameOf(incidentMember),
            },
          ],
          deliveries: [delivery],
        });
      },
    });

    /*
     * Every member row not notified yet, a page at a time, oldest first -
     * each a notification of its own, taken by one run alone - with the
     * incidents and roles of a page read once for all its rows. The run
     * stops at its deadline and the next carries on
     * (OwnerNotificationBacklog, issue #8862).
     */
    await OwnerNotificationBacklog.forEachToNotify<IncidentMember>({
      jobName: "IncidentMember:SendMemberAddedEmail",
      service: IncidentMemberService,
      notYetNotified: {
        isMemberNotified: false,
      },
      notified: {
        isMemberNotified: true,
      },
      select: MEMBER_SELECT,
      deadline: deadline,
      readPage: readIncidentsOfPage,
      notify: async (input: {
        record: IncidentMember;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }): Promise<void> => {
        await notifyOfMemberAdded({
          incidentMember: input.record,
          page: input.page,
          take: input.take,
        });
      },
    });
  },
);

/*
 * One member row read by the run: whom it tells planned, the row taken,
 * and - when this run took it - its person told of the role it gives them.
 */
async function notifyOfMemberAdded(data: {
  incidentMember: IncidentMember;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}): Promise<void> {
  const incidentMember: IncidentMember = data.incidentMember;
  const incidentId: ObjectID | undefined = incidentMember.incidentId;

  // Read with the page's incidents.
  const incident: Incident | null = incidentId
    ? await data.page.once(
        incidentKey(incidentId),
        (): Promise<Incident | null> => {
          return readIncident(incidentId);
        },
      )
    : null;

  const assignment: MemberAssigned = {
    memberRowId: incidentMember.id!,
    user: userOf(incidentMember),
    roleName: await roleNameOf(incidentMember, data.page),
  };

  /*
   * Whom the row is to tell, written before the row is marked: a worker
   * stopped from here on leaves them to be told by a later run, and one
   * stopped before the marking leaves the row to be read again.
   */
  const delivery: OwnerNotificationDelivery | null = incident
    ? await OwnerNotificationDeliveries.plan({
        notification: {
          kind: OwnerNotificationKind.IncidentMemberAdded,
          projectId: incident.projectId!,
          resourceId: incident.id!,
          eventId: assignment.memberRowId,
        },
        owners: [assignment.user],
        isProjectOwners: false,
        writesFeedItem: false,
      })
    : null;

  /*
   * Marked as notified before anyone is told, so a row whose notification
   * keeps failing is never read again on every run - one whose incident is
   * gone too. Taken by another run first: that run tells them.
   */
  if (!(await data.take())) {
    return;
  }

  if (!incident || !delivery) {
    return;
  }

  try {
    await notifyMembersAssigned({
      incident: incident,
      assignments: [assignment],
      deliveries: [delivery],
    });
  } catch (e) {
    logger.error("Error in sending incident member added notification", {
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
 * The incidents of a page's member rows, in one query: each is read once
 * however many of its rows the page has.
 */
async function readIncidentsOfPage(
  incidentMembers: Array<IncidentMember>,
  page: OwnerNotificationPage,
): Promise<void> {
  const incidentIds: Map<string, ObjectID> = new Map<string, ObjectID>();

  for (const incidentMember of incidentMembers) {
    if (incidentMember.incidentId) {
      incidentIds.set(
        incidentMember.incidentId.toString(),
        incidentMember.incidentId,
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
   * One not found - gone since its rows were read - is read on its own when
   * a row asks for it, as it would be without the page.
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

// The person a member row assigned, by the id the row names.
function userOf(incidentMember: IncidentMember): User {
  const user: User = incidentMember.user || new User();

  if (!user.id && incidentMember.userId) {
    user.id = incidentMember.userId;
  }

  return user;
}

/*
 * The role a member row gives: its role's name, or "Member" - each role
 * read once for a page, when one is given.
 */
async function roleNameOf(
  incidentMember: IncidentMember,
  page?: OwnerNotificationPage | undefined,
): Promise<string> {
  const incidentRoleId: ObjectID | undefined = incidentMember.incidentRoleId;

  let roleName: string = "Member";
  if (incidentRoleId) {
    const readRole: () => Promise<IncidentRole | null> =
      (): Promise<IncidentRole | null> => {
        return IncidentRoleService.findOneById({
          id: incidentRoleId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });
      };

    const role: IncidentRole | null = page
      ? await page.once(`incidentRole:${incidentRoleId.toString()}`, readRole)
      : await readRole();

    if (role && role.name) {
      roleName = role.name;
    }
  }

  return roleName;
}

/*
 * Tells each delivery's person that they were assigned to the incident in
 * their row's role, each once (OwnerNotificationDelivery.tell).
 */
async function notifyMembersAssigned(data: {
  incident: Incident;
  assignments: Array<MemberAssigned>;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const incident: Incident = data.incident;

  const toTell: number = data.deliveries.reduce(
    (count: number, delivery: OwnerNotificationDelivery): number => {
      return count + delivery.owners.length;
    },
    0,
  );

  if (toTell === 0) {
    return;
  }

  const incidentNumber: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  // Every resource the incident's Affected Resources card lists.
  const resourcesAffected: string = LinkedAffectedResources.getText({
    resources: await LinkedAffectedResources.readForIncident({
      service: IncidentService,
      projectId: incident.projectId!,
      incidentId: incident.id!,
    }),
    fallback: "None",
  });

  for (const delivery of data.deliveries) {
    // The row this delivery is of: its person, and their role.
    const assignment: MemberAssigned | undefined = data.assignments.find(
      (each: MemberAssigned): boolean => {
        return (
          each.memberRowId.toString() ===
          delivery.notification.eventId.toString()
        );
      },
    );

    if (!assignment) {
      continue;
    }

    const roleName: string = assignment.roleName;

    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const vars: Dictionary<string> = {
          incidentTitle: incident.title!,
          incidentNumber: incidentNumber,
          projectName: incident.project!.name!,
          currentState: incident.currentIncidentState!.name!,
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            incident.currentIncidentState?.color,
          ),
          incidentRole: roleName,
          incidentDescription: await Markdown.convertToHTML(
            incident.description! || "",
            MarkdownContentType.Email,
          ),
          resourcesAffected: resourcesAffected,
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

        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentMemberAdded,
          vars: vars,
          subject: `You have been assigned as ${roleName} to Incident ${incidentNumber} - ${incident.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been assigned as ${roleName} to the incident ${incidentIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been assigned as ${roleName} to the incident ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Assigned as ${roleName} to Incident ${incidentNumber}`,
            body: `You have been assigned as ${roleName} to the incident ${incidentIdentifier}. Click to view details.`,
            clickAction: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            tag: "incident-member-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_MEMBER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              incident_title: incident.title!,
              incident_number:
                incident.incidentNumber !== undefined
                  ? incident.incidentNumber.toString()
                  : "",
              incident_role: roleName,
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
      });
    }
  }
}
