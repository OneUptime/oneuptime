import AndroidNotificationChannel from "./AndroidNotificationChannel";

/*
 * The alarm a critical on-call page plays, chosen per device in the mobile app
 * (UserPush.criticalAlertSound).
 *
 * The sounds are files the app bundles - iOS plays only sounds inside the app,
 * and Android plays a channel's sound - so this list is a contract with the
 * app, like AndroidNotificationChannel: the app's own copy is
 * MobileApp/src/notifications/criticalAlertSounds.ts, and the two must name
 * the same sounds, files and channels.
 *
 *   iOS     - the push names the file (sound.name). A file the installed app
 *             does not have plays the default critical sound instead.
 *   Android - the push names the sound's channel. A channel the installed app
 *             never created delivers the page with default settings, which
 *             for an on-call page means silently. So a device is only paged
 *             on a sound's channel after its app chose that sound - and only
 *             an app that creates the channels offers the choice.
 *
 * Default is the system's own critical sound and the original oncall_critical
 * channel, which every version of the app has.
 */
enum CriticalAlertSound {
  Default = "default",
  Klaxon = "klaxon",
  Siren = "siren",
  Digital = "digital",
  SmokeAlarm = "smoke_alarm",
  Rising = "rising",
}

export interface CriticalAlertSoundDefinition {
  sound: CriticalAlertSound;
  title: string;
  // What an iOS push names: the bundled file, or "default".
  iosSoundName: string;
  // The Android channel a page with this sound is sent on.
  androidChannelId: AndroidNotificationChannel;
}

export const DEFAULT_CRITICAL_ALERT_SOUND: CriticalAlertSound =
  CriticalAlertSound.Default;

export const CRITICAL_ALERT_SOUNDS: ReadonlyArray<CriticalAlertSoundDefinition> =
  [
    {
      sound: CriticalAlertSound.Default,
      title: "System default",
      iosSoundName: "default",
      androidChannelId: AndroidNotificationChannel.Critical,
    },
    {
      sound: CriticalAlertSound.Klaxon,
      title: "Klaxon",
      iosSoundName: "oneuptime_klaxon.wav",
      androidChannelId: AndroidNotificationChannel.CriticalKlaxon,
    },
    {
      sound: CriticalAlertSound.Siren,
      title: "Siren",
      iosSoundName: "oneuptime_siren.wav",
      androidChannelId: AndroidNotificationChannel.CriticalSiren,
    },
    {
      sound: CriticalAlertSound.Digital,
      title: "Digital alarm",
      iosSoundName: "oneuptime_digital.wav",
      androidChannelId: AndroidNotificationChannel.CriticalDigital,
    },
    {
      sound: CriticalAlertSound.SmokeAlarm,
      title: "Smoke alarm",
      iosSoundName: "oneuptime_smoke_alarm.wav",
      androidChannelId: AndroidNotificationChannel.CriticalSmokeAlarm,
    },
    {
      sound: CriticalAlertSound.Rising,
      title: "Rising alarm",
      iosSoundName: "oneuptime_rising.wav",
      androidChannelId: AndroidNotificationChannel.CriticalRising,
    },
  ];

export function isCriticalAlertSound(
  value: unknown,
): value is CriticalAlertSound {
  return CRITICAL_ALERT_SOUNDS.some(
    (definition: CriticalAlertSoundDefinition): boolean => {
      return definition.sound === value;
    },
  );
}

/*
 * The sound a device is paged with. Anything that is not one of the sounds -
 * unset, or a value from a newer app - is the default, which every app plays.
 */
export function getCriticalAlertSound(value: unknown): CriticalAlertSound {
  return isCriticalAlertSound(value) ? value : DEFAULT_CRITICAL_ALERT_SOUND;
}

export function getCriticalAlertSoundDefinition(
  value: unknown,
): CriticalAlertSoundDefinition {
  const sound: CriticalAlertSound = getCriticalAlertSound(value);

  return CRITICAL_ALERT_SOUNDS.find(
    (definition: CriticalAlertSoundDefinition): boolean => {
      return definition.sound === sound;
    },
  )!;
}

export default CriticalAlertSound;
