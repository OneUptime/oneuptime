import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import URL from "Common/Types/API/URL";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOwnerTeam from "Common/Models/DatabaseModels/NetworkDeviceOwnerTeam";
import NetworkDeviceOwnerUser from "Common/Models/DatabaseModels/NetworkDeviceOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "NetworkDeviceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const deviceOwnerTeams: Array<NetworkDeviceOwnerTeam> =
      await NetworkDeviceOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          networkDeviceId: true,
          teamId: true,
        },
      });

    const deviceOwnersMap: Dictionary<Array<User>> = {};

    for (const deviceOwnerTeam of deviceOwnerTeams) {
      const networkDeviceId: ObjectID = deviceOwnerTeam.networkDeviceId!;
      const teamId: ObjectID = deviceOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (deviceOwnersMap[networkDeviceId.toString()] === undefined) {
        deviceOwnersMap[networkDeviceId.toString()] = [];
      }

      for (const user of users) {
        (deviceOwnersMap[networkDeviceId.toString()] as Array<User>).push(
          user,
        );
      }

      // mark this as notified.
      await NetworkDeviceOwnerTeamService.updateOneById({
        id: deviceOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const deviceOwnerUsers: Array<NetworkDeviceOwnerUser> =
      await NetworkDeviceOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          networkDeviceId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const deviceOwnerUser of deviceOwnerUsers) {
      const networkDeviceId: ObjectID = deviceOwnerUser.networkDeviceId!;
      const user: User = deviceOwnerUser.user!;

      if (deviceOwnersMap[networkDeviceId.toString()] === undefined) {
        deviceOwnersMap[networkDeviceId.toString()] = [];
      }

      (deviceOwnersMap[networkDeviceId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await NetworkDeviceOwnerUserService.updateOneById({
        id: deviceOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const networkDeviceId in deviceOwnersMap) {
      if (!deviceOwnersMap[networkDeviceId]) {
        continue;
      }

      if ((deviceOwnersMap[networkDeviceId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = deviceOwnersMap[
        networkDeviceId
      ] as Array<User>;

      const networkDevice: NetworkDevice | null =
        await NetworkDeviceService.findOneById({
          id: new ObjectID(networkDeviceId),
          props: {
            isRoot: true,
          },

          select: {
            _id: true,
            name: true,
            projectId: true,
            project: {
              name: true,
            },
          },
        });

      if (!networkDevice) {
        continue;
      }

      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
      const deviceViewLink: string = URL.fromString(dashboardUrl.toString())
        .addRoute(
          `/${networkDevice.projectId!.toString()}/network-devices/${networkDevice.id!.toString()}`,
        )
        .toString();

      const emailSubject: string =
        "You have been added as the owner of the network device.";

      const vars: Dictionary<string> = {
        subject: emailSubject,
        message: `You have been added as the owner of the network device ${networkDevice.name!} in the project ${networkDevice.project!.name!}. You can view the device here: ${deviceViewLink}`,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.SimpleMessage,
          vars: vars,
          subject: emailSubject,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the network device - ${networkDevice.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the network device ${networkDevice.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Network Device Owner",
            body: `You have been added as the owner of the network device: ${networkDevice.name}. Click to view details.`,
            clickAction: deviceViewLink,
            tag: "network-device-owner-added",
            requireInteraction: false,
          });

        /*
         * There is no dedicated network-device notification setting yet, so
         * device ownership rides on the monitor owner-added preference —
         * network devices are monitored resources and every user gets this
         * setting by default.
         */
        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_MONITOR_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              monitor_name: networkDevice.name!,
              monitor_link: deviceViewLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: networkDevice.projectId!,
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
