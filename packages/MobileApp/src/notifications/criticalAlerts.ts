import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import { NotificationChannelId } from "./channels";
import logger from "../utils/logger";

/*
 * Whether this device can be made to ring through silent mode, and how to ask
 * for that if it cannot yet.
 *
 * The two platforms grant this in completely different ways and neither one
 * fails loudly when it is missing, which is the whole reason this module
 * exists. A phone that quietly refuses to override Do Not Disturb looks
 * identical to one that was never asked, right up until the 3am page nobody
 * hears - so everything here is written to establish the CURRENT state from
 * the OS rather than from what the app last tried to set.
 *
 *   iOS     - needs Apple's critical-alert entitlement on the build AND the
 *             user's consent, reported back as
 *             permissions.ios.allowsCriticalAlerts - which is null, not
 *             false, until an entitled build has asked for it.
 *   Android - needs the notification channel to actually carry bypassDnd,
 *             which the OS grants only after the user gives this app
 *             Notification Policy Access in system settings. Writing
 *             bypassDnd: true without it succeeds and produces a channel with
 *             bypassDnd: false.
 */

export enum CriticalAlertAvailability {
  // The OS will let critical alerts through. Safe to turn the setting on.
  Granted = "granted",
  /*
   * Not granted yet. requestCriticalAlertPermission() asks where it can, and
   * the reason says what is still missing.
   *
   * An iOS build without Apple's entitlement lands here too, not in
   * Unsupported: iOS reports it exactly as it reports an entitled build that
   * has not asked yet, so the only way to tell them apart is to ask - which
   * is what turning the setting on does.
   */
  Denied = "denied",
  // Simulator or web: there is no ringer for the OS to override.
  Unsupported = "unsupported",
}

export interface CriticalAlertStatus {
  availability: CriticalAlertAvailability;
  /*
   * What to tell the responder. Kept next to the availability because the same
   * "denied" means two very different chores on the two platforms.
   */
  reason: string;
}

const IOS_DENIED_REASON: string =
  "iOS has not granted critical alerts to this app. Allow Critical Alerts for OneUptime On-Call in iOS Settings > Notifications.";

const IOS_NOT_OFFERED_REASON: string =
  "iOS does not offer critical alerts to this version of the app, so there is no Critical Alerts switch for it in iOS Settings. Update OneUptime On-Call from the App Store, then try again.";

const IOS_NOTIFICATIONS_OFF_REASON: string =
  "Notifications are turned off for this app. Turn on Allow Notifications for OneUptime On-Call in iOS Settings > Notifications, then try again.";

const ANDROID_DENIED_REASON: string =
  "Android has not granted Do Not Disturb access to this app. Allow it in Settings > Notifications > Do Not Disturb access, then try again.";

const UNSUPPORTED_REASON: string =
  "Critical alerts are only available on a physical iOS or Android device.";

const GRANTED_REASON: string =
  "On-call pages will play a sound even when this device is silenced or in Do Not Disturb.";

/*
 * Read the critical channel back from Android and report whether it really
 * bypasses Do Not Disturb.
 *
 * setNotificationChannelAsync returns the channel as the OS actually stored
 * it, so the returned bypassDnd is the OS's answer and not an echo of the
 * request. The channel is (re)written here rather than only read because a
 * fresh install may not have created it yet, and creating it is harmless when
 * it already exists - Android ignores every field but name and description on
 * an existing channel.
 */
export async function isCriticalChannelBypassingDnd(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return false;
  }

  try {
    const channel: Notifications.NotificationChannel | null =
      await Notifications.getNotificationChannelAsync(
        NotificationChannelId.CRITICAL,
      );

    return Boolean(channel?.bypassDnd);
  } catch (error: unknown) {
    logger.warn(
      "[CriticalAlerts] Could not read the critical notification channel:",
      error,
    );
    return false;
  }
}

/*
 * allowsCriticalAlerts has three answers, and the two that are not `true` need
 * different instructions:
 *
 *   false - iOS Settings has a Critical Alerts switch for this app and it is
 *           off: the responder declined the prompt or switched it off later.
 *           Settings is the place to send them.
 *   null  - iOS reports critical alerts as not supported, and Settings has no
 *           such switch at all. iOS adds it only once a build carrying Apple's
 *           entitlement has asked, so this is also an entitled build that has
 *           not asked yet - turning the setting on asks first. If it is still
 *           null after that, the build lacks the entitlement, as every App
 *           Store build up to 1.4.0 did. Pointing the responder at a Settings
 *           switch that does not exist is a dead end, so the reason names the
 *           app version instead.
 *
 * Notifications turned off for the app altogether outrank both: that is the
 * first switch the responder needs, and while it is off the app does not even
 * register this device for pushes.
 */
