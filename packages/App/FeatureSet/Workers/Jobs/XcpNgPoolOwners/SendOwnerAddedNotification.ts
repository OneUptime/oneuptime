import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgPoolOwnerTeamService from "Common/Server/Services/XcpNgPoolOwnerTeamService";
import XcpNgPoolOwnerUserService from "Common/Server/Services/XcpNgPoolOwnerUserService";
import XcpNgPoolService from "Common/Server/Services/XcpNgPoolService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an XCP-ng pool owner rule, or a person on its Owners
 * page, made owners of an XCP-ng pool, as every other record's new owners
 * are told (ResourceOwnersAdded). It waits while XCP-ng is switched off on
 * the server.
 */
runResourceOwnerAddedJob<XcpNgPool>({
  jobName: "XcpNgPoolOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.XcpNgPoolOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "XcpNgPoolOwnerUser",
  recordIdColumn: "xcpNgPoolId",
  teamService: XcpNgPoolOwnerTeamService,
  userService: XcpNgPoolOwnerUserService,
  recordService: XcpNgPoolService,
  noun: "XCP-ng pool",
  title: "XCP-ng Pool",
  getLink: (projectId: ObjectID, xcpNgPool: XcpNgPool): Promise<URL> => {
    return XcpNgPoolService.getXcpNgPoolLinkInDashboard(
      projectId,
      xcpNgPool.id!,
    );
  },
});
