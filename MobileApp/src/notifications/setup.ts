import * as Notifications from "expo-notifications";
import type { ExpoPushToken } from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { PermissionStatus } from "expo-modules-core";
import { NOTIFICATION_CHANNELS } from "./channels";
import logger from "../utils/logger";

// Show notifications when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => {
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  /*
   * Created on every launch, not only the first. Android treats this as a
   * no-op for a channel that already exists, and a responder who cleared the
   * app's data or restored to a new phone otherwise ends up with the server
   * naming channels that are not there - which does not error, it just
   * delivers the page with default settings.
   */
  for (const { id, channel } of NOTIFICATION_CHANNELS) {
    try {
      await Notifications.setNotificationChannelAsync(id, channel);
    } catch (error: unknown) {
      logger.error(
        `[PushNotifications] Failed to create notification channel ${id}:`,
        error,
      );
    }
  }
}

export async function setupNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync("INCIDENT_ACTIONS", [
    {
      identifier: "ACKNOWLEDGE",
      buttonTitle: "Acknowledge",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "VIEW",
      buttonTitle: "View",
      options: { opensAppToForeground: true },
    },
  ]);

  await Notifications.setNotificationCategoryAsync("ALERT_ACTIONS", [
    {
      identifier: "ACKNOWLEDGE",
      buttonTitle: "Acknowledge",
      options: { opensAppToForeground: false },
    },
    {
      identifier: "VIEW",
      buttonTitle: "View",
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function requestPermissionsAndGetToken(): Promise<string | null> {
  if (!Device.isDevice) {
    logger.warn(
      "[PushNotifications] Not a physical device — skipping push token registration",
    );
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus: PermissionStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true,
      },
    });
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    logger.warn(
      "[PushNotifications] Push notification permission not granted:",
      finalStatus,
    );
    return null;
  }

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    logger.warn(
      "[PushNotifications] EAS project ID not found — cannot register for push notifications",
    );
    return null;
  }

  try {
    logger.info(
      `[PushNotifications] Requesting Expo push token with projectId: ${projectId}`,
    );

    const tokenData: ExpoPushToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    /*
     * The token itself is deliberately NOT in this message. It is the address
     * that pages this responder's handset, so anything holding it can deliver
     * a notification that looks exactly like a OneUptime page - and on Android
     * any app with READ_LOGS on a rooted or developer handset can read the
     * device log. Logger output also travels: into bug reports the responder
     * files, and into crash-reporter breadcrumbs. The diagnostic that matters
     * here is that a token was obtained AT ALL, since the failure this line
     * helps debug is the empty/absent one; the credential adds nothing to it.
     */
    logger.info("[PushNotifications] Successfully obtained push token");

    return tokenData.data;
  } catch (error: unknown) {
    logger.error("[PushNotifications] Failed to get push token:", error);
    return null;
  }
}
