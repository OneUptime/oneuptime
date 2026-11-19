import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import RumApplicationOwnerTeamService from "Common/Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "Common/Server/Services/RumApplicationOwnerUserService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a RUM application owner rule, or a person on its Owners
 * page, made owners of a RUM application (#9700), as every other record's
 * new owners are told (ResourceOwnersAdded). It waits while Real User
 * Monitoring is switched off on the server.
 */
runResourceOwnerAddedJob<RumApplication>({
  jobName: "RumApplicationOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.RumApplicationOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "RumApplicationOwnerUser",
  recordIdColumn: "rumApplicationId",
  teamService: RumApplicationOwnerTeamService,
  userService: RumApplicationOwnerUserService,
  recordService: RumApplicationService,
  noun: "RUM application",
  title: "RUM Application",
  getLink: (
    projectId: ObjectID,
    rumApplication: RumApplication,
  ): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `rum/${rumApplication.id!.toString()}`,
    );
  },
});
