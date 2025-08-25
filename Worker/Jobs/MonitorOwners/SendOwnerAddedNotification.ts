import RunCron from "../../Utils/Cron";
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
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import MonitorService from "Common/Server/Services/MonitorService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "MonitorOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const monitorOwnerTeams: Array<MonitorOwnerTeam> =
      await MonitorOwnerTeamService.findBy({
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
          monitorId: true,
          teamId: true,
        },
      });

    const monitorOwnersMap: Dictionary<Array<User>> = {};

    for (const monitorOwnerTeam of monitorOwnerTeams) {
      const monitorId: ObjectID = monitorOwnerTeam.monitorId!;
      const teamId: ObjectID = monitorOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (monitorOwnersMap[monitorId.toString()] === undefined) {
        monitorOwnersMap[monitorId.toString()] = [];
      }

      for (const user of users) {
        (monitorOwnersMap[monitorId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await MonitorOwnerTeamService.updateOneById({
        id: monitorOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const monitorOwnerUsers: Array<MonitorOwnerUser> =
      await MonitorOwnerUserService.findBy({
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
          monitorId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const monitorOwnerUser of monitorOwnerUsers) {
      const monitorId: ObjectID = monitorOwnerUser.monitorId!;
      const user: User = monitorOwnerUser.user!;

      if (monitorOwnersMap[monitorId.toString()] === undefined) {
        monitorOwnersMap[monitorId.toString()] = [];
      }

      (monitorOwnersMap[monitorId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await MonitorOwnerUserService.updateOneById({
        id: monitorOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const monitorId in monitorOwnersMap) {
      if (!monitorOwnersMap[monitorId]) {
        continue;
      }

      if ((monitorOwnersMap[monitorId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = monitorOwnersMap[monitorId] as Array<User>;

      // get all scheduled events of all the projects.
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: new ObjectID(monitorId),
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
        },
      });

      if (!monitor) {
        continue;
      }

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
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.MonitorOwnerAdded,
          vars: vars,
          subject: "You have been added as the owner of the monitor.",
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the monitor - ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const whatsApp: WhatsAppMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the monitor - ${monitor.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the monitor ${monitor.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Monitor Owner",
            body: `You have been added as the owner of the monitor: ${monitor.name}. Click to view details.`,
            clickAction: (
              await MonitorService.getMonitorLinkInDashboard(
                monitor.projectId!,
                monitor.id!,
              )
            ).toString(),
            tag: "monitor-owner-added",
            requireInteraction: false,
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: monitor.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          whatsAppMessage: whatsApp,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION,
        });
      }
    }
  },
);
