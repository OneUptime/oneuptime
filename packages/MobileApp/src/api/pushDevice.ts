import { Platform } from "react-native";
import * as Device from "expo-device";
import apiClient from "./client";
import type { CriticalAlertSoundIdValue } from "../notifications/criticalAlertSounds";
import logger from "../utils/logger";

/*
 * What the server says about the device a registration made or found. A
 * server from before it said leaves isCriticalAlertEnabled out, and so does
 * one answering for a device that is not a phone's.
 */
export interface RegisteredPushDevice {
  /*
   * Whether a critical page rings through on this device, as the server
   * holds it now that the registration is done.
   */
  isCriticalAlertEnabled?: boolean | undefined;
}

export async function registerPushDevice(params: {
  deviceToken: string;
  projectId: string;
  /*
   * What this phone will do with a critical page: on only while the
   * responder has Critical On-Call Alerts on AND the phone's system allows
   * it (notifications/criticalAlertsReport.ts).
   */
  isCriticalAlertEnabled?: boolean;
  /*
   * The alarm sound and iPhone volume this device chose for critical pages
   * (Settings > Alarm sound), restated like isCriticalAlertEnabled. A server
   * older than the choice ignores them.
   */
  criticalAlertSound?: CriticalAlertSoundIdValue | undefined;
  criticalAlertVolume?: number | undefined;
  /*
   * The token this app had before `deviceToken`, when it changed: the
   * server moves the device registered with it, rules and all, to the new
   * token. A server older than this ignores it.
   */
  previousDeviceToken?: string | undefined;
}): Promise<RegisteredPushDevice | undefined> {
  const deviceType: string =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : "web";

  try {
    const response: { data?: unknown } | undefined = await apiClient.post(
      "/api/user-push/register",
      {
        deviceToken: params.deviceToken,
        deviceType: deviceType,
        deviceName: Device.modelName || "Unknown Device",
        projectId: params.projectId,
        /*
         * Restated on every registration. A responder who joins a new
         * project, reinstalls, or is issued a fresh push token creates a new
         * device row, and a row created without this defaults to off - so the
         * phone would quietly stop overriding Do Not Disturb for exactly the
         * project they just joined. A device the phone already has takes it
         * too, on a server that knows to.
         */
        isCriticalAlertEnabled: Boolean(params.isCriticalAlertEnabled),
        /*
         * The same goes for the alarm: a row created without it plays the
         * system sound, not the one the responder picked.
         */
        ...(params.criticalAlertSound
          ? { criticalAlertSound: params.criticalAlertSound }
          : {}),
        ...(params.criticalAlertVolume !== undefined
          ? { criticalAlertVolume: params.criticalAlertVolume }
          : {}),
        ...(params.previousDeviceToken
          ? { previousDeviceToken: params.previousDeviceToken }
          : {}),
      },
    );
    logger.info(
      `[PushNotifications] Device registered successfully for project ${params.projectId}`,
    );

    const isCriticalAlertEnabled: unknown = (
      response?.data as { isCriticalAlertEnabled?: unknown } | undefined
    )?.isCriticalAlertEnabled;

    return typeof isCriticalAlertEnabled === "boolean"
      ? { isCriticalAlertEnabled: isCriticalAlertEnabled }
      : {};
  } catch (error: unknown) {
    const status: number | undefined = (
      error as { response?: { status?: number } }
    )?.response?.status;
    const message: string =
      (error as { response?: { data?: { message?: string } } })?.response?.data
        ?.message || String(error);

    // Treat "already registered" as success
    if (status === 400 && message.includes("already registered")) {
      logger.info(
        `[PushNotifications] Device already registered for project ${params.projectId}`,
      );
      return undefined;
    }

    // Log and re-throw other errors
    logger.error(
      `[PushNotifications] Registration failed (status=${status}): ${message}`,
    );
    throw error;
  }
}

/*
 * Turn "ring through silent mode" on or off for this handset, across every
 * project it is registered against. Keyed on the push token because that is
 * the only device identity the app holds; the server resolves it to the
 * caller's own rows.
 *
 * Errors are not swallowed. Enabling is a promise to the responder that their
 * phone will wake them, and a toggle that looked like it worked but did not
 * reach the server is the exact failure mode this feature is meant to remove,
 * so the caller reverts the switch and says so.
 */
export async function setCriticalAlertsEnabledOnServer(params: {
  deviceToken: string;
  isEnabled: boolean;
}): Promise<void> {
  await apiClient.post("/api/user-push/critical-alerts", {
    deviceToken: params.deviceToken,
    isEnabled: params.isEnabled,
  });

  logger.info(
    `[PushNotifications] Critical alerts ${
      params.isEnabled ? "enabled" : "disabled"
    } for this device`,
  );
}

/*
 * A server from before alarm sounds could be chosen has no route for them.
 * Told apart from any other failure because the cure is different: nothing
 * the responder does on the phone helps until the server is updated.
 */
export class CriticalAlertPreferencesUnsupportedError extends Error {
  public constructor() {
    super(
      "This OneUptime server does not support choosing an alarm sound yet. Ask your administrator to update OneUptime.",
    );
    this.name = "CriticalAlertPreferencesUnsupportedError";
  }
}

/*
 * Choose the alarm this handset's critical pages play, and on an iPhone how
 * loud, across every project it is registered against - keyed on the push
 * token, like the critical alerts toggle. Either may be left out to keep what
 * the server has.
 *
 * Errors are not swallowed: the screen shows the choice only once the server
 * holds it, because the server is what puts the sound in the page.
 */
export async function setCriticalAlertPreferencesOnServer(params: {
  deviceToken: string;
  sound?: CriticalAlertSoundIdValue | undefined;
  volume?: number | undefined;
}): Promise<void> {
  try {
    await apiClient.post("/api/user-push/critical-alert-preferences", {
      deviceToken: params.deviceToken,
      ...(params.sound !== undefined ? { sound: params.sound } : {}),
      ...(params.volume !== undefined ? { volume: params.volume } : {}),
    });
  } catch (error: unknown) {
    const status: number | undefined = (
      error as { response?: { status?: number } }
    )?.response?.status;

    if (status === 404) {
      throw new CriticalAlertPreferencesUnsupportedError();
    }

    throw error;
  }

  logger.info(
    `[PushNotifications] Critical alert ${[
      params.sound !== undefined ? `sound set to ${params.sound}` : "",
      params.volume !== undefined ? `volume set to ${params.volume}%` : "",
    ]
      .filter(Boolean)
      .join(" and ")} for this device`,
  );
}

export async function unregisterPushDevice(deviceToken: string): Promise<void> {
  try {
    await apiClient.post("/api/user-push/unregister", {
      deviceToken: deviceToken,
    });
  } catch {
    // Best-effort: don't block logout on failure
  }
}
