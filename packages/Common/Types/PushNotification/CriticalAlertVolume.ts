/*
 * How loud a critical on-call page plays on an iPhone, as a percentage, chosen
 * per device in the mobile app (UserPush.criticalAlertVolume).
 *
 * iOS takes a critical alert's volume from the push itself (sound.volume, 0 to
 * 1), whatever the ringer is set to - which is why the setting is the server's
 * to send. Android plays critical pages on the alarm stream at the phone's
 * alarm volume, and a push cannot change that, so the app offers the setting
 * on iPhone only.
 *
 * The floor is not zero. A critical alert exists to wake somebody, and one set
 * to silence would look switched on while waking nobody.
 */
export const CRITICAL_ALERT_VOLUME_MIN_PERCENT: number = 10;

export const CRITICAL_ALERT_VOLUME_MAX_PERCENT: number = 100;

// Full volume: what every critical page played before the choice existed.
export const DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT: number = 100;

// The steps the app offers.
export const CRITICAL_ALERT_VOLUME_OPTIONS: ReadonlyArray<number> = [
  25, 50, 75, 100,
];

/*
 * A volume the API stores as it is: a whole percentage within the bounds.
 * The app only ever sends one of the options, but the API accepts any step in
 * between.
 */
export function isCriticalAlertVolumePercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= CRITICAL_ALERT_VOLUME_MIN_PERCENT &&
    value <= CRITICAL_ALERT_VOLUME_MAX_PERCENT
  );
}

/*
 * The volume a device is paged at. A stored value outside the bounds - never
 * written by this server, but a page must not fail on one - is pulled back
 * inside them, and anything that is not a number at all is full volume.
 */
export function getCriticalAlertVolumePercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT;
  }

  return Math.min(
    CRITICAL_ALERT_VOLUME_MAX_PERCENT,
    Math.max(CRITICAL_ALERT_VOLUME_MIN_PERCENT, Math.round(value)),
  );
}

// The volume as an iOS critical sound takes it: 0.1 to 1.
export function toCriticalAlertSoundVolume(percent: unknown): number {
  return getCriticalAlertVolumePercent(percent) / 100;
}
