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
  ExpoPushReceipt,
  ExpoPushTicket,
} from "expo-server-sdk";
import ExpoPushReceiptQueue, {
  ExpoPushDeliveryPath,
  PendingExpoPushReceipt,
} from "../Infrastructure/ExpoPushReceiptQueue";
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
import {
  fitTextsToBudget,
  MAX_PUSH_TEXT_BYTES,
  TextSizeFunction,
  TRUNCATED_NAME_NOTE,
  TRUNCATED_TEXT_NOTE,
} from "../../Utils/MessageFit";

// A text's size in a push notification: as JSON writes it, in UTF-8.
const getPushTextSize: TextSizeFunction = (text: string): number => {
  return Buffer.byteLength(JSON.stringify(text), "utf8");
};

// A web address, with or without its scheme ("https://", "//").
const WEB_ADDRESS_PATTERN: RegExp = /^(?:https?:)?\/\//i;

// An address a notification opens: never cut.
const isAddress: (value: string) => boolean = (value: string): boolean => {
  return WEB_ADDRESS_PATTERN.test(value) || value.startsWith("/");
};

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

/*
 * Thrown by sendRelayPushNotification for every other refusal Expo answers
 * a push with - MessageTooBig, MessageRateExceeded, InvalidCredentials and
 * the rest - so the relay route can answer it with Expo's own code and words
 * (getRelayExpoRefusalAnswer). It used to reach the error handler and come
 * back as 500 "Server Error", and the server that relayed the page could
 * only log that.
 */
export class ExpoPushRefusedError extends Error {
  // Expo's error code (details.error), when its ticket names one.
  public readonly code: string | undefined;

  // Expo's own message, the push token taken out.
  public readonly expoMessage: string;

  public constructor(data: { code?: string | undefined; expoMessage: string }) {
    super(`Failed to send push notification: ${data.expoMessage}`);
    this.name = "ExpoPushRefusedError";
    this.code = data.code;
    this.expoMessage = data.expoMessage;
  }
}

/*
 * A push Expo accepted: what its ticket said, and how it was sent - with
 * this deployment's Expo access token, or through the push relay - which is
 * where its receipt is read later (ExpoPushReceiptService).
 */
export interface ExpoPushAccepted {
  receiptId: string;
  via: ExpoPushDeliveryPath;
  sentAt: number;
}

/*
 * A push's receipt, as Expo or the push relay gives it: Apple or Google
 * took the notification ("ok"), or it was not delivered, with Expo's code in
 * details.error and its message.
 */
export type ExpoPushReceiptResult =
  | { status: "ok" }
  | {
      status: "error";
      message: string;
      details?: { error?: string | undefined } | undefined;
    };

/*
 * What a relay that offers receipts answers (getExpoPushReceiptsThroughRelay):
 * the receipts it found - a receipt that is not ready yet is not among them,
 * as with Expo - or "unavailable" when there is no relay to ask, or it is
 * older than receipts and has no route for them.
 */
export type RelayPushReceiptsResult =
  | { kind: "receipts"; receipts: Map<string, ExpoPushReceiptResult> }
  | { kind: "unavailable" };

/*
 * A receipt id as Expo issues them (a UUID), held to letters, digits and
 * hyphens: the relay passes them on to Expo, and back as the keys of its
 * answer.
 */
const EXPO_PUSH_RECEIPT_ID_PATTERN: RegExp = /^[A-Za-z0-9-]{1,128}$/;

// An Expo push token, wherever one appears in a message.
const ANY_EXPO_PUSH_TOKEN_PATTERN: RegExp =
  /(?:ExponentPushToken|ExpoPushToken)\[[^\]]*\]/g;

// The relay's send address ends in /send; its receipts are at /receipts.
const RELAY_SEND_PATH_PATTERN: RegExp = /\/send\/?$/;

