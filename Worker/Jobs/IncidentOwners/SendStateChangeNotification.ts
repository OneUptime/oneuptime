import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "Common/Types/BrandColors";
import UserService from "Common/Server/Services/UserService";

RunCron(
  "IncidentOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.

    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
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
          createdAt: true,
          projectId: true,
          project: {
            name: true,
          },
          incidentId: true,
          incidentState: {
            name: true,
            isResolvedState: true,
          },
        },
      });

    for (const incidentStateTimeline of incidentStateTimelines) {
      let moreIncidentFeedInformationInMarkdown: string = "";

      const incidentId: ObjectID = incidentStateTimeline.incidentId!;

      if (!incidentId) {
        continue;
      }

      // get incident

      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          description: true,
          projectId: true,
          monitors: {
            name: true,
          },
          incidentNumber: true,
        },
      });

      if (!incident) {
        continue;
      }

      const incidentState: IncidentState = incidentStateTimeline.incidentState!;

      // get incident severity
      const incidentWithSeverity: Incident | null =
        await IncidentService.findOneById({
          id: incident.id!,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            incidentSeverity: {
              name: true,
            },
          },
        });

      if (!incidentWithSeverity) {
        continue;
      }

      await IncidentStateTimelineService.updateOneById({
        id: incidentStateTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await IncidentService.findOwners(incident.id!);

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          incidentStateTimeline.projectId!,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      const resourcesAffected: string =
        incident
          .monitors!.map((monitor: Monitor) => {
            return monitor.name!;
          })
          .join(", ") || "";

      for (const user of owners) {
        const vars: Dictionary<string> = {
          incidentTitle: incident.title!,
          projectName: incidentStateTimeline.project!.name!,
          currentState: incidentState!.name!,
          incidentDescription: await Markdown.convertToHTML(
            incident.description! || "",
            MarkdownContentType.Email,
          ),
          resourcesAffected: resourcesAffected || "None",
          stateChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: incidentStateTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          incidentSeverity: incidentWithSeverity.incidentSeverity!.name!,
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

        let subjectLine: string = `[Incident] ${incident.title!}`;

        if (incidentState.isResolvedState) {
          if (resourcesAffected) {
            subjectLine = `[Incident] Incident on ${resourcesAffected} is resolved`;
          } else {
            subjectLine = `[Incident] Incident is resolved`;
          }
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerStateChanged,
          vars: vars,
          subject: subjectLine,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Incident: ${
            incident.title
          } - state changed to ${incidentState!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Incident ${
                incident.title
              }       state changed to ${incidentState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentStateChangedNotification({
            incidentTitle: incident.title!,
            projectName: incidentStateTimeline.project!.name!,
            newState: incidentState!.name!,
            incidentViewLink: vars["incidentViewLink"] || "",
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incidentStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
        });

        moreIncidentFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: incidentStateTimeline.projectId!,
          },
        )})\n`;
      }

      const incidentNumber: number = incident.incidentNumber!;
      const projectId: ObjectID = incident.projectId!;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Incident ${incidentNumber}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}).**: Owners have been notified about the state change of the incident because the incident state changed to **${incidentState.name}**.`,
        moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
