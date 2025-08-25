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
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "StatusPageOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const statusPageOwnerTeams: Array<StatusPageOwnerTeam> =
      await StatusPageOwnerTeamService.findBy({
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
          statusPageId: true,
          teamId: true,
        },
      });

    const statusPageOwnersMap: Dictionary<Array<User>> = {};

    for (const statusPageOwnerTeam of statusPageOwnerTeams) {
      const statusPageId: ObjectID = statusPageOwnerTeam.statusPageId!;
      const teamId: ObjectID = statusPageOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
        statusPageOwnersMap[statusPageId.toString()] = [];
      }

      for (const user of users) {
        (statusPageOwnersMap[statusPageId.toString()] as Array<User>).push(
          user,
        );
      }

      // mark this as notified.
      await StatusPageOwnerTeamService.updateOneById({
        id: statusPageOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const statusPageOwnerUsers: Array<StatusPageOwnerUser> =
      await StatusPageOwnerUserService.findBy({
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
          statusPageId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const statusPageOwnerUser of statusPageOwnerUsers) {
      const statusPageId: ObjectID = statusPageOwnerUser.statusPageId!;
      const user: User = statusPageOwnerUser.user!;

      if (statusPageOwnersMap[statusPageId.toString()] === undefined) {
        statusPageOwnersMap[statusPageId.toString()] = [];
      }

      (statusPageOwnersMap[statusPageId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await StatusPageOwnerUserService.updateOneById({
        id: statusPageOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const statusPageId in statusPageOwnersMap) {
      if (!statusPageOwnersMap[statusPageId]) {
        continue;
      }

      if ((statusPageOwnersMap[statusPageId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = statusPageOwnersMap[
        statusPageId
      ] as Array<User>;

      // get all scheduled events of all the projects.
      const statusPage: StatusPage | null = await StatusPageService.findOneById(
        {
          id: new ObjectID(statusPageId),
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
        },
      );

      if (!statusPage) {
        continue;
      }

      const vars: Dictionary<string> = {
        statusPageName: statusPage.name!,
        projectName: statusPage.project!.name!,
        statusPageDescription: await Markdown.convertToHTML(
          statusPage.description! || "",
          MarkdownContentType.Email,
        ),
        statusPageViewLink: (
          await StatusPageService.getStatusPageLinkInDashboard(
            statusPage.projectId!,
            statusPage.id!,
          )
        ).toString(),
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.StatusPageOwnerAdded,
          vars: vars,
          subject: "You have been added as the owner of the status page.",
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the status page. Status Page Name: ${statusPage.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const whatsApp: WhatsAppMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the status page. Status Page Name: ${statusPage.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the status page. Status Page ${statusPage.name}.  To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Status Page Owner",
            body: `You have been added as the owner of the status page: ${statusPage.name}. Click to view details.`,
            clickAction: (
              await StatusPageService.getStatusPageLinkInDashboard(
                statusPage.projectId!,
                statusPage.id!,
              )
            ).toString(),
            tag: "status-page-owner-added",
            requireInteraction: false,
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: statusPage.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          whatsAppMessage: whatsApp,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          eventType:
            NotificationSettingEventType.SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION,
        });
      }
    }
  },
);
