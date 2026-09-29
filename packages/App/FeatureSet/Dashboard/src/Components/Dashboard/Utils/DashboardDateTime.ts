import OneUptimeDate from "Common/Types/Date";

/**
 * Every timestamp a dashboard widget shows goes through here.
 *
 * Widgets used to print bare dates ("Jul 16, 2026"), which is unusable on a
 * dashboard: three incidents declared on the same day all read identically,
 * and a log stream where every line carries the same date tells you nothing.
 * So a widget timestamp is always date *and* time of day.
 *
 * Widget columns are narrow, so the visible label stays compact (no timezone
 * abbreviation, no seconds unless the surface needs them) and the full,
 * timezone-qualified, second-precision timestamp goes in the cell's `title`
 * so it is one hover away.
 *
 * Both parts resolve through OneUptimeDate's current-timezone helpers, so a
 * user who picked a timezone in User Settings reads that wall clock here too,
 * and the date and the time can never disagree about which zone they are in.
 */

// What a cell shows when there is no usable timestamp.
export const NO_DATE_LABEL: string = "—";

export interface DashboardDateTime {
  // Compact, for the cell itself: "Jul 16, 2026 14:32".
  label: string;
  // Full precision, for the cell's title attribute: "Jul 16 2026, 14:32:05 PDT".
  title: string;
}

export interface DashboardDateTimeOptions {
  /*
   * Surfaces where sub-minute ordering matters (log lines, spans) put seconds
   * in the visible label too.
   */
  showSeconds?: boolean | undefined;
}

/**
 * Anything a widget hands us — a Date, an ISO string off the API, null,
 * undefined, or junk — resolved to a Date we can format, or null.
 */
function toDisplayableDate(
  date: Date | string | null | undefined,
): Date | null {
  if (date === null || date === undefined || date === "") {
    return null;
  }

  let parsed: Date;

  try {
    parsed = OneUptimeDate.fromString(date);
  } catch {
    // fromString throws on a value that is not a Date, string or date JSON.
    return null;
  }

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

/**
 * The label + hover title a widget should render for a timestamp. Never
 * throws: an absent or unparseable date yields the placeholder and no title.
 */
export function getDashboardDateTime(
  date: Date | string | null | undefined,
  options?: DashboardDateTimeOptions | undefined,
): DashboardDateTime {
  const displayableDate: Date | null = toDisplayableDate(date);

  if (!displayableDate) {
    return {
      label: NO_DATE_LABEL,
      title: "",
    };
  }

  const datePart: string = OneUptimeDate.getDateAsLocalFormattedString(
    displayableDate,
    true,
  );

  const timePart: string = OneUptimeDate.getLocalTimeString(displayableDate, {
    includeMinutes: true,
    includeSeconds: options?.showSeconds === true,
  });

  return {
    label: `${datePart} ${timePart}`,
    title: OneUptimeDate.getDateAsLocalFormattedString(
      displayableDate,
      false, // onlyShowDate
      false, // use12HourFormat
      true, // showSeconds
    ),
  };
}

/**
 * The visible label on its own, for surfaces that have nowhere to hang a
 * title attribute (honeycomb tooltip rows, for example).
 */
export function getDashboardDateTimeLabel(
  date: Date | string | null | undefined,
  options?: DashboardDateTimeOptions | undefined,
): string {
  return getDashboardDateTime(date, options).label;
}
