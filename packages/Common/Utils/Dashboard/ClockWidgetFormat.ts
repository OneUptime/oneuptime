import {
  ClockWidgetFace,
  ClockWidgetHourFormat,
} from "../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import OneUptimeDate, { Moment } from "../../Types/Date";
import Timezone from "../../Types/Timezone";
import type { Moment as MomentType } from "moment-timezone";

/**
 * Every derivation the dashboard Clock widget needs to turn "now" into what
 * it draws — the digit strings, the caption, the analog hand angles, and how
 * long to sleep before the next repaint.
 *
 * It all lives here rather than in the React renderer because the interesting
 * cases are all clock arithmetic and none of them need a DOM: half-hour and
 * quarter-hour zone offsets, DST jumps, midnight/noon in 12-hour form, a
 * timezone that no longer exists, and hand angles that have to stay smooth
 * across the top of the hour.
 */

/** Degrees swept per second (and per minute) — a full turn over 60 steps. */
const DEGREES_PER_SECOND: number = 6;

/** Degrees swept per hour on a 12-hour dial. */
const DEGREES_PER_HOUR: number = 30;

const MILLISECONDS_PER_SECOND: number = 1000;
const MILLISECONDS_PER_MINUTE: number = 60 * MILLISECONDS_PER_SECOND;

/** Local hour at which the widget starts calling it daytime (inclusive). */
const DAY_STARTS_AT_HOUR: number = 6;

/** Local hour at which the widget stops calling it daytime (exclusive). */
const DAY_ENDS_AT_HOUR: number = 18;

/**
 * True when moment-timezone knows the zone. A dashboard config outlives the
 * tzdb release it was written against, so a zone can be renamed or dropped
 * (and a hand-edited config can hold anything at all) — every entry point
 * below has to survive that rather than render "Invalid date".
 */
export type IsSupportedClockTimezoneFunction = (
  timezone: string | undefined | null,
) => boolean;

export const isSupportedClockTimezone: IsSupportedClockTimezoneFunction = (
  timezone: string | undefined | null,
): boolean => {
  if (typeof timezone !== "string") {
    return false;
  }

  const trimmed: string = timezone.trim();

  if (!trimmed) {
    return false;
  }

  return Boolean(Moment.tz.zone(trimmed));
};

/**
 * The zone the clock should actually be read in: the configured one when it
 * is usable, otherwise the viewer's own. Falling back (rather than erroring)
 * keeps an unconfigured, freshly-dropped widget showing a real time.
 */
export type ResolveClockTimezoneFunction = (
  timezone: string | undefined | null,
) => string;

export const resolveClockTimezone: ResolveClockTimezoneFunction = (
  timezone: string | undefined | null,
): string => {
  if (isSupportedClockTimezone(timezone)) {
    return (timezone as string).trim();
  }

  return OneUptimeDate.getCurrentTimezone().toString();
};

/**
 * The city out of an IANA name — "America/New_York" -> "New York",
 * "America/Argentina/Buenos_Aires" -> "Buenos Aires", "UTC" -> "UTC".
 * Used as the caption when the author did not write one, because
 * "America/Argentina/Buenos_Aires" does not fit in a 3-unit tile.
 */
export type GetCityFromTimezoneFunction = (timezone: string) => string;

export const getCityFromTimezone: GetCityFromTimezoneFunction = (
  timezone: string,
): string => {
  const segments: Array<string> = timezone
    .split("/")
    .map((segment: string): string => {
      return segment.trim();
    })
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  const lastSegment: string | undefined = segments[segments.length - 1];

  if (!lastSegment) {
    return timezone.trim();
  }

  return lastSegment.replace(/_/g, " ");
};

/**
 * The caption under the time: the author's label if they wrote one, else the
 * city of the zone being shown. Never the raw IANA path.
 */
export type GetClockLabelFunction = (data: {
  label?: string | undefined;
  timezone: string;
}) => string;

export const getClockLabel: GetClockLabelFunction = (data: {
  label?: string | undefined;
  timezone: string;
}): string => {
  const trimmedLabel: string = (data.label || "").trim();

  if (trimmedLabel) {
    return trimmedLabel;
  }

  return getCityFromTimezone(data.timezone);
};

/**
 * Resolve the 12/24-hour choice. `Auto` (and anything unrecognised, which is
 * what an older saved config holds) defers to the viewer's browser locale.
 */