// The most receipt ids one request asks for: Expo's own chunk size.
export const MAX_EXPO_PUSH_RECEIPT_IDS_PER_REQUEST: number =
  Expo.pushNotificationReceiptChunkSizeLimit;

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

    return "Push notification not sent: this browser no longer receives push notifications. Register it again from User Settings > Notification Methods > Push in that browser.";
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

  /*
   * Every Expo push token taken out of a message, for where the token it
   * names is not known: the relay answering receipts it did not send.
   */
  public static withoutAnyPushToken(message: string): string {
    return message.replace(ANY_EXPO_PUSH_TOKEN_PATTERN, "[push token]");
  }

  /*
   * How the push relay answers a send Expo refused for any reason but a gone
   * token: 502, Expo's own message in `message` and its code in
   * `details.error` - the shape of Expo's error ticket. A server older than
   * this counts it as a failed send, as it did the 500 "Server Error" this
   * used to be, and its log now says why; this one says it in the words a
   * direct send uses (sendViaRelay). An error ticket that names no code is
   * answered with the message alone.
   */
  public static readonly RELAY_EXPO_REFUSAL_STATUS_CODE: number = 502;

  public static getRelayExpoRefusalAnswer(
    error: ExpoPushRefusedError,
  ): JSONObject {
    return {
      message: error.expoMessage,
      ...(error.code ? { details: { error: error.code } } : {}),
    };
  }

  /*
   * Expo's refusal in a relay's answer: 502 with Expo's code and message.
   * Both are needed - a 502 from a proxy or a gateway in the way, even one
   * with a JSON message, says nothing about the push.
   */
  public static getRelayExpoRefusal(
    response: HTTPErrorResponse,
  ): { code: string; message: string } | null {
    if (
      response.statusCode !==
      PushNotificationService.RELAY_EXPO_REFUSAL_STATUS_CODE
    ) {
      return null;
    }

    const body: unknown = response.jsonData;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const message: unknown = (body as JSONObject)["message"];
    const details: unknown = (body as JSONObject)["details"];

    if (
      typeof message !== "string" ||
      !details ||
      typeof details !== "object" ||
      Array.isArray(details)
    ) {
      return null;
    }

    const code: unknown = (details as JSONObject)["error"];

    if (typeof code !== "string" || !code) {
      return null;
    }

    return { code: code, message: message };
  }

  // A field of a JSON object answer; nothing from a list or anything else.
  public static readAnswerField(
    response: HTTPResponse<JSONObject> | HTTPErrorResponse,
    field: string,
  ): unknown {
    const body: unknown = response.jsonData;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }

    return (body as JSONObject)[field];
  }

  // A receipt id this server sends on, or reads back.
  public static isExpoPushReceiptId(value: unknown): value is string {
    return (
      typeof value === "string" && EXPO_PUSH_RECEIPT_ID_PATTERN.test(value)
    );
  }

  /*
   * What the push log and the on-call timeline say about a push Expo
   * accepted when its receipt says it never reached the device. They said
   * it was sent; this says it was not, why, and - for a phone Expo says is
   * gone - what was done and what the person does next, in the words a
   * refused ticket uses (EXPO_PUSH_TOKEN_GONE_MESSAGE).
   */
  public static getUndeliveredExpoPushMessage(data: {
    code?: string | undefined;
    expoMessage?: string | undefined;
    // The app registered the token again after the push was sent.
    registeredAgainSince?: boolean | undefined;
  }): string {
    if (data.code === EXPO_DEVICE_NOT_REGISTERED) {
      if (data.registeredAgainSince) {
        return "Push notification not delivered. Expo said this device was not registered for push notifications when it was sent (DeviceNotRegistered). The mobile app has registered the device again since then, so it still receives notifications.";
      }

      return `Push notification not delivered. ${PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE}`;
    }

    const code: string = data.code ? ` (${data.code})` : "";
    const said: string = data.expoMessage ? `: ${data.expoMessage}` : ".";

    return `Push notification not delivered. Expo could not deliver it to the device${code}${said}`;
  }

  /*
   * Where the push relay answers receipts: its send address
   * (PUSH_NOTIFICATION_RELAY_URL, ".../push-relay/send") with /receipts in
   * place of /send. Null when the address does not end in /send - a relay
   * of some other making - and so has no receipts this server can find.
   * Read each time, like the send address.
   */
  public static getRelayReceiptsUrl(): string | null {
    if (!PushNotificationRelayUrl) {
      return null;
    }

    let url: globalThis.URL;

    try {
      url = new globalThis.URL(PushNotificationRelayUrl);
    } catch {
      return null;
    }

    if (!RELAY_SEND_PATH_PATTERN.test(url.pathname)) {
      return null;
    }

    url.pathname = url.pathname.replace(RELAY_SEND_PATH_PATTERN, "/receipts");

    return url.toString();
  }

  /*
   * A receipt as Expo, or a relay, wrote it, read as one: "ok", or "error"
   * with a message and maybe Expo's code. Anything else is not a receipt.
   */
  public static readExpoPushReceipt(
    value: unknown,
  ): ExpoPushReceiptResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const receipt: JSONObject = value as JSONObject;

    if (receipt["status"] === "ok") {
      return { status: "ok" };
    }

    if (receipt["status"] !== "error") {
      return null;
    }

    const message: string =
      typeof receipt["message"] === "string" ? receipt["message"] : "";
    const details: unknown = receipt["details"];
    const code: unknown =
      details && typeof details === "object" && !Array.isArray(details)
        ? (details as JSONObject)["error"]
        : undefined;

    return {
      status: "error",
      message: message,
      ...(typeof code === "string" && code ? { details: { error: code } } : {}),
    };
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

  /*
   * A notification's text held to what every push service takes: Expo (and
   * APNs and FCM behind it) and web push refuse a notification of more than
   * 4,096 bytes, and it is lost. Its title, body and the texts of its data
   * are held to MAX_PUSH_TEXT_BYTES together, as JSON writes them in UTF-8:
   * the longest cut first, all to about the same size, the body ending with
   * a note that the rest is in OneUptime and a title or a name with "…".
   * An address in its data - where it opens - is never cut. A notification
   * that fits is sent as it always was.
   */
  public static fitMessage(
    message: PushNotificationMessage,
  ): PushNotificationMessage {
    const data: { [key: string]: any } = message.data || {};
    const textKeys: Array<string> = Object.keys(data).filter(
      (key: string): boolean => {
        return typeof data[key] === "string" && !isAddress(data[key]);
      },
    );
    const texts: Array<string> = [
      message.title || "",
      message.body || "",
      ...textKeys.map((key: string): string => {
        return data[key] as string;
      }),
    ];

    // The rest of the data, its texts left out, takes what it takes.
    const otherData: { [key: string]: any } = { ...data };

    for (const key of textKeys) {
      otherData[key] = "";
    }

    const budget: number =
      MAX_PUSH_TEXT_BYTES -
      Buffer.byteLength(JSON.stringify(otherData), "utf8");

    const totalSize: number = texts.reduce(
      (total: number, text: string): number => {
        return total + getPushTextSize(text);
      },
      0,
    );

    if (totalSize <= budget) {
      return message;
    }

    const fitted: Array<string> = fitTextsToBudget(texts, budget, {
      measure: getPushTextSize,
      getNote: (index: number): string => {
        return index === 1 ? TRUNCATED_TEXT_NOTE : TRUNCATED_NAME_NOTE;
      },
    });

    const fittedData: { [key: string]: any } = { ...data };

    textKeys.forEach((key: string, index: number): void => {
      fittedData[key] = fitted[index + 2];
    });

    return {
      ...message,
      title: fitted[0]!,
      body: fitted[1]!,
      ...(message.data ? { data: fittedData } : {}),
    };
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

    // Held to what the push services take (fitMessage), as branded, for every device.
    request.message = this.fitMessage(request.message);

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

    /*
     * Each device's send. A push Expo accepted settles with its ticket's
     * receipt id, read later to learn whether it was delivered.
     */
    const promises: Promise<ExpoPushAccepted | undefined | void>[] = [];

    for (const device of request.devices) {
      if (request.deviceType === PushDeviceType.Web) {
        promises.push(
          this.sendWebPushNotification(device.token, request.message, options),
        );
      } else if (isExpoPushDeviceType(request.deviceType)) {
        // The same devices UserPushService marks when Expo says a token is gone.
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

    // Each device's push log, when one is written: its receipt may change it.
    const pushLogIds: Array<string | undefined> = [];

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

        const createdLog: PushNotificationLog | undefined =
          await PushNotificationLogService.create({
            data: log,
            props: { isRoot: true },
          });

        pushLogIds[i] = createdLog?.id?.toString() || undefined;
      }
    }

    /*
     * Read each accepted push's receipt later: Expo usually says a phone is
     * gone there, not in the ticket (ExpoPushReceiptQueue).
     */
    await PushNotificationService.keepReceiptsToRead({
      results: results,
      devices: request.devices,
      pushLogIds: pushLogIds,
      userOnCallLogTimelineId: options.userOnCallLogTimelineId,
    });

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
        successCount > 0
          ? "Push notification sent successfully"
          : failureMessage;

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
   * The pushes of a send that Expo accepted, kept for their receipts to be
   * read 15 minutes on (ExpoPushReceiptQueue): each with its token and its
   * push log and - when the send was a page to this one device, as every
   * on-call page is - the page's on-call timeline row. A row saying the page
   * reached nobody is never written for a send another device received.
   * Never throws: the pushes have gone out.
   */
  private static async keepReceiptsToRead(data: {
    results: Array<PromiseSettledResult<ExpoPushAccepted | undefined | void>>;
    devices: Array<{ token: string; name?: string }>;
    pushLogIds: Array<string | undefined>;
    userOnCallLogTimelineId?: ObjectID | undefined;
  }): Promise<void> {
    const receipts: Array<PendingExpoPushReceipt> = [];

    data.results.forEach(
      (
        result: PromiseSettledResult<ExpoPushAccepted | undefined | void>,
        index: number,
      ) => {
        if (result.status !== "fulfilled" || !result.value) {
          return;
        }

        const device: { token: string; name?: string } | undefined =
          data.devices[index];

        if (!device?.token) {
          return;
        }

        const receipt: PendingExpoPushReceipt = {
          receiptId: result.value.receiptId,
          deviceToken: device.token,
          via: result.value.via,
          sentAt: result.value.sentAt,
          attempts: 0,
        };

        const pushLogId: string | undefined = data.pushLogIds[index];

        if (pushLogId) {
          receipt.pushNotificationLogId = pushLogId;
        }

        if (data.userOnCallLogTimelineId && data.devices.length === 1) {
          receipt.userOnCallLogTimelineId =
            data.userOnCallLogTimelineId.toString();
        }

        receipts.push(receipt);
      },
    );

    await ExpoPushReceiptQueue.add(receipts);
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
   */
  private static async stopSendingToGoneWebPushSubscription(
    deviceToken: string,
  ): Promise<void> {
    await PushNotificationService.stopSendingToGoneDevices({
      whatIsGone: "web push subscription",
      markAsGone: (): Promise<number> => {
        return UserPushService.markWebPushSubscriptionAsGone({
          deviceToken: deviceToken,
        });
      },
    });
  }

  /*
   * The one way both push paths stop sending to a subscription or token that
   * is gone. The send has failed either way: a failure to mark the devices
   * is logged, and does not take the place of the send's own error.
   */
  private static async stopSendingToGoneDevices(data: {
    whatIsGone: string;
    markAsGone: () => Promise<number>;
  }): Promise<void> {
    try {
      const markedCount: number = await data.markAsGone();

      logger.info(
        `A gone ${data.whatIsGone}: ${markedCount} device(s) marked as not receiving notifications.`,
      );
    } catch (markError) {
      logger.error(
        `Could not mark the devices of a gone ${data.whatIsGone}: ${markError}`,
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

  /*
   * Sends one push through Expo, directly or through the push relay. A push
   * Expo accepted comes back with its ticket's receipt id - undefined when
   * there is none to read (an older relay answers without one).
   */
  private static async sendExpoPushNotification(
    expoPushToken: string,
    message: PushNotificationMessage,
    deviceType: PushDeviceType,
    _options: PushNotificationOptions,
  ): Promise<ExpoPushAccepted | undefined> {
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
      return await this.sendViaRelay(
        expoPushToken,
        message,
        dataPayload,
        delivery,
        deviceType,
      );
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

      // Accepted: whether it reached the phone is in its receipt.
      if (
        ticket?.status === "ok" &&
        PushNotificationService.isExpoPushReceiptId(ticket.id)
      ) {
        return {
          receiptId: ticket.id,
          via: "expo",
          sentAt: Date.now(),
        };
      }

      return undefined;
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
   * stopSendingToGoneWebPushSubscription does for a browser: when a push's
   * ticket says so, here, and when its receipt does (ExpoPushReceiptService).
   */
  public static async stopSendingToGoneExpoPushToken(
    expoPushToken: string,
  ): Promise<void> {
    await PushNotificationService.stopSendingToGoneDevices({
      whatIsGone: "Expo push token (DeviceNotRegistered)",
      markAsGone: (): Promise<number> => {
        return UserPushService.markExpoPushTokenAsGone({
          deviceToken: expoPushToken,
        });
      },
    });
  }

  private static async sendViaRelay(
    expoPushToken: string,
    message: PushNotificationMessage,
    dataPayload: { [key: string]: string },
    delivery: ExpoDeliveryOptions,
    deviceType: PushDeviceType,
  ): Promise<ExpoPushAccepted | undefined> {
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
        if (
          PushNotificationService.isRelayDeviceNotRegisteredAnswer(response)
        ) {
          await PushNotificationService.stopSendingToGoneExpoPushToken(
            expoPushToken,
          );

          throw new Error(PushNotificationService.EXPO_PUSH_TOKEN_GONE_MESSAGE);
        }

        /*
         * Expo refused it for another reason, and the relay says which:
         * said as a direct send says it. An older relay answers every such
         * refusal 500 "Server Error", which falls through to below.
         */
        const refusal: { code: string; message: string } | null =
          PushNotificationService.getRelayExpoRefusal(response);

        if (refusal) {
          throw new Error(
            `Expo push notification failed: ${PushNotificationService.withoutPushToken(
              refusal.message,
              expoPushToken,
            )}`,
          );
        }

        throw new Error(
          `Push relay error: ${JSON.stringify(response.jsonData)}`,
        );
      }

      logger.info(
        `Push notification sent via relay successfully to ${deviceType} device`,
      );

      /*
       * The relay names the receipt of the push it sent, and answers for it
       * later (getExpoPushReceiptsThroughRelay). An older relay names none,
       * and nothing is read; so does a relay whose receipts cannot be found
       * from its address.
       */
      const receiptId: unknown = PushNotificationService.readAnswerField(
        response,
        "receiptId",
      );

      if (
        PushNotificationService.isExpoPushReceiptId(receiptId) &&
        PushNotificationService.getRelayReceiptsUrl()
      ) {
        return {
          receiptId: receiptId,
          via: "relay",
          sentAt: Date.now(),
        };
      }

      return undefined;
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

  /*
   * The push relay's send, for a server that relays its pages here. Answers
   * the receipt id of the push Expo accepted, for that server to ask for
   * its receipt later (getRelayPushReceipts); undefined when Expo gave none.
   */
  public static async sendRelayPushNotification(data: {
    to: string;
    title?: string;
    body?: string;
    data?: { [key: string]: string };
    sound?: ExpoPushSound;
    priority?: string;
    channelId?: string;
    interruptionLevel?: ExpoInterruptionLevel;
  }): Promise<string | undefined> {
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

    /*
     * What another server relays is held to what Expo takes as well
     * (fitMessage): a server of an older version relays its text as it is.
     */
    const fitted: PushNotificationMessage = this.fitMessage({
      title: data.title || "",
      body: data.body || "",
      ...(data.data ? { data: data.data } : {}),
    });

    const expoPushMessage: ExpoPushMessage = {
      to: data.to,
      title: fitted.title,
      body: fitted.body,
      data: (fitted.data as { [key: string]: string } | undefined) || {},
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

      /*
       * Expo's message names the token, and the token is the address that
       * pages somebody else's phone - another installation's user. It stays
       * out of this relay's logs, and out of its answer.
       */
      const expoMessage: string = PushNotificationService.withoutAnyPushToken(
        PushNotificationService.withoutPushToken(
          errorTicket.message || "",
          data.to,
        ),
      );

      logger.error(`Push relay: Expo push notification error: ${expoMessage}`);

      /*
       * Said apart from every other failure, so the server that relayed
       * the page learns that the token is gone and stops sending to it: the
       * relay route answers this with getRelayDeviceNotRegisteredAnswer.
       */
      if (PushNotificationService.isExpoDeviceNotRegisteredTicket(ticket)) {
        throw new ExpoDeviceNotRegisteredError();
      }

      /*
       * Every other refusal, with Expo's code and words, so the relay route
       * can say which it was (getRelayExpoRefusalAnswer).
       */
      const code: unknown = errorTicket.details?.error;

      throw new ExpoPushRefusedError({
        code: typeof code === "string" && code ? code : undefined,
        expoMessage: expoMessage,
      });
    }

    logger.info("Push relay: notification sent successfully");

    return ticket?.status === "ok" &&
      PushNotificationService.isExpoPushReceiptId(ticket.id)
      ? ticket.id
      : undefined;
  }

  /*
   * The receipts of pushes this deployment sent with its own Expo access
   * token, by receipt id. A receipt that is not ready yet is not among them.
   * Throws when Expo cannot be asked, for the caller to ask again later.
   */
  public static async getExpoPushReceipts(
    receiptIds: Array<string>,
  ): Promise<Map<string, ExpoPushReceiptResult>> {
    const receipts: Map<string, ExpoPushReceiptResult> = new Map<
      string,
      ExpoPushReceiptResult
    >();

    if (receiptIds.length === 0) {
      return receipts;
    }

    const answer: { [id: string]: ExpoPushReceipt } =
      await this.expoClient.getPushNotificationReceiptsAsync(receiptIds);

    for (const receiptId of receiptIds) {
      if (!Object.prototype.hasOwnProperty.call(answer, receiptId)) {
        continue;
      }

      const receipt: ExpoPushReceiptResult | null =
        PushNotificationService.readExpoPushReceipt(answer[receiptId]);

      if (receipt) {
        receipts.set(receiptId, receipt);
      }
    }

    return receipts;
  }

  /*
   * The push relay's answer to a server asking for the receipts of pushes
   * it relayed (the relay route's POST /receipts): whether each was
   * delivered, read from Expo with this deployment's access token. Only
   * each receipt's status, Expo's code and its message, the token taken
   * out: the route is unauthenticated, and a receipt names the token it was
   * for. The relay keeps nothing of the pushes it sends; the server that
   * sent each one asks for its receipt.
   */
  public static async getRelayPushReceipts(
    receiptIds: Array<string>,
  ): Promise<JSONObject> {
    if (!PushNotificationService.hasExpoAccessToken()) {
      throw new Error(
        "Push relay is not configured. EXPO_ACCESS_TOKEN is not set on this server.",
      );
    }

    const receipts: Map<string, ExpoPushReceiptResult> =
      await PushNotificationService.getExpoPushReceipts(receiptIds);

    const answer: JSONObject = {};

    for (const [receiptId, receipt] of receipts.entries()) {
      if (receipt.status === "ok") {
        answer[receiptId] = { status: "ok" };
        continue;
      }

      answer[receiptId] = {
        status: "error",
        message: PushNotificationService.withoutAnyPushToken(receipt.message),
        ...(receipt.details?.error
          ? { details: { error: receipt.details.error } }
          : {}),
      };
    }

    return answer;
  }

  /*
   * The receipts of pushes this server sent through the push relay, asked
   * of the relay (it holds the Expo access token this server does not).
   * "unavailable" when there is no relay to ask, or it is older than
   * receipts (it answers 404); every other failure throws, for the caller to
   * ask again later.
   */
  public static async getExpoPushReceiptsThroughRelay(
    receiptIds: Array<string>,
  ): Promise<RelayPushReceiptsResult> {
    const receiptsUrl: string | null =
      PushNotificationService.getRelayReceiptsUrl();

    if (!receiptsUrl) {
      return { kind: "unavailable" };
    }

    const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
      await API.post<JSONObject>({
        url: URL.fromString(receiptsUrl),
        data: {
          ids: receiptIds,
        },
      });

    if (response instanceof HTTPErrorResponse) {
      if (response.statusCode === 404 || response.statusCode === 405) {
        return { kind: "unavailable" };
      }

      throw new Error(
        `Push relay receipts error (${response.statusCode}): ${JSON.stringify(response.jsonData)}`,
      );
    }

    const answered: unknown = PushNotificationService.readAnswerField(
      response,
      "receipts",
    );

    if (!answered || typeof answered !== "object" || Array.isArray(answered)) {
      throw new Error(
        `Push relay receipts answer has no receipts: ${JSON.stringify(response.jsonData)}`,
      );
    }

    const receipts: Map<string, ExpoPushReceiptResult> = new Map<
      string,
      ExpoPushReceiptResult
    >();

    for (const receiptId of receiptIds) {
      if (!Object.prototype.hasOwnProperty.call(answered, receiptId)) {
        continue;
      }

      const receipt: ExpoPushReceiptResult | null =
        PushNotificationService.readExpoPushReceipt(
          (answered as JSONObject)[receiptId],
        );

      if (receipt) {
        receipts.set(receiptId, receipt);
      }
    }

    return { kind: "receipts", receipts: receipts };
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
