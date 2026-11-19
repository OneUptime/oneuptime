import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudResourceOwnerTeamService from "Common/Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "Common/Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import URL from "Common/Types/API/URL";
import {
  getCloudResourceDashboardPath,
  getCloudResourceKindNoun,
} from "Common/Types/Cloud/CloudResourceKind";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a cloud resource or cloud environment owner rule, or a
 * person on its Owners page, made owners of a cloud resource or cloud
 * environment (#9700), as every other record's new owners are told
 * (ResourceOwnersAdded). It waits only while Cloud and App Platforms are
 * both switched off on the server: a cloud resource is both products'.
 */
runResourceOwnerAddedJob<CloudResource>({
  jobName: "CloudResourceOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.CloudResourceOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "CloudResourceOwnerUser",
  recordIdColumn: "cloudResourceId",
  teamService: CloudResourceOwnerTeamService,
  userService: CloudResourceOwnerUserService,
  recordService: CloudResourceService,
  // Which it is: a resource in Cloud, or an environment in App Platforms.
  recordSelect: {
    cloudResourceKind: true,
  },
  noun: (cloudResource: CloudResource): string => {
    return getCloudResourceKindNoun(
      cloudResource.cloudResourceKind,
    ).toLowerCase();
  },
  title: (cloudResource: CloudResource): string => {
    return getCloudResourceKindNoun(cloudResource.cloudResourceKind);
  },
  getLink: (
    projectId: ObjectID,
    cloudResource: CloudResource,
  ): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      getCloudResourceDashboardPath({
        cloudResourceId: cloudResource.id!.toString(),
        cloudResourceKind: cloudResource.cloudResourceKind || null,
      }),
    );
  },
});
