import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * HOW A TIME RANGE IS NAMED, WITHOUT REACT.
 *
 * The time range picker (TimeRangePickerDropdown) names the range on its
 * button and in its list with these, and so does anything that says which
 * range it counted - a RUM application's Overview tiles (issue #10552) - so
 * the two always say the same thing. They live apart from the picker
 * because the picker's module draws a dialog, whose chain reads `window`
 * the moment it loads: a node test of a page's pure helpers could not
 * import them from there. The picker re-exports every one, so nothing that
 * imported them from it has to change.
 */

export interface TimeRangePickerPresetOption {
  range: TimeRange;
  label: string;
}

// Preset options to show in the dropdown, ordered shortest window first.
export const TIME_RANGE_PRESET_OPTIONS: Array<TimeRangePickerPresetOption> = [
  { range: TimeRange.PAST_FIVE_MINS, label: "Past 5 Minutes" },
  { range: TimeRange.PAST_FIFTEEN_MINS, label: "Past 15 Minutes" },
  { range: TimeRange.PAST_THIRTY_MINS, label: "Past 30 Minutes" },
  { range: TimeRange.PAST_ONE_HOUR, label: "Past 1 Hour" },
  { range: TimeRange.PAST_TWO_HOURS, label: "Past 2 Hours" },
  { range: TimeRange.PAST_THREE_HOURS, label: "Past 3 Hours" },
  { range: TimeRange.PAST_ONE_DAY, label: "Past 1 Day" },
  { range: TimeRange.PAST_TWO_DAYS, label: "Past 2 Days" },
  { range: TimeRange.PAST_ONE_WEEK, label: "Past 1 Week" },
  { range: TimeRange.PAST_TWO_WEEKS, label: "Past 2 Weeks" },
  { range: TimeRange.PAST_ONE_MONTH, label: "Past 1 Month" },
  { range: TimeRange.PAST_THREE_MONTHS, label: "Past 3 Months" },
];

/*
 * What stands between a custom range's two ends ("Mar 1, 10:00 – Mar 2,
 * 13:30").
 */
export const TIME_RANGE_LABEL_SEPARATOR: string = " – ";

/*
 * A range's English label: its preset's ("Past 5 Minutes"), or the range
 * itself ("Custom"). Look it up in the reader's language where it is shown.
 */
export function getTimeRangeLabel(range: TimeRange): string {
  const preset: TimeRangePickerPresetOption | undefined =
    TIME_RANGE_PRESET_OPTIONS.find((opt: TimeRangePickerPresetOption) => {
      return opt.range === range;
    });
  return preset ? preset.label : range;
}

/*
 * A range's label on the button: its preset's ("Past 5 Minutes"), or a
 * custom range's two ends ("Mar 1, 10:00 – Mar 2, 13:30").
 *
 * Both ends are written the way the user's machine writes times: on its 12-
 * or 24-hour clock, in the timezone they configured. Reading the digits off
 * the Date itself - which is what this used to do - pinned the label to a
 * 24-hour clock in whatever zone the browser process happened to be in, so
 * a machine set to AM/PM still got "Mar 1, 14:30" back.
 *
 * The ends carry their years when the range is not all in this year, on the
 * reader's calendar (issue #7124): a range of exactly a year read "Nov 12,
 * 9:49 AM – Nov 12, 9:49 AM", as if it had no length, and one across New
 * Year or in an earlier year did not say which year it was. A range within
 * this year keeps the short label. "This year" is the one `now` is in: now,
 * unless a caller says.
 *
 * A range within one day names its day once, the end its time alone
 * (OneUptimeDate.getLocalDateTimeRangeEnds, #7281): "Nov 5, 2025, 5:14 AM –
 * 6:14 AM", "2025년 11월 5일 오전 5:14 – 오전 6:14". Written in full, the
 * windows an incident offers ("Around the start", "The hour before it
 * started") took two lines each at phone width in Russian, Arabic or Korean.
 */
export function getTimeRangeButtonLabel(
  value: RangeStartAndEndDateTime,
  now?: Date | undefined,
): string {
  if (value.range === TimeRange.CUSTOM && value.startAndEndDate) {
    const showYear: boolean = !OneUptimeDate.isWindowInTheCurrentYear({
      start: value.startAndEndDate.startValue,
      end: value.startAndEndDate.endValue,
      now: now,
    });
    const ends: { start: string; end: string } =
      OneUptimeDate.getLocalDateTimeRangeEnds({
        start: value.startAndEndDate.startValue,
        end: value.startAndEndDate.endValue,
        style: "short",
        showYear: showYear,
      });

    return `${ends.start}${TIME_RANGE_LABEL_SEPARATOR}${ends.end}`;
  }

  return getTimeRangeLabel(value.range);
}
