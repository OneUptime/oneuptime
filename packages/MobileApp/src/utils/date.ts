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

export function formatDateTime(dateString: string): string {
  const timestamp: number | null = parseTimestamp(dateString);

  /*
   * Without this, toLocaleDateString on an invalid Date returns the literal
   * string "Invalid Date", which the detail screens print verbatim under a
   * "Created" heading - it looks like a value and tells the reader nothing.
   */
  if (timestamp === null) {
    return UNKNOWN_TIME;
  }

  const date: Date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
