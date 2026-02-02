import PushNotificationRequest from "../../Types/PushNotification/PushNotificationRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import UserPushService from "./UserPushService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import {
  VapidPublicKey,
  VapidPrivateKey,
  VapidSubject,
} from "../EnvironmentConfig";
import webpush from "web-push";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationLog from "../../Models/DatabaseModels/PushNotificationLog";
import PushNotificationLogService from "./PushNotificationLogService";
import PushStatus from "../../Types/PushNotification/PushStatus";

export interface PushNotificationOptions {
  projectId?: ObjectID | undefined;
  isSensitive?: boolean;
  userOnCallLogTimelineId?: ObjectID | undefined;
  // Optional relations for richer logging
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  statusPageId?: ObjectID | undefined;
  statusPageAnnouncementId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  // On-call policy related fields
  onCallPolicyId?: ObjectID | undefined;
  onCallPolicyEscalationRuleId?: ObjectID | undefined;
  onCallDutyPolicyExecutionLogTimelineId?: ObjectID | undefined;
  onCallScheduleId?: ObjectID | undefined;
  teamId?: ObjectID | undefined;
}

export default class PushNotificationService {
  public static isWebPushInitialized = false;

  public static initializeWebPush(): void {
    if (this.isWebPushInitialized) {
      return;
    }

    if (!VapidPublicKey || !VapidPrivateKey) {
      logger.warn(
        "VAPID keys not configured. Web push notifications will not work.",
      );
      logger.warn(`VapidPublicKey present: ${Boolean(VapidPublicKey)}`);
      logger.warn(`VapidPrivateKey present: ${Boolean(VapidPrivateKey)}`);
      logger.warn(`VapidSubject: ${VapidSubject}`);
      return;
    }

    logger.info(`Initializing web push with VAPID subject: ${VapidSubject}`);
    webpush.setVapidDetails(VapidSubject, VapidPublicKey, VapidPrivateKey);
    this.isWebPushInitialized = true;
    logger.info("Web push notifications initialized successfully");
  }

