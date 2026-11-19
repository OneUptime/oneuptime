import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterOwnerTeamService from "Common/Server/Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "Common/Server/Services/VMwareVCenterOwnerUserService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a VMware vCenter owner rule, or a person on its Owners
 * page, made owners of a VMware vCenter (#9700), as every other record's new
 * owners are told (ResourceOwnersAdded). It waits while VMware is switched
 * off on the server.
 */
runResourceOwnerAddedJob<VMwareVCenter>({
  jobName: "VMwareVCenterOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.VMwareVCenterOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "VMwareVCenterOwnerUser",
  recordIdColumn: "vmwareVCenterId",
  teamService: VMwareVCenterOwnerTeamService,
  userService: VMwareVCenterOwnerUserService,
  recordService: VMwareVCenterService,
  noun: "VMware vCenter",
  title: "VMware vCenter",
  getLink: (projectId: ObjectID, vmwareVCenter: VMwareVCenter): Promise<URL> => {
    return VMwareVCenterService.getVMwareVCenterLinkInDashboard(projectId, vmwareVCenter.id!);
  },
});
