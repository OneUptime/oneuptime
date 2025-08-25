import RunCron from "../../Utils/Cron";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessage } from "Common/Types/WhatsApp/WhatsApp";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";

RunCron(
  "IncidentOwner:SendsNotePostedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const publicNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          incidentId: true,
          projectId: true,
        },
      });

    const privateNotes: Array<IncidentInternalNote> =
      await IncidentInternalNoteService.findBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          note: true,
          incidentId: true,
          projectId: true,
        },
      });

    const privateNoteIds: Array<string> = privateNotes.map(
      (note: IncidentInternalNote) => {
        return note._id!;
      },
    );

    for (const note of publicNotes) {
      await IncidentPublicNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    for (const note of privateNotes) {
      await IncidentInternalNoteService.updateOneById({
        id: note.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const notes: Array<BaseModel> = [...publicNotes, ...privateNotes];

    for (const noteObject of notes) {
      let moreIncidentFeedInformationInMarkdown: string = "";

      const note: BaseModel = noteObject as BaseModel;

      // get all scheduled events of all the projects.
      const incident: Incident | null = await IncidentService.findOneById({
        id: note.getColumnValue("incidentId")! as ObjectID,
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

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await IncidentService.findOwners(
        note.getColumnValue("incidentId")! as ObjectID,
      );

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          note.getColumnValue("projectId") as ObjectID,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      const vars: Dictionary<string> = {
        incidentTitle: incident.title!,
        projectName: incident.project!.name!,
        currentState: incident.currentIncidentState!.name!,
        note: await Markdown.convertToHTML(
          (note.getColumnValue("note")! as string) || "",
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

      if (doesResourceHasOwners === true) {
        vars["isOwner"] = "true";
      }

      if (privateNoteIds.includes(note._id!)) {
        vars["isPrivateNote"] = "true";
      }

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerNotePosted,
          vars: vars,
          subject: "[Incident Update] " + incident.title,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New note posted on incident: ${incident.title}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const whatsApp: WhatsAppMessage = {
          message: `This is a message from OneUptime. New note posted on incident: ${incident.title}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New note posted on incident ${incident.title}. To see the note, go to OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentNotePostedNotification({
            incidentTitle: incident.title!,
            projectName: incident.project!.name!,
            isPrivateNote: privateNoteIds.includes(note._id!),
            incidentViewLink: (
              await IncidentService.getIncidentLinkInDashboard(
                incident.projectId!,
                incident.id!,
              )
            ).toString(),
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incident.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          whatsAppMessage: whatsApp,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
        });

        moreIncidentFeedInformationInMarkdown += `**Notified:** ${user.name} (${user.email})\n`;
      }

      const isPrivateNote: boolean = privateNoteIds.includes(
        note._id!.toString(),
      );

      const projectId: ObjectID = incident.projectId!;
      const incidentId: ObjectID = incident.id!;
      const incidentNumber: number = incident.incidentNumber!; // incident number is not null here.

      const incidentFeedText: string = `🔔 **Owners Notified because ${isPrivateNote ? "private" : "public"} note is posted** Owners have been notified about the new ${isPrivateNote ? "private" : "public"} note posted on the [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}).`;

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
    }
  },
);
