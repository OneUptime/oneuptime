import PushNotificationRequest from "../../Types/PushNotification/PushNotificationRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import ObjectID from "../../Types/ObjectID";
import logger from "../Utils/Logger";
import UserPushService from "./UserPushService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import {
  VapidPublicKey,
  VapidPrivateKey,
  VapidSubject,
  ExpoAccessToken,
  PushNotificationRelayUrl,
} from "../EnvironmentConfig";
import webpush from "web-push";
import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import API from "../../Utils/API";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationLog from "../../Models/DatabaseModels/PushNotificationLog";
import PushNotificationLogService from "./PushNotificationLogService";
import PushStatus from "../../Types/PushNotification/PushStatus";
import AndroidNotificationChannel from "../../Types/PushNotification/AndroidNotificationChannel";

/*
 * The push services the browsers actually use. A Web Push subscription is a
 * JSON blob supplied by the client and stored verbatim in UserPush.deviceToken;
 * web-push then dials whatever host:port its "endpoint" names. Nothing else is
 * a legitimate destination, so this is an allowlist rather than a blocklist —
 * there is no self-hosted deployment of a browser push service to accommodate.
 *
 * Matching is on the registrable host (exact, or a subdomain) and https only,
 * which covers the real endpoints: updates.push.services.mozilla.com,
 * web.push.apple.com, and the regional *.notify.windows.com hosts.
 */
const ALLOWED_WEB_PUSH_HOSTS: Array<string> = [
  "push.services.mozilla.com",
  "fcm.googleapis.com",
  "android.googleapis.com",
  "notify.windows.com",
  "push.apple.com",
];

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

/*
 * What Expo needs to be told for a notification to ring through a silenced
 * handset. The two platforms disagree about where the answer lives, so this is
 * computed once and reused by both the direct-SDK and relay send paths.
 *
 * iOS reads the payload: a `sound` object with `critical: true` plus
 * `interruptionLevel: "critical"` is what makes APNs ignore the ringer switch
 * and Focus, and it is refused unless the app carries Apple's critical-alert
 * entitlement.
 *
 * Android ignores all of that and reads the CHANNEL. Sound, importance and Do
 * Not Disturb bypass are baked into the channel when the app creates it and
 * cannot be raised by a payload, so the only lever the server has is which
 * channel id it names.
 */
export type ExpoPushSound =
  | string
  | null
  | {
      critical?: boolean;
      name?: string | null;
      volume?: number;
    };

export type ExpoInterruptionLevel =
  | "active"
  | "critical"
  | "passive"
  | "time-sensitive";

export interface ExpoDeliveryOptions {
  channelId: string;
  sound: ExpoPushSound;
  priority: "high";
  interruptionLevel?: ExpoInterruptionLevel;
}

export default class PushNotificationService {
  public static isWebPushInitialized = false;
  private static expoClient: Expo = new Expo(
    ExpoAccessToken ? { accessToken: ExpoAccessToken } : undefined,
  );

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

