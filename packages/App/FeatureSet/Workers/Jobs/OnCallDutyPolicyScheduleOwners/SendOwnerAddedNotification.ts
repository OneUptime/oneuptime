import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an on-call schedule owner rule, or a person on its Owners
 * page, made owners of an on-call schedule (#9700), as every other record's
 * new owners are told (ResourceOwnersAdded). It waits while On-Call is
 * switched off on the server.
 */
runResourceOwnerAddedJob<OnCallDutyPolicySchedule>({
  jobName: "OnCallDutyPolicyScheduleOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.OnCallDutyPolicyScheduleOwnerAdded,
  eventType: NotificationSettingEventType.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "OnCallDutyPolicyScheduleOwnerUser",
  recordIdColumn: "onCallDutyPolicyScheduleId",
  teamService: OnCallDutyPolicyScheduleOwnerTeamService,
  userService: OnCallDutyPolicyScheduleOwnerUserService,
  recordService: OnCallDutyPolicyScheduleService,
  noun: "on-call schedule",
  title: "On-Call Schedule",
  getLink: (projectId: ObjectID, onCallDutyPolicySchedule: OnCallDutyPolicySchedule): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `on-call-duty/schedules/${onCallDutyPolicySchedule.id!.toString()}`,
    );
  },
});