  public static async sendPushNotification(
    request: PushNotificationRequest,
    options: PushNotificationOptions = {},
  ): Promise<void> {
    logger.info(
      `Sending push notification to ${request.devices?.length} devices`,
    );

    if (!request.devices || request.devices.length === 0) {
      logger.error("No devices provided for push notification");
      throw new Error("No devices provided");
    }

    if (request.deviceType !== "web") {
      logger.error(`Unsupported device type: ${request.deviceType}`);
      throw new Error("Only web push notifications are supported");
    }

    logger.info(
      `Sending web push notifications to ${request.devices.length} devices`,
    );
    logger.info(`Notification message: ${JSON.stringify(request.message)}`);

    const deviceNames: (string | undefined)[] = request.devices
      .map((device: { token: string; name?: string }) => {
        return device.name;
      })
      .filter(Boolean);
    if (deviceNames.length > 0) {
      logger.info(`Device names: ${deviceNames.join(", ")}`);
    }

    const promises: Promise<void>[] = [];

    for (const device of request.devices) {
      promises.push(
        this.sendWebPushNotification(device.token, request.message, options),
      );
    }

    const results: Array<any> = await Promise.allSettled(promises);

    let successCount: number = 0;
    let errorCount: number = 0;

    results.forEach((result: any, index: number) => {
      const device:
        | {
            token: string;
            name?: string;
          }
        | undefined = request.devices[index];
      const deviceInfo: string = device?.name
        ? `device "${device.name}" (${index + 1})`
        : `device ${index + 1}`;

      if (result.status === "fulfilled") {
        successCount++;
        logger.info(`${deviceInfo}: Notification sent successfully`);
      } else {
        errorCount++;
        logger.error(
          `Failed to send notification to ${deviceInfo}: ${result.reason}`,
        );
      }
    });

    logger.info(
      `Push notification results: ${successCount} successful, ${errorCount} failed`,
    );

    // Create one push log per device if projectId provided
    if (options.projectId) {
      for (let i: number = 0; i < results.length; i++) {
        const result: any = results[i];
        const device:
          | {
              token: string;
              name?: string;
            }
          | undefined = request.devices[i];
        const log: PushNotificationLog = new PushNotificationLog();
        log.projectId = options.projectId;
        log.title = request.message.title || "";
        log.body = options.isSensitive
          ? "Sensitive message not logged"
          : request.message.body || "";
        log.deviceType = request.deviceType;

        // Set device name if available
        if (device?.name) {
          log.deviceName = device.name;
        }

        // relations if provided
        if (options.incidentId) {
          log.incidentId = options.incidentId;
        }
        if (options.alertId) {
          log.alertId = options.alertId;
        }
        if (options.monitorId) {
          log.monitorId = options.monitorId;
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
        if (options.userId) {
          log.userId = options.userId;
        }
        if (options.teamId) {
          log.teamId = options.teamId;
        }

        // Set OnCall-related fields
        if (options.onCallPolicyId) {
          log.onCallDutyPolicyId = options.onCallPolicyId;
        }
        if (options.onCallPolicyEscalationRuleId) {
          log.onCallDutyPolicyEscalationRuleId =
            options.onCallPolicyEscalationRuleId;
        }
        if (options.onCallScheduleId) {
          log.onCallDutyPolicyScheduleId = options.onCallScheduleId;
        }

        if (result.status === "fulfilled") {
          log.status = PushStatus.Success;
          log.statusMessage = "Push notification sent";
        } else {
          log.status = PushStatus.Error;
          const reason: string =
            (result &&
              (result.reason?.message || result.reason?.toString?.())) ||
            `Failed to send push notification`;
          log.statusMessage = reason;
        }

        await PushNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      }
    }

    // Update user on call log timeline status if provided
    if (options.userOnCallLogTimelineId) {
      const status: UserNotificationStatus =
        successCount > 0
          ? UserNotificationStatus.Sent
          : UserNotificationStatus.Error;
      const statusMessage: string =
        successCount > 0
          ? "Push notification sent successfully"
          : `Failed to send push notification: ${errorCount} errors`;

      await UserOnCallLogTimelineService.updateOneById({
        id: options.userOnCallLogTimelineId,
        data: {
          status,
          statusMessage,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (errorCount > 0 && successCount === 0) {
      throw new Error(
        `Failed to send push notification to all ${errorCount} devices`,
      );
    }
  }

  private static async sendWebPushNotification(
    deviceToken: string,
    message: PushNotificationMessage,
    _options: PushNotificationOptions,
  ): Promise<void> {
    if (!this.isWebPushInitialized) {
      this.initializeWebPush();
    }

    if (!this.isWebPushInitialized) {
      throw new Error("Web push notifications not configured");
    }

    try {
      const payload: string = JSON.stringify({
        title: message.title,
        body: message.body,
        icon: message.icon || PushNotificationUtil.DEFAULT_ICON,
        badge: message.badge || PushNotificationUtil.DEFAULT_BADGE,
        data: message.data || {},
        tag: message.tag || "oneuptime-notification",
        requireInteraction: message.requireInteraction || false,
        actions: message.actions || [],
        url: message.url || message.clickAction,
      });

      logger.debug(`Sending push notification with payload: ${payload}`);
      logger.debug(`Device token: ${deviceToken}`);

      let subscriptionObject: any;
      try {
        subscriptionObject = JSON.parse(deviceToken);
        logger.debug(
          `Parsed subscription object: ${JSON.stringify(subscriptionObject)}`,
        );
      } catch (parseError) {
        logger.error(`Failed to parse device token: ${parseError}`);
        throw new Error(`Invalid device token format: ${parseError}`);
      }

      const result: webpush.SendResult = await webpush.sendNotification(
        subscriptionObject,
        payload,
        {
          TTL: 24 * 60 * 60, // 24 hours
        },
      );

      logger.debug(`Web push notification sent successfully:`);
      logger.debug(`Result: ${JSON.stringify(result, null, 2)}`);
      logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);
      logger.debug(
        `Subscription object: ${JSON.stringify(subscriptionObject, null, 2)}`,
      );

      logger.info(`Web push notification sent successfully`);
    } catch (error: any) {
      logger.error(`Failed to send web push notification: ${error.message}`);
      logger.error(error);

      // If the subscription is no longer valid, remove it
      if (error.statusCode === 410 || error.statusCode === 404) {
        logger.info("Removing invalid web push subscription");
        // You would implement removal logic here
      }

      throw error;
    }
  }

  public static async sendPushNotificationToUser(
    userId: ObjectID,
    projectId: ObjectID,
    message: PushNotificationMessage,
    options: PushNotificationOptions = {},
  ): Promise<void> {
    // Get all verified push devices for the user
    const userPushDevices: UserPush[] = await UserPushService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        deviceToken: true,
        deviceType: true,
        deviceName: true,
        _id: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (userPushDevices.length === 0) {
      logger.info(
        `No verified web push devices found for user ${userId.toString()}`,
      );
      return;
    }

    // Get web devices with tokens and names
    const webDevices: Array<{ token: string; name?: string }> = [];

    for (const device of userPushDevices) {
      if (device.deviceType === "web") {
        webDevices.push({
          token: device.deviceToken!,
          name: device.deviceName || "Unknown Device",
        });
      }
    }

    // Send notifications to web devices
    if (webDevices.length > 0) {
      await this.sendPushNotification(
        {
          devices: webDevices,
          message: message,
          deviceType: "web",
        },
        options,
      );
    }
  }
}