    logger.info(
      `Sending ${request.deviceType} push notifications to ${request.devices.length} devices`,
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
      if (request.deviceType === PushDeviceType.Web) {
        promises.push(
          this.sendWebPushNotification(device.token, request.message, options),
        );
      } else if (
        request.deviceType === PushDeviceType.iOS ||
        request.deviceType === PushDeviceType.Android
      ) {
        promises.push(
          this.sendExpoPushNotification(
            device.token,
            request.message,
            request.deviceType,
            options,
          ),
        );
      } else {
        logger.error(`Unsupported device type: ${request.deviceType}`);
      }
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

  /*
   * Refuse to hand web-push an endpoint that is not one of the browser push
   * services. The subscription JSON is client-supplied, so without this the
   * endpoint is a free choice of host and port for a POST the server makes
   * with its own credentials — the usual internal-service and metadata
   * targets included.
   */
  public static assertWebPushEndpointIsAllowed(endpoint: unknown): void {
    if (!endpoint || typeof endpoint !== "string") {
      throw new Error(
        "Web push subscription is missing its endpoint and cannot be delivered.",
      );
    }

    /*
     * Parsed with the WHATWG parser deliberately: that is the parser web-push
     * itself uses, so what is checked here is exactly what gets dialed. Going
     * through OneUptime's URL type instead would introduce a differential —
     * it reads "https://push.apple.com:80@evil.com/" as host push.apple.com,
     * while WHATWG (correctly) reads userinfo push.apple.com:80 and host
     * evil.com.
     */
    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(endpoint);
    } catch {
      throw new Error("Web push subscription endpoint is not a valid URL.");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("Web push subscription endpoint must use https.");
    }

    const host: string = parsed.hostname.toLowerCase();

    const isAllowed: boolean = ALLOWED_WEB_PUSH_HOSTS.some(
      (allowedHost: string) => {
        return host === allowedHost || host.endsWith(`.${allowedHost}`);
      },
    );

    if (!isAllowed) {
      throw new Error(
        `Web push subscription endpoint ${host} is not a recognised browser push service and will not be contacted.`,
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

      PushNotificationService.assertWebPushEndpointIsAllowed(
        subscriptionObject?.endpoint,
      );

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

  /*
   * Volume is pinned rather than exposed as a setting. A critical alert exists
   * to wake somebody, and a responder who has already opted this device in and
   * granted the OS permission has not asked to be woken quietly.
   */
  public static readonly CRITICAL_ALERT_VOLUME: number = 1;

  public static getExpoDeliveryOptions(
    message: PushNotificationMessage,
    deviceType: PushDeviceType,
  ): ExpoDeliveryOptions {
    const isAndroid: boolean = deviceType === PushDeviceType.Android;
    const isCritical: boolean = Boolean(message.isCriticalAlert);

    /*
     * iOS has no channels, so "default" here is the payload's own sound rather
     * than a channel id. Android without the critical flag stays on
     * oncall_high, which is what every push has used until now.
     */
    const channelId: string = isAndroid
      ? isCritical
        ? AndroidNotificationChannel.Critical
        : AndroidNotificationChannel.High
      : "default";

    if (!isCritical) {
      return {
        channelId: channelId,
        sound: "default",
        priority: "high",
      };
    }

    return {
      channelId: channelId,
      /*
       * Sent to Android too, and harmlessly ignored there. Expo forwards it to
       * APNs where it is the whole mechanism, and to FCM where the channel has
       * already decided the sound; keeping one shape avoids a per-platform
       * branch that could silently drop the iOS half.
       */
      sound: {
        critical: true,
        name: "default",
        volume: PushNotificationService.CRITICAL_ALERT_VOLUME,
      },
      priority: "high",
      interruptionLevel: "critical",
    };
  }

  private static async sendExpoPushNotification(
    expoPushToken: string,
    message: PushNotificationMessage,
    deviceType: PushDeviceType,
    _options: PushNotificationOptions,
  ): Promise<void> {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error(
        `Invalid Expo push token for ${deviceType} device: ${expoPushToken}`,
      );
    }

    const dataPayload: { [key: string]: string } = {};
    if (message.data) {
      for (const key of Object.keys(message.data)) {
        dataPayload[key] = String(message.data[key]);
      }
    }
    if (message.url || message.clickAction) {
      dataPayload["url"] = message.url || message.clickAction || "";
    }

    const delivery: ExpoDeliveryOptions = this.getExpoDeliveryOptions(
      message,
      deviceType,
    );

    // If EXPO_ACCESS_TOKEN is not set, relay through the push notification gateway
    if (!ExpoAccessToken) {
      await this.sendViaRelay(
        expoPushToken,
        message,
        dataPayload,
        delivery,
        deviceType,
      );
      return;
    }

    // Send directly via Expo SDK
    try {
      const expoPushMessage: ExpoPushMessage = {
        to: expoPushToken,
        title: message.title,
        body: message.body,
        data: dataPayload,
        sound: delivery.sound,
        priority: delivery.priority,
        channelId: delivery.channelId,
        ...(delivery.interruptionLevel
          ? { interruptionLevel: delivery.interruptionLevel }
          : {}),
      };

      const tickets: ExpoPushTicket[] =
        await this.expoClient.sendPushNotificationsAsync([expoPushMessage]);

      const ticket: ExpoPushTicket | undefined = tickets[0];

      if (ticket && ticket.status === "error") {
        const errorTicket: ExpoPushTicket & {
          message?: string;
          details?: { error?: string };
        } = ticket as ExpoPushTicket & {
          message?: string;
          details?: { error?: string };
        };
        logger.error(
          `Expo push notification error for ${deviceType} device: ${errorTicket.message}`,
        );

        if (errorTicket.details?.error === "DeviceNotRegistered") {
          logger.info(
            "Expo push token is no longer valid (DeviceNotRegistered)",
          );
        }

        throw new Error(
          `Expo push notification failed: ${errorTicket.message}`,
        );
      }

      logger.info(
        `Expo push notification sent successfully to ${deviceType} device`,
      );
    } catch (error: any) {
      logger.error(
        `Failed to send Expo push notification to ${deviceType} device: ${error.message}`,
      );
      throw error;
    }
  }

  private static async sendViaRelay(
    expoPushToken: string,
    message: PushNotificationMessage,
    dataPayload: { [key: string]: string },
    delivery: ExpoDeliveryOptions,
    deviceType: PushDeviceType,
  ): Promise<void> {
    logger.info(
      `Sending ${deviceType} push notification via relay: ${PushNotificationRelayUrl}`,
    );

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(PushNotificationRelayUrl),
          data: {
            to: expoPushToken,
            title: message.title || "",
            body: message.body || "",
            data: dataPayload,
            /*
             * The relay re-sends exactly what it is given, so a critical page
             * that loses its sound object here arrives on the responder's
             * phone as an ordinary silent notification. That is the failure
             * this feature exists to prevent, so the whole delivery shape
             * crosses the wire rather than the channel id alone.
             */
            sound: delivery.sound,
            priority: delivery.priority,
            channelId: delivery.channelId,
            ...(delivery.interruptionLevel
              ? { interruptionLevel: delivery.interruptionLevel }
              : {}),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw new Error(
          `Push relay error: ${JSON.stringify(response.jsonData)}`,
        );
      }

      logger.info(
        `Push notification sent via relay successfully to ${deviceType} device`,
      );
    } catch (error: any) {
      logger.error(
        `Failed to send push notification via relay to ${deviceType} device: ${error.message}`,
      );
      throw error;
    }
  }

  public static isValidExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  public static hasExpoAccessToken(): boolean {
    return Boolean(ExpoAccessToken);
  }

  public static async sendRelayPushNotification(data: {
    to: string;
    title?: string;
    body?: string;
    data?: { [key: string]: string };
    sound?: ExpoPushSound;
    priority?: string;
    channelId?: string;
    interruptionLevel?: ExpoInterruptionLevel;
  }): Promise<void> {
    if (!ExpoAccessToken) {
      throw new Error(
        "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
      );
    }

    /*
     * `sound: null` is a caller asking for a silent notification and has to
     * survive, so the fallback tests for undefined rather than falsiness.
     */
    const sound: ExpoPushSound =
      data.sound === undefined ? "default" : data.sound;

    const expoPushMessage: ExpoPushMessage = {
      to: data.to,
      title: data.title || "",
      body: data.body || "",
      data: data.data || {},
      sound: sound,
      priority: (data.priority as "default" | "normal" | "high") || "high",
      channelId: data.channelId || "default",
      ...(data.interruptionLevel
        ? { interruptionLevel: data.interruptionLevel }
        : {}),
    };

    const tickets: ExpoPushTicket[] =
      await this.expoClient.sendPushNotificationsAsync([expoPushMessage]);

    const ticket: ExpoPushTicket | undefined = tickets[0];

    if (ticket && ticket.status === "error") {
      const errorTicket: ExpoPushTicket & {
        message?: string;
        details?: { error?: string };
      } = ticket as ExpoPushTicket & {
        message?: string;
        details?: { error?: string };
      };

      logger.error(
        `Push relay: Expo push notification error: ${errorTicket.message}`,
      );

      throw new Error(
        `Failed to send push notification: ${errorTicket.message}`,
      );
    }

    logger.info(`Push relay: notification sent successfully to ${data.to}`);
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
        `No verified push devices found for user ${userId.toString()}`,
      );
      return;
    }

    // Group devices by type
    const devicesByType: Map<
      string,
      Array<{ token: string; name?: string }>
    > = new Map();

    for (const device of userPushDevices) {
      const type: string = device.deviceType || PushDeviceType.Web;
      if (!devicesByType.has(type)) {
        devicesByType.set(type, []);
      }
      devicesByType.get(type)!.push({
        token: device.deviceToken!,
        name: device.deviceName || "Unknown Device",
      });
    }

    // Send notifications to each device type group
    const sendPromises: Promise<void>[] = [];

    for (const [deviceType, devices] of devicesByType.entries()) {
      if (devices.length > 0) {
        sendPromises.push(
          this.sendPushNotification(
            {
              devices: devices,
              message: message,
              deviceType: deviceType as PushDeviceType,
            },
            options,
          ),
        );
      }
    }

    await Promise.allSettled(sendPromises);
  }
}
