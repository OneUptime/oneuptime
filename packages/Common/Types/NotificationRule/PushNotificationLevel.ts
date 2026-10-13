/*
 * How a push notification from an on-call rule sounds on the responder's
 * phone, chosen per rule - so the cards on the On-Call Rules page can have a
 * critical incident ring through silent mode and Do Not Disturb while a
 * low-severity one arrives as an ordinary push.
 *
 * The rule can only LOWER what the device allows, never raise it. A Critical
 * push rings through only on a device whose owner turned on Critical On-Call
 * Alerts in the mobile app (UserPush.isCriticalAlertEnabled), and the phone's
 * operating system still has to allow it. So Critical is the default: a rule
 * that never chose stays exactly as loud as the device was before this choice
 * existed, and a phone that never opted in is not made any louder by it.
 *
 * Stored as text on UserNotificationRule.pushNotificationLevel. It means
 * nothing on a rule that does not page a push device.
 */
enum PushNotificationLevel {
  // Rings through silent mode and Do Not Disturb, on a device that opted in.
  Critical = "Critical",
  // Follows the phone's sound, silent and Do Not Disturb settings.
  Standard = "Standard",
}

export const DEFAULT_PUSH_NOTIFICATION_LEVEL: PushNotificationLevel =
  PushNotificationLevel.Critical;

export const PUSH_NOTIFICATION_LEVELS: ReadonlyArray<PushNotificationLevel> = [
  PushNotificationLevel.Critical,
  PushNotificationLevel.Standard,
];

export function isPushNotificationLevel(
  value: unknown,
): value is PushNotificationLevel {
  return PUSH_NOTIFICATION_LEVELS.includes(value as PushNotificationLevel);
}

/*
 * The level a rule pages at. A rule read without the column, or written before
 * it existed, has no level of its own and pages at the default - which is how
 * every rule paged before the choice was offered.
 */
export function getPushNotificationLevel(
  value: unknown,
): PushNotificationLevel {
  return isPushNotificationLevel(value)
    ? value
    : DEFAULT_PUSH_NOTIFICATION_LEVEL;
}

/*
 * Whether a page from a rule at this level, to this device, goes out as a
 * critical alert.
 *
 * Both have to agree. The device's switch is the responder's consent to be
 * woken through a silenced phone at all, so without it nothing is critical,
 * whatever the rule says. With it, only a rule set to Standard sends an
 * ordinary push. Every other answer - Critical, a rule read without the
 * column, a value written by a newer build - is critical: a page that loses
 * the flag arrives silently and nothing reports it, which is the costlier
 * mistake for a page meant to wake somebody.
 */
export function isCriticalPushNotification(data: {
  pushNotificationLevel: PushNotificationLevel | string | null | undefined;
  isDeviceCriticalAlertEnabled: boolean | null | undefined;
}): boolean {
  if (!data.isDeviceCriticalAlertEnabled) {
    return false;
  }

  return data.pushNotificationLevel !== PushNotificationLevel.Standard;
}

export default PushNotificationLevel;
