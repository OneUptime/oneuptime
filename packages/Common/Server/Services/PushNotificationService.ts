import PushNotificationRequest from "../../Types/PushNotification/PushNotificationRequest";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import { isExpoPushDeviceType } from "../../Types/PushNotification/ExpoPushDeviceType";
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
import {
  Expo,
  ExpoPushErrorTicket,
  ExpoPushMessage,
  ExpoPushTicket,
} from "expo-server-sdk";
import API from "../../Utils/API";
import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import { JSONObject } from "../../Types/JSON";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import ProductBrandingText from "../Utils/ProductBrandingText";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import UserPush from "../../Models/DatabaseModels/UserPush";
import PushNotificationLog from "../../Models/DatabaseModels/PushNotificationLog";
import PushNotificationLogService from "./PushNotificationLogService";
import PushStatus from "../../Types/PushNotification/PushStatus";
import AndroidNotificationChannel from "../../Types/PushNotification/AndroidNotificationChannel";
import BadDataException from "../../Types/Exception/BadDataException";

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

/*
 * Expo's error code for a push token it can no longer deliver to: the app
 * was removed from the device, or the device's push token is no longer
 * valid. Expo's own advice is to stop sending to it
 * (https://docs.expo.dev/push-notifications/sending-notifications/#individual-errors).
 */
export const EXPO_DEVICE_NOT_REGISTERED: string = "DeviceNotRegistered";

/*
 * What Expo said, and nothing about what the sender did with it: the push
 * relay answers with this (see getRelayDeviceNotRegisteredAnswer), and the
 * server it answers may be older than the relay and mark nothing.
 */
const EXPO_DEVICE_NOT_REGISTERED_EXPLANATION: string =
  "Expo says this device is no longer registered for push notifications (DeviceNotRegistered): the mobile app was removed from it, or its push token is no longer valid.";

/*
 * Thrown by sendRelayPushNotification when Expo says the token it was asked
 * to send to is gone, so the relay route can answer that distinctly
 * (RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE) instead of as a server error.
 */
export class ExpoDeviceNotRegisteredError extends Error {
  public constructor() {
    super(EXPO_DEVICE_NOT_REGISTERED_EXPLANATION);
    this.name = "ExpoDeviceNotRegisteredError";
  }
}

export default class PushNotificationService {
  public static isWebPushInitialized = false;
  private static expoClient: Expo = new Expo(
    ExpoAccessToken ? { accessToken: ExpoAccessToken } : undefined,
  );

  /*
   * The send's own failure when Expo says the token is gone, directly or
   * through the relay: what happened, what was done about it, and what the
   * person does next. It reaches the push log, the on-call timeline and a
   * failed test notification. The mobile app registers its token again when
   * it is opened, and that brings the device back
   * (UserPushService.verifyExpoPushDeviceRegisteredAgain).
   */
  public static readonly EXPO_PUSH_TOKEN_GONE_MESSAGE: string = `${EXPO_DEVICE_NOT_REGISTERED_EXPLANATION} The device is marked as not receiving notifications; open the mobile app on it to register it again.`;

  // A phone or tablet marked so, when something is sent to it later.
  public static readonly EXPO_DEVICE_NOT_RECEIVING_MESSAGE: string =
    "This device no longer receives push notifications. Open the mobile app on it to register it again.";

  /*
   * The on-call timeline's row for a page that was not pushed to a device
   * because it is not verified: its push service, or Expo, said it is gone
   * (UserPushService.markWebPushSubscriptionAsGone, markExpoPushTokenAsGone).
   * It says how to bring the device back, on the device it is about.
   */
  public static getNotSentToUnverifiedDeviceMessage(
    deviceType: PushDeviceType | string | undefined,
  ): string {
    if (isExpoPushDeviceType(deviceType)) {
      return "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.";
    }

    return "Push notification not sent: this browser no longer receives push notifications. Register it again from User Settings > Notification Methods in that browser.";
  }

  /*
   * How the push relay answers a send Expo refused because the token is
   * gone: 410 Gone, with Expo's error code in `details.error` - the shape
   * of Expo's own error ticket - and a sentence in `message`.
   *
   * Every server that relays through it, of any version, counts an answer
   * that is not a success as a failed send, and logs its body. So a server
   * older than this still fails the send, as it always did, and now logs
   * why; a server that knows this answer also stops sending to the token
   * (sendViaRelay). Before, the relay answered this like any other failure,
   * 500 "Server Error", and nobody could tell a gone token from an outage.
   */
  public static readonly RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE: number = 410;

  public static getRelayDeviceNotRegisteredAnswer(): JSONObject {
    return {
      message: EXPO_DEVICE_NOT_REGISTERED_EXPLANATION,
      details: {
        error: EXPO_DEVICE_NOT_REGISTERED,
      },
    };
  }

