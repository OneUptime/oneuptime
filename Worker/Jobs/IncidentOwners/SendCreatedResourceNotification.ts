import RunCron from "../../Utils/Cron";
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
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const incidents: Array<Incident> = await IncidentService.findAllBy({
      query: {
        isOwnerNotifiedOfResourceCreation: false,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      select: {
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
        } as Select<IncidentState>,
        incidentSeverity: {
          name: true,
        },
        rootCause: true,
        monitors: {
          name: true,
        },
        createdByProbe: {
          name: true,
        },
        createdByUser: {
          name: true,
          email: true,
        },
        incidentNumber: true,
        incidentNumberWithPrefix: true,
      },
    });

    for (const incident of incidents) {
      const projectId: ObjectID = incident.projectId!;
      const incidentId: ObjectID = incident.id!;
      const incidentNumber: number = incident.incidentNumber!;
      const incidentNumberDisplay: string =
        incident.incidentNumberWithPrefix || "#" + incidentNumber;

      const incidentFeedText: string = `🔔 **Owner Incident Created Notification Sent**:
Notification sent to owners because [Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}) was created.`;
      let moreIncidentFeedInformationInMarkdown: string = "";

      const incidentIdentifiedDate: Date =
        await IncidentService.getIncidentIdentifiedDate(incident.id!);

      await IncidentService.updateOneById({
        id: incident.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
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
        owners = await ProjectService.getOwners(incident.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

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

      for (const user of owners) {
        try {
          const vars: Dictionary<string> = {
            incidentTitle: incident.title!,
            incidentNumber: incidentNumberStr,
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
            declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
              {
                date: incidentIdentifiedDate,
                timezones: user.timezone ? [user.timezone] : [],
              },
            ),
            declaredBy: declaredBy,
            remediationNotes:
              (await Markdown.convertToHTML(
                incident.remediationNotes! || "",
                MarkdownContentType.Email,
              )) || "",
            rootCause:
              (await Markdown.convertToHTML(
                incident.rootCause ||
                  "No root cause identified for this incident",
                MarkdownContentType.Email,
              )) || "",
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
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. New incident created: ${incidentIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
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

          moreIncidentFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
        } catch (e) {
          logger.error(
            "Error in sending incident created resource notification",
          );
          logger.error(e);
        }
      }

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: incidentFeedText,
        moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: false,
        },
      });
    }
  },
);
