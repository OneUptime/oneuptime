/*
 * What goes on the card when the timestamp cannot be used. An em dash is the
 * conventional "no value" mark, and the point of it is that it cannot be
 * mistaken for data: this text sits directly beside an incident title, so any
 * fallback made of digits ("0m ago", a date in 1970) reads as something the
 * server actually said and quietly misinforms the responder. An empty string
 * would be honest too, but it leaves the clock icon next to it hanging with
 * nothing beside it, which reads as a rendering bug rather than a missing
 * value.
 */
const UNKNOWN_TIME: string = "—";

/**
 * The instant `dateString` names, or null if it does not name one.
 *
 * Both exported functions take `string`, but the fields feeding them come
 * straight off an API response - a column the server omitted arrives as
 * undefined and a nulled one arrives as null, and the annotation does nothing
 * about either at runtime. Both failure modes have to be caught HERE rather
 * than left to the arithmetic below:
 *
 *  - An unparseable string gives NaN, and every comparison against NaN is
 *    false, so it falls through minutes, hours, days and months untouched and
 *    comes out of the years branch as the literal string "NaNy ago".
 *  - null is worse, because it is not NaN: `new Date(null)` is midnight on 1
 *    January 1970, so the arithmetic succeeds and reports a brand-new incident
 *    as being half a century old - a plausible number that is pure fiction.
 */
function parseTimestamp(dateString: string): number | null {
  if (!dateString) {
    return null;
  }

  const time: number = new Date(dateString).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return time;
}

export function formatRelativeTime(dateString: string): string {
  const date: number | null = parseTimestamp(dateString);

  if (date === null) {
    return UNKNOWN_TIME;
  }

  const now: number = Date.now();
  /*
   * A timestamp in the future makes this negative, which is less than 60 and so
   * reports "just now". That is deliberate: every field passed in here -
   * createdAt, declaredAt, startsAt - records something that has already
   * happened, so the only realistic way one lands ahead of the handset's clock
   * is skew between the phone and the server, and a few seconds of skew should
   * read as "just now". Counting forwards instead would print "in 3 hours" on
   * an incident that is already paging someone.
   */
  const seconds: number = Math.floor((now - date) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes: number = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours: number = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days: number = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months: number = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  const years: number = Math.floor(months / 12);
  return `${years}y ago`;
}

/*
 * HOW A TIME OF DAY'S HOUR IS WRITTEN.
 *
 * A 12-hour time has no leading zero in any language: "5:14 AM", "오전
 * 5:14", "上午5:14", "5:14 am", "5:14 ص". A 24-hour one keeps it: "05:14".
 * Intl writes the zero wherever it is asked for a two-digit hour, whatever
 * the clock, so the app read "Nov 5, 05:14 AM" and "11월 5일 오전 05:14" on
 * a 12-hour phone (issue #7650); asked for a numeric hour on a 24-hour clock
 * it drops the zero in German, French, Japanese and most others ("5:14").
 * So the hour follows the clock: "numeric" on a 12-hour one, "2-digit" on a
 * 24-hour one - the rule the web Dashboard writes its times by
 * (Common/Types/DateLanguage's getHourOption), copied here because the app
 * imports only from its own package and React Native.
 */
export function getHourOption(use12HourClock: boolean): "numeric" | "2-digit" {
  return use12HourClock ? "numeric" : "2-digit";
}

/*
 * Whether `locale` (the phone's own when undefined) reads a 12-hour clock.
 * Intl reports the clock only for a format that has an hour, so the probe
 * asks for one; an engine that reports the cycle but not the boolean says
 * h11 or h12 for a 12-hour clock. One whose Intl cannot say reads a 24-hour
 * clock, whose "05:14" no language misreads.
 */
export function uses12HourClock(locale?: string | undefined): boolean {
  try {
    const resolved: { hour12?: boolean | undefined; hourCycle?: string } =
      new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();

    if (typeof resolved.hour12 === "boolean") {
      return resolved.hour12;
    }

    if (resolved.hourCycle) {
      return resolved.hourCycle === "h11" || resolved.hourCycle === "h12";
    }
  } catch {
    // A locale Intl refuses: the 24-hour clock, below.
  }

  return false;
}

export interface DateTimeTextOptions {
  // With the year: "Nov 5, 2026, 5:14 AM" rather than "Nov 5, 5:14 AM".
  showYear: boolean;
  // The locale written in; the phone's own when undefined.
  locale?: string | undefined;
  // The IANA zone read in; the phone's own when undefined.
  timeZone?: string | undefined;
}

/*
 * An instant as a date and a time of day, on the clock `locale` reads:
 * "Nov 5, 2026, 5:14 AM", "2026년 11월 5일 오전 5:14", "5. Nov. 2026,
 * 05:14". The detail screens' dates and a monitor's last check are all
 * written here, so they cannot write one time two ways; a component that
 * asks Intl for an hour on its own is refused by the web's guards
 * (Common/Tests/Types/*ClockLeadingZeroGuard), which read the app too.
 */
export function writeDateTime(
  date: Date,
  options: DateTimeTextOptions,
): string {
  const twelveHour: boolean = uses12HourClock(options.locale);

  return date.toLocaleString(options.locale, {
    ...(options.showYear ? { year: "numeric" } : {}),
    month: "short",
    day: "numeric",
    hour: getHourOption(twelveHour),
    minute: "2-digit",
    hour12: twelveHour,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
}

export function formatDateTime(dateString: string): string {
  const timestamp: number | null = parseTimestamp(dateString);

  /*
   * Without this, toLocaleString on an invalid Date returns the literal
   * string "Invalid Date", which the detail screens print verbatim under a
   * "Created" heading - it looks like a value and tells the reader nothing.
   */
  if (timestamp === null) {
    return UNKNOWN_TIME;
  }

  return writeDateTime(new Date(timestamp), { showYear: true });
}

/*
 * "Nov 5, 5:14 AM": a date and time without its year, as a monitor's
 * summary tiles write the last check. Null for a value that names no
 * instant, so the caller keeps its own placeholder.
 */
export function formatShortDateTime(dateString: string): string | null {
  const timestamp: number | null = parseTimestamp(dateString);

  if (timestamp === null) {
    return null;
  }

  return writeDateTime(new Date(timestamp), { showYear: false });
}
