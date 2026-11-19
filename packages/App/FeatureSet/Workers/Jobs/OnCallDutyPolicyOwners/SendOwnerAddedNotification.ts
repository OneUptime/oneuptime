import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { runResourceOwnerAddedJob } from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an on-call policy owner rule, or a person on its Owners
 * page, made owners of an on-call policy (#9700), as every other record's
 * new owners are told (ResourceOwnersAdded). It waits while On-Call is
 * switched off on the server.
 */
runResourceOwnerAddedJob<OnCallDutyPolicy>({
  jobName: "OnCallDutyPolicyOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.OnCallDutyPolicyOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "OnCallDutyPolicyOwnerUser",
  recordIdColumn: "onCallDutyPolicyId",
  teamService: OnCallDutyPolicyOwnerTeamService,
  userService: OnCallDutyPolicyOwnerUserService,
  recordService: OnCallDutyPolicyService,
  noun: "on-call policy",
  title: "On-Call Policy",
  getLink: (
    projectId: ObjectID,
    onCallDutyPolicy: OnCallDutyPolicy,
  ): Promise<URL> => {
    return OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
      projectId,
      onCallDutyPolicy.id!,
    );
  },
  ownershipNote:
    "You are told when a page this on-call policy sends cannot reach someone the way they asked to be reached.",
});
