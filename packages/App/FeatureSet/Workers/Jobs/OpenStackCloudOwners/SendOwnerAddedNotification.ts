import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudOwnerTeamService from "Common/Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "Common/Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an OpenStack cloud owner rule, or a person on its Owners
 * page, made owners of an OpenStack cloud (#9700), as every other record's
 * new owners are told (ResourceOwnersAdded). It waits while OpenStack is
 * switched off on the server.
 */
runResourceOwnerAddedJob<OpenStackCloud>({
  jobName: "OpenStackCloudOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.OpenStackCloudOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "OpenStackCloudOwnerUser",
  recordIdColumn: "openStackCloudId",
  teamService: OpenStackCloudOwnerTeamService,
  userService: OpenStackCloudOwnerUserService,
  recordService: OpenStackCloudService,
  noun: "OpenStack cloud",
  title: "OpenStack Cloud",
  getLink: (projectId: ObjectID, openStackCloud: OpenStackCloud): Promise<URL> => {
    return OpenStackCloudService.getOpenStackCloudLinkInDashboard(projectId, openStackCloud.id!);
  },
});