export type ResolveUse12HourFormatFunction = (
  hourFormat: ClockWidgetHourFormat | undefined | null,
) => boolean;

export const resolveUse12HourFormat: ResolveUse12HourFormatFunction = (
  hourFormat: ClockWidgetHourFormat | undefined | null,
): boolean => {
  if (hourFormat === ClockWidgetHourFormat.TwelveHour) {
    return true;
  }

  if (hourFormat === ClockWidgetHourFormat.TwentyFourHour) {
    return false;
  }

  return OneUptimeDate.getUserPrefers12HourFormat();
};

export interface ClockWidgetDisplay {
  /** Caption under the time. */
  label: string;
  /** "9:05" (12h) or "21:05" (24h) — never carries seconds. */
  time: string;
  /** "07", or null when the widget is configured without seconds. */
  seconds: string | null;
  /** "AM" / "PM" in 12-hour mode, null in 24-hour mode. */
  meridiem: string | null;
  /** "Mon, Aug 3", or null when the date is switched off. */
  dateText: string | null;
  /** DST-aware "EDT" / "GMT+05:30", or null when switched off. */
  zoneAbbreviation: string | null;
  /** The zone the strings above were resolved in. */
  timezone: string;
  /**
   * True only when the author DID configure a zone and it turned out to be
   * unusable, so the renderer can say so. Leaving the zone blank is the
   * documented way to ask for the viewer's own zone and is not flagged.
   */
  isFallbackTimezone: boolean;
}

/**
 * Did a configured zone get silently swapped for the viewer's own? True only
 * when something was actually configured — an empty value means "use the
 * viewer's zone", which is a choice rather than a failure.
 */
export type IsClockTimezoneFallbackFunction = (
  timezone: string | undefined | null,
) => boolean;

export const isClockTimezoneFallback: IsClockTimezoneFallbackFunction = (
  timezone: string | undefined | null,
): boolean => {
  if (typeof timezone !== "string" || !timezone.trim()) {
    return false;
  }

  return !isSupportedClockTimezone(timezone);
};

/**
 * Everything the digital face draws, for one instant.
 *
 * Seconds and meridiem come back separately from the time so the renderer can
 * set them in a smaller type beside the big digits without re-parsing a
 * formatted string.
 */
export type GetClockWidgetDisplayFunction = (data: {
  date: Date;
  timezone?: string | undefined;
  label?: string | undefined;
  hourFormat?: ClockWidgetHourFormat | undefined;
  showSeconds?: boolean | undefined;
  showDate?: boolean | undefined;
  showTimezoneAbbreviation?: boolean | undefined;
}) => ClockWidgetDisplay;

export const getClockWidgetDisplay: GetClockWidgetDisplayFunction = (data: {
  date: Date;
  timezone?: string | undefined;
  label?: string | undefined;
  hourFormat?: ClockWidgetHourFormat | undefined;
  showSeconds?: boolean | undefined;
  showDate?: boolean | undefined;
  showTimezoneAbbreviation?: boolean | undefined;
}): ClockWidgetDisplay => {
  const isFallbackTimezone: boolean = isClockTimezoneFallback(data.timezone);
  const timezone: string = resolveClockTimezone(data.timezone);
  const use12HourFormat: boolean = resolveUse12HourFormat(data.hourFormat);

  const zoned: MomentType = Moment(data.date).tz(timezone);

  return {
    label: getClockLabel({ label: data.label, timezone: timezone }),
    time: zoned.format(use12HourFormat ? "h:mm" : "HH:mm"),
    seconds: data.showSeconds ? zoned.format("ss") : null,
    meridiem: use12HourFormat ? zoned.format("A") : null,
    dateText: data.showDate ? zoned.format("ddd, MMM D") : null,
    zoneAbbreviation: data.showTimezoneAbbreviation
      ? OneUptimeDate.getZoneAbbrByTimezone(timezone as Timezone, data.date)
      : null,
    timezone: timezone,
    isFallbackTimezone: isFallbackTimezone,
  };
};

/**
 * "GMT+5:30" for the instant given — computed at `date` rather than at "now"
 * so a clock rendered either side of a DST boundary reports the offset that
 * actually applies to the time on its face.
 */
export type GetClockGmtOffsetTextFunction = (data: {
  date: Date;
  timezone: string;
}) => string;

