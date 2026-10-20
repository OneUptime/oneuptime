"use strict";

/*
 * Works out the events of a calendar from outside the project, in a worker
 * thread of its own (ExternalCalendarExpansion.ts starts it, and ends it
 * when it runs too long or too large).
 *
 * The calendar's text comes from wherever its link points, so it is
 * untrusted, and the parser - ical.js, Mozilla's, with its recurrence rules
 * (RRULE, RDATE, EXDATE, RECURRENCE-ID) and time zones (VTIMEZONE) - can be
 * made to work for a very long time by a rule written to: an impossible
 * FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30 never comes back from one call. Run on
 * the main thread, that would stop every API request of the process with
 * it. Here it stops nothing but this thread, which its parent terminates.
 *
 * Plain CommonJS on purpose: a worker thread starts a fresh Node, which
 * loads JavaScript, not the TypeScript the rest of the server is run as.
 * The parent hands in text it has already cut down to the properties read
 * here (ExternalCalendarText.ts), and turns what comes back into events -
 * every time resolved to an instant, every title cleaned and cut - after
 * checking its shape.
 *
 * Input (workerData):
 *   text                    the calendar, as ExternalCalendarText prepared it
 *   windowStartMs           occurrences ending before this are skipped
 *   windowEndMs             occurrences starting after this are skipped
 *   maxSteps                recurrence steps for the whole calendar
 *   maxStepsPerSeries       recurrence steps for one repeating event
 *   maxOccurrences          occurrences sent back at most
 *
 * The window is wider than the one the parent keeps (by a day each side):
 * a time with no zone of its own is compared here as if it were UTC, and is
 * placed in its zone by the parent.
 *
 * Output (one message):
 *   { ok: true, calendarTimezone, occurrences, skippedSeries,
 *     hitStepLimit, hitOccurrenceLimit }
 *   { ok: false, reason: "NotACalendar" }
 *
 * where each occurrence is { uid, title, isPrivate, start, end } and start
 * and end are one of
 *   { kind: "instant", ms }                       a time in UTC or a VTIMEZONE
 *   { kind: "date", year, month, day }            an all-day date
 *   { kind: "wall", year, month, day, hour, minute, second, tzid }
 *                                                 a wall clock with no
 *                                                 VTIMEZONE (tzid: its TZID,
 *                                                 or null when it has none)
 */

const { parentPort, workerData } = require("worker_threads");
const ICAL = require("ical.js");

// Rules that step by the second or the minute: never a calendar's event.
const UNSUPPORTED_FREQUENCIES = ["SECONDLY", "MINUTELY"];

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function isZoned(time) {
  return Boolean(time.zone && time.zone.tzid && time.zone.tzid !== "floating");
}

function toRawTime(time, tzid) {
  if (time.isDate) {
    return {
      kind: "date",
      year: time.year,
      month: time.month,
      day: time.day,
    };
  }

  if (isZoned(time)) {
    return { kind: "instant", ms: time.toUnixTime() * 1000 };
  }

  return {
    kind: "wall",
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
    tzid: typeof tzid === "string" && tzid ? tzid : null,
  };
}

/*
 * A time as milliseconds, for comparing with the window: exact for a zoned
 * time, and as if UTC for a date or a wall clock (the window is a day wider
 * each side for them).
 */
function toApproximateMs(time) {
  if (!time.isDate && isZoned(time)) {
    return time.toUnixTime() * 1000;
  }

  return Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.isDate ? 0 : time.hour,
    time.isDate ? 0 : time.minute,
    time.isDate ? 0 : time.second,
  );
}

function getTzid(event, propertyName) {
  const property = event.component.getFirstProperty(propertyName);

  if (!property) {
    return null;
  }

  const tzid = property.getParameter("tzid");

  return typeof tzid === "string" && tzid ? tzid : null;
}

function getText(component, propertyName) {
  const value = component.getFirstPropertyValue(propertyName);

  return typeof value === "string" ? value : "";
}

function isCancelled(event) {
  return getText(event.component, "status").toUpperCase() === "CANCELLED";
}

function isPrivate(event) {
  const visibility = getText(event.component, "class").toUpperCase();

  return visibility === "PRIVATE" || visibility === "CONFIDENTIAL";
}

function run(input) {
  let parsed;

  try {
    parsed = ICAL.parse(input.text);
  } catch {
    return { ok: false, reason: "NotACalendar" };
  }

  const roots =
    Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed : [parsed];

  const calendars = [];

  for (const root of roots) {
    if (!Array.isArray(root) || root[0] !== "vcalendar") {
      continue;
    }

    calendars.push(new ICAL.Component(root));
  }

  if (calendars.length === 0) {
    return { ok: false, reason: "NotACalendar" };
  }

  const state = {
    steps: 0,
    occurrences: [],
    skippedSeries: 0,
    hitStepLimit: false,
    hitOccurrenceLimit: false,
  };

  let calendarTimezone = null;

  for (const calendar of calendars) {
    if (!calendarTimezone) {
      const timezone = getText(calendar, "x-wr-timezone").trim();
      calendarTimezone = timezone || null;
    }

    readCalendar(calendar, input, state);

    if (state.hitStepLimit || state.hitOccurrenceLimit) {
      break;
    }
  }

  return {
    ok: true,
    calendarTimezone: calendarTimezone,
    occurrences: state.occurrences,
    skippedSeries: state.skippedSeries,
    hitStepLimit: state.hitStepLimit,
    hitOccurrenceLimit: state.hitOccurrenceLimit,
  };
}

function emit(state, input, occurrence) {
  if (state.occurrences.length >= input.maxOccurrences) {
    state.hitOccurrenceLimit = true;
    return false;
  }

  state.occurrences.push(occurrence);

  return true;
}