  /*
   * Whether the relay answered that the token is gone. Both the status and
   * Expo's code: a 410 from anything else in the way - a proxy, a relay URL
   * pointed somewhere else - says nothing about the token, and neither does
   * the 500 an older relay answers a gone token with.
   */
  public static isRelayDeviceNotRegisteredAnswer(
    response: HTTPErrorResponse,
  ): boolean {
    if (
      response.statusCode !==
      PushNotificationService.RELAY_DEVICE_NOT_REGISTERED_STATUS_CODE
    ) {
      return false;
    }

    const body: unknown = response.jsonData;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return false;
    }

    const details: unknown = (body as JSONObject)["details"];

    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return false;
    }

    return (details as JSONObject)["error"] === EXPO_DEVICE_NOT_REGISTERED;
  }

  // An Expo push ticket saying the token is gone.
  public static isExpoDeviceNotRegisteredTicket(
    ticket: ExpoPushTicket | undefined,
  ): boolean {
    return (
      ticket?.status === "error" &&
      (ticket as ExpoPushErrorTicket).details?.error ===
        EXPO_DEVICE_NOT_REGISTERED
    );
  }

  /*
   * The push token taken out of a message about a send to it. Expo writes
   * the token into its error messages ('"ExponentPushToken[...]" is not a
   * registered push notification recipient'), and a send's failure is
   * stored where every member of the project reads it (the push log) and
   * shown on the on-call timeline. The token is the address that pushes to
   * the person's phone, and stays out of both.
   */
  public static withoutPushToken(message: string, pushToken: string): string {
    if (!pushToken) {
      return message;
    }

    return message.split(pushToken).join("[push token]");
  }

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
    pushRequest: PushNotificationRequest,
    options: PushNotificationOptions = {},
  ): Promise<void> {
    // The installation's own name and icon, when it goes by one.
    const request: PushNotificationRequest = {
      ...pushRequest,
      message: ProductBrandingText.brandPushMessage(pushRequest.message, [
        PushNotificationUtil.DEFAULT_ICON,
      ]),
    };

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

    // Why the devices that failed did, each reason once, in device order.
    const failureReasons: Array<string> = [];

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

        const reason: string = PushNotificationService.getFailureReason(
          result.reason,
        );

        if (!failureReasons.includes(reason)) {
          failureReasons.push(reason);
        }
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
          log.statusMessage = PushNotificationService.getFailureReason(
            result?.reason,
          );
        }

        await PushNotificationLogService.create({
          data: log,
          props: { isRoot: true },
        });
      }
    }

    /*
     * Why nothing was delivered, in the words of the device's own failure:
     * that is what tells on-call what happened and what to do - "Expo says
     * this device is no longer registered ... open the mobile app on it to
     * register it again" - where "Failed to send push notification to all
     * 1 devices" told them nothing.
     */
    const failureMessage: string = PushNotificationService.describeFailedSend({
      errorCount: errorCount,
      failureReasons: failureReasons,
    });

    // Update user on call log timeline status if provided
    if (options.userOnCallLogTimelineId) {
      const status: UserNotificationStatus =
        successCount > 0
          ? UserNotificationStatus.Sent
          : UserNotificationStatus.Error;
      const statusMessage: string =
        successCount > 0 ? "Push notification sent successfully" : failureMessage;

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
      throw new Error(failureMessage);
    }
  }

  // A device's failed send, as its push log and the on-call timeline say it.
  public static getFailureReason(reason: unknown): string {
    const message: unknown =
      (reason as { message?: unknown } | null | undefined)?.message ||
      (reason as { toString?: () => string } | null | undefined)?.toString?.();

    return typeof message === "string" && message
      ? message
      : "Failed to send push notification";
  }

  /*
   * A send that reached none of its devices. One device - every on-call
   * page and every test notification is sent to one - fails with that
   * device's own reason; more say how many, and each reason once.
   */
  public static describeFailedSend(data: {
    errorCount: number;
    failureReasons: Array<string>;
  }): string {
    if (data.failureReasons.length === 0) {
      return "Failed to send push notification.";
    }

    if (data.errorCount <= 1) {
      return data.failureReasons[0]!;
    }

    return `Failed to send push notification to all ${data.errorCount} devices: ${data.failureReasons.join("; ")}`;
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

      if (PushNotificationService.isGoneWebPushSubscription(error)) {
        await PushNotificationService.stopSendingToGoneWebPushSubscription(
          deviceToken,
        );

        throw new Error(
          `The push service no longer accepts this browser's subscription (HTTP ${error.statusCode}): it expired or was revoked. The device is marked as not receiving notifications; register the browser again to receive them.`,
        );
      }

      throw error;
    }
  }

  /*
   * How a push service says a subscription is gone for good: 404 (it expired,
   * or there never was one) or 410 (the browser unsubscribed, or notifications
   * were blocked). Every other refusal - 403 for a subscription made with
   * another VAPID key, 413, 429, a 5xx - says nothing about the subscription
   * itself, and leaves the device as it is.
   */
  public static isGoneWebPushSubscription(error: unknown): boolean {
    const statusCode: unknown = (error as { statusCode?: unknown } | null)
      ?.statusCode;

    return statusCode === 404 || statusCode === 410;
  }

  /*
   * Stop sending to the devices registered with a gone subscription (see
   * UserPushService.markWebPushSubscriptionAsGone). They used to stay as they
   * were, so every later page went to the dead subscription and failed there.
   * The send has failed either way: a failure to mark the devices is logged,
   * and does not take the place of the send's own error.
   */
  private static async stopSendingToGoneWebPushSubscription(
    deviceToken: string,
  ): Promise<void> {
    try {
      const markedCount: number =
        await UserPushService.markWebPushSubscriptionAsGone({
          deviceToken: deviceToken,
        });

      logger.info(
        `Web push subscription is gone: ${markedCount} device(s) marked as not receiving notifications.`,
      );
    } catch (markError) {
      logger.error(
        `Could not mark the devices of a gone web push subscription: ${markError}`,
      );
    }
  }

  /*
   * A browser push subscription as the Dashboard and its service worker send
   * it (PushSubscription.toJSON(), stringified): an endpoint at one of the
   * browser push services, and the two keys a notification is encrypted
   * with. Checked when a browser reports a new subscription, so a device is
   * never renewed with one that could not be delivered to.
   */
  public static assertIsWebPushSubscription(deviceToken: unknown): void {
    if (!deviceToken || typeof deviceToken !== "string") {
      throw new BadDataException("A web push subscription is required.");
    }

    let subscription: unknown;

    try {
      subscription = JSON.parse(deviceToken);
    } catch {
      throw new BadDataException("The web push subscription is not JSON.");
    }

    if (
      !subscription ||
      typeof subscription !== "object" ||
      Array.isArray(subscription)
    ) {
      throw new BadDataException(
        "The web push subscription is not a subscription.",
      );
    }

    try {
      PushNotificationService.assertWebPushEndpointIsAllowed(
        (subscription as JSONObject)["endpoint"],
      );
    } catch (error) {
      throw new BadDataException((error as Error).message);
    }

    const keys: unknown = (subscription as JSONObject)["keys"];

    if (
      !keys ||
      typeof keys !== "object" ||
      !(keys as JSONObject)["p256dh"] ||
      typeof (keys as JSONObject)["p256dh"] !== "string" ||
      !(keys as JSONObject)["auth"] ||
      typeof (keys as JSONObject)["auth"] !== "string"
    ) {
      throw new BadDataException(
        "The web push subscription is missing the keys notifications are encrypted with.",
      );
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
    // Without the token: what fails here is shown to every project member.
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error(`Invalid Expo push token for ${deviceType} device.`);
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
    if (!PushNotificationService.hasExpoAccessToken()) {
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
        const errorTicket: ExpoPushErrorTicket = ticket;
        const expoMessage: string = PushNotificationService.withoutPushToken(
          errorTicket.message || "",
          expoPushToken,
        );

        logger.error(
          `Expo push notification error for ${deviceType} device: ${expoMessage}`,
        );

        /*
         * The token is gone. It used to be logged and nothing more: the
         * device stayed verified, every later page went to the dead token
         * and failed at Expo, and the device list, readiness and the on-call
         * timeline all kept treating the phone as reachable.
         */
        if (PushNotificationService.isExpoDeviceNotRegisteredTicket(ticket)) {
          await PushNotificationService.stopSendingToGoneExpoPushToken(
            expoPushToken,
          );

          throw new Error(PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE);
        }

        throw new Error(`Expo push notification failed: ${expoMessage}`);
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

  /*
   * Stop sending to the devices registered with a token Expo says is gone
   * (UserPushService.markExpoPushTokenAsGone), as
   * stopSendingToGoneWebPushSubscription does for a browser. The send has
   * failed either way: a failure to mark the devices is logged, and does not
   * take the place of the send's own error.
   */
  private static async stopSendingToGoneExpoPushToken(
    expoPushToken: string,
  ): Promise<void> {
    try {
      const markedCount: number = await UserPushService.markExpoPushTokenAsGone(
        {
          deviceToken: expoPushToken,
        },
      );

      logger.info(
        `Expo push token is gone (DeviceNotRegistered): ${markedCount} device(s) marked as not receiving notifications.`,
      );
    } catch (markError) {
      logger.error(
        `Could not mark the devices of a gone Expo push token: ${markError}`,
      );
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
        /*
         * The relay says Expo refused the token as gone. Without this the
         * relay path could not tell a gone token from an outage, and the
         * device stayed verified as on the direct path.
         */
        if (PushNotificationService.isRelayDeviceNotRegisteredAnswer(response)) {
          await PushNotificationService.stopSendingToGoneExpoPushToken(
            expoPushToken,
          );

          throw new Error(PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE);
        }

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
    if (!PushNotificationService.hasExpoAccessToken()) {
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
      const errorTicket: ExpoPushErrorTicket = ticket;

      logger.error(
        `Push relay: Expo push notification error: ${errorTicket.message}`,
      );

      /*
       * Said apart from every other failure, so the server that relayed
       * the page learns that the token is gone and stops sending to it: the
       * relay route answers this with getRelayDeviceNotRegisteredAnswer.
       */
      if (PushNotificationService.isExpoDeviceNotRegisteredTicket(ticket)) {
        throw new ExpoDeviceNotRegisteredError();
      }

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