export const getClockGmtOffsetText: GetClockGmtOffsetTextFunction = (data: {
  date: Date;
  timezone: string;
}): string => {
  const timezone: string = resolveClockTimezone(data.timezone);
  const offsetInMinutes: number = Moment(data.date).tz(timezone).utcOffset();

  return OneUptimeDate.getGmtOffsetFriendlyString(offsetInMinutes);
};

export interface ClockHandAngles {
  /** Degrees clockwise from 12 o'clock. */
  hourAngleInDegrees: number;
  minuteAngleInDegrees: number;
  secondAngleInDegrees: number;
}

/**
 * Where the three hands point, in degrees clockwise from 12.
 *
 * The hour and minute hands carry the fraction of the smaller unit (the hour
 * hand sits half-way between 3 and 4 at 3:30) — a dial whose hour hand jumps
 * only on the hour reads as broken. The second hand ticks whole seconds,
 * which is both what a real clock does and all the resolution the widget's
 * once-a-second repaint can show.
 */
export type GetClockHandAnglesFunction = (data: {
  date: Date;
  timezone?: string | undefined;
}) => ClockHandAngles;

export const getClockHandAngles: GetClockHandAnglesFunction = (data: {
  date: Date;
  timezone?: string | undefined;
}): ClockHandAngles => {
  const timezone: string = resolveClockTimezone(data.timezone);
  const zoned: MomentType = Moment(data.date).tz(timezone);

  const seconds: number = zoned.seconds();
  const minutes: number = zoned.minutes();
  const hours: number = zoned.hours() % 12;

  return {
    hourAngleInDegrees:
      (hours + minutes / 60 + seconds / 3600) * DEGREES_PER_HOUR,
    minuteAngleInDegrees: (minutes + seconds / 60) * DEGREES_PER_SECOND,
    secondAngleInDegrees: seconds * DEGREES_PER_SECOND,
  };
};

/**
 * How long to wait before repainting, aligned to the next second (or minute)
 * boundary rather than a flat 1000ms.
 *
 * A plain setInterval(1000) accumulates every scheduling delay, so a clock
 * left open drifts visibly and eventually skips a second outright. Re-arming
 * to the boundary each tick keeps the displayed second in step with the real
 * one no matter how late a given callback runs.
 *
 * Zone offsets are all whole minutes, so the sub-minute remainder is the same
 * in every timezone and the instant alone answers this.
 */
export type GetMillisecondsUntilNextClockTickFunction = (data: {
  date: Date;
  showSeconds?: boolean | undefined;
}) => number;

export const getMillisecondsUntilNextClockTick: GetMillisecondsUntilNextClockTickFunction =
  (data: { date: Date; showSeconds?: boolean | undefined }): number => {
    const period: number = data.showSeconds
      ? MILLISECONDS_PER_SECOND
      : MILLISECONDS_PER_MINUTE;

    const timeInMs: number = data.date.getTime();

    if (!isFinite(timeInMs)) {
      // An Invalid Date must not turn into a NaN (i.e. immediate) timeout.
      return period;
    }

    /*
     * `%` keeps the sign of the dividend, and pre-1970 instants are negative
     * — normalise so the remainder is always the distance *past* the last
     * boundary.
     */
    const sinceLastBoundary: number = ((timeInMs % period) + period) % period;
    const untilNextBoundary: number = period - sinceLastBoundary;

    /*
     * Exactly on a boundary the remainder is 0 and this yields a full period,
     * which is correct: the next boundary is one period away. The result is
     * therefore always in 1..period and never 0, so the caller can never
     * schedule a zero-delay timer that spins.
     */
    return untilNextBoundary;
  };

/**
 * Whether it is daytime where the clock is pointed (06:00–17:59 local).
 *
 * The renderer uses this for the sun/moon glyph, which is the whole point of
 * putting another team's zone on a wall dashboard: you want to see at a
 * glance whether paging Sydney right now means waking someone up.
 */
export type IsDaytimeAtClockFunction = (data: {
  date: Date;
  timezone?: string | undefined;
}) => boolean;

export const isDaytimeAtClock: IsDaytimeAtClockFunction = (data: {
  date: Date;
  timezone?: string | undefined;
}): boolean => {
  const timezone: string = resolveClockTimezone(data.timezone);
  const hour: number = Moment(data.date).tz(timezone).hours();

  return hour >= DAY_STARTS_AT_HOUR && hour < DAY_ENDS_AT_HOUR;
};

/**
 * Seconds and the AM/PM marker are drawn at this fraction of the main time
 * size, so they read as annotations rather than competing with the digits.
 * The width estimate below has to know it too.
 */
