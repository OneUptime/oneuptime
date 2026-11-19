import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephClusterOwnerTeamService from "Common/Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "Common/Server/Services/CephClusterOwnerUserService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Ceph cluster owner rule, or a person on its Owners
 * page, made owners of a Ceph cluster (#9700), as every other record's new
 * owners are told (ResourceOwnersAdded). It waits while Ceph is switched off
 * on the server.
 */
runResourceOwnerAddedJob<CephCluster>({
  jobName: "CephClusterOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.CephClusterOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "CephClusterOwnerUser",
  recordIdColumn: "cephClusterId",
  teamService: CephClusterOwnerTeamService,
  userService: CephClusterOwnerUserService,
  recordService: CephClusterService,
  noun: "Ceph cluster",
  title: "Ceph Cluster",
  getLink: (projectId: ObjectID, cephCluster: CephCluster): Promise<URL> => {
    return CephClusterService.getCephClusterLinkInDashboard(
      projectId,
      cephCluster.id!,
    );
  },
});
