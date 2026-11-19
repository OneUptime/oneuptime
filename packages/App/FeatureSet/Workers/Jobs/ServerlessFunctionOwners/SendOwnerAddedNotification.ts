import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ServerlessFunctionOwnerTeamService from "Common/Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "Common/Server/Services/ServerlessFunctionOwnerUserService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a serverless function owner rule, or a person on its
 * Owners page, made owners of a serverless function (#9700), as every other
 * record's new owners are told (ResourceOwnersAdded). It waits while
 * Serverless is switched off on the server.
 */
runResourceOwnerAddedJob<ServerlessFunction>({
  jobName: "ServerlessFunctionOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.ServerlessFunctionOwnerAdded,
  eventType: NotificationSettingEventType.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "ServerlessFunctionOwnerUser",
  recordIdColumn: "serverlessFunctionId",
  teamService: ServerlessFunctionOwnerTeamService,
  userService: ServerlessFunctionOwnerUserService,
  recordService: ServerlessFunctionService,
  noun: "serverless function",
  title: "Serverless Function",
  getLink: (projectId: ObjectID, serverlessFunction: ServerlessFunction): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `serverless/${serverlessFunction.id!.toString()}`,
    );
  },
});