export const CLOCK_SECONDARY_FONT_SCALE: number = 0.45;

/** Advance width of one tabular-numeral, as a fraction of the font size. */
const TABULAR_DIGIT_WIDTH_RATIO: number = 0.62;

/** Vertical space one secondary line (label / date / zone) occupies. */
const SECONDARY_LINE_HEIGHT_IN_PX: number = 16;

/** The `gap-1` the renderer puts between every stacked row. */
const CLOCK_ROW_GAP_IN_PX: number = 4;

/** line-height on the time row, so its box is taller than the font size. */
const CLOCK_TIME_LINE_HEIGHT_RATIO: number = 1.05;

/**
 * Padding the widget chrome puts between the tile edge and the widget's own
 * content box. Mirrors DashboardBaseComponent, which wraps every widget in
 * `padding: 12px`, widened to `28px 12px 12px 12px` in edit mode to leave room
 * for the drag handle it overlays on the top of the tile.
 *
 * The canvas hands each widget its OUTER tile size, so a sizer that does not
 * subtract this overflows the content box — most visibly on a short tile,
 * where the last caption line gets clipped by the tile's overflow-hidden.
 */
const CLOCK_CHROME_HORIZONTAL_IN_PX: number = 24;
const CLOCK_CHROME_VERTICAL_IN_PX: number = 24;
const CLOCK_CHROME_VERTICAL_EDIT_MODE_IN_PX: number = 40;

/** Breathing room kept inside the content box so nothing sits flush. */
const CLOCK_HORIZONTAL_PADDING_IN_PX: number = 8;
const CLOCK_VERTICAL_PADDING_IN_PX: number = 4;

const MIN_CLOCK_FONT_SIZE_IN_PX: number = 14;
const MAX_CLOCK_FONT_SIZE_IN_PX: number = 64;
const MIN_ANALOG_DIAL_SIZE_IN_PX: number = 48;

export interface ClockContentBox {
  widthInPx: number;
  heightInPx: number;
}

/**
 * How many single-line rows sit alongside the clock face: the label, plus
 * whichever of the date, the zone and the unknown-zone warning are showing.
 *
 * The warning row counts too — it is the case where the widget has the MOST
 * to fit, so leaving it out of the budget clips exactly the message the user
 * needs to read.
 */
export type GetClockCaptionLineCountFunction = (
  display: ClockWidgetDisplay,
) => number;

export const getClockCaptionLineCount: GetClockCaptionLineCountFunction = (
  display: ClockWidgetDisplay,
): number => {
  return (
    1 +
    (display.dateText ? 1 : 0) +
    (display.zoneAbbreviation ? 1 : 0) +
    (display.isFallbackTimezone ? 1 : 0)
  );
};

/**
 * Height the caption rows claim, including the flex gap above each of them.
 * The face itself is the row they are stacked around, so the gap count equals
 * the caption count.
 */
type GetCaptionStackHeightFunction = (captionLineCount: number) => number;

const getCaptionStackHeightInPx: GetCaptionStackHeightFunction = (
  captionLineCount: number,
): number => {
  return captionLineCount * (SECONDARY_LINE_HEIGHT_IN_PX + CLOCK_ROW_GAP_IN_PX);
};

/**
 * Turn the OUTER tile size the dashboard canvas reports into the box the
 * widget actually gets to draw in, by subtracting the padding the widget
 * chrome adds around it.
 *
 * Edit mode is not cosmetic here: the drag handle takes another 16px off the
 * top, so a clock that only just fits while viewing would have its bottom
 * caption clipped the moment the dashboard is edited.
 */
export type GetClockContentBoxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
}) => ClockContentBox;

export const getClockContentBox: GetClockContentBoxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  isEditMode?: boolean | undefined;
}): ClockContentBox => {
  const verticalChrome: number = data.isEditMode
    ? CLOCK_CHROME_VERTICAL_EDIT_MODE_IN_PX
    : CLOCK_CHROME_VERTICAL_IN_PX;

  return {
    widthInPx: Math.max(data.widthInPx - CLOCK_CHROME_HORIZONTAL_IN_PX, 0),
    heightInPx: Math.max(data.heightInPx - verticalChrome, 0),
  };
};

/**
 * How wide the time reads, in multiples of the main font size — the digits at
 * full size plus the seconds and meridiem at their reduced size. Used to size
 * the digits to the tile instead of letting a long "12:34:56 PM" overflow a
 * narrow one.
 */
