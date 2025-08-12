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
    });
  }
}
