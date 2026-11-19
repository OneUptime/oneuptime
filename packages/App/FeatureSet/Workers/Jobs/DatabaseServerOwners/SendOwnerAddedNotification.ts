import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerOwnerTeamService from "Common/Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "Common/Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a database owner rule, or a person on its Owners page,
 * made owners of a database (#9700), as every other record's new owners are
 * told (ResourceOwnersAdded). It waits while Databases is switched off on
 * the server.
 */
runResourceOwnerAddedJob<DatabaseServer>({
  jobName: "DatabaseServerOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.DatabaseServerOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "DatabaseServerOwnerUser",
  recordIdColumn: "databaseServerId",
  teamService: DatabaseServerOwnerTeamService,
  userService: DatabaseServerOwnerUserService,
  recordService: DatabaseServerService,
  noun: "database",
  title: "Database",
  getLink: (projectId: ObjectID, databaseServer: DatabaseServer): Promise<URL> => {
    return DatabaseServerService.getDatabaseServerLinkInDashboard(projectId, databaseServer.id!);
  },
});