export type GetClockTimeWidthInFontUnitsFunction = (
  display: ClockWidgetDisplay,
) => number;

export const getClockTimeWidthInFontUnits: GetClockTimeWidthInFontUnitsFunction =
  (display: ClockWidgetDisplay): number => {
    // ":" + "ss", and " " + "AM", each drawn at the secondary size.
    const secondsChars: number = display.seconds
      ? (display.seconds.length + 1) * CLOCK_SECONDARY_FONT_SCALE
      : 0;
    const meridiemChars: number = display.meridiem
      ? (display.meridiem.length + 1) * CLOCK_SECONDARY_FONT_SCALE
      : 0;

    return (
      (display.time.length + secondsChars + meridiemChars) *
      TABULAR_DIGIT_WIDTH_RATIO
    );
  };

/**
 * The font size for the digital face: as large as the tile allows, bounded by
 * BOTH the height left over after the caption lines and the width the digits
 * need. Clamped so a 1-unit-tall tile still shows readable digits and a huge
 * tile does not turn the time into a billboard.
 */
export type GetClockDigitalFontSizeInPxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  display: ClockWidgetDisplay;
  isEditMode?: boolean | undefined;
}) => number;

export const getClockDigitalFontSizeInPx: GetClockDigitalFontSizeInPxFunction =
  (data: {
    widthInPx: number;
    heightInPx: number;
    display: ClockWidgetDisplay;
    isEditMode?: boolean | undefined;
  }): number => {
    const contentBox: ClockContentBox = getClockContentBox(data);

    /*
     * Divide by the line-height ratio rather than treating the font size as
     * the row height: at `line-height: 1.05` the time row's box is taller
     * than its font size, and that difference is enough to push the last
     * caption past the tile's overflow-hidden edge on a short strip.
     */
    const heightBudget: number = Math.max(
      (contentBox.heightInPx -
        getCaptionStackHeightInPx(getClockCaptionLineCount(data.display)) -
        CLOCK_VERTICAL_PADDING_IN_PX) /
        CLOCK_TIME_LINE_HEIGHT_RATIO,
      MIN_CLOCK_FONT_SIZE_IN_PX,
    );

    const widthBudget: number = Math.max(
      contentBox.widthInPx - CLOCK_HORIZONTAL_PADDING_IN_PX,
      MIN_CLOCK_FONT_SIZE_IN_PX,
    );

    const widthLimited: number =
      widthBudget / getClockTimeWidthInFontUnits(data.display);

    return Math.max(
      Math.min(heightBudget, widthLimited, MAX_CLOCK_FONT_SIZE_IN_PX),
      MIN_CLOCK_FONT_SIZE_IN_PX,
    );
  };

/**
 * Diameter of the analog dial: the largest circle that fits once the caption
 * lines below it have taken their share of the height.
 */
export type GetClockAnalogDialSizeInPxFunction = (data: {
  widthInPx: number;
  heightInPx: number;
  display: ClockWidgetDisplay;
  isEditMode?: boolean | undefined;
}) => number;

export const getClockAnalogDialSizeInPx: GetClockAnalogDialSizeInPxFunction =
  (data: {
    widthInPx: number;
    heightInPx: number;
    display: ClockWidgetDisplay;
    isEditMode?: boolean | undefined;
  }): number => {
    const contentBox: ClockContentBox = getClockContentBox(data);

    const availableHeight: number =
      contentBox.heightInPx -
      getCaptionStackHeightInPx(getClockCaptionLineCount(data.display)) -
      CLOCK_VERTICAL_PADDING_IN_PX;

    const availableWidth: number =
      contentBox.widthInPx - CLOCK_HORIZONTAL_PADDING_IN_PX;

    return Math.max(
      Math.min(availableWidth, availableHeight),
      MIN_ANALOG_DIAL_SIZE_IN_PX,
    );
  };

/** Normalise a possibly-absent saved value to a face the renderer handles. */
export type ResolveClockFaceFunction = (
  clockFace: ClockWidgetFace | undefined | null,
) => ClockWidgetFace;

export const resolveClockFace: ResolveClockFaceFunction = (
  clockFace: ClockWidgetFace | undefined | null,
): ClockWidgetFace => {
  return clockFace === ClockWidgetFace.Analog
    ? ClockWidgetFace.Analog
    : ClockWidgetFace.Digital;
};
