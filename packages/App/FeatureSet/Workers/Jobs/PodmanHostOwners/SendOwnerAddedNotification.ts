import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerTeamService from "Common/Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "Common/Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Podman host owner rule, or a person on its Owners page,
 * made owners of a Podman host (#9700), as every other record's new owners
 * are told (ResourceOwnersAdded). It waits while Podman is switched off on
 * the server.
 */
runResourceOwnerAddedJob<PodmanHost>({
  jobName: "PodmanHostOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.PodmanHostOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "PodmanHostOwnerUser",
  recordIdColumn: "podmanHostId",
  teamService: PodmanHostOwnerTeamService,
  userService: PodmanHostOwnerUserService,
  recordService: PodmanHostService,
  noun: "Podman host",
  title: "Podman Host",
  getLink: (projectId: ObjectID, podmanHost: PodmanHost): Promise<URL> => {
    return PodmanHostService.getPodmanHostLinkInDashboard(
      projectId,
      podmanHost.id!,
    );
  },
});
