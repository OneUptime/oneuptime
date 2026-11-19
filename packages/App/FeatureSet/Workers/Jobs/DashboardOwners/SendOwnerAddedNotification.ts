import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardOwnerTeamService from "Common/Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "Common/Server/Services/DashboardOwnerUserService";
import DashboardService from "Common/Server/Services/DashboardService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people a dashboard owner rule, or a person on its Owners page,
 * made owners of a dashboard (#9700), as every other record's new owners are
 * told (ResourceOwnersAdded). It waits while Dashboards is switched off on
 * the server.
 */
runResourceOwnerAddedJob<Dashboard>({
  jobName: "DashboardOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.DashboardOwnerAdded,
  eventType: NotificationSettingEventType.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "DashboardOwnerUser",
  recordIdColumn: "dashboardId",
  teamService: DashboardOwnerTeamService,
  userService: DashboardOwnerUserService,
  recordService: DashboardService,
  noun: "dashboard",
  title: "Dashboard",
  getLink: (projectId: ObjectID, dashboard: Dashboard): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `dashboards/${dashboard.id!.toString()}`,
    );
  },
});