async function getIosCriticalAlertStatus(): Promise<CriticalAlertStatus> {
  const permissions: Notifications.NotificationPermissionsStatus =
    await Notifications.getPermissionsAsync();

  const allowsCriticalAlerts: boolean | null | undefined =
    permissions.ios?.allowsCriticalAlerts;

  if (allowsCriticalAlerts) {
    return {
      availability: CriticalAlertAvailability.Granted,
      reason: GRANTED_REASON,
    };
  }

  if (permissions.status === "denied") {
    return {
      availability: CriticalAlertAvailability.Denied,
      reason: IOS_NOTIFICATIONS_OFF_REASON,
    };
  }

  return {
    availability: CriticalAlertAvailability.Denied,
    reason:
      allowsCriticalAlerts === false
        ? IOS_DENIED_REASON
        : IOS_NOT_OFFERED_REASON,
  };
}

async function getAndroidCriticalAlertStatus(): Promise<CriticalAlertStatus> {
  const bypassesDnd: boolean = await isCriticalChannelBypassingDnd();

  if (bypassesDnd) {
    return {
      availability: CriticalAlertAvailability.Granted,
      reason: GRANTED_REASON,
    };
  }

  return {
    availability: CriticalAlertAvailability.Denied,
    reason: ANDROID_DENIED_REASON,
  };
}

export async function getCriticalAlertStatus(): Promise<CriticalAlertStatus> {
  /*
   * Simulators report permissions that a real handset would not honour, and
   * there is no ringer to override on web.
   */
  if (
    !Device.isDevice ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  ) {
    return {
      availability: CriticalAlertAvailability.Unsupported,
      reason: UNSUPPORTED_REASON,
    };
  }

  try {
    if (Platform.OS === "ios") {
      return await getIosCriticalAlertStatus();
    }

    return await getAndroidCriticalAlertStatus();
  } catch (error: unknown) {
    logger.warn(
      "[CriticalAlerts] Could not determine critical alert status:",
      error,
    );
    /*
     * Report "denied" rather than "granted" when the answer is unknown. The
     * cost of being wrong in this direction is a responder who is told to
     * check a setting that was already fine; the other direction is a
     * responder told their phone will wake them when it will not.
     */
    return {
      availability: CriticalAlertAvailability.Denied,
      reason: Platform.OS === "ios" ? IOS_DENIED_REASON : ANDROID_DENIED_REASON,
    };
  }
}

/*
 * Ask for the capability, then report what the OS decided.
 *
 * iOS can be asked in-app: requesting the critical-alert permission shows the
 * system prompt (once - after that the request resolves immediately with
 * whatever the user chose the first time, which is why the caller is sent to
 * Settings on a denial). A build without Apple's entitlement gets no prompt at
 * all: iOS drops the option from the request without an error, and the status
 * read back afterwards says the app version is what is missing.
 *
 * Android cannot be asked in-app at all. Do Not Disturb access is granted only
 * from a system settings screen, so the best available move is to open that
 * screen; the return value here is the state BEFORE the user acts on it, and
 * the caller re-checks when the app comes back to the foreground.
 */
export async function requestCriticalAlertPermission(): Promise<CriticalAlertStatus> {
  if (
    !Device.isDevice ||
    (Platform.OS !== "ios" && Platform.OS !== "android")
  ) {
    return {
      availability: CriticalAlertAvailability.Unsupported,
      reason: UNSUPPORTED_REASON,
    };
  }

  if (Platform.OS === "ios") {
    try {
      await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowCriticalAlerts: true,
        },
      });
    } catch (error: unknown) {
      logger.warn(
        "[CriticalAlerts] Requesting the iOS critical alert permission failed:",
        error,
      );
    }

    return getCriticalAlertStatus();
  }

  await openAndroidDoNotDisturbAccessSettings();

  return getCriticalAlertStatus();
}

/*
 * Open the system screen where Do Not Disturb access is granted.
 *
 * sendIntent is used rather than Linking.openSettings() because the app's own
 * settings page does not contain this toggle - Do Not Disturb access is a
 * separate, global list. If the intent is unavailable on some OEM build, fall
 * back to the app settings page, which is at least one tap from the right
 * place rather than nowhere.
 */
export async function openAndroidDoNotDisturbAccessSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  try {
    await Linking.sendIntent(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
  } catch (error: unknown) {
    logger.warn(
      "[CriticalAlerts] Could not open Do Not Disturb access settings:",
      error,
    );

    try {
      await Linking.openSettings();
    } catch (fallbackError: unknown) {
      logger.warn(
        "[CriticalAlerts] Could not open app settings either:",
        fallbackError,
      );
    }
  }
}
