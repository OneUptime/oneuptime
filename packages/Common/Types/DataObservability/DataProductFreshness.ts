/*
 * WHETHER A DATA PRODUCT'S DATA IS FRESH, BY ITS SLA.
 *
 * A data product promises its consumers fresh data in one or both of two
 * ways:
 *
 *  - Fresh by a time of day (UTC), "fresh by 07:00": each day's load lands
 *    that day, by then. From 07:00 a table must have changed that day; until
 *    07:00, yesterday's load still stands. A load that is always half an
 *    hour late is late every day for half an hour, never on time.
 *  - A maximum age, "never older than 2 hours": a table is on time while it
 *    last changed no longer ago than that.
 *
 * The product is late when any of its tables is; its data is "as of" the
 * oldest last change among them, since a report reading them all is only as
 * fresh as that. A table that has never been seen changing says nothing
 * either way; a product none of whose tables say anything is unknown.
 */

export enum DataProductStatus {
  OnTime = "On Time",
  Late = "Late",
  Unknown = "Unknown",
}

export const MINUTES_PER_DAY: number = 24 * 60;
// The longest maximum age a product may promise: a week.
export const MAX_DATA_AGE_IN_MINUTES: number = 7 * MINUTES_PER_DAY;
const DAY_IN_MS: number = MINUTES_PER_DAY * 60 * 1000;
const TIME_OF_DAY: RegExp = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export interface DataProductSla {
  // Minutes after midnight UTC by which the day's data lands; null for none.
  freshByMinuteOfDay: number | null;
  // How old the data may be, in minutes; null for no limit.
  maxDataAgeInMinutes: number | null;
}

// "07:00" or "7:00" as minutes after midnight; null for anything else.
export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const match: RegExpMatchArray | null = value.trim().match(TIME_OF_DAY);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

