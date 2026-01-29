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
import IncidentMemberService from "Common/Server/Services/IncidentMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentMember:SendMemberAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const incidentMembers: Array<IncidentMember> =
      await IncidentMemberService.findAllBy({
        query: {
          isMemberNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          incidentId: true,
          userId: true,
          incidentRoleId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    const incidentMembersMap: Dictionary<
      Array<{ user: User; roleName: string }>
    > = {};

    for (const incidentMember of incidentMembers) {
      const incidentId: ObjectID = incidentMember.incidentId!;
      const user: User = incidentMember.user!;
      const incidentRoleId: ObjectID | undefined =
        incidentMember.incidentRoleId;

      let roleName: string = "Member";
      if (incidentRoleId) {
        const role: IncidentRole | null = await IncidentRoleService.findOneById(
          {
            id: incidentRoleId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          },
        );
        if (role && role.name) {
          roleName = role.name;
        }
      }

      if (incidentMembersMap[incidentId.toString()] === undefined) {
        incidentMembersMap[incidentId.toString()] = [];
      }

      (
        incidentMembersMap[incidentId.toString()] as Array<{
          user: User;
          roleName: string;
        }>
      ).push({ user, roleName });

      // mark this as notified.
      await IncidentMemberService.updateOneById({
        id: incidentMember.id!,
        data: {
          isMemberNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const incidentId in incidentMembersMap) {
      if (!incidentMembersMap[incidentId]) {
        continue;
      }

      if (
        (
          incidentMembersMap[incidentId] as Array<{
            user: User;
            roleName: string;
          }>
        ).length === 0
      ) {
        continue;
      }

      const members: Array<{ user: User; roleName: string }> =
        incidentMembersMap[incidentId] as Array<{
          user: User;
          roleName: string;
        }>;

      // get incident details
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
        },
      });

      if (!incident) {
        continue;
      }

      const incidentNumber: string = incident.incidentNumber
        ? `#${incident.incidentNumber}`
        : "";

      for (const member of members) {
        const user: User = member.user;
        const roleName: string = member.roleName;

        const vars: Dictionary<string> = {
          incidentTitle: incident.title!,
          incidentNumber: incidentNumber,
          projectName: incident.project!.name!,
          currentState: incident.currentIncidentState!.name!,
          incidentRole: roleName,
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

        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `#${incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentMemberAdded,
          vars: vars,
          subject: `You have been assigned as ${roleName} to Incident ${incidentNumber} - ${incident.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been assigned as ${roleName} to the incident ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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
      }
    }
  },
);
