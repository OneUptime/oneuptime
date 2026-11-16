import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import { tellOwnersAdded } from "../../Utils/OwnersAdded";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import Incident from "Common/Models/DatabaseModels/Incident";
import User from "Common/Models/DatabaseModels/User";
import Select from "Common/Server/Types/Database/Select";
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

RunCron(
  "IncidentOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
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

    /*
     * Every record's new owner rows, a page at a time, oldest first: its
     * team rows and user rows told of together, each person once, each row
     * taken by one run alone; the run stops between records at its deadline
     * and the next carries on (OwnersAdded, issue #8862).
     */
    await tellOwnersAdded<Incident>({
      jobName: "IncidentOwner:SendOwnerAddedEmail",
      kind: OwnerNotificationKind.IncidentOwnerAdded,
      recordIdColumn: "incidentId",
      teamService: IncidentOwnerTeamService,
      userService: IncidentOwnerUserService,
      recordService: IncidentService,
      recordSelect: INCIDENT_SELECT,
      deadline: deadline,
      tell: async (
        record: Incident,
        deliveries: Array<OwnerNotificationDelivery>,
      ): Promise<void> => {
        await notifyOwnersAdded({
          incident: record,
          deliveries: deliveries,
        });
      },
    });
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
