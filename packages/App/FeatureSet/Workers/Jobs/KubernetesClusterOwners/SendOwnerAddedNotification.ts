import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerTeamService from "Common/Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "Common/Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a Kubernetes cluster owner rule, or a person on its
 * Owners page, made owners of a Kubernetes cluster (#9700), as every other
 * record's new owners are told (ResourceOwnersAdded). It waits while
 * Kubernetes is switched off on the server.
 */
runResourceOwnerAddedJob<KubernetesCluster>({
  jobName: "KubernetesClusterOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.KubernetesClusterOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "KubernetesClusterOwnerUser",
  recordIdColumn: "kubernetesClusterId",
  teamService: KubernetesClusterOwnerTeamService,
  userService: KubernetesClusterOwnerUserService,
  recordService: KubernetesClusterService,
  noun: "Kubernetes cluster",
  title: "Kubernetes Cluster",
  getLink: (
    projectId: ObjectID,
    kubernetesCluster: KubernetesCluster,
  ): Promise<URL> => {
    return KubernetesClusterService.getKubernetesClusterLinkInDashboard(
      projectId,
      kubernetesCluster.id!,
    );
  },
});
