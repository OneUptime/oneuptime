import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import MonitorService, {
  MonitorDestinationInfo,
} from "Common/Server/Services/MonitorService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "MonitorOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const monitors: Array<Monitor> = await MonitorService.findAllBy({
      query: {
        isOwnerNotifiedOfResourceCreation: false,
      },
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        name: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
        currentMonitorStatus: {
          name: true,
        },
        monitorType: true,
        monitorSteps: true,
      },
    });

    for (const monitor of monitors) {
      await MonitorService.updateOneById({
        id: monitor.id!,
        data: {
          isOwnerNotifiedOfResourceCreation: true,
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
        owners = await ProjectService.getOwners(monitor.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      // Get monitor destination info using the helper function
      const destinationInfo: MonitorDestinationInfo =
        MonitorService.getMonitorDestinationInfo(monitor);

      const vars: Dictionary<string> = {
        monitorName: monitor.name!,
        projectName: monitor.project!.name!,
        currentStatus: monitor.currentMonitorStatus!.name!,
        monitorDescription: await Markdown.convertToHTML(
          monitor.description! || "",
          MarkdownContentType.Email,
        ),
        monitorViewLink: (
          await MonitorService.getMonitorLinkInDashboard(
            monitor.projectId!,
            monitor.id!,
          )
        ).toString(),
        monitorDestination: destinationInfo.monitorDestination,
        requestType: destinationInfo.requestType,
        monitorType: destinationInfo.monitorType,
      };

      if (doesResourceHasOwners === true) {
        vars["isOwner"] = "true";
      }

      for (const user of owners) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorOwnerResourceCreated,
          vars: vars,
          subject: "[Monitor Created] " + monitor.name!,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. New monitor created - ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. New monitor was created ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createMonitorCreatedNotification({
            monitorName: monitor.name!,
            monitorId: monitor.id!.toString(),
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              monitor_name: monitor.name!,
              monitor_link: vars["monitorViewLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitor.projectId!,
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
