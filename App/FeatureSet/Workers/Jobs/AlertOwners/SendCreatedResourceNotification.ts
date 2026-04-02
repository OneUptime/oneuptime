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
import AlertService from "Common/Server/Services/AlertService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import logger from "Common/Server/Utils/Logger";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertFeedEventType } from "Common/Models/DatabaseModels/AlertFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertOwner:SendCreatedResourceEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // get all scheduled events of all the projects.
    const alerts: Array<Alert> = await AlertService.findAllBy({
      query: {
        isOwnerNotifiedOfAlertCreation: false,
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
        currentAlertState: {
          name: true,
        } as Select<AlertState>,
        alertSeverity: {
          name: true,
        },
        rootCause: true,
        monitor: {
          name: true,
        },
        createdByProbe: {
          name: true,
        },
        createdByUser: {
          name: true,
          email: true,
        },
        alertNumber: true,
        alertNumberWithPrefix: true,
      },
    });

    for (const alert of alerts) {
      const projectId: ObjectID = alert.projectId!;
      const alertId: ObjectID = alert.id!;
      const alertDisplayNumber: string =
        alert.alertNumberWithPrefix || "#" + alert.alertNumber!;

      const alertFeedText: string = `🔔 **Owner Alert Created Notification Sent**:
      Notification sent to owners because [Alert ${alertDisplayNumber}](${(await AlertService.getAlertLinkInDashboard(projectId, alertId)).toString()}) was created.`;
      let moreAlertFeedInformationInMarkdown: string = "";

      const alertIdentifiedDate: Date =
        await AlertService.getAlertIdentifiedDate(alert.id!);

      await AlertService.updateOneById({
        id: alert.id!,
        data: {
          isOwnerNotifiedOfAlertCreation: true,
        },
        props: {
          isRoot: true,
        },
      });

      // now find owners.

      let doesResourceHasOwners: boolean = true;

      let owners: Array<User> = await AlertService.findOwners(alert.id!);

      if (owners.length === 0) {
        doesResourceHasOwners = false;

        // find project owners.
        owners = await ProjectService.getOwners(alert.projectId!);
      }

      if (owners.length === 0) {
        continue;
      }

      let declaredBy: string = "OneUptime";

      if (alert.createdByProbe && alert.createdByProbe.name) {
        declaredBy = alert.createdByProbe.name;
      }

      if (
        alert.createdByUser &&
        alert.createdByUser.name &&
        alert.createdByUser.email
      ) {
        declaredBy = `${alert.createdByUser.name.toString()} (${alert.createdByUser.email.toString()})`;
      }

      const alertNumberStr: string =
        alert.alertNumberWithPrefix ||
        (alert.alertNumber ? `#${alert.alertNumber}` : "");

      for (const user of owners) {
        try {
          const alertIdentifier: string =
            alert.alertNumber !== undefined
              ? `${alert.alertNumberWithPrefix || "#" + alert.alertNumber} (${alert.title})`
              : alert.title!;

          const vars: Dictionary<string> = {
            alertTitle: alert.title!,
            alertNumber: alertNumberStr,
            projectName: alert.project!.name!,
            currentState: alert.currentAlertState!.name!,
            alertDescription: await Markdown.convertToHTML(
              alert.description! || "",
              MarkdownContentType.Email,
            ),
            resourcesAffected: alert.monitor?.name || "None",
            alertSeverity: alert.alertSeverity!.name!,
            declaredAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones(
              {
                date: alertIdentifiedDate,
                timezones: user.timezone ? [user.timezone] : [],
              },
            ),
            declaredBy: declaredBy,
            remediationNotes:
              (await Markdown.convertToHTML(
                alert.remediationNotes! || "",
                MarkdownContentType.Email,
              )) || "",
            rootCause:
              (await Markdown.convertToHTML(
                alert.rootCause || "No root cause identified for this alert",
                MarkdownContentType.Email,
              )) || "",
            alertViewLink: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.AlertOwnerResourceCreated,
            vars: vars,
            subject: `[New Alert ${alertNumberStr}] - ${alert.title!}`,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. New alert created: ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. New alert created: ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createAlertCreatedNotification({
              alertTitle: alert.title!,
              projectName: alert.project!.name!,
              alertViewLink: vars["alertViewLink"] || "",
              ...(alert.alertNumber !== undefined && {
                alertNumber: alert.alertNumber,
              }),
              alertId: alert.id!.toString(),
              projectId: alert.projectId!.toString(),
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_ALERT_CREATED_OWNER_NOTIFICATION;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                alert_title: alert.title!,
                project_name: alert.project!.name!,
                alert_link: vars["alertViewLink"] || "",
                alert_number: alert.alertNumber!.toString(),
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: alert.projectId!,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            alertId: alert.id!,
            eventType,
          });

          moreAlertFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
        } catch (e) {
          logger.error("Error in sending alert created resource notification");
          logger.error(e);
        }
      }

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: alertFeedText,
        moreInformationInMarkdown: moreAlertFeedInformationInMarkdown,
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });
    }
  },
);
