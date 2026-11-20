/*
 * WHEN AN ANDROID DEVICE IS BEHIND ON ITS SECURITY PATCHES (#9965).
 *
 * A device's security patch level is the date of the Android security
 * bulletin its build includes (Build.VERSION.SECURITY_PATCH, "2024-06-05"):
 * the OneUptime Android agent sends it with every report and an Esper import
 * writes it, under android.os.security_patch, onto the device's Inventory
 * item. Google publishes a bulletin every month, and Android Enterprise
 * Recommended holds a device's maker to shipping each one within 90 days.
 * So a device is behind - out of date - when its patch level is more than
 * ANDROID_SECURITY_PATCH_MAX_AGE_DAYS old: it misses fixes its maker should
 * have shipped by now.
 *
 * Measured against an absolute age, not against the newest level in the
 * fleet: a fleet that is all behind is all out of date, and a model whose
 * maker patches more slowly is not hidden by one that patches fast.
 *
 * One rule, three readers: Inventory's Security Patch Level filter (the
 * `securityPatchStatus` virtual column, in SQL), its column (here), and the
 * Security Patch Out of Date alert template (HostAlertTemplates), which
 * reads the agent's android.os.security_patch.age the same way: older than
 * 90 days.
 */

export const ANDROID_SECURITY_PATCH_MAX_AGE_DAYS: number = 90;

// The attribute the patch level is kept under (ManagedDeviceIdentity's ANDROID_SECURITY_PATCH_LEVEL_ATTRIBUTE).
export const ANDROID_SECURITY_PATCH_ATTRIBUTE: string =
  "android.os.security_patch";

export enum AndroidSecurityPatchStatus {
  UpToDate = "upToDate",
  OutOfDate = "outOfDate",
}

/*
 * A patch level as Android and Esper write it: a year, a month and a day.
 * The same test in SQL below. Compared as text - which orders these dates
 * as the calendar does - so the SQL and this agree on every value.
 */
const LEVEL: RegExp = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

const LEVEL_SQL_PATTERN: string =
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$";

const MILLIS_PER_DAY: number = 24 * 60 * 60 * 1000;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toUtcDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

export default class AndroidSecurityPatch {
  // The patch level a value holds, or undefined when it holds none.
  public static readLevel(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const level: string = value.trim();
    return LEVEL.test(level) ? level : undefined;
  }

  /*
   * The oldest patch level that is up to date today: the UTC day
   * ANDROID_SECURITY_PATCH_MAX_AGE_DAYS before now's.
   */
  public static getOldestUpToDate(now: Date): string {
    const today: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return toUtcDay(
      new Date(today - ANDROID_SECURITY_PATCH_MAX_AGE_DAYS * MILLIS_PER_DAY),
    );
  }

  public static getStatus(
    value: unknown,
    now: Date,
  ): AndroidSecurityPatchStatus | undefined {
    const level: string | undefined = AndroidSecurityPatch.readLevel(value);

    if (!level) {
      return undefined;
    }

    return level < AndroidSecurityPatch.getOldestUpToDate(now)
      ? AndroidSecurityPatchStatus.OutOfDate
      : AndroidSecurityPatchStatus.UpToDate;
  }

  /*
   * Whole UTC days from the patch level's date to now's, as the agent
   * counts android.os.security_patch.age: 0 for a date after today, and
   * undefined for a level that is no date of the calendar (2023-02-30).
   */
  public static getAgeInDays(value: unknown, now: Date): number | undefined {
    const level: string | undefined = AndroidSecurityPatch.readLevel(value);

    if (!level) {
      return undefined;
    }

    const [year, month, day] = level.split("-").map((part: string): number => {
      return parseInt(part, 10);
    }) as [number, number, number];
    const patched: Date = new Date(Date.UTC(year, month - 1, day));

    if (toUtcDay(patched) !== level) {
      return undefined;
    }

    const today: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return Math.max(
      0,
      Math.round((today - patched.getTime()) / MILLIS_PER_DAY),
    );
  }

  /*
   * The status as a Postgres expression over an Inventory item - its
   * descriptiveAttributes, under `tableAlias`, already quoted
   * ("InventoryItem") - against the database's clock in UTC: the
   * `securityPatchStatus` virtual column. Null for an item with no patch
   * level, so a filter on it never lists a service or a server.
   */
  public static getStatusSql(tableAlias: string): string {
    const level: string = `(${tableAlias}."descriptiveAttributes" ->> '${ANDROID_SECURITY_PATCH_ATTRIBUTE}')`;

    return `CASE
        WHEN ${level} ~ '${LEVEL_SQL_PATTERN}' THEN
          CASE
            WHEN ${level} < to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - ${ANDROID_SECURITY_PATCH_MAX_AGE_DAYS}, 'YYYY-MM-DD') THEN '${AndroidSecurityPatchStatus.OutOfDate}'
            ELSE '${AndroidSecurityPatchStatus.UpToDate}'
          END
        ELSE NULL
      END`;
  }
}
