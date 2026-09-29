import PushNotificationRequest from "Common/Types/PushNotification/PushNotificationRequest";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationServiceCommon from "Common/Server/Services/PushNotificationService";

export default class PushNotificationService {
  public static async send(
    request: PushNotificationRequest,
    options: {
      projectId?: ObjectID | undefined;
      isSensitive?: boolean;
      userOnCallLogTimelineId?: ObjectID | undefined;
      incidentId?: ObjectID | undefined;
      alertId?: ObjectID | undefined;
      scheduledMaintenanceId?: ObjectID | undefined;
      statusPageId?: ObjectID | undefined;
      statusPageAnnouncementId?: ObjectID | undefined;
      userId?: ObjectID | undefined;
      onCallPolicyId?: ObjectID | undefined;
      onCallPolicyEscalationRuleId?: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
      onCallScheduleId?: ObjectID | undefined;
      teamId?: ObjectID | undefined;
    } = {},
  ): Promise<void> {
    // Delegate to Common service which now handles logging and timeline updates
    await PushNotificationServiceCommon.sendPushNotification(request, {
      projectId: options.projectId,
      isSensitive: Boolean(options.isSensitive),
      userOnCallLogTimelineId: options.userOnCallLogTimelineId,
      incidentId: options.incidentId,
      alertId: options.alertId,
      scheduledMaintenanceId: options.scheduledMaintenanceId,
      statusPageId: options.statusPageId,
      statusPageAnnouncementId: options.statusPageAnnouncementId,
      userId: options.userId,
      onCallPolicyId: options.onCallPolicyId,
      onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
      onCallDutyPolicyExecutionLogTimelineId:
        options.onCallDutyPolicyExecutionLogTimelineId,
      onCallScheduleId: options.onCallScheduleId,
      teamId: options.teamId,
    });
  }
}
