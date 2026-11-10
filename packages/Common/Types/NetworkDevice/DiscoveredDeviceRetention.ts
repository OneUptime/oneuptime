/*
 * HOW LONG A DISCOVERED DEVICE STAYS ONCE NOTHING SEES IT (OneUptime issue
 * #6389, a follow-up of #5775).
 *
 * The Discovered Devices list is every device a project's switches, routers
 * and network controllers have seen - a row of NetworkEndpoint each. A guest
 * phone, a laptop that left, a printer that was replaced: each stayed on the
 * list for good, so the list kept growing with devices that were long gone.
 * Now a device that has not been seen for the project's
 * Project.discoveredDeviceRetentionInDays is removed from the list (the
 * Workers job NetworkDeviceDiscovery:AgeOutDiscoveredDevices, through
 * Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut), unless a person cares
 * about it:
 *
 *   - it is monitored: a live, unarchived device of the project has its MAC
 *     address - what the list calls Monitored for a device not seen lately;
 *   - it has a classification (what a person said it is);
 *   - a person added it, or changed its vendor, address or site
 *     (NetworkEndpoint.editedAt, createdByUserId).
 *
 * Seen again later, it comes back as a new device: nothing stale with it.
 *
 * The choices are a short list, as a polling interval's are: a week covers a
 * store closed for a few days, a year a device that turns up once in a
 * while; 30 days, the default, a month of absence. 0 keeps every device, as
 * the list did before.
 */

export const DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS: ReadonlyArray<number> =
  [7, 14, 30, 60, 90, 180, 365];

export const DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS: number = 30;

// The setting's value for "Never": every device stays, however long ago it was seen.
export const KEEP_EVERY_DISCOVERED_DEVICE: number = 0;

// The shortest a project may keep a device it no longer sees.
export const MIN_DISCOVERED_DEVICE_RETENTION_IN_DAYS: number =
  DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS[0]!;

// "7, 14, 30, 60, 90, 180 or 365": the choices as a sentence says them.
const RETENTION_CHOICES_TEXT: string = `${DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS.slice(0, -1).join(", ")} or ${DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS[DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS.length - 1]}`;

export const DISCOVERED_DEVICE_RETENTION_REFUSAL: string = `Pick how long a discovered device stays once it is no longer seen: ${RETENTION_CHOICES_TEXT} days, or ${KEEP_EVERY_DISCOVERED_DEVICE} to keep every device.`;

// Whether a value is one the setting takes: a choice, or 0 for never.
export function isDiscoveredDeviceRetentionInDays(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    (value === KEEP_EVERY_DISCOVERED_DEVICE ||
      DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS.includes(value))
  );
}

/*
 * What is wrong with a value written to the setting, or null when it is one
 * of the choices or 0. A whole number written as text ("30") is read as the
 * number; nothing else is: the column is never left empty, so null is
 * refused too, and a number that is not a choice is a mistake, not a
 * default.
 */
export function getDiscoveredDeviceRetentionProblem(
  value: unknown,
): string | null {
  return isDiscoveredDeviceRetentionInDays(toNumber(value))
    ? null
    : DISCOVERED_DEVICE_RETENTION_REFUSAL;
}

// The value as the column stores it. Call getDiscoveredDeviceRetentionProblem first.
export function toDiscoveredDeviceRetentionInDays(value: unknown): number {
  const days: number | null = toNumber(value);

  return isDiscoveredDeviceRetentionInDays(days)
    ? days
    : DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS;
}

/*
 * The setting as a reader of a response or a row takes it: one of the
 * choices, 0 for never, or undefined when it is missing or not one of them -
 * then nothing is said about it, rather than a guess.
 */
export function readDiscoveredDeviceRetentionInDays(
  value: unknown,
): number | undefined {
  const days: number | null = toNumber(value);

  return isDiscoveredDeviceRetentionInDays(days) ? days : undefined;
}

// Whether devices are removed at all with this setting.
export function isDiscoveredDeviceRetentionOn(days: number): boolean {
  return days !== KEEP_EVERY_DISCOVERED_DEVICE;
}

// Days as a form or an API client may send them: as text.
const DAYS_AS_TEXT: RegExp = /^\d{1,4}$/;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && DAYS_AS_TEXT.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}
