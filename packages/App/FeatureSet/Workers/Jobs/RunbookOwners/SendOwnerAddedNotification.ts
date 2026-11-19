import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookOwnerTeamService from "Common/Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "Common/Server/Services/RunbookOwnerUserService";
import RunbookService from "Common/Server/Services/RunbookService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a runbook owner rule, or a person on its Owners page,
 * made owners of a runbook (#9700), as every other record's new owners are
 * told (ResourceOwnersAdded). It waits while Runbooks is switched off on the
 * server.
 */
runResourceOwnerAddedJob<Runbook>({
  jobName: "RunbookOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.RunbookOwnerAdded,
  eventType: NotificationSettingEventType.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "RunbookOwnerUser",
  recordIdColumn: "runbookId",
  teamService: RunbookOwnerTeamService,
  userService: RunbookOwnerUserService,
  recordService: RunbookService,
  noun: "runbook",
  title: "Runbook",
  getLink: (projectId: ObjectID, runbook: Runbook): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `runbooks/${runbook.id!.toString()}`,
    );
  },
});
