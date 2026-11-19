import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import StorageArrayOwnerTeamService from "Common/Server/Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "Common/Server/Services/StorageArrayOwnerUserService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a storage array owner rule, or a person on its Owners
 * page, made owners of a storage array (#9700), as every other record's new
 * owners are told (ResourceOwnersAdded). It waits while Storage Arrays is
 * switched off on the server.
 */
runResourceOwnerAddedJob<StorageArray>({
  jobName: "StorageArrayOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.StorageArrayOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "StorageArrayOwnerUser",
  recordIdColumn: "storageArrayId",
  teamService: StorageArrayOwnerTeamService,
  userService: StorageArrayOwnerUserService,
  recordService: StorageArrayService,
  noun: "storage array",
  title: "Storage Array",
  getLink: (projectId: ObjectID, storageArray: StorageArray): Promise<URL> => {
    return StorageArrayService.getStorageArrayLinkInDashboard(projectId, storageArray.id!);
  },
});
