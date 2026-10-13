import {
  NotificationChannelId,
  type NotificationChannelIdValue,
} from "./channels";

/*
 * The alarms a critical on-call page can play, and on an iPhone how loud,
 * chosen per device in Settings > Alarm sound.
 *
 * This list is a contract with the server, like the channel ids: its copy is
 * Common/Types/PushNotification/CriticalAlertSound.ts (and
 * CriticalAlertVolume.ts), and the two must name the same sounds, files and
 * channels - Common's CriticalAlertSoundMobileParity test reads this file to
 * hold them together.
 *
 *   iOS     - the page names the file, and iOS plays it from the app bundle,
 *             through silent mode, at the chosen volume.
 *   Android - the page names the sound's channel (channels.ts), which plays
 *             the file on the alarm stream at the phone's alarm volume.
 *
 * The files are synthesised by scripts/generate-critical-alert-sounds.js
 * into assets/sounds/, and bundled into the app by the expo-notifications
 * config plugin (app.json).
 */
export const CriticalAlertSoundId: {
  readonly DEFAULT: "default";
  readonly KLAXON: "klaxon";
  readonly SIREN: "siren";
  readonly DIGITAL: "digital";
  readonly SMOKE_ALARM: "smoke_alarm";
  readonly RISING: "rising";
} = {
  DEFAULT: "default",
  KLAXON: "klaxon",
  SIREN: "siren",
  DIGITAL: "digital",
  SMOKE_ALARM: "smoke_alarm",
  RISING: "rising",
} as const;

export type CriticalAlertSoundIdValue =
  (typeof CriticalAlertSoundId)[keyof typeof CriticalAlertSoundId];

export interface CriticalAlertSoundOption {
  id: CriticalAlertSoundIdValue;
  title: string;
  // What it sounds like, for somebody choosing without playing every one.
  description: string;
  // The bundled file. Null for the phone's own critical sound.
  fileName: string | null;
  // The Android channel a page with this sound arrives on.
  channelId: NotificationChannelIdValue;
  /*
   * About how long it plays, for the preview's Stop button. The bundled
   * files' exact lengths (a test holds these to them); the phone's own sound
   * is a short chime.
   */
  previewSeconds: number;
}

export const DEFAULT_CRITICAL_ALERT_SOUND: CriticalAlertSoundIdValue =
  CriticalAlertSoundId.DEFAULT;

export const CRITICAL_ALERT_SOUND_OPTIONS: ReadonlyArray<CriticalAlertSoundOption> =
  [
    {
      id: CriticalAlertSoundId.DEFAULT,
      title: "System default",
      description: "Your phone's own critical alert sound.",
      fileName: null,
      channelId: NotificationChannelId.CRITICAL,
      previewSeconds: 3,
    },
    {
      id: CriticalAlertSoundId.KLAXON,
      title: "Klaxon",
      description: "A ship's horn, blast after blast.",
      fileName: "oneuptime_klaxon.wav",
      channelId: NotificationChannelId.CRITICAL_KLAXON,
      previewSeconds: 15,
    },
    {
      id: CriticalAlertSoundId.SIREN,
      title: "Siren",
      description: "An emergency siren's wail, breaking into a fast yelp.",
      fileName: "oneuptime_siren.wav",
      channelId: NotificationChannelId.CRITICAL_SIREN,
      previewSeconds: 15,
    },
    {
      id: CriticalAlertSoundId.DIGITAL,
      title: "Digital alarm",
      description: "An alarm clock's beeping that speeds up.",
      fileName: "oneuptime_digital.wav",
      channelId: NotificationChannelId.CRITICAL_DIGITAL,
      previewSeconds: 15,
    },
    {
      id: CriticalAlertSoundId.SMOKE_ALARM,
      title: "Smoke alarm",
      description: "The piercing three-beep pattern of a fire alarm.",
      fileName: "oneuptime_smoke_alarm.wav",
      channelId: NotificationChannelId.CRITICAL_SMOKE_ALARM,
      previewSeconds: 15,
    },
    {
      id: CriticalAlertSoundId.RISING,
      title: "Rising alarm",
      description: "Starts soft, then keeps getting louder and faster.",
      fileName: "oneuptime_rising.wav",
      channelId: NotificationChannelId.CRITICAL_RISING,
      previewSeconds: 25,
    },
  ];

export function isCriticalAlertSoundId(
  value: unknown,
): value is CriticalAlertSoundIdValue {
  return CRITICAL_ALERT_SOUND_OPTIONS.some(
    (option: CriticalAlertSoundOption): boolean => {
      return option.id === value;
    },
  );
}

/*
 * The sound for a stored or received value. Anything else - nothing stored
 * yet, or a value a newer version of the app wrote - is the system's sound,
 * which every phone has.
 */
export function getCriticalAlertSoundOption(
  value: unknown,
): CriticalAlertSoundOption {
  return (
    CRITICAL_ALERT_SOUND_OPTIONS.find(
      (option: CriticalAlertSoundOption): boolean => {
        return option.id === value;
      },
    ) || CRITICAL_ALERT_SOUND_OPTIONS[0]!
  );
}

/*
 * How loud a critical page plays on an iPhone, as a percentage. iOS takes the
 * volume from the page itself, so it is the server's to send; Android plays
 * critical pages at the phone's alarm volume, which a page cannot change, so
 * the setting is offered on iPhone only. Full volume is what every critical
 * page played before there was a choice. The server accepts any whole
 * percentage from 10 to 100; these are the steps the app offers.
 */
export const CRITICAL_ALERT_VOLUME_OPTIONS: ReadonlyArray<number> = [
  25, 50, 75, 100,
];

export const DEFAULT_CRITICAL_ALERT_VOLUME: number = 100;

export function isCriticalAlertVolumeOption(value: unknown): value is number {
  return CRITICAL_ALERT_VOLUME_OPTIONS.includes(value as number);
}

export function getCriticalAlertVolume(value: unknown): number {
  return isCriticalAlertVolumeOption(value)
    ? value
    : DEFAULT_CRITICAL_ALERT_VOLUME;
}
