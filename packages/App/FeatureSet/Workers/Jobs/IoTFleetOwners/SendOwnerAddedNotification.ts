import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import IoTFleetOwnerTeamService from "Common/Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "Common/Server/Services/IoTFleetOwnerUserService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an IoT fleet owner rule, or a person on its Owners page,
 * made owners of an IoT fleet (#9700), as every other record's new owners
 * are told (ResourceOwnersAdded). It waits while IoT is switched off on the
 * server.
 */
runResourceOwnerAddedJob<IoTFleet>({
  jobName: "IoTFleetOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.IoTFleetOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "IoTFleetOwnerUser",
  recordIdColumn: "iotFleetId",
  teamService: IoTFleetOwnerTeamService,
  userService: IoTFleetOwnerUserService,
  recordService: IoTFleetService,
  noun: "IoT fleet",
  title: "IoT Fleet",
  getLink: (projectId: ObjectID, iotFleet: IoTFleet): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `iot/${iotFleet.id!.toString()}`,
    );
  },
});
