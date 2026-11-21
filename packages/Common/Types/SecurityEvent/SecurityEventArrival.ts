import OneUptimeDate from "../Date";
import { DETECTION_LATE_EVENT_WINDOW_IN_MINUTES } from "./DetectionFindingConstants";

/*
 * WHAT ARRIVED, AND WHEN IT MAY HAVE HAPPENED.
 *
 * A security event carries two times: when it happened (`time`, the
 * source's) and when it reached OneUptime (`createdAt`, stamped as its row
 * is built, in whole seconds). They differ: a span is read when it ends, a
 * flow in whole windows, a cloud audit log lags, a shipper holds a batch.
 * What runs on a schedule - a detection rule (#10337), a hunt (#10488) -
 * reads what ARRIVED since its last run, whenever it happened, so an event
 * that lands late is still read, once.
 *
 * An arrival range is (arrivedAfter, arrivedUntil]: after the first, up to
 * and including the second, both whole seconds as createdAt is. An event in
 * it counts when it arrived within a day of when it happened
 * (DETECTION_LATE_EVENT_WINDOW_IN_MINUTES): one later than that is stored
 * and searchable, but no run reads it (#10491 says so where people look).
 *
 * Shared by the server, which reads by it, and the Dashboard, which opens a
 * hunt's run on the events it counted: a read of the SecurityEvent table
 * carries the range under its own synthetic key
 * (SECURITY_EVENT_ARRIVAL_QUERY_KEY), which the statement generator compiles
 * to the same condition a scheduled detection rule reads with
 * (Server/Utils/SecurityEvent/DetectionArrivalRead). It only ever narrows a
 * read: authorization still runs on the query's own project and sources.
 */

// The synthetic query key a read of what arrived carries its range under.
export const SECURITY_EVENT_ARRIVAL_QUERY_KEY: string = "securityEventArrival";

/*
 * How far ahead of when it arrived an event's own time may be, as a source's
 * clock may run fast: past this, ingest stamps the event with when it
 * arrived instead (SecurityEventRow).
 */
export const SECURITY_EVENT_MAX_FUTURE_SKEW_IN_MINUTES: number = 60;

export interface SecurityEventArrivalRange {
  // Exclusive: what arrived by then was read before.
  arrivedAfter: Date;
  // Inclusive.
  arrivedUntil: Date;
}

// A whole second, as createdAt keeps it: a range's edges match its rows exactly.
export function floorToSecond(date: Date): Date {
  return new Date(Math.floor(new Date(date).getTime() / 1000) * 1000);
}

/*
 * When the events of an arrival range may have happened: up to
 * DETECTION_LATE_EVENT_WINDOW_IN_MINUTES before the first of them arrived,
 * and as far ahead of the last as a source's clock may run. Every read of a
 * range is held to it, so the table's sort by event time keeps the read to
 * these parts of it - and the Events page opened on a range shows its
 * events wherever in it they happened.
 */
export function getArrivalEventTimeBounds(range: SecurityEventArrivalRange): {
  happenedAfter: Date;
  happenedBefore: Date;
} {
  return {
    happenedAfter: OneUptimeDate.addRemoveMinutes(
      range.arrivedAfter,
      -DETECTION_LATE_EVENT_WINDOW_IN_MINUTES,
    ),
    happenedBefore: OneUptimeDate.addRemoveMinutes(
      range.arrivedUntil,
      SECURITY_EVENT_MAX_FUTURE_SKEW_IN_MINUTES + 1,
    ),
  };
}

function readMoment(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const date: Date = new Date(value.trim());

  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * A range read from an untrusted query or address: both ends a moment, in
 * whole seconds, the first before the second. Null when it is not one: a
 * read that carries a range it cannot read matches nothing, never
 * everything.
 */
export function readSecurityEventArrivalRange(
  value: unknown,
): SecurityEventArrivalRange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const after: Date | null = readMoment(raw["arrivedAfter"]);
  const until: Date | null = readMoment(raw["arrivedUntil"]);

  if (!after || !until) {
    return null;
  }

  const range: SecurityEventArrivalRange = {
    arrivedAfter: floorToSecond(after),
    arrivedUntil: floorToSecond(until),
  };

  if (range.arrivedAfter.getTime() >= range.arrivedUntil.getTime()) {
    return null;
  }

  return range;
}

/*
 * The Events page's address names a range of arrivals with these, beside
 * its time range (range / start / end): a hunt's notification, its last
 * find and its Run History open its page on exactly the events a run
 * counted, the arrivals as a chip a reader can take off.
 */
export const SECURITY_EVENTS_ARRIVED_AFTER_PARAM: string = "arrivedAfter";
export const SECURITY_EVENTS_ARRIVED_UNTIL_PARAM: string = "arrivedUntil";

// The range an address names, or null when it names none it can read.
export function readSecurityEventArrivalRangeFromSearch(
  search: string,
): SecurityEventArrivalRange | null {
  const params: URLSearchParams = new URLSearchParams(search);

  return readSecurityEventArrivalRange({
    arrivedAfter: params.get(SECURITY_EVENTS_ARRIVED_AFTER_PARAM),
    arrivedUntil: params.get(SECURITY_EVENTS_ARRIVED_UNTIL_PARAM),
  });
}

// A range as a query carries it: ISO strings, which travel as they are.
export function toSecurityEventArrivalQueryValue(
  range: SecurityEventArrivalRange,
): { arrivedAfter: string; arrivedUntil: string } {
  return {
    arrivedAfter: floorToSecond(range.arrivedAfter).toISOString(),
    arrivedUntil: floorToSecond(range.arrivedUntil).toISOString(),
  };
}