// Minutes after midnight as "07:00".
export function formatTimeOfDay(minuteOfDay: number): string {
  const minutes: number =
    ((Math.floor(minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

// The latest deadline at or before now: today's, or yesterday's while today's is still ahead.
export function getLatestDeadline(now: Date, minuteOfDay: number): Date {
  const midnight: number = Math.floor(now.getTime() / DAY_IN_MS) * DAY_IN_MS;
  const today: number = midnight + minuteOfDay * 60 * 1000;

  return new Date(today <= now.getTime() ? today : today - DAY_IN_MS);
}

/*
 * When a table that last changed then stops being on time: the first moment
 * its data is too old, or the next day's deadline, which a change on an
 * earlier day misses. Null when the SLA promises nothing.
 */
export function getLateAt(data: {
  lastChangedAt: Date;
  sla: DataProductSla;
}): Date | null {
  const candidates: Array<number> = [];

  if (data.sla.maxDataAgeInMinutes !== null) {
    candidates.push(
      data.lastChangedAt.getTime() + data.sla.maxDataAgeInMinutes * 60 * 1000,
    );
  }

  if (data.sla.freshByMinuteOfDay !== null) {
    const midnight: number =
      Math.floor(data.lastChangedAt.getTime() / DAY_IN_MS) * DAY_IN_MS;

    candidates.push(
      midnight + DAY_IN_MS + data.sla.freshByMinuteOfDay * 60 * 1000,
    );
  }

  return candidates.length > 0 ? new Date(Math.min(...candidates)) : null;
}

// Whether a table that last changed then is late now; null when it was never seen changing.
export function isTableLate(data: {
  lastChangedAt: Date | null;
  now: Date;
  sla: DataProductSla;
}): boolean | null {
  if (!data.lastChangedAt) {
    return null;
  }

  const lateAt: Date | null = getLateAt({
    lastChangedAt: data.lastChangedAt,
    sla: data.sla,
  });

  return lateAt !== null && data.now.getTime() >= lateAt.getTime();
}

export interface DataProductTableFreshness {
  dataAssetId: string;
  lastChangedAt: Date | null;
}

export interface DataProductFreshness {
  status: DataProductStatus;
  lateDataAssetIds: Array<string>;
  // The oldest last change among the tables seen changing: what the product's data is as of.
  dataAsOf: Date | null;
  // The tables never seen changing.
  unknownCount: number;
}

export function getDataProductFreshness(data: {
  tables: Array<DataProductTableFreshness>;
  now: Date;
  sla: DataProductSla;
}): DataProductFreshness {
  const lateDataAssetIds: Array<string> = [];
  let dataAsOf: Date | null = null;
  let unknownCount: number = 0;
  let knownCount: number = 0;

  for (const table of data.tables) {
    const late: boolean | null = isTableLate({
      lastChangedAt: table.lastChangedAt,
      now: data.now,
      sla: data.sla,
    });

    if (late === null) {
      unknownCount++;
      continue;
    }

    knownCount++;

    if (late) {
      lateDataAssetIds.push(table.dataAssetId);
    }

    if (!dataAsOf || table.lastChangedAt! < dataAsOf) {
      dataAsOf = table.lastChangedAt;
    }
  }

  return {
    status:
      lateDataAssetIds.length > 0
        ? DataProductStatus.Late
        : knownCount > 0
          ? DataProductStatus.OnTime
          : DataProductStatus.Unknown,
    lateDataAssetIds,
    dataAsOf,
    unknownCount,
  };
}

// The least and most a product's SLA target may be: what an SLO can track.
export const MIN_SLA_TARGET_PERCENTAGE: number = 50;
export const MAX_SLA_TARGET_PERCENTAGE: number = 99.999;
export const DEFAULT_SLA_TARGET_PERCENTAGE: number = 99;
// The least maximum age a product may promise: a table is read every five minutes.
export const MIN_DATA_AGE_IN_MINUTES: number = 15;

// A product's SLA as saved: a time of day and a maximum age, either empty.
export function readDataProductSla(data: {
  freshByTimeOfDay?: unknown;
  maxDataAgeInMinutes?: unknown;
}): DataProductSla {
  const maxAge: number = Number(data.maxDataAgeInMinutes);

  return {
    freshByMinuteOfDay: parseTimeOfDay(data.freshByTimeOfDay),
    maxDataAgeInMinutes:
      data.maxDataAgeInMinutes === null ||
      data.maxDataAgeInMinutes === undefined ||
      data.maxDataAgeInMinutes === "" ||
      !Number.isFinite(maxAge)
        ? null
        : Math.floor(maxAge),
  };
}

// Why a product's SLA cannot be saved as it is, or null when it can.
export function getDataProductSlaError(data: {
  freshByTimeOfDay?: unknown;
  maxDataAgeInMinutes?: unknown;
  slaTargetPercentage?: unknown;
}): string | null {
  const hasTime: boolean =
    typeof data.freshByTimeOfDay === "string" &&
    data.freshByTimeOfDay.trim().length > 0;

  if (hasTime && parseTimeOfDay(data.freshByTimeOfDay) === null) {
    return "Fresh By is a time of day in UTC, written HH:MM, such as 07:00.";
  }

  const hasMaxAge: boolean =
    data.maxDataAgeInMinutes !== null &&
    data.maxDataAgeInMinutes !== undefined &&
    data.maxDataAgeInMinutes !== "";

  if (hasMaxAge) {
    const minutes: number = Number(data.maxDataAgeInMinutes);

    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_DATA_AGE_IN_MINUTES ||
      minutes > MAX_DATA_AGE_IN_MINUTES
    ) {
      return `Maximum Data Age is a whole number of minutes, from ${MIN_DATA_AGE_IN_MINUTES} to ${MAX_DATA_AGE_IN_MINUTES} (a week).`;
    }
  }

  if (!hasTime && !hasMaxAge) {
    return "A data product needs a freshness SLA: a time of day its data lands by, a maximum age, or both.";
  }

  if (
    data.slaTargetPercentage !== null &&
    data.slaTargetPercentage !== undefined &&
    data.slaTargetPercentage !== ""
  ) {
    const target: number = Number(data.slaTargetPercentage);

    if (
      !Number.isFinite(target) ||
      target < MIN_SLA_TARGET_PERCENTAGE ||
      target > MAX_SLA_TARGET_PERCENTAGE
    ) {
      return `The SLA target is a percentage from ${MIN_SLA_TARGET_PERCENTAGE} to ${MAX_SLA_TARGET_PERCENTAGE}.`;
    }
  }

  return null;
}
