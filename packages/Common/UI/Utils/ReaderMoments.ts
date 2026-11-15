import OneUptimeDate from "../../Types/Date";

/*
 * A DATE OR A TIME, WRITTEN FOR THE PERSON READING IT (issue #8231).
 *
 * Every date and time on the Dashboard follows the reader: the zone they
 * picked in User Settings (else the browser's), their 12- or 24-hour clock
 * and their language, as OneUptimeDate writes them. A few were written by
 * the browser instead - Date.prototype.toLocaleString, toLocaleDateString
 * or toLocaleTimeString with only a locale - which writes the browser's
 * zone, the language's own clock and the seconds: Topology's "Last
 * refreshed" read "05:14:00", in the browser's zone, beside a table's "5:14
 * AM" in the zone the reader picked. These are the three shapes those
 * places write, each through OneUptimeDate; DatesOnTheReadersClockGuard
 * keeps the browser's own writing out of the product.
 *
 * Each writes in OneUptimeDate's display language, and remembers its
 * English, so a sentence the reader's language does not word yet takes the
 * English date (Translator).
 */

/*
 * A moment in a sentence or a title: "Nov 5, 2026, 5:14 AM", "5. Nov.
 * 2026, 05:14" - as a table writes it, with the year, since a sentence
 * read later has no "this year" to leave it to. With seconds for a record
 * read to the second, an instance health log.
 */
export function writeReaderMoment(
  date: Date,
  options?: { includeSeconds?: boolean | undefined },
): string {
  return OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
    showYear: true,
    includeSeconds: Boolean(options?.includeSeconds),
  });
}

// A day: "Nov 5, 2026", "5. Nov. 2026", "2026년 11월 5일", in the reader's zone.
export function writeReaderDay(date: Date): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: date,
    onlyShowDate: true,
  });
}

/*
 * A time of day, to the second, for something that refreshes while it is
 * read: "5:14:07 AM", "05:14:07", "오전 5:14:07", on the reader's clock.
 */
export function writeReaderTimeOfDay(date: Date): string {
  return OneUptimeDate.getLocalTimeString(date, {
    includeSeconds: true,
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}
