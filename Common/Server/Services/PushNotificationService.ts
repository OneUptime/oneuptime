import PushNotificationRequest from "../../Types/PushNotification/PushNotificationRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import UserPushService from "./UserPushService";

// Optional imports - these packages need to be installed separately
let webpush: any;
let admin: any;

try {
  webpush = require("web-push");
} catch (error) {
  logger.warn("web-push package not installed. Web push notifications will not work.");
}

try {
  admin = require("firebase-admin");
} catch (error) {
  logger.warn("firebase-admin package not installed. Mobile push notifications will not work.");
}

export interface PushNotificationOptions {
  projectId?: ObjectID | undefined;
  isSensitive?: boolean;
}

export default class PushNotificationService {
  public static isWebPushInitialized = false;
  public static isFirebaseInitialized = false;

  public static initializeWebPush(): void {
    if (this.isWebPushInitialized) {
      return;
    }

    const vapidPublicKey = process.env["VAPID_PUBLIC_KEY"];
    const vapidPrivateKey = process.env["VAPID_PRIVATE_KEY"];
    const vapidSubject = process.env["VAPID_SUBJECT"] || "mailto:support@oneuptime.com";

    if (!vapidPublicKey || !vapidPrivateKey) {
      logger.warn("VAPID keys not configured. Web push notifications will not work.");
      return;
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    this.isWebPushInitialized = true;
    logger.info("Web push notifications initialized");
  }

  public static initializeFirebase(): void {
    if (this.isFirebaseInitialized) {
      return;
    }

    const firebaseServiceAccount = process.env["FIREBASE_SERVICE_ACCOUNT"];
    
    if (!firebaseServiceAccount) {
      logger.warn("Firebase service account not configured. Mobile push notifications will not work.");
      return;
    }

    try {
      const serviceAccount = JSON.parse(firebaseServiceAccount);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      this.isFirebaseInitialized = true;
      logger.info("Firebase push notifications initialized");
    } catch (error: any) {
      logger.error(`Failed to initialize Firebase: ${error.message || error}`);
    }
  }

  public static async sendPushNotification(
    request: PushNotificationRequest,
    options: PushNotificationOptions = {},
  ): Promise<void> {
    if (!request.deviceTokens || request.deviceTokens.length === 0) {
      throw new Error("No device tokens provided");
    }

    const promises: Promise<void>[] = [];

    for (const deviceToken of request.deviceTokens) {
      if (request.deviceType === "web") {
        promises.push(this.sendWebPushNotification(deviceToken, request.message, options));
      } else if (request.deviceType === "android" || request.deviceType === "ios") {
        promises.push(this.sendFirebasePushNotification(deviceToken, request.message, request.deviceType, options));
      }
    }

    await Promise.allSettled(promises);
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

  private static async sendFirebasePushNotification(
    deviceToken: string,
    message: PushNotificationMessage,
    deviceType: "android" | "ios",
    _options: PushNotificationOptions,
  ): Promise<void> {
    if (!this.isFirebaseInitialized) {
      this.initializeFirebase();
    }

    if (!this.isFirebaseInitialized) {
      throw new Error("Firebase push notifications not configured");
    }

    try {
      const firebaseMessage: any = {
        token: deviceToken,
        notification: {
          title: message.title,
          body: message.body,
          imageUrl: message.icon,
        },
        data: {
          ...message.data,
          clickAction: message.clickAction || message.url || "",
        },
        android: deviceType === "android" ? {
          notification: {
            icon: message.icon || "ic_notification",
            color: "#3B82F6", // OneUptime brand color
            tag: message.tag || "oneuptime-notification",
            clickAction: message.clickAction || message.url,
          },
          priority: "high",
        } : undefined,
        apns: deviceType === "ios" ? {
          payload: {
            aps: {
              alert: {
                title: message.title,
                body: message.body,
              },
              badge: message.badge ? parseInt(message.badge) : 1,
              sound: "default",
              category: message.tag || "oneuptime-notification",
            },
          },
          headers: {
            "apns-priority": "10",
          },
        } : undefined,
      };

      const response = await admin.messaging().send(firebaseMessage);
      logger.info(`Firebase push notification sent successfully: ${response}`);
    } catch (error: any) {
      logger.error(`Failed to send Firebase push notification: ${error.message}`);
      
      // If the token is no longer valid, remove it
      if (error.code === "messaging/registration-token-not-registered" || 
          error.code === "messaging/invalid-registration-token") {
        logger.info("Removing invalid Firebase token");
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
      logger.info(`No verified push devices found for user ${userId.toString()}`);
      return;
    }

    // Group devices by type
    const webDevices: string[] = [];
    const androidDevices: string[] = [];
    const iosDevices: string[] = [];

    for (const device of userPushDevices) {
      if (device.deviceType === "web") {
        webDevices.push(device.deviceToken!);
      } else if (device.deviceType === "android") {
        androidDevices.push(device.deviceToken!);
      } else if (device.deviceType === "ios") {
        iosDevices.push(device.deviceToken!);
      }

      // Mark device as used
      await UserPushService.markDeviceAsUsed(device._id!.toString());
    }

    // Send notifications to each device type
    const promises: Promise<void>[] = [];

    if (webDevices.length > 0) {
      promises.push(
        this.sendPushNotification({
          deviceTokens: webDevices,
          message: message,
          deviceType: "web",
        }, options)
      );
    }

    if (androidDevices.length > 0) {
      promises.push(
        this.sendPushNotification({
          deviceTokens: androidDevices,
          message: message,
          deviceType: "android",
        }, options)
      );
    }

    if (iosDevices.length > 0) {
      promises.push(
        this.sendPushNotification({
          deviceTokens: iosDevices,
          message: message,
          deviceType: "ios",
        }, options)
      );
    }

    await Promise.allSettled(promises);
  }
}
