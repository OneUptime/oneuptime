import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Linking, Platform } from "react-native";
import { CRITICAL_CHANNELS } from "./channels";
import {
  getCriticalAlertSoundOption,
  type CriticalAlertSoundIdValue,
} from "./criticalAlertSounds";
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
 *             Notification Policy Access in system settings - and only to a
 *             channel the app writes after that. Writing bypassDnd: true
 *             without the access succeeds and produces a channel with
 *             bypassDnd: false, which stays false until the app writes the
 *             channel again (isCriticalChannelBypassingDnd).
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

export interface CriticalAlertStatusOptions {
  /*
   * The alarm sound the responder chose. On Android each sound pages on a
   * channel of its own, and the chosen sound's channel is the one that has to
   * bypass Do Not Disturb. Left out, the system sound's channel.
   */
  sound?: CriticalAlertSoundIdValue | undefined;
}

export interface CriticalAlertStatus {
  availability: CriticalAlertAvailability;
  /*
   * What to tell the responder. Kept next to the availability because the same
   * "denied" means two very different chores on the two platforms.
   */
  reason: string;
  /*
   * Set when the OS could not be asked at all. The availability is then the
   * cautious answer for the screen to show (denied), not a reading anything
   * may act on: the server is never told that a phone stopped ringing
   * through over a failed read (notifications/criticalAlertsReport.ts).
   */
  isUncertain?: boolean | undefined;
  /*
   * On a denied status: what the Settings screen says when the responder has
   * Critical On-Call Alerts on and the phone's own settings turn them off -
   * why the switch reads off, what pages do meanwhile, and where to turn
   * them back on. `reason` says what to do when turning the switch on.
   */
  offInPhoneSettings?: CriticalAlertsOffInPhoneSettings | undefined;
}

export interface CriticalAlertsOffInPhoneSettings {
  message: string;
  place: CriticalAlertSettingsPlace;
}

/*
 * Where offInPhoneSettings sends the responder: the phone's settings page
 * that turns critical alerts back on (openCriticalAlertSettings), or the App
 * Store, which the app does not open for them.
 */
export enum CriticalAlertSettingsPlace {
  IosAppSettings = "ios-app-settings",
  AndroidDoNotDisturbAccess = "android-do-not-disturb-access",
  AppStore = "app-store",
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
 * What the Settings screen says when the responder turned Critical On-Call
 * Alerts on and the phone's settings have turned them off since - the
 * switch reads off, and the server sends pages as ordinary notifications
 * (criticalAlertsReport), so the responder is told why, and where to undo it.
 */
export const IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS: string =
  "Off in iOS Settings: Critical Alerts are turned off for OneUptime On-Call, so on-call pages arrive as ordinary notifications. Turn them back on in iOS Settings > Notifications > OneUptime On-Call.";

export const IOS_NOTIFICATIONS_OFF_IN_SETTINGS: string =
  "Off in iOS Settings: notifications are turned off for OneUptime On-Call, so on-call pages do not reach this phone at all. Turn on Allow Notifications in iOS Settings > Notifications > OneUptime On-Call.";

export const IOS_CRITICAL_ALERTS_NOT_OFFERED: string =
  "Off: iOS does not offer critical alerts to this version of the app, so on-call pages arrive as ordinary notifications. Update OneUptime On-Call from the App Store.";

export const ANDROID_CRITICAL_ALERTS_OFF_IN_SETTINGS: string =
  "Off in Android settings: your alarm cannot ring through Do Not Disturb, so on-call pages arrive as ordinary notifications, silent in Do Not Disturb. Allow OneUptime On-Call in Settings > Notifications > Do Not Disturb access.";

/*
 * Write the critical channels again, then report whether Android really lets
 * the chosen sound's channel bypass Do Not Disturb.
 *
 * Android settles a channel's bypass when the app WRITES the channel, not when
 * the user grants access. The app writes its channels when it starts, which on
 * a fresh install is before anybody has granted Do Not Disturb access, so the
 * critical channels are stored with bypassDnd false. Granting the access later
 * changes nothing on a stored channel: Android raises bypassDnd on an existing
 * channel only when an app that holds the access writes it again, and only
 * while the user has not changed any of that channel's settings themselves.
 * Reading the channel without writing it first therefore went on reporting
 * the old false after the responder had granted the access - the settings
 * screen told them to grant it again, and the switch would not stay on until
 * the app was restarted.
 *
 * So the channels are written here, every time the status is read: on
 * returning from the Do Not Disturb access screen, that write is what turns
 * the bypass on. Every critical channel is written, not only the chosen
 * sound's, so a responder who picks another alarm later finds it already
 * bypassing. It is harmless otherwise - on an existing channel Android keeps
 * every setting the user changed, and never lets the app undo a bypass the
 * user switched off. setNotificationChannelAsync returns the channel as
 * Android stored it, so the returned bypassDnd is Android's answer, not an
 * echo of the request.
 *
 * A channel the user changed before granting the access stays without the
 * bypass whatever the app writes; that phone is reported as denied, which is
 * true, and the responder can let the channel override Do Not Disturb in the
 * phone's own settings.
 */
export async function isCriticalChannelBypassingDnd(
  sound?: CriticalAlertSoundIdValue,
): Promise<boolean> {
  return Boolean(await readCriticalChannelBypass(sound));
}

/*
 * isCriticalChannelBypassingDnd's answer, or null when Android could not be
 * asked at all: writing the channels failed and reading the chosen one
 * failed too. A channel that is not there is an answer (false); a read that
 * threw is not one.
 */
async function readCriticalChannelBypass(
  sound?: CriticalAlertSoundIdValue,
): Promise<boolean | null> {
  if (Platform.OS !== "android") {
    return false;
  }

  const chosenChannelId: string = getCriticalAlertSoundOption(sound).channelId;

  let chosenChannel: Notifications.NotificationChannel | null = null;
  let isChosenChannelWritten: boolean = false;

  for (const { id, channel } of CRITICAL_CHANNELS) {
    try {
      const stored: Notifications.NotificationChannel | null =
        await Notifications.setNotificationChannelAsync(id, channel);

      if (id === chosenChannelId) {
        chosenChannel = stored;
        isChosenChannelWritten = true;
      }
    } catch (error: unknown) {
      logger.warn(
        `[CriticalAlerts] Could not write the critical notification channel ${id}:`,
        error,
      );
    }
  }

  if (isChosenChannelWritten) {
    return Boolean(chosenChannel?.bypassDnd);
  }

  /*
   * The write failed, but the channel may still be there from when the app
   * started: what Android stored is still the truest answer available, and a
   * channel that already bypasses Do Not Disturb should not be reported as
   * one that does not.
   */
  try {
    const channel: Notifications.NotificationChannel | null =
      await Notifications.getNotificationChannelAsync(chosenChannelId);

    return Boolean(channel?.bypassDnd);
  } catch (error: unknown) {
    logger.warn(
      `[CriticalAlerts] Could not read the critical notification channel ${chosenChannelId}:`,
      error,
    );
    return null;
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
      offInPhoneSettings: {
        message: IOS_NOTIFICATIONS_OFF_IN_SETTINGS,
        place: CriticalAlertSettingsPlace.IosAppSettings,
      },
    };
  }

