import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyOwnerTeamService from "Common/Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "Common/Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import URL from "Common/Types/API/URL";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import {
  getRecordLinkInDashboard,
  runResourceOwnerAddedJob,
} from "../../Utils/ResourceOwnersAdded";

/*
 * Tells the people an incoming call policy owner rule, or a person on its
 * Owners page, made owners of an incoming call policy (#9700), as every
 * other record's new owners are told (ResourceOwnersAdded). It waits while
 * On-Call is switched off on the server.
 */
runResourceOwnerAddedJob<IncomingCallPolicy>({
  jobName: "IncomingCallPolicyOwner:SendOwnerAddedNotification",
  kind: OwnerNotificationKind.IncomingCallPolicyOwnerAdded,
  eventType:
    NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
  ownerTableName: "IncomingCallPolicyOwnerUser",
  recordIdColumn: "incomingCallPolicyId",
  teamService: IncomingCallPolicyOwnerTeamService,
  userService: IncomingCallPolicyOwnerUserService,
  recordService: IncomingCallPolicyService,
  noun: "incoming call policy",
  title: "Incoming Call Policy",
  getLink: (
    projectId: ObjectID,
    incomingCallPolicy: IncomingCallPolicy,
  ): Promise<URL> => {
    return getRecordLinkInDashboard(
      projectId,
      `on-call-duty/incoming-call-policies/${incomingCallPolicy.id!.toString()}`,
    );
  },
  ownershipNote:
    "You are told when a call to this incoming call policy reaches nobody.",
});
