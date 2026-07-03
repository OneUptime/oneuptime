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
import RumApplicationOwnerTeamService from "Common/Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "Common/Server/Services/RumApplicationOwnerUserService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationOwnerTeam from "Common/Models/DatabaseModels/RumApplicationOwnerTeam";
import RumApplicationOwnerUser from "Common/Models/DatabaseModels/RumApplicationOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "RumApplicationOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const rumApplicationOwnerTeams: Array<RumApplicationOwnerTeam> =
      await RumApplicationOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          rumApplicationId: true,
          teamId: true,
        },
      });

    const rumApplicationOwnersMap: Dictionary<Array<User>> = {};

    for (const rumApplicationOwnerTeam of rumApplicationOwnerTeams) {
      const rumApplicationId: ObjectID = rumApplicationOwnerTeam.rumApplicationId!;
      const teamId: ObjectID = rumApplicationOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (rumApplicationOwnersMap[rumApplicationId.toString()] === undefined) {
        rumApplicationOwnersMap[rumApplicationId.toString()] = [];
      }

      for (const user of users) {
        (rumApplicationOwnersMap[rumApplicationId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await RumApplicationOwnerTeamService.updateOneById({
        id: rumApplicationOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const rumApplicationOwnerUsers: Array<RumApplicationOwnerUser> =
      await RumApplicationOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          rumApplicationId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const rumApplicationOwnerUser of rumApplicationOwnerUsers) {
      const rumApplicationId: ObjectID = rumApplicationOwnerUser.rumApplicationId!;
      const user: User = rumApplicationOwnerUser.user!;

      if (rumApplicationOwnersMap[rumApplicationId.toString()] === undefined) {
        rumApplicationOwnersMap[rumApplicationId.toString()] = [];
      }

      (rumApplicationOwnersMap[rumApplicationId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await RumApplicationOwnerUserService.updateOneById({
        id: rumApplicationOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const rumApplicationId in rumApplicationOwnersMap) {
      if (!rumApplicationOwnersMap[rumApplicationId]) {
        continue;
      }

      if ((rumApplicationOwnersMap[rumApplicationId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = rumApplicationOwnersMap[rumApplicationId] as Array<User>;

      const rumApplication: RumApplication | null = await RumApplicationService.findOneById({
        id: new ObjectID(rumApplicationId),
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

      if (!rumApplication) {
        continue;
      }

      const viewApplicationLink: string = (
        await RumApplicationService.getLinkInDashboard(rumApplication.projectId!, rumApplication.id!)
      ).toString();

      const vars: Dictionary<string> = {
        applicationName: rumApplication.name!,
        applicationDescription: rumApplication.description || "No description provided",
        projectName: rumApplication.project!.name!,
        viewApplicationLink: viewApplicationLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.RumApplicationOwnerAdded,
          vars: vars,
          subject: "[RUM Application] Owner of " + rumApplication.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the RUM application: ${rumApplication.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the RUM application: ${rumApplication.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as RUM Application Owner",
            body: `You have been added as the owner of the RUM application: ${rumApplication.name!}. Click to view details.`,
            clickAction: viewApplicationLink,
            tag: "rum-application-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_RUM_APPLICATION_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              application_name: rumApplication.name!,
              application_link: viewApplicationLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: rumApplication.projectId!,
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
