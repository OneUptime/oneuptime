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
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
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

    const incidentOwnersMap: Dictionary<Array<User>> = {};

    for (const incidentOwnerTeam of incidentOwnerTeams) {
      const incidentId: ObjectID = incidentOwnerTeam.incidentId!;
      const teamId: ObjectID = incidentOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (incidentOwnersMap[incidentId.toString()] === undefined) {
        incidentOwnersMap[incidentId.toString()] = [];
      }

      for (const user of users) {
        (incidentOwnersMap[incidentId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await IncidentOwnerTeamService.updateOneById({
        id: incidentOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
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

      (incidentOwnersMap[incidentId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await IncidentOwnerUserService.updateOneById({
        id: incidentOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const incidentId in incidentOwnersMap) {
      if (!incidentOwnersMap[incidentId]) {
        continue;
      }

      if ((incidentOwnersMap[incidentId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = incidentOwnersMap[incidentId] as Array<User>;

      // get all scheduled events of all the projects.
      const incident: Incident | null = await IncidentService.findOneById({
        id: new ObjectID(incidentId),
        props: {
          isRoot: true,
        },

        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          project: {
            name: true,
          },
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          monitors: {
            name: true,
          },
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
      });

      if (!incident) {
        continue;
      }

      const incidentNumber: string = incident.incidentNumberWithPrefix
        || (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

      const vars: Dictionary<string> = {
        incidentTitle: incident.title!,
        incidentNumber: incidentNumber,
        projectName: incident.project!.name!,
        currentState: incident.currentIncidentState!.name!,
        incidentDescription: await Markdown.convertToHTML(
          incident.description! || "",
          MarkdownContentType.Email,
        ),
        resourcesAffected:
          incident
            .monitors!.map((monitor: Monitor) => {
              return monitor.name!;
            })
            .join(", ") || "None",
        incidentSeverity: incident.incidentSeverity!.name!,
        incidentViewLink: (
          await IncidentService.getIncidentLinkInDashboard(
            incident.projectId!,
            incident.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || '#' + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Incident ${incidentNumber} - ${incident.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the incident ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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
      }
    }
  },
);
