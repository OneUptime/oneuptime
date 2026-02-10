import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import Text from "Common/Types/Text";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
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
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentOwner:SendStateChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.

    const incidentStateTimelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          projectId: true,
          project: {
            name: true,
          },
          incidentId: true,
          incidentStateId: true,
          incidentState: {
            name: true,
            isResolvedState: true,
            color: true,
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
          incidentNumberWithPrefix: true,
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

      // Fetch the previous state timeline entry
      let previousState: IncidentState | null = null;
      let previousStateDuration: string = "";

      if (incidentStateTimeline.incidentId && incidentStateTimeline.startsAt) {
        const previousTimeline: IncidentStateTimeline | null =
          await IncidentStateTimelineService.findOneBy({
            query: {
              incidentId: incidentStateTimeline.incidentId,
              startsAt: QueryHelper.lessThan(incidentStateTimeline.startsAt),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              incidentStateId: true,
              startsAt: true,
              createdAt: true,
            },
          });

        if (previousTimeline?.incidentStateId) {
          previousState = await IncidentStateService.findOneById({
            id: previousTimeline.incidentStateId,
            props: {
              isRoot: true,
            },
            select: {
              name: true,
              color: true,
            },
          });

          /*
           * Calculate how long the incident was in the previous state
           * Use startsAt if available, otherwise fall back to createdAt
           */
          const previousStartTime: Date | undefined =
            previousTimeline.startsAt || previousTimeline.createdAt;
          const currentStartTime: Date | undefined =
            incidentStateTimeline.startsAt || incidentStateTimeline.createdAt;

          if (previousStartTime && currentStartTime) {
            const durationInSeconds: number =
              OneUptimeDate.getDifferenceInSeconds(
                currentStartTime,
                previousStartTime,
              );
            previousStateDuration =
              OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
                durationInSeconds,
              );
          }
        }
      }

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

      const incidentNumberStr: string =
        incident.incidentNumberWithPrefix ||
        (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

      for (const user of owners) {
        // Build the "Was X for Y" string
        const previousStateDurationText: string =
          previousState?.name && previousStateDuration
            ? `Was ${previousState.name} for ${previousStateDuration}`
            : "";

        const vars: Dictionary<string> = {
          incidentTitle: incident.title!,
          incidentNumber: incidentNumberStr,
          projectName: incidentStateTimeline.project!.name!,
          currentState: incidentState!.name!,
          currentStateColor: incidentState!.color?.toString() || "#000000",
          previousState: previousState?.name || "",
          previousStateColor: previousState?.color?.toString() || "#6b7280",
          previousStateDurationText: previousStateDurationText,
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

        const subjectLine: string = `[Incident ${incidentNumberStr} ${Text.uppercaseFirstLetter(incidentState!.name!)}] - ${incident.title!}`;

        const incidentIdentifier: string =
          incident.incidentNumber !== undefined
            ? `${incident.incidentNumberWithPrefix || "#" + incident.incidentNumber} (${incident.title})`
            : incident.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncidentOwnerStateChanged,
          vars: vars,
          subject: subjectLine,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Incident ${incidentIdentifier} - state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Incident ${
                incidentIdentifier
              } state changed${previousState ? ` from ${previousState.name}` : ""} to ${incidentState!
                .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushNotificationParams: {
          incidentTitle: string;
          projectName: string;
          newState: string;
          previousState?: string;
          incidentViewLink: string;
          incidentNumber?: number;
          incidentId?: string;
          projectId?: string;
        } = {
          incidentTitle: incident.title!,
          projectName: incidentStateTimeline.project!.name!,
          newState: incidentState!.name!,
          incidentViewLink: vars["incidentViewLink"] || "",
          ...(incident.incidentNumber !== undefined && {
            incidentNumber: incident.incidentNumber,
          }),
          incidentId: incident.id!.toString(),
          projectId: incident.projectId!.toString(),
        };

        if (previousState?.name) {
          pushNotificationParams.previousState = previousState.name;
        }

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createIncidentStateChangedNotification(
            pushNotificationParams,
          );

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              incident_title: incident.title!,
              incident_state: incidentState!.name!,
              incident_number:
                incident.incidentNumber !== undefined
                  ? incident.incidentNumber.toString()
                  : "",
              incident_link: vars["incidentViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incidentStateTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          incidentId: incident.id!,
          eventType,
        });

        moreIncidentFeedInformationInMarkdown += `**Notified:** ${await UserService.getUserMarkdownString(
          {
            userId: user.id!,
            projectId: incidentStateTimeline.projectId!,
          },
        )})\n`;
      }

      const incidentNumberDisplayValue: string =
        incident.incidentNumberWithPrefix || "#" + incident.incidentNumber!;
      const projectId: ObjectID = incident.projectId!;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id!,
        projectId: incident.projectId!,
        incidentFeedEventType: IncidentFeedEventType.OwnerNotificationSent,
        displayColor: Blue500,
        feedInfoInMarkdown: `🔔 **Owners have been notified about the state change of the [Incident ${incidentNumberDisplayValue}](${(await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)).toString()}).**: Owners have been notified about the state change of the incident because the incident state changed to **${incidentState.name}**.`,
        moreInformationInMarkdown: moreIncidentFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