/*
 * One occurrence of an event: the event itself, or one time a repeating
 * event happens (with what its RECURRENCE-ID override changed).
 */
function emitOccurrence(state, input, data) {
  const item = data.item;

  if (isCancelled(item)) {
    return true;
  }

  const start = data.startDate;
  const end = data.endDate;

  if (!start) {
    return true;
  }

  const startMs = toApproximateMs(start);
  const endMs = end ? toApproximateMs(end) : startMs;

  if (
    startMs > input.windowEndMs ||
    Math.max(endMs, startMs) < input.windowStartMs
  ) {
    return true;
  }

  const startTzid = getTzid(item, "dtstart");
  const endTzid = getTzid(item, "dtend") || startTzid;

  return emit(state, input, {
    uid: getText(item.component, "uid"),
    title: isPrivate(item) ? "" : getText(item.component, "summary"),
    isPrivate: isPrivate(item),
    start: toRawTime(start, startTzid),
    end: end ? toRawTime(end, endTzid) : toRawTime(start, startTzid),
  });
}

function readCalendar(calendar, input, state) {
  const masters = new Map();
  const exceptionsByUid = new Map();
  const standalone = [];

  for (const component of calendar.getAllSubcomponents("vevent")) {
    const uid = getText(component, "uid");

    if (component.hasProperty("recurrence-id")) {
      if (!exceptionsByUid.has(uid)) {
        exceptionsByUid.set(uid, []);
      }

      exceptionsByUid.get(uid).push(component);
      continue;
    }

    if (uid && !masters.has(uid)) {
      masters.set(uid, component);
    } else {
      // No UID, or a UID seen before: an event of its own.
      standalone.push(component);
    }
  }

  // An override whose event is not in the file is an event of its own.
  for (const [uid, components] of exceptionsByUid) {
    if (!masters.has(uid)) {
      standalone.push(...components);
    }
  }

  const components = [...masters.values(), ...standalone];

  for (const component of components) {
    if (state.hitStepLimit || state.hitOccurrenceLimit) {
      return;
    }

    try {
      readEvent(component, exceptionsByUid, masters, input, state);
    } catch {
      // One event that cannot be read is left out; the rest still are.
      state.skippedSeries++;
    }
  }
}

function readEvent(component, exceptionsByUid, masters, input, state) {
  const uid = getText(component, "uid");
  const isMaster =
    !component.hasProperty("recurrence-id") && masters.get(uid) === component;

  /*
   * Overrides are related by hand, from this event's own list: left to
   * itself, ical.js relates every override in the calendar to every event,
   * which is quadratic in a calendar made to be.
   */
  const event = new ICAL.Event(component, {
    strictExceptions: true,
    exceptions: [],
  });

  if (isMaster) {
    for (const exception of exceptionsByUid.get(uid) || []) {
      try {
        event.relateException(exception);
      } catch {
        // An override that does not fit its event is ignored.
      }
    }
  }

  if (!event.startDate) {
    return;
  }

  if (!event.isRecurring() || !isMaster) {
    emitOccurrence(state, input, {
      item: event,
      startDate: event.startDate,
      endDate: event.endDate,
    });
    return;
  }

  const rule = component.getFirstPropertyValue("rrule");
  const frequency =
    rule && typeof rule.freq === "string" ? rule.freq.toUpperCase() : "";

  if (UNSUPPORTED_FREQUENCIES.includes(frequency)) {
    state.skippedSeries++;
    return;
  }

  let durationMs = 0;

  try {
    durationMs = Math.max(0, event.duration.toSeconds() * 1000);
  } catch {
    durationMs = 0;
  }

  const iterator = event.iterator();
  const exceptions = event.exceptions || {};
  const hasRangeExceptions =
    Array.isArray(event.rangeExceptions) && event.rangeExceptions.length > 0;

  /*
   * The times this event's overrides replace, to find them among the
   * occurrences before the window without working out each of those.
   */
  const overriddenMs = new Set();

  for (const id of Object.keys(exceptions)) {
    const exception = exceptions[id];

    if (exception && exception.recurrenceId) {
      overriddenMs.add(toApproximateMs(exception.recurrenceId));
    }
  }

  let seriesSteps = 0;
  let next = iterator.next();

  while (next) {
    seriesSteps++;
    state.steps++;

    if (state.steps > input.maxSteps) {
      state.hitStepLimit = true;
      state.skippedSeries++;
      return;
    }

    if (seriesSteps > input.maxStepsPerSeries) {
      state.skippedSeries++;
      return;
    }

    const instanceMs = toApproximateMs(next);

    if (instanceMs > input.windowEndMs) {
      break;
    }

    const isOverridden =
      hasRangeExceptions ||
      overriddenMs.has(instanceMs) ||
      Boolean(exceptions[next.toString()]);

    if (
      isOverridden ||
      instanceMs + durationMs + MILLISECONDS_PER_DAY >= input.windowStartMs
    ) {
      const details = event.getOccurrenceDetails(next);

      if (!emitOccurrence(state, input, details)) {
        return;
      }
    }

    next = iterator.next();
  }

  /*
   * An override moved into the window from a time past it: the iterator
   * stopped before reaching its own time.
   */
  for (const id of Object.keys(exceptions)) {
    const exception = exceptions[id];

    if (!exception || !exception.recurrenceId) {
      continue;
    }

    if (toApproximateMs(exception.recurrenceId) <= input.windowEndMs) {
      continue;
    }

    if (
      !emitOccurrence(state, input, {
        item: exception,
        startDate: exception.startDate,
        endDate: exception.endDate,
      })
    ) {
      return;
    }
  }
}

parentPort.postMessage(run(workerData));
