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
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "AlertOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const alertOwnerTeams: Array<AlertOwnerTeam> =
      await AlertOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertId: true,
          teamId: true,
        },
      });

    const alertOwnersMap: Dictionary<Array<User>> = {};

    for (const alertOwnerTeam of alertOwnerTeams) {
      const alertId: ObjectID = alertOwnerTeam.alertId!;
      const teamId: ObjectID = alertOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (alertOwnersMap[alertId.toString()] === undefined) {
        alertOwnersMap[alertId.toString()] = [];
      }

      for (const user of users) {
        (alertOwnersMap[alertId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await AlertOwnerTeamService.updateOneById({
        id: alertOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const alertOwnerUsers: Array<AlertOwnerUser> =
      await AlertOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          alertId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const alertOwnerUser of alertOwnerUsers) {
      const alertId: ObjectID = alertOwnerUser.alertId!;
      const user: User = alertOwnerUser.user!;

      if (alertOwnersMap[alertId.toString()] === undefined) {
        alertOwnersMap[alertId.toString()] = [];
      }

      (alertOwnersMap[alertId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await AlertOwnerUserService.updateOneById({
        id: alertOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const alertId in alertOwnersMap) {
      if (!alertOwnersMap[alertId]) {
        continue;
      }

      if ((alertOwnersMap[alertId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = alertOwnersMap[alertId] as Array<User>;

      // get all scheduled events of all the projects.
      const alert: Alert | null = await AlertService.findOneById({
        id: new ObjectID(alertId),
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
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
          monitor: {
            name: true,
          },
          alertNumber: true,
          alertNumberWithPrefix: true,
        },
      });

      if (!alert) {
        continue;
      }

      const alertNumber: string = alert.alertNumberWithPrefix
        || (alert.alertNumber ? `#${alert.alertNumber}` : "");

      const vars: Dictionary<string> = {
        alertTitle: alert.title!,
        alertNumber: alertNumber,
        projectName: alert.project!.name!,
        currentState: alert.currentAlertState!.name!,
        alertDescription: await Markdown.convertToHTML(
          alert.description! || "",
          MarkdownContentType.Email,
        ),
        resourcesAffected: alert.monitor?.name || "None",
        alertSeverity: alert.alertSeverity!.name!,
        alertViewLink: (
          await AlertService.getAlertLinkInDashboard(
            alert.projectId!,
            alert.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const alertIdentifier: string =
          alert.alertNumber !== undefined
            ? `${alert.alertNumberWithPrefix || '#' + alert.alertNumber} (${alert.title})`
            : alert.title!;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertOwnerAdded,
          vars: vars,
          subject: `You have been added as the owner of Alert ${alertNumber} - ${alert.title}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the alert ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the alert ${alertIdentifier}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Alert Owner",
            body: `You have been added as the owner of the alert ${alertIdentifier}. Click to view details.`,
            clickAction: (
              await AlertService.getAlertLinkInDashboard(
                alert.projectId!,
                alert.id!,
              )
            ).toString(),
            tag: "alert-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              alert_title: alert.title!,
              alert_link: vars["alertViewLink"] || "",
              alert_number:
                alert.alertNumber !== undefined
                  ? alert.alertNumber.toString()
                  : "",
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
      }
    }
  },
);
