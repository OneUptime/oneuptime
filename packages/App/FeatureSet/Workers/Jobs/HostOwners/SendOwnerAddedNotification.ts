import Host from "Common/Models/DatabaseModels/Host";
import HostOwnerTeamService from "Common/Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "Common/Server/Services/HostOwnerUserService";
import HostService from "Common/Server/Services/HostService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a host owner rule, or a person on its Owners page, made
 * owners of a host (#9700), as every other record's new owners are told
 * (ResourceOwnersAdded). It waits while Hosts is switched off on the server.
 */
runResourceOwnerAddedJob<Host>({
  jobName: "HostOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.HostOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "HostOwnerUser",
  recordIdColumn: "hostId",
  teamService: HostOwnerTeamService,
  userService: HostOwnerUserService,
  recordService: HostService,
  noun: "host",
  title: "Host",
  getLink: (projectId: ObjectID, host: Host): Promise<URL> => {
    return HostService.getHostLinkInDashboard(projectId, host.id!);
  },
});
