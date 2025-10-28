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
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "MonitorOwner:SendStatusChangeEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.

    const monitorStatusTimelines: Array<MonitorStatusTimeline> =
      await MonitorStatusTimelineService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          project: {
            name: true,
          },
          monitor: {
            _id: true,
            name: true,
            description: true,
          },
          monitorStatus: {
            name: true,
          },
          rootCause: true,
        },
      });

    for (const monitorStatusTimeline of monitorStatusTimelines) {
      const monitor: Monitor = monitorStatusTimeline.monitor!;
      const monitorStatus: MonitorStatus = monitorStatusTimeline.monitorStatus!;

      await MonitorStatusTimelineService.updateOneById({
        id: monitorStatusTimeline.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await MonitorService.findOwners(monitor.id!);

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(
          monitorStatusTimeline.projectId!,
        );
      }

      if (owners.length === 0) {
        continue;
      }

      for (const user of owners) {
        const vars: Dictionary<string> = {
          monitorName: monitor.name!,
          projectName: monitorStatusTimeline.project!.name!,
          currentStatus: monitorStatus!.name!,
          monitorDescription: await Markdown.convertToHTML(
            monitor.description! || "",
            MarkdownContentType.Email,
          ),
          statusChangedAt:
            OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: monitorStatusTimeline.createdAt!,
              timezones: user.timezone ? [user.timezone] : [],
            }),
          monitorViewLink: (
            await MonitorService.getMonitorLinkInDashboard(
              monitorStatusTimeline.projectId!,
              monitor.id!,
            )
          ).toString(),
          rootCause:
            (await Markdown.convertToHTML(
              monitorStatusTimeline.rootCause || "",
              MarkdownContentType.Email,
            )) || "",
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorOwnerStatusChanged,
          vars: vars,
          subject: `[Monitor] ${
            monitor.name || "Monitor"
          } is ${monitorStatus!.name!}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. ${
            monitor.name || "Monitor"
          } status changed to ${monitorStatus!
            .name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. ${
                monitor.name || "Monitor"
              } status changed to ${monitorStatus!
                .name!}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createMonitorStatusChangedNotification({
            monitorName: monitor.name || "Monitor",
            projectName: monitorStatusTimeline.project!.name!,
            newStatus: monitorStatus!.name!,
            monitorViewLink: vars["monitorViewLink"] || "",
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              monitor_name: monitor.name || "Monitor",
              monitor_status: monitorStatus!.name!,
              monitor_link: vars["monitorViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitorStatusTimeline.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      }
    }
  },
);
