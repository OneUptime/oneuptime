import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Critical alerts as the Push Notification Devices card shows them
 * (User Settings > Notification Methods > Push Notifications).
 *
 * Whether on-call pages ring a device through silent mode and Do Not Disturb
 * is decided on that device: the responder turns on Critical On-Call Alerts
 * in the OneUptime On-Call app, the phone's system has to allow it, and the
 * app tells the server (UserPushAPI's critical-alerts route). Nobody can
 * change it from the Dashboard - UserPush.isCriticalAlertEnabled grants no
 * update permission at all. So the card draws it as what it is, a state of
 * each device, and says how to change it on the device when it is off. It
 * used to be a bare checkmark that read like a switch somebody could flip
 * here by editing the row.
 *
 * Everything the card says about the app names the app's own labels. Those
 * are English in every language, because the app is: MOBILE_APP_LABELS is
 * held to the app's screens by
 * App/Tests/Dashboard/PushDeviceCriticalAlertsMatchMobileApp.test.ts, so the
 * steps here cannot drift from what the phone shows.
 */

/*
 * How a device gets its pushes, which decides everything else here: the
 * mobile app on an iPhone or iPad, the mobile app on Android, or a browser.
 *
 * Every write of a device checks its type against PushDeviceType
 * (UserPushService), so there is no fourth kind. A row read without the
 * column is taken for a browser, as the rest of the card takes it
 * (isExpoPushDeviceType): nothing claims a phone did something it cannot
 * be seen to have done.
 */
export enum PushDevicePlatform {
  IOS = "ios",
  Android = "android",
  Browser = "browser",
}

export function getPushDevicePlatform(deviceType: unknown): PushDevicePlatform {
  if (deviceType === PushDeviceType.iOS) {
    return PushDevicePlatform.IOS;
  }

  if (deviceType === PushDeviceType.Android) {
    return PushDevicePlatform.Android;
  }

  return PushDevicePlatform.Browser;
}

// The line under a device's name: what kind of device it is.
export const PUSH_DEVICE_PLATFORM_LABELS: Record<PushDevicePlatform, string> = {
  [PushDevicePlatform.IOS]: translationKey("iPhone or iPad"),
  [PushDevicePlatform.Android]: translationKey("Android phone"),
  [PushDevicePlatform.Browser]: translationKey("Web browser"),
};

/*
 * What the Critical Alerts column says about one device.
 */
export enum CriticalAlertDeviceState {
  // On-call pages ring through silent mode and Do Not Disturb.
  On = "on",
  // A phone that has not turned it on: pages follow its sound settings.
  Off = "off",
  /*
   * A browser. No browser can ring through a device's silent mode, and the
   * server refuses to store the setting for one (UserPushService).
   */
  NotAvailable = "not-available",
  /*
   * A phone nothing reaches any more (isVerified false: Expo said its push
   * token is gone). Whatever its switch says, nothing rings on it, so the
   * column says nothing and leaves it to the Device column's "Not receiving
   * notifications", which says how to bring it back.
   */
  NotReceiving = "not-receiving",
}

export interface CriticalAlertDeviceFacts {
  deviceType?: unknown;
  isVerified?: boolean | undefined;
  isCriticalAlertEnabled?: boolean | undefined;
}

export function getCriticalAlertDeviceState(
  device: CriticalAlertDeviceFacts,
): CriticalAlertDeviceState {
  // True of a browser whether or not it still receives anything.
  if (getPushDevicePlatform(device.deviceType) === PushDevicePlatform.Browser) {
    return CriticalAlertDeviceState.NotAvailable;
  }

  // Absent is not false: a row read without the column is not a dead phone.
  if (device.isVerified === false) {
    return CriticalAlertDeviceState.NotReceiving;
  }

  return device.isCriticalAlertEnabled
    ? CriticalAlertDeviceState.On
    : CriticalAlertDeviceState.Off;
}

/*
 * The app's own labels, exactly as its screens draw them
 * (packages/MobileApp: app.json's name, the Settings tab, and the
 * Notifications group of the Settings screen). Drawn as they are in every
 * language - the app is in English - and never translated.
 */
export const MOBILE_APP_LABELS: {
  appName: string;
  settingsTab: string;
  notificationsSection: string;
  criticalAlertsSwitch: string;
  alarmSoundRow: string;
} = {
  appName: "OneUptime On-Call",
  settingsTab: "Settings",
  notificationsSection: "Notifications",
  criticalAlertsSwitch: "Critical On-Call Alerts",
  alarmSoundRow: "Alarm sound",
};

/*
 * The {{placeholders}} the sentences below use. Each is drawn by the dialog
 * as it is, never translated: the app's labels in bold, the stores as links,
 * and the address the app connects to as the code it is.
 */
export type CriticalAlertSentenceSlot =
  | "app"
  | "settings"
  | "notifications"
  | "criticalAlerts"
  | "alarmSoundPath"
  | "appStore"
  | "googlePlay"
  | "serverUrl";

const TURN_ON_THE_SWITCH: string = translationKey(
  "Under {{notifications}}, turn on {{criticalAlerts}}.",
);

/*
 * The steps that turn critical alerts on, for each kind of device - as the
 * app really behaves (MobileApp/src/hooks/useCriticalAlerts.ts and
 * notifications/criticalAlerts.ts). English, looked up when shown.
 *
 *   iOS     - turning the switch on asks iOS, which shows its own prompt
 *             once. Allow, and it is on.
 *   Android - the app cannot ask in place. It opens Android's Do Not Disturb
 *             access screen, and the switch stays off until the responder
 *             comes back and turns it on again: only then does the app tell
 *             the server (the app's own test, "granting Do Not Disturb access
 *             and coming back turns critical alerts on - no restart").
 *   Browser - it cannot have them at all. The steps get the person the app,
 *             on their phone, and the setting there. The app's first screen
 *             asks which OneUptime to connect to and fills in OneUptime
 *             Cloud's address, so the steps name this one's
 *             (Utils/MobileAppServerUrl): a self-hosted server's has to be
 *             typed in, or the sign-in that follows goes to the wrong place.
 */
export const CRITICAL_ALERT_STEPS: Record<
  PushDevicePlatform,
  ReadonlyArray<string>
> = {
  [PushDevicePlatform.IOS]: [
    translationKey("Open {{app}} on this iPhone or iPad and tap {{settings}}."),
    TURN_ON_THE_SWITCH,
    translationKey(
      "When iOS asks whether {{app}} may send critical alerts, tap Allow.",
    ),
  ],
  [PushDevicePlatform.Android]: [
    translationKey("Open {{app}} on this phone and tap {{settings}}."),
    TURN_ON_THE_SWITCH,
    translationKey(
      "Android opens Do Not Disturb access. Allow it for {{app}}.",
    ),
    translationKey("Go back to the app and turn on {{criticalAlerts}} again."),
  ],
  [PushDevicePlatform.Browser]: [
    translationKey(
      "Install {{app}} on your phone from the {{appStore}} or {{googlePlay}}.",
    ),
    translationKey(
      "Open it, connect to {{serverUrl}} and sign in. Allow notifications, and your phone shows up in this list.",
    ),
    /*
     * One step for both platforms, since the phone is not known yet: allow
     * what it asks for (iOS's prompt, or Android's Do Not Disturb access),
     * then check the switch - on Android it is off again on the way back.
     */
    translationKey(
      "In the app, tap {{settings}} and, under {{notifications}}, turn on {{criticalAlerts}}. Allow what the phone asks for, then check the switch is on.",
    ),
  ],
};

/*
 * When the steps did not turn it on: what the app says then, and what to do
 * about it (the reasons in MobileApp's notifications/criticalAlerts.ts).
 */
export const CRITICAL_ALERT_TROUBLESHOOTING: Record<
  PushDevicePlatform,
  ReadonlyArray<string>
> = {
  [PushDevicePlatform.IOS]: [
    translationKey(
      "Tapped Don't Allow? Turn on Critical Alerts in iOS Settings > Notifications > {{app}}, then turn on {{criticalAlerts}} in the app again.",
    ),
    translationKey(
      "iOS didn't ask? Update {{app}} from the App Store: versions before 1.5.0 cannot receive critical alerts.",
    ),
  ],
  [PushDevicePlatform.Android]: [
    translationKey(
      "The app still asks for Do Not Disturb access? Allow {{app}} in the phone's Settings > Notifications > Do Not Disturb access, then turn on {{criticalAlerts}} again.",
    ),
  ],
  [PushDevicePlatform.Browser]: [],
};

/*
 * What to do once it is on: choose the alarm, and hear it. The alarm - and
 * on an iPhone how loud it plays - is chosen in the app (Settings >
 * Notifications > Alarm sound, shown once the switch is on), and the test
 * notification plays it (UserPushAPI's test-notification route). What
 * critical alerts do is the dialog's description, so it is not said again
 * here.
 */
export const CRITICAL_ALERT_ONCE_ON: string = translationKey(
  "Once it's on, choose the alarm sound for on-call pages under {{alarmSoundPath}}.",
);

export const CRITICAL_ALERT_HOW_TO_HEAR_IT: string = translationKey(
  "To hear it, silence the phone and send it a Test Notification from this list.",
);
