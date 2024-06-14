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
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentService from "CommonServer/Services/IncidentService";
import IncidentStateTimelineService from "CommonServer/Services/IncidentStateTimelineService";
import ProjectService from "CommonServer/Services/ProjectService";
import UserNotificationSettingService from "CommonServer/Services/UserNotificationSettingService";
import Markdown, { MarkdownContentType } from "CommonServer/Types/Markdown";
import Incident from "Model/Models/Incident";
import IncidentState from "Model/Models/IncidentState";
import IncidentStateTimeline from "Model/Models/IncidentStateTimeline";
import Monitor from "Model/Models/Monitor";
import User from "Model/Models/User";

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
          },
        },
      });

    for (const incidentStateTimeline of incidentStateTimelines) {
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
          monitors: {
            name: true,
          },
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

      const vars: Dictionary<string> = {
        incidentTitle: incident.title!,
        projectName: incidentStateTimeline.project!.name!,
        currentState: incidentState!.name!,
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
        stateChangedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
          incidentStateTimeline.createdAt!,
        ),
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

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerStateChanged,
          vars: vars,
          subject: `[Incident ${Text.uppercaseFirstLetter(
            incidentState!.name!,
          )}] ${incident.title!}`,
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

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incidentStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          eventType:
            NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
        });
      }
    }
  },
);
