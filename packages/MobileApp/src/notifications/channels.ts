import * as Notifications from "expo-notifications";

/*
 * Android channel ids. These must match
 * Common/Types/PushNotification/AndroidNotificationChannel.ts on the server:
 * a push names a channel by id, and a channel the app never created falls back
 * to default settings rather than failing, so a typo here shows up as an
 * on-call page that arrives silently.
 */
export const NotificationChannelId: {
  readonly CRITICAL: "oncall_critical";
  readonly CRITICAL_KLAXON: "oncall_critical_klaxon";
  readonly CRITICAL_SIREN: "oncall_critical_siren";
  readonly CRITICAL_DIGITAL: "oncall_critical_digital";
  readonly CRITICAL_SMOKE_ALARM: "oncall_critical_smoke_alarm";
  readonly CRITICAL_RISING: "oncall_critical_rising";
  readonly HIGH: "oncall_high";
  readonly NORMAL: "oncall_normal";
  readonly LOW: "oncall_low";
} = {
  CRITICAL: "oncall_critical",
  CRITICAL_KLAXON: "oncall_critical_klaxon",
  CRITICAL_SIREN: "oncall_critical_siren",
  CRITICAL_DIGITAL: "oncall_critical_digital",
  CRITICAL_SMOKE_ALARM: "oncall_critical_smoke_alarm",
  CRITICAL_RISING: "oncall_critical_rising",
  HIGH: "oncall_high",
  NORMAL: "oncall_normal",
  LOW: "oncall_low",
} as const;

export type NotificationChannelIdValue =
  (typeof NotificationChannelId)[keyof typeof NotificationChannelId];

/*
 * The critical channel, spelled out because every field on it is doing work:
 *
 * - bypassDnd is the actual Do Not Disturb override. Android only honours it
 *   once the user has granted this app Notification Policy Access in system
 *   settings; until then the channel is created with the flag silently off,
 *   which is why isCriticalChannelBypassingDnd() reads it back rather than
 *   trusting the write.
 * - usage ALARM puts the sound on the alarm stream, which is the stream that
 *   still plays when the ringer is silenced. This is the half that gets a
 *   silenced (as opposed to Do-Not-Disturbed) phone to make noise, and it
 *   needs no permission.
 * - enforceAudibility asks the system not to duck the sound for whatever else
 *   is playing.
 * - MAX importance is what allows a heads-up notification and a sound at all.
 *
 * None of these can be raised after the channel exists. Android freezes a
 * channel's settings on creation so that a user's later adjustments cannot be
 * undone by an app update, so changing any of this means shipping a new
 * channel id, not editing this object.
 */
export const CRITICAL_CHANNEL: Notifications.NotificationChannelInput = {
  name: "Critical On-Call Alerts",
  description:
    "Urgent on-call pages. These override silent mode and Do Not Disturb so incidents are not missed.",
  importance: Notifications.AndroidImportance.MAX,
  sound: "default",
  bypassDnd: true,
  vibrationPattern: [0, 500, 250, 500, 250, 500],
  enableVibrate: true,
  enableLights: true,
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  showBadge: true,
  audioAttributes: {
    usage: Notifications.AndroidAudioUsage.ALARM,
    contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    flags: {
      enforceAudibility: true,
      requestHardwareAudioVideoSynchronization: false,
    },
  },
};

/*
 * One critical channel per alarm sound the app bundles
 * (criticalAlertSounds.ts). A channel's sound is fixed when it is created, so
 * a page cannot carry its own sound on Android: the server pages a device on
 * the channel of the sound its responder chose. Each is the critical channel
 * in every other respect - Do Not Disturb, the alarm stream, the vibration -
 * because the sound is the only thing the responder chose.
 *
 * All of them are created on every launch, whichever sound is chosen. A
 * channel the server names that the phone does not have delivers the page
 * with default settings - silently - so every sound the server could name has
 * to exist, including on a phone whose app data was cleared after it chose
 * one.
 */
function criticalSoundChannel(
  soundTitle: string,
  fileName: string,
): Notifications.NotificationChannelInput {
  return {
    ...CRITICAL_CHANNEL,
    name: `Critical On-Call Alerts: ${soundTitle}`,
    description: `Urgent on-call pages, with the ${soundTitle.toLowerCase()} sound. These override silent mode and Do Not Disturb so incidents are not missed.`,
    sound: fileName,
  };
}

export const CRITICAL_SOUND_CHANNELS: ReadonlyArray<{
  id: NotificationChannelIdValue;
  channel: Notifications.NotificationChannelInput;
}> = [
  {
    id: NotificationChannelId.CRITICAL_KLAXON,
    channel: criticalSoundChannel("Klaxon", "oneuptime_klaxon.wav"),
  },
  {
    id: NotificationChannelId.CRITICAL_SIREN,
    channel: criticalSoundChannel("Siren", "oneuptime_siren.wav"),
  },
  {
    id: NotificationChannelId.CRITICAL_DIGITAL,
    channel: criticalSoundChannel("Digital alarm", "oneuptime_digital.wav"),
  },
  {
    id: NotificationChannelId.CRITICAL_SMOKE_ALARM,
    channel: criticalSoundChannel("Smoke alarm", "oneuptime_smoke_alarm.wav"),
  },
  {
    id: NotificationChannelId.CRITICAL_RISING,
    channel: criticalSoundChannel("Rising alarm", "oneuptime_rising.wav"),
  },
];

/*
 * Every channel a critical page can arrive on: the original, with the
 * system's sound, and one per bundled sound.
 */
export const CRITICAL_CHANNELS: ReadonlyArray<{
  id: NotificationChannelIdValue;
  channel: Notifications.NotificationChannelInput;
}> = [
  { id: NotificationChannelId.CRITICAL, channel: CRITICAL_CHANNEL },
  ...CRITICAL_SOUND_CHANNELS,
];

/*
 * The ordinary on-call channel: loud, but it respects the ringer switch and Do
 * Not Disturb like any other notification. This is where every page goes for a
 * responder who has not opted this device into critical alerts, and it is the
 * channel the server names by default.
 */
export const HIGH_CHANNEL: Notifications.NotificationChannelInput = {
  name: "High Priority",
  description:
    "On-call pages and other time-sensitive notifications. Follows your device's silent and Do Not Disturb settings.",
  importance: Notifications.AndroidImportance.HIGH,
  sound: "default",
  vibrationPattern: [0, 250, 250, 250],
  enableVibrate: true,
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
};

export const NORMAL_CHANNEL: Notifications.NotificationChannelInput = {
  name: "Normal Priority",
  description: "General OneUptime notifications.",
  importance: Notifications.AndroidImportance.DEFAULT,
  sound: "default",
};

export const LOW_CHANNEL: Notifications.NotificationChannelInput = {
  name: "Low Priority",
  description: "Informational updates that do not need your attention now.",
  importance: Notifications.AndroidImportance.LOW,
};

export const NOTIFICATION_CHANNELS: ReadonlyArray<{
  id: NotificationChannelIdValue;
  channel: Notifications.NotificationChannelInput;
}> = [
  ...CRITICAL_CHANNELS,
  { id: NotificationChannelId.HIGH, channel: HIGH_CHANNEL },
  { id: NotificationChannelId.NORMAL, channel: NORMAL_CHANNEL },
  { id: NotificationChannelId.LOW, channel: LOW_CHANNEL },
];
