import PushNotificationRequest from "Common/Types/PushNotification/PushNotificationRequest";
import ObjectID from "Common/Types/ObjectID";
import PushNotificationServiceCommon from "Common/Server/Services/PushNotificationService";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import PushNotificationLogService from "Common/Server/Services/PushNotificationLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import PushStatus from "Common/Types/PushNotification/PushStatus";

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
    const log: PushNotificationLog = new PushNotificationLog();

    if (options.projectId) {
      log.projectId = options.projectId;
    }

    log.title = request.message.title || "";
    log.body = options.isSensitive
      ? "Sensitive message not logged"
      : request.message.body || "";
    log.deviceType = request.deviceType;

    if (options.incidentId) {
      log.incidentId = options.incidentId;
    }
    if (options.alertId) {
      log.alertId = options.alertId;
    }
    if (options.scheduledMaintenanceId) {
      log.scheduledMaintenanceId = options.scheduledMaintenanceId;
    }
    if (options.statusPageId) {
      log.statusPageId = options.statusPageId;
    }
    if (options.statusPageAnnouncementId) {
      log.statusPageAnnouncementId = options.statusPageAnnouncementId;
    }

    try {
      await PushNotificationServiceCommon.sendPushNotification(request, {
        projectId: options.projectId,
        isSensitive: Boolean(options.isSensitive),
        userOnCallLogTimelineId: options.userOnCallLogTimelineId,
      });

      log.status = PushStatus.Success;
      log.statusMessage = "Push notification sent";
    } catch (err: any) {
      log.status = PushStatus.Error;
      log.statusMessage =
        err?.message || err?.toString?.() || "Failed to send push notification";

      if (options.userOnCallLogTimelineId) {
        await UserOnCallLogTimelineService.updateOneById({
          id: options.userOnCallLogTimelineId,
          data: {
            status: UserNotificationStatus.Error,
            statusMessage: log.statusMessage || "Push send failed",
          },
          props: { isRoot: true },
        });
      }
    }

    if (options.projectId) {
      await PushNotificationLogService.create({
        data: log,
        props: { isRoot: true },
      });
    }

    if (log.status === PushStatus.Error) {
      throw new Error(log.statusMessage || "Push failed");
    }
  }
}
