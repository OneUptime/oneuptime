import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
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
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  OwnerRowAdded,
  ownersToTell,
  planOwnersAdded,
} from "../../Utils/OwnersAdded";

RunCron(
  "NetworkDeviceOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the network device as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.NetworkDeviceOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const networkDevice: NetworkDevice | null = await readNetworkDevice(
          delivery.notification.resourceId,
        );

        if (!networkDevice) {
          await delivery.giveUp("the network device is gone");
          return;
        }

        await notifyOwnersAdded({
          networkDevice: networkDevice,
          deliveries: [delivery],
        });
      },
    });

    const deviceOwnerTeams: Array<NetworkDeviceOwnerTeam> =
      await NetworkDeviceOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          networkDeviceId: true,
          teamId: true,
        },
      });

    const deviceOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const deviceOwnerTeam of deviceOwnerTeams) {
      const networkDeviceId: ObjectID = deviceOwnerTeam.networkDeviceId!;
      const teamId: ObjectID = deviceOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (deviceOwnersMap[networkDeviceId.toString()] === undefined) {
        deviceOwnersMap[networkDeviceId.toString()] = [];
      }

      (
        deviceOwnersMap[networkDeviceId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: deviceOwnerTeam.id!,
        isTeam: true,
        users: users,
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
        skip: 0,
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

      (
        deviceOwnersMap[networkDeviceId.toString()] as Array<OwnerRowAdded>
      ).push({
        ownerRowId: deviceOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const networkDeviceId in deviceOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> =
        deviceOwnersMap[networkDeviceId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const networkDevice: NetworkDevice | null = await readNetworkDevice(
        new ObjectID(networkDeviceId),
      );

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = networkDevice
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.NetworkDeviceOwnerAdded,
            projectId: networkDevice.projectId!,
            resourceId: networkDevice.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose network device is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await NetworkDeviceOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await NetworkDeviceOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!networkDevice) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          networkDevice: networkDevice,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error(
          "Error in sending network device owner added notification",
          {
            projectId: networkDevice.projectId?.toString(),
            networkDeviceId: networkDevice.id?.toString(),
          },
        );
        logger.error(e, {
          projectId: networkDevice.projectId?.toString(),
          networkDeviceId: networkDevice.id?.toString(),
        });
      }
    }
  },
);

async function readNetworkDevice(
  networkDeviceId: ObjectID,
): Promise<NetworkDevice | null> {
  return await NetworkDeviceService.findOneById({
    id: networkDeviceId,
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
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * network device, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  networkDevice: NetworkDevice;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const networkDevice: NetworkDevice = data.networkDevice;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
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

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.SimpleMessage,
          vars: vars,
          subject: emailSubject,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the network device - ${networkDevice.name}.`,
          ),
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
      });
    }
  }
}
