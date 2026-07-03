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
import IoTFleetOwnerTeamService from "Common/Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "Common/Server/Services/IoTFleetOwnerUserService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTFleetOwnerTeam from "Common/Models/DatabaseModels/IoTFleetOwnerTeam";
import IoTFleetOwnerUser from "Common/Models/DatabaseModels/IoTFleetOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "IoTFleetOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const iotFleetOwnerTeams: Array<IoTFleetOwnerTeam> =
      await IoTFleetOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          iotFleetId: true,
          teamId: true,
        },
      });

    const iotFleetOwnersMap: Dictionary<Array<User>> = {};

    for (const iotFleetOwnerTeam of iotFleetOwnerTeams) {
      const iotFleetId: ObjectID = iotFleetOwnerTeam.iotFleetId!;
      const teamId: ObjectID = iotFleetOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (iotFleetOwnersMap[iotFleetId.toString()] === undefined) {
        iotFleetOwnersMap[iotFleetId.toString()] = [];
      }

      for (const user of users) {
        (iotFleetOwnersMap[iotFleetId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await IoTFleetOwnerTeamService.updateOneById({
        id: iotFleetOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const iotFleetOwnerUsers: Array<IoTFleetOwnerUser> =
      await IoTFleetOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          iotFleetId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const iotFleetOwnerUser of iotFleetOwnerUsers) {
      const iotFleetId: ObjectID = iotFleetOwnerUser.iotFleetId!;
      const user: User = iotFleetOwnerUser.user!;

      if (iotFleetOwnersMap[iotFleetId.toString()] === undefined) {
        iotFleetOwnersMap[iotFleetId.toString()] = [];
      }

      (iotFleetOwnersMap[iotFleetId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await IoTFleetOwnerUserService.updateOneById({
        id: iotFleetOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const iotFleetId in iotFleetOwnersMap) {
      if (!iotFleetOwnersMap[iotFleetId]) {
        continue;
      }

      if ((iotFleetOwnersMap[iotFleetId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = iotFleetOwnersMap[iotFleetId] as Array<User>;

      const iotFleet: IoTFleet | null = await IoTFleetService.findOneById({
        id: new ObjectID(iotFleetId),
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

      if (!iotFleet) {
        continue;
      }

      const viewFleetLink: string = (
        await IoTFleetService.getLinkInDashboard(
          iotFleet.projectId!,
          iotFleet.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        fleetName: iotFleet.name!,
        fleetDescription: iotFleet.description || "No description provided",
        projectName: iotFleet.project!.name!,
        viewFleetLink: viewFleetLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IoTFleetOwnerAdded,
          vars: vars,
          subject: "[IoT Fleet] Owner of " + iotFleet.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the IoT fleet: ${iotFleet.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the IoT fleet: ${iotFleet.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as IoT Fleet Owner",
            body: `You have been added as the owner of the IoT fleet: ${iotFleet.name!}. Click to view details.`,
            clickAction: viewFleetLink,
            tag: "iot-fleet-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_IOT_FLEET_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              fleet_name: iotFleet.name!,
              fleet_link: viewFleetLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: iotFleet.projectId!,
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
