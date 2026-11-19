import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerOwnerTeamService from "Common/Server/Services/RunnerOwnerTeamService";
import RunnerOwnerUserService from "Common/Server/Services/RunnerOwnerUserService";
import RunnerService from "Common/Server/Services/RunnerService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a person on a runner's Owners card made its owners
 * (#9758), as every other record's new owners are told (ResourceOwnersAdded):
 * the rows were written not told yet, and no job read them, so nobody was.
 * Told through their own Added as Runner owner setting, on the Dashboards &
 * Automation card. A runner runs runbooks' steps and AI code fixes, so it
 * waits only while both Runbooks and Code are switched off on the server.
 */
runResourceOwnerAddedJob<Runner>({
  jobName: "RunnerOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.RunnerOwnerAdded,
  eventType: NotificationSettingEventType.SEND_RUNNER_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "RunnerOwnerUser",
  recordIdColumn: "runnerId",
  teamService: RunnerOwnerTeamService,
  userService: RunnerOwnerUserService,
  recordService: RunnerService,
  noun: "Runner",
  title: "Runner",
  getLink: (projectId: ObjectID, runner: Runner): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `runbooks/runners/${runner.id!.toString()}`,
    );
  },
});
