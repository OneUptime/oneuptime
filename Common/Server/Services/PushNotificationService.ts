import PushNotificationRequest from "../../Types/PushNotification/PushNotificationRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import UserPushService from "./UserPushService";
import {
  VapidPublicKey,
  VapidPrivateKey,
  VapidSubject,
} from "../EnvironmentConfig";
import webpush from "web-push";

export interface PushNotificationOptions {
  projectId?: ObjectID | undefined;
  isSensitive?: boolean;
}

export default class PushNotificationService {
  public static isWebPushInitialized = false;

  public static initializeWebPush(): void {
    if (this.isWebPushInitialized) {
      return;
    }

    if (!VapidPublicKey || !VapidPrivateKey) {
      logger.warn("VAPID keys not configured. Web push notifications will not work.");
      return;
    }

    webpush.setVapidDetails(VapidSubject, VapidPublicKey, VapidPrivateKey);
    this.isWebPushInitialized = true;
    logger.info("Web push notifications initialized");
  }

  public static async sendPushNotification(
    request: PushNotificationRequest,
    options: PushNotificationOptions = {},
  ): Promise<void> {
    logger.info(`Sending push notification to ${request.deviceTokens?.length} devices`);
    
    if (!request.deviceTokens || request.deviceTokens.length === 0) {
      logger.error("No device tokens provided for push notification");
      throw new Error("No device tokens provided");
    }

    if (request.deviceType !== "web") {
      logger.error(`Unsupported device type: ${request.deviceType}`);
      throw new Error("Only web push notifications are supported");
    }

    logger.info(`Sending web push notifications to ${request.deviceTokens.length} devices`);

    const promises: Promise<void>[] = [];

    for (const deviceToken of request.deviceTokens) {
      promises.push(this.sendWebPushNotification(deviceToken, request.message, options));
    }

    const results = await Promise.allSettled(promises);
    
    let successCount = 0;
    let errorCount = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        errorCount++;
        logger.error(`Failed to send notification to device ${index + 1}: ${result.reason}`);
      }
    });
    
    logger.info(`Push notification results: ${successCount} successful, ${errorCount} failed`);
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
      const payload = JSON.stringify({
        title: message.title,
        body: message.body,
        icon: message.icon || "/icon-192x192.png",
        badge: message.badge || "/badge-72x72.png",
        data: message.data || {},
        tag: message.tag || "oneuptime-notification",
        requireInteraction: message.requireInteraction || false,
        actions: message.actions || [],
        url: message.url || message.clickAction,
      });

      await webpush.sendNotification(
        JSON.parse(deviceToken), // deviceToken is the subscription object for web push
        payload,
        {
          TTL: 24 * 60 * 60, // 24 hours
        }
      );

      logger.info(`Web push notification sent successfully`);
    } catch (error: any) {
      logger.error(`Failed to send web push notification: ${error.message}`);
      
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
    const userPushDevices = await UserPushService.findBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
        deviceType: "web", // Only support web devices
      },
      select: {
        deviceToken: true,
        deviceType: true,
        _id: true,
      },
      limit: 100, // Reasonable limit
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (userPushDevices.length === 0) {
      logger.info(`No verified web push devices found for user ${userId.toString()}`);
      return;
    }

    // Get web device tokens
    const webDevices: string[] = [];

    for (const device of userPushDevices) {
      if (device.deviceType === "web") {
        webDevices.push(device.deviceToken!);
      }

      // Mark device as used
      await UserPushService.markDeviceAsUsed(device._id!.toString());
    }

    // Send notifications to web devices
    if (webDevices.length > 0) {
      await this.sendPushNotification({
        deviceTokens: webDevices,
        message: message,
        deviceType: "web",
      }, options);
    }
  }
}
