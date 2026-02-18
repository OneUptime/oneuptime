import * as Notifications from "expo-notifications";
import type { ExpoPushToken } from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { PermissionStatus } from "expo-modules-core";

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

  await Notifications.setNotificationChannelAsync("oncall_critical", {
    name: "Critical Alerts",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 500, 250, 500],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  await Notifications.setNotificationChannelAsync("oncall_high", {
    name: "High Priority",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });

  await Notifications.setNotificationChannelAsync("oncall_normal", {
    name: "Normal Priority",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });

  await Notifications.setNotificationChannelAsync("oncall_low", {
    name: "Low Priority",
    importance: Notifications.AndroidImportance.LOW,
  });
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
    console.warn(
      "[PushNotifications] Not a physical device — skipping push token registration",
    );
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus: PermissionStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn(
      "[PushNotifications] Push notification permission not granted:",
      finalStatus,
    );
    return null;
  }

  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn(
      "[PushNotifications] EAS project ID not found — cannot register for push notifications",
    );
    return null;
  }

  try {
    const tokenData: ExpoPushToken = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    return tokenData.data;
  } catch (error: unknown) {
    console.error("[PushNotifications] Failed to get push token:", error);
    return null;
  }
}
