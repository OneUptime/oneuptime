import { Platform } from "react-native";
import * as Device from "expo-device";
import apiClient from "./client";
import logger from "../utils/logger";

export async function registerPushDevice(params: {
  deviceToken: string;
  projectId: string;
  isCriticalAlertEnabled?: boolean;
}): Promise<void> {
  const deviceType: string =
    Platform.OS === "ios"
      ? "ios"
      : Platform.OS === "android"
        ? "android"
        : "web";

  try {
    await apiClient.post("/api/user-push/register", {
      deviceToken: params.deviceToken,
      deviceType: deviceType,
      deviceName: Device.modelName || "Unknown Device",
      projectId: params.projectId,
      /*
       * Restated on every registration. A responder who joins a new project,
       * reinstalls, or is issued a fresh push token creates a new device row,
       * and a row created without this defaults to off - so the phone would
       * quietly stop overriding Do Not Disturb for exactly the project they
       * just joined.
       */
      isCriticalAlertEnabled: Boolean(params.isCriticalAlertEnabled),
    });
    logger.info(
      `[PushNotifications] Device registered successfully for project ${params.projectId}`,
    );
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
      return;
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

export async function unregisterPushDevice(deviceToken: string): Promise<void> {
  try {
    await apiClient.post("/api/user-push/unregister", {
      deviceToken: deviceToken,
    });
  } catch {
    // Best-effort: don't block logout on failure
  }
}