  if (allowsCriticalAlerts === false) {
    return {
      availability: CriticalAlertAvailability.Denied,
      reason: IOS_DENIED_REASON,
      offInPhoneSettings: {
        message: IOS_CRITICAL_ALERTS_OFF_IN_SETTINGS,
        place: CriticalAlertSettingsPlace.IosAppSettings,
      },
    };
  }

  return {
    availability: CriticalAlertAvailability.Denied,
    reason: IOS_NOT_OFFERED_REASON,
    offInPhoneSettings: {
      message: IOS_CRITICAL_ALERTS_NOT_OFFERED,
      place: CriticalAlertSettingsPlace.AppStore,
    },
  };
}

async function getAndroidCriticalAlertStatus(
  sound: CriticalAlertSoundIdValue | undefined,
): Promise<CriticalAlertStatus> {
  const bypassesDnd: boolean | null = await readCriticalChannelBypass(sound);

  if (bypassesDnd) {
    return {
      availability: CriticalAlertAvailability.Granted,
      reason: GRANTED_REASON,
    };
  }

  return {
    availability: CriticalAlertAvailability.Denied,
    reason: ANDROID_DENIED_REASON,
    offInPhoneSettings: {
      message: ANDROID_CRITICAL_ALERTS_OFF_IN_SETTINGS,
      place: CriticalAlertSettingsPlace.AndroidDoNotDisturbAccess,
    },
    ...(bypassesDnd === null ? { isUncertain: true } : {}),
  };
}

export async function getCriticalAlertStatus(
  options: CriticalAlertStatusOptions = {},
): Promise<CriticalAlertStatus> {
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

    return await getAndroidCriticalAlertStatus(options.sound);
  } catch (error: unknown) {
    logger.warn(
      "[CriticalAlerts] Could not determine critical alert status:",
      error,
    );
    /*
     * Report "denied" rather than "granted" when the answer is unknown. The
     * cost of being wrong in this direction is a responder who is told to
     * check a setting that was already fine; the other direction is a
     * responder told their phone will wake them when it will not. Marked
     * uncertain, so nothing tells the server pages should stop ringing
     * through on the strength of it.
     */
    return {
      availability: CriticalAlertAvailability.Denied,
      reason: Platform.OS === "ios" ? IOS_DENIED_REASON : ANDROID_DENIED_REASON,
      isUncertain: true,
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
export async function requestCriticalAlertPermission(
  options: CriticalAlertStatusOptions = {},
): Promise<CriticalAlertStatus> {
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

    return getCriticalAlertStatus(options);
  }

  await openAndroidDoNotDisturbAccessSettings();

  return getCriticalAlertStatus(options);
}

/*
 * Open the place in the phone's settings that turns critical alerts back on
 * (CriticalAlertsOffInPhoneSettings.place): this app's page in iOS Settings,
 * where its Notifications and Critical Alerts switches are, or Android's Do
 * Not Disturb access list. The App Store is not opened for the responder.
 * Never throws: a phone that cannot open it leaves the words to say where.
 */
export async function openCriticalAlertSettings(
  place: CriticalAlertSettingsPlace,
): Promise<void> {
  if (place === CriticalAlertSettingsPlace.AndroidDoNotDisturbAccess) {
    await openAndroidDoNotDisturbAccessSettings();
    return;
  }

  if (place !== CriticalAlertSettingsPlace.IosAppSettings) {
    return;
  }

  try {
    await Linking.openSettings();
  } catch (error: unknown) {
    logger.warn("[CriticalAlerts] Could not open the app's settings:", error);
  }
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
