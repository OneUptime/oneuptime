import OneUptimeDate from "../Date";
import { JSONArray, JSONObject, JSONValue } from "../JSON";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "./DetectionFindingConstants";
import { DETECTION_RETROHUNT_PERIODS_IN_HOURS } from "./DetectionRetrohunt";

/*
 * Security events that arrived more than a day after they happened (#10491).
 *
 * A scheduled detection rule judges what arrived since its last run, each
 * event within a day of when it happened (isDetectionArrivalCandidate). One
 * that arrives later - a shipper that was down for more than a day, a
 * connection that caught up on a backlog, a backfill of history - is stored
 * and searchable, but no rule's run judges it, on purpose:
 *
 *   - a run reads a day back from what arrived, on the table's sort by
 *     event time; reading every arrival however old would read every day
 *     the table keeps, on every rule, every minute;
 *   - a rule's windows are about the time they cover: a backfill of last
 *     month would open alerts, incidents and cases about last month, as if
 *     it were happening now.
 *
 * So OneUptime says so instead. A materialized view counts every event
 * written later than that, per project, source and day it arrived
 * (Models/AnalyticsModels/SecurityEventLateArrival); Detection Rules reads
 * the last week of them and says how many, from which sources and when
 * they happened, with Run on Past Events - which reads by when events
 * happened - ready over that time.
 */

// Later than this after it happened, an event is not judged by a rule's runs: one day.
export const SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS: number =
  DETECTION_LATE_EVENT_WINDOW_IN_MINUTES * 60;

// Detection Rules tells of what arrived late in the last week: today and the six days before.
export const SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS: number = 7;

// The counts are kept for a month, as long as Run on Past Events reads back.
export const SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS: number = 30;

// The most sources one read answers with, the ones with the most late events first.
export const SECURITY_EVENT_LATE_ARRIVAL_MAX_SOURCES: number = 100;

// The events of one source that arrived late.
export interface SecurityEventLateArrivalSource {
  vendorName: string;
  productName: string;
  eventCount: number;
  // When the earliest and the latest of them happened.
  happenedFrom: Date;
  happenedTo: Date;
  // When the first and the last of them arrived.
  arrivedFrom: Date;
  arrivedTo: Date;
}

// What arrived late since a day, every source together and each on its own.
export interface SecurityEventLateArrivals {
  arrivedSince: Date;
  eventCount: number;
  sources: Array<SecurityEventLateArrivalSource>;
}

/*
 * The first day the notice reads: midnight UTC of the sixth day before
 * today, so it holds today and the six days before it.
 */
export function getLateArrivalsSince(now: Date): Date {
  const day: Date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  return OneUptimeDate.addRemoveDays(
    day,
    -(SECURITY_EVENT_LATE_ARRIVAL_NOTICE_DAYS - 1),
  );
}

/*
 * The shortest period Run on Past Events offers that reaches back to when
 * the earliest of them happened; the longest when none does.
 */
export function getLateArrivalsRetrohuntPeriodInHours(data: {
  happenedFrom: Date;
  now: Date;
}): number {
  const hoursBack: number =
    (data.now.getTime() - data.happenedFrom.getTime()) / (60 * 60 * 1000);

  for (const periodInHours of DETECTION_RETROHUNT_PERIODS_IN_HOURS) {
    if (hoursBack <= periodInHours) {
      return periodInHours;
    }
  }

  return DETECTION_RETROHUNT_PERIODS_IN_HOURS[
    DETECTION_RETROHUNT_PERIODS_IN_HOURS.length - 1
  ] as number;
}

// When the earliest of every source's late events happened, or null when none did.
export function getLateArrivalsHappenedFrom(
  lateArrivals: SecurityEventLateArrivals,
): Date | null {
  let earliest: Date | null = null;

  for (const source of lateArrivals.sources) {
    if (!earliest || source.happenedFrom.getTime() < earliest.getTime()) {
      earliest = source.happenedFrom;
    }
  }

  return earliest;
}

export function lateArrivalsToJSON(
  lateArrivals: SecurityEventLateArrivals,
): JSONObject {
  return {
    arrivedSince: lateArrivals.arrivedSince.toISOString(),
    eventCount: lateArrivals.eventCount,
    sources: lateArrivals.sources.map(
      (source: SecurityEventLateArrivalSource): JSONObject => {
        return {
          vendorName: source.vendorName,
          productName: source.productName,
          eventCount: source.eventCount,
          happenedFrom: source.happenedFrom.toISOString(),
          happenedTo: source.happenedTo.toISOString(),
          arrivedFrom: source.arrivedFrom.toISOString(),
          arrivedTo: source.arrivedTo.toISOString(),
        };
      },
    ),
  };
}

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readCount(value: JSONValue | undefined): number {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/*
 * The answer as the Dashboard reads it: a source without a count or with
 * a time that is not one is left out, and the total is what the sources
 * the server sent hold when it sent none.
 */
export function parseLateArrivals(
  value: JSONValue | undefined,
): SecurityEventLateArrivals | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body: JSONObject = value as JSONObject;
  const arrivedSince: Date | null = readDate(body["arrivedSince"]);

  if (!arrivedSince) {
    return null;
  }

  const sources: Array<SecurityEventLateArrivalSource> = [];
  const rows: JSONArray = Array.isArray(body["sources"])
    ? (body["sources"] as JSONArray)
    : [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const source: JSONObject = row as JSONObject;
    const eventCount: number = readCount(source["eventCount"]);
    const happenedFrom: Date | null = readDate(source["happenedFrom"]);
    const happenedTo: Date | null = readDate(source["happenedTo"]);
    const arrivedFrom: Date | null = readDate(source["arrivedFrom"]);
    const arrivedTo: Date | null = readDate(source["arrivedTo"]);

    if (
      eventCount === 0 ||
      !happenedFrom ||
      !happenedTo ||
      !arrivedFrom ||
      !arrivedTo
    ) {
      continue;
    }

    sources.push({
      vendorName: readText(source["vendorName"]),
      productName: readText(source["productName"]),
      eventCount,
      happenedFrom,
      happenedTo,
      arrivedFrom,
      arrivedTo,
    });
  }

  const sentCount: number = readCount(body["eventCount"]);
  const sourcesCount: number = sources.reduce(
    (total: number, source: SecurityEventLateArrivalSource): number => {
      return total + source.eventCount;
    },
    0,
  );

  return {
    arrivedSince,
    eventCount: Math.max(sentCount, sourcesCount),
    sources,
  };
}
