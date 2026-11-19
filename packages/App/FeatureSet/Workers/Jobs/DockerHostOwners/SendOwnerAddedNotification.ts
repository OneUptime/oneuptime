import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerHostOwnerTeamService from "Common/Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "Common/Server/Services/DockerHostOwnerUserService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Docker host owner rule, or a person on its Owners page,
 * made owners of a Docker host (#9700), as every other record's new owners
 * are told (ResourceOwnersAdded). It waits while Docker is switched off on
 * the server.
 */
runResourceOwnerAddedJob<DockerHost>({
  jobName: "DockerHostOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.DockerHostOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "DockerHostOwnerUser",
  recordIdColumn: "dockerHostId",
  teamService: DockerHostOwnerTeamService,
  userService: DockerHostOwnerUserService,
  recordService: DockerHostService,
  noun: "Docker host",
  title: "Docker Host",
  getLink: (projectId: ObjectID, dockerHost: DockerHost): Promise<URL> => {
    return DockerHostService.getDockerHostLinkInDashboard(
      projectId,
      dockerHost.id!,
    );
  },
});
