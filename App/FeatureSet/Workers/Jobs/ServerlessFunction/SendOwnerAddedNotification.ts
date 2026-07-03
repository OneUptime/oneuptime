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
import ServerlessFunctionOwnerTeamService from "Common/Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "Common/Server/Services/ServerlessFunctionOwnerUserService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerTeam from "Common/Models/DatabaseModels/ServerlessFunctionOwnerTeam";
import ServerlessFunctionOwnerUser from "Common/Models/DatabaseModels/ServerlessFunctionOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "ServerlessFunctionOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const serverlessFunctionOwnerTeams: Array<ServerlessFunctionOwnerTeam> =
      await ServerlessFunctionOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          serverlessFunctionId: true,
          teamId: true,
        },
      });

    const serverlessFunctionOwnersMap: Dictionary<Array<User>> = {};

    for (const serverlessFunctionOwnerTeam of serverlessFunctionOwnerTeams) {
      const serverlessFunctionId: ObjectID = serverlessFunctionOwnerTeam.serverlessFunctionId!;
      const teamId: ObjectID = serverlessFunctionOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (serverlessFunctionOwnersMap[serverlessFunctionId.toString()] === undefined) {
        serverlessFunctionOwnersMap[serverlessFunctionId.toString()] = [];
      }

      for (const user of users) {
        (serverlessFunctionOwnersMap[serverlessFunctionId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await ServerlessFunctionOwnerTeamService.updateOneById({
        id: serverlessFunctionOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const serverlessFunctionOwnerUsers: Array<ServerlessFunctionOwnerUser> =
      await ServerlessFunctionOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          serverlessFunctionId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const serverlessFunctionOwnerUser of serverlessFunctionOwnerUsers) {
      const serverlessFunctionId: ObjectID = serverlessFunctionOwnerUser.serverlessFunctionId!;
      const user: User = serverlessFunctionOwnerUser.user!;

      if (serverlessFunctionOwnersMap[serverlessFunctionId.toString()] === undefined) {
        serverlessFunctionOwnersMap[serverlessFunctionId.toString()] = [];
      }

      (serverlessFunctionOwnersMap[serverlessFunctionId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await ServerlessFunctionOwnerUserService.updateOneById({
        id: serverlessFunctionOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const serverlessFunctionId in serverlessFunctionOwnersMap) {
      if (!serverlessFunctionOwnersMap[serverlessFunctionId]) {
        continue;
      }

      if ((serverlessFunctionOwnersMap[serverlessFunctionId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = serverlessFunctionOwnersMap[serverlessFunctionId] as Array<User>;

      const serverlessFunction: ServerlessFunction | null = await ServerlessFunctionService.findOneById({
        id: new ObjectID(serverlessFunctionId),
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

      if (!serverlessFunction) {
        continue;
      }

      const viewFunctionLink: string = (
        await ServerlessFunctionService.getLinkInDashboard(serverlessFunction.projectId!, serverlessFunction.id!)
      ).toString();

      const vars: Dictionary<string> = {
        functionName: serverlessFunction.name!,
        functionDescription: serverlessFunction.description || "No description provided",
        projectName: serverlessFunction.project!.name!,
        viewFunctionLink: viewFunctionLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ServerlessFunctionOwnerAdded,
          vars: vars,
          subject: "[Serverless Function] Owner of " + serverlessFunction.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the serverless function: ${serverlessFunction.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the serverless function: ${serverlessFunction.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Serverless Function Owner",
            body: `You have been added as the owner of the serverless function: ${serverlessFunction.name!}. Click to view details.`,
            clickAction: viewFunctionLink,
            tag: "serverless-function-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_SERVERLESS_FUNCTION_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              function_name: serverlessFunction.name!,
              function_link: viewFunctionLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: serverlessFunction.projectId!,
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
