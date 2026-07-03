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
import DashboardOwnerTeamService from "Common/Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "Common/Server/Services/DashboardOwnerUserService";
import DashboardService from "Common/Server/Services/DashboardService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeam from "Common/Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "Common/Models/DatabaseModels/DashboardOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "DashboardOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const dashboardOwnerTeams: Array<DashboardOwnerTeam> =
      await DashboardOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dashboardId: true,
          teamId: true,
        },
      });

    const dashboardOwnersMap: Dictionary<Array<User>> = {};

    for (const dashboardOwnerTeam of dashboardOwnerTeams) {
      const dashboardId: ObjectID = dashboardOwnerTeam.dashboardId!;
      const teamId: ObjectID = dashboardOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (dashboardOwnersMap[dashboardId.toString()] === undefined) {
        dashboardOwnersMap[dashboardId.toString()] = [];
      }

      for (const user of users) {
        (dashboardOwnersMap[dashboardId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await DashboardOwnerTeamService.updateOneById({
        id: dashboardOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const dashboardOwnerUsers: Array<DashboardOwnerUser> =
      await DashboardOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          dashboardId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const dashboardOwnerUser of dashboardOwnerUsers) {
      const dashboardId: ObjectID = dashboardOwnerUser.dashboardId!;
      const user: User = dashboardOwnerUser.user!;

      if (dashboardOwnersMap[dashboardId.toString()] === undefined) {
        dashboardOwnersMap[dashboardId.toString()] = [];
      }

      (dashboardOwnersMap[dashboardId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await DashboardOwnerUserService.updateOneById({
        id: dashboardOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const dashboardId in dashboardOwnersMap) {
      if (!dashboardOwnersMap[dashboardId]) {
        continue;
      }

      if ((dashboardOwnersMap[dashboardId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = dashboardOwnersMap[dashboardId] as Array<User>;

      const dashboard: Dashboard | null = await DashboardService.findOneById({
        id: new ObjectID(dashboardId),
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
        },
      });

      if (!dashboard) {
        continue;
      }

      const viewDashboardLink: string = (
        await DashboardService.getLinkInDashboard(
          dashboard.projectId!,
          dashboard.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        dashboardName: dashboard.name!,
        dashboardDescription:
          dashboard.description || "No description provided",
        projectName: dashboard.project!.name!,
        viewDashboardLink: viewDashboardLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.DashboardOwnerAdded,
          vars: vars,
          subject: "[Dashboard] Owner of " + dashboard.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the dashboard: ${dashboard.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the dashboard: ${dashboard.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Dashboard Owner",
            body: `You have been added as the owner of the dashboard: ${dashboard.name!}. Click to view details.`,
            clickAction: viewDashboardLink,
            tag: "dashboard-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              dashboard_name: dashboard.name!,
              dashboard_link: viewDashboardLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: dashboard.projectId!,
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
