import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupOwnerTeamService from "Common/Server/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "Common/Server/Services/MonitorGroupOwnerUserService";
import MonitorGroupService from "Common/Server/Services/MonitorGroupService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a person on a monitor group's Owners page made its owners
 * (#9758), as every other record's new owners are told (ResourceOwnersAdded):
 * the rows were written not told yet, and no job read them, so nobody was.
 * Told through their own Added as monitor group owner setting, on the
 * Monitors card. It waits while Monitors is switched off on the server.
 */
runResourceOwnerAddedJob<MonitorGroup>({
  jobName: "MonitorGroupOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.MonitorGroupOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "MonitorGroupOwnerUser",
  recordIdColumn: "monitorGroupId",
  teamService: MonitorGroupOwnerTeamService,
  userService: MonitorGroupOwnerUserService,
  recordService: MonitorGroupService,
  noun: "monitor group",
  title: "Monitor Group",
  getLink: (projectId: ObjectID, monitorGroup: MonitorGroup): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `monitor-groups/${monitorGroup.id!.toString()}`,
    );
  },
});
