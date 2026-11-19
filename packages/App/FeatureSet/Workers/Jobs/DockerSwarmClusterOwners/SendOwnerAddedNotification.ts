import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterOwnerTeamService from "Common/Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "Common/Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Docker Swarm cluster owner rule, or a person on its
 * Owners page, made owners of a Docker Swarm cluster (#9700), as every other
 * record's new owners are told (ResourceOwnersAdded). It waits while Docker
 * Swarm is switched off on the server.
 */
runResourceOwnerAddedJob<DockerSwarmCluster>({
  jobName: "DockerSwarmClusterOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.DockerSwarmClusterOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "DockerSwarmClusterOwnerUser",
  recordIdColumn: "dockerSwarmClusterId",
  teamService: DockerSwarmClusterOwnerTeamService,
  userService: DockerSwarmClusterOwnerUserService,
  recordService: DockerSwarmClusterService,
  noun: "Docker Swarm cluster",
  title: "Docker Swarm Cluster",
  getLink: (
    projectId: ObjectID,
    dockerSwarmCluster: DockerSwarmCluster,
  ): Promise<URL> => {
    return DockerSwarmClusterService.getDockerSwarmClusterLinkInDashboard(
      projectId,
      dockerSwarmCluster.id!,
    );
  },
});
