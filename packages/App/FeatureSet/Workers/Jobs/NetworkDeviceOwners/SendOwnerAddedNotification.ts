import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a network device owner rule, or a person on its Owners
 * page, made owners of a network device, as every other record's new
 * owners are told (ResourceOwnersAdded). It waits while Network is switched
 * off on the server.
 *
 * A network device is infrastructure, so its owners are told through the
 * one setting for every service and piece of infrastructure (#9700), on by
 * email for every member. It used to borrow "Added as monitor owner", which
 * starts off and which no member was given, so most owners were never
 * told; and a WhatsApp template written for monitors, which called the
 * device a monitor.
 */
runResourceOwnerAddedJob<NetworkDevice>({
  // The name it always ran under, so its lock and its history carry on.
  jobName: "NetworkDeviceOwner:SendOwnerAddedEmail",
  kind: OwnerNotificationKind.NetworkDeviceOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "NetworkDeviceOwnerUser",
  recordIdColumn: "networkDeviceId",
  teamService: NetworkDeviceOwnerTeamService,
  userService: NetworkDeviceOwnerUserService,
  recordService: NetworkDeviceService,
  noun: "network device",
  title: "Network Device",
  getLink: (
    projectId: ObjectID,
    networkDevice: NetworkDevice,
  ): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `network-devices/${networkDevice.id!.toString()}`,
    );
  },
});
