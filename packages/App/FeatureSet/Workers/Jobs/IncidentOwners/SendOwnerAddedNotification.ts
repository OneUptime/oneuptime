import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentService from "Common/Server/Services/IncidentService";
import LinkedAffectedResources from "Common/Server/Utils/AffectedResources/LinkedAffectedResources";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

// What the incident the owners were added to is read with.
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

// An owner row not told of yet, and the people it made owners.
interface OwnerRowAdded {
  ownerRowId: ObjectID;
  isTeam: boolean;
  users: Array<User>;
}

RunCron(
  "IncidentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8199) - told first, exactly
     * them, from the incident as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const incident: Incident | null = await readIncident(
          delivery.notification.resourceId,
        );

        if (!incident) {
          await delivery.giveUp("the incident is gone");
          return;
        }

        await notifyOwnersAdded({
          incident: incident,
          deliveries: [delivery],
        });
      },
    });

    const incidentOwnerTeams: Array<IncidentOwnerTeam> =
      await IncidentOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          incidentId: true,
          teamId: true,
        },
      });

    const incidentOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const incidentOwnerTeam of incidentOwnerTeams) {
      const incidentId: ObjectID = incidentOwnerTeam.incidentId!;
      const teamId: ObjectID = incidentOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (incidentOwnersMap[incidentId.toString()] === undefined) {
        incidentOwnersMap[incidentId.toString()] = [];
      }

      (incidentOwnersMap[incidentId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: incidentOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const incidentOwnerUsers: Array<IncidentOwnerUser> =
      await IncidentOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          incidentId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const incidentOwnerUser of incidentOwnerUsers) {
      const incidentId: ObjectID = incidentOwnerUser.incidentId!;
      const user: User = incidentOwnerUser.user!;

      if (incidentOwnersMap[incidentId.toString()] === undefined) {
        incidentOwnersMap[incidentId.toString()] = [];
      }

      (incidentOwnersMap[incidentId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: incidentOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const incidentId in incidentOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        incidentOwnersMap[incidentId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      // get all scheduled events of all the projects.
      const incident: Incident | null = await readIncident(
        new ObjectID(incidentId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = incident
        ? await planOwnersAdded({ incident: incident, ownerRows: ownerRows })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose incident is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await IncidentOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await IncidentOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!incident) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          incident: incident,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending incident owner added notification", {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });
        logger.error(e, {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        });
      }
    }
  },
);

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
 * Whom each owner row tells it made them an owner of the incident, written
 * down before the rows are taken (OwnerNotificationDeliveries.plan): the
 * accepted members of the project among the people it names, each person
 * once for the incident - by the first row that names them - however many
 * of its new rows do. A failure to read them tells nobody, as it did when
 * it came after the take.
 */
async function planOwnersAdded(data: {
  incident: Incident;
  ownerRows: Array<OwnerRowAdded>;
}): Promise<Array<OwnerNotificationDelivery>> {
  let members: Set<string> = new Set<string>();

  try {
    /*
     * A team row expands to every member row, pending invitations included,
     * and a pending invitee has no notification settings yet (the defaults
     * are added on accept). Tell only the accepted members of the project -
     * the same people findOwners reports as owners.
     */
    const users: Array<User> =
      await TeamMemberService.filterUsersToProjectMembers({
        projectId: data.incident.projectId!,
        users: data.ownerRows.flatMap((ownerRow: OwnerRowAdded) => {
          return ownerRow.users;
        }),
      });

    members = new Set<string>(
      users.map((user: User): string => {
        return user.id?.toString() || "";
      }),
    );
  } catch (e) {
    logger.error("Error in reading the owners added to an incident", {
      projectId: data.incident.projectId?.toString(),
      incidentId: data.incident.id?.toString(),
    });
    logger.error(e);
  }

  const deliveries: Array<OwnerNotificationDelivery> = [];
  const planned: Set<string> = new Set<string>();

  for (const ownerRow of data.ownerRows) {
    const owners: Array<User> = ownerRow.users.filter((user: User): boolean => {
      const userId: string = user?.id?.toString() || "";

      if (!userId || !members.has(userId) || planned.has(userId)) {
        return false;
      }

      planned.add(userId);
      return true;
    });

    if (owners.length === 0) {
      continue;
    }

    deliveries.push(
      await OwnerNotificationDeliveries.plan({
        notification: {
          kind: OwnerNotificationKind.IncidentOwnerAdded,
          projectId: data.incident.projectId!,
          resourceId: data.incident.id!,
          eventId: ownerRow.ownerRowId,
        },
        owners: owners,
        isProjectOwners: false,
      }),
    );
  }

  return deliveries;
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * incident, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  incident: Incident;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const incident: Incident = data.incident;

  const users: Array<User> = data.deliveries.flatMap(
    (delivery: OwnerNotificationDelivery) => {
      return delivery.owners;
    },
  );

  if (users.length === 0) {
    return;
  }

  const incidentNumber: string =
    incident.incidentNumberWithPrefix ||
    (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

  const vars: Dictionary<string> = {
    incidentTitle: incident.title!,
    incidentNumber: incidentNumber,
    projectName: incident.project!.name!,
    currentState: incident.currentIncidentState!.name!,
    ...EmailColorUtil.getTemplateVariables(
      "currentState",
      incident.currentIncidentState?.color,
    ),
    incidentDescription: await Markdown.convertToHTML(
      incident.description! || "",
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

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Incident ${incidentNumber} - ${incident.title}`,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the incident ${incidentIdentifier}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the incident ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: `Added as Incident ${incidentNumber} Owner`,
            body: `You have been added as the owner of the incident ${incidentIdentifier}. Click to view details.`,
            clickAction: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
            tag: "incident-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_OWNER_ADDED_NOTIFICATION;

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
      });
    }
  }
}
