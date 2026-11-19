import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterOwnerTeamService from "Common/Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "Common/Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Proxmox cluster owner rule, or a person on its Owners
 * page, made owners of a Proxmox cluster (#9700), as every other record's
 * new owners are told (ResourceOwnersAdded). It waits while Proxmox is
 * switched off on the server.
 */
runResourceOwnerAddedJob<ProxmoxCluster>({
  jobName: "ProxmoxClusterOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.ProxmoxClusterOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "ProxmoxClusterOwnerUser",
  recordIdColumn: "proxmoxClusterId",
  teamService: ProxmoxClusterOwnerTeamService,
  userService: ProxmoxClusterOwnerUserService,
  recordService: ProxmoxClusterService,
  noun: "Proxmox cluster",
  title: "Proxmox Cluster",
  getLink: (
    projectId: ObjectID,
    proxmoxCluster: ProxmoxCluster,
  ): Promise<URL> => {
    return ProxmoxClusterService.getProxmoxClusterLinkInDashboard(
      projectId,
      proxmoxCluster.id!,
    );
  },
});
