import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";

/*
 * The time range a metric investigation charts, and how it was picked.
 *
 * A pick is one of three kinds:
 *
 * - a preset the page anchors on what it is about, such as "Around the
 *   start" of an incident. The page works its window out for a moment it is
 *   handed ("now"), so an ongoing incident's "Start to now" ends there;
 * - a range relative to now, such as "Past 1 Hour";
 * - a custom window, picked by hand or dragged out on a chart.
 *
 * Kept as the pick rather than as the window it resolved to, so the picker
 * names it the way the reader picked it ("Around the start", not two dates),
 * the URL keeps it (a link to "Start to now" still ends at now when it is
 * opened tomorrow), and a reset after a zoom comes back to it.
 *
 * Pure: the page, the picker and the URL all read it the same way.
 */

export interface MetricInvestigationTimePreset {
  // Stable for the page: the URL keeps it.
  id: string;
  // English. Looked up in the reader's language where it is shown.
  label: string;
  window: InBetween<Date>;
}

export enum MetricInvestigationTimeKind {
  Preset = "preset",
  Relative = "relative",
  Custom = "custom",
}

export interface MetricInvestigationPresetTime {
  kind: MetricInvestigationTimeKind.Preset;
  presetId: string;
}

export interface MetricInvestigationRelativeTime {
  kind: MetricInvestigationTimeKind.Relative;
  // Never TimeRange.CUSTOM: a custom window is a custom pick.
  range: TimeRange;
}

export interface MetricInvestigationCustomTime {
  kind: MetricInvestigationTimeKind.Custom;
  window: InBetween<Date>;
}

export type MetricInvestigationTimeSelection =
  | MetricInvestigationPresetTime
  | MetricInvestigationRelativeTime
  | MetricInvestigationCustomTime;

// How a pick is written into the URL; see toUrlValue.
export interface MetricInvestigationTimeUrlValue {
  // A preset's id, a relative range ("Past 1 Hour"), or "custom".
  time: string;
  // ISO instants, for a custom window only.
  start?: string | undefined;
  end?: string | undefined;
}

// The `time` a custom window is written with.
export const CUSTOM_TIME_URL_VALUE: string = "custom";

// What an investigation shows when nothing better is offered.
export const DEFAULT_RELATIVE_RANGE: TimeRange = TimeRange.PAST_ONE_HOUR;

type ToEpochMsFunction = (value: unknown) => number;

/*
 * A window can come back from the URL, a stored record or a test holding
 * strings or numbers despite its type, so every bound is read through this.
 * NaN for anything that is not an instant.
 */
const toEpochMs: ToEpochMsFunction = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return new Date(value).getTime();
  }

  return Number.NaN;
};

export default class MetricInvestigationTime {
  /*
   * A window a chart can show: both ends real instants, the start before
   * the end. A window of no width shows nothing at all.
   */
  public static isUsableWindow(
    window: InBetween<Date> | null | undefined,
  ): boolean {
    if (!window) {
      return false;
    }

    const startMs: number = toEpochMs(window.startValue);
    const endMs: number = toEpochMs(window.endValue);

    return (
      Number.isFinite(startMs) && Number.isFinite(endMs) && startMs < endMs
    );
  }

  /*
   * The same window with real Date bounds, or null when it is not usable.
   * The very same object when its bounds already are Dates.
   */
  public static toUsableWindow(
    window: InBetween<Date> | null | undefined,
  ): InBetween<Date> | null {
    if (!window || !MetricInvestigationTime.isUsableWindow(window)) {
      return null;
    }

    if (window.startValue instanceof Date && window.endValue instanceof Date) {
      return window;
    }

    return new InBetween<Date>(
      new Date(toEpochMs(window.startValue)),
      new Date(toEpochMs(window.endValue)),
    );
  }

  public static isSameWindow(
    first: InBetween<Date> | null | undefined,
    second: InBetween<Date> | null | undefined,
  ): boolean {
    if (!first || !second) {
      return !first && !second;
    }

    const firstStartMs: number = toEpochMs(first.startValue);
    const firstEndMs: number = toEpochMs(first.endValue);

    return (
      Number.isFinite(firstStartMs) &&
      Number.isFinite(firstEndMs) &&
      firstStartMs === toEpochMs(second.startValue) &&
      firstEndMs === toEpochMs(second.endValue)
    );
  }

  // A relative range a pick can be: any preset of TimeRange but Custom.
  public static isRelativeRange(value: unknown): value is TimeRange {
    return (
      typeof value === "string" &&
      value !== TimeRange.CUSTOM &&
      (Object.values(TimeRange) as Array<string>).includes(value)
    );
  }

  public static findPreset(
    presets: Array<MetricInvestigationTimePreset>,
    presetId: string,
  ): MetricInvestigationTimePreset | null {
    return (
      presets.find((preset: MetricInvestigationTimePreset): boolean => {
        return preset.id === presetId;
      }) || null
    );
  }

  /*
   * A relative range's window, ending at `now`. Its length is what the
   * picker's own presets mean by it (RangeStartAndEndDateTimeUtil: days of
   * 24 hours, calendar months), so "Past 1 Day" is the same day here as on
   * every other page. Null for Custom, or for anything that is not a range.
   */
  public static resolveRelativeWindow(
    range: TimeRange,
    now: Date,
  ): InBetween<Date> | null {
    if (!MetricInvestigationTime.isRelativeRange(range)) {
      return null;
    }

    const nowMs: number = toEpochMs(now);

    if (!Number.isFinite(nowMs)) {
      return null;
    }

    const resolved: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range: range });
    const lengthMs: number =
      toEpochMs(resolved.endValue) - toEpochMs(resolved.startValue);

    if (!Number.isFinite(lengthMs) || lengthMs <= 0) {
      return null;
    }

    return new InBetween<Date>(new Date(nowMs - lengthMs), new Date(nowMs));
  }

  /*
   * Whether a pick can be shown with these presets: a preset the page still
   * offers, a relative range, or a usable custom window.
   */
  public static isUsableSelection(
    selection: MetricInvestigationTimeSelection | null | undefined,
    presets: Array<MetricInvestigationTimePreset>,
  ): boolean {
    if (!selection) {
      return false;
    }

    if (selection.kind === MetricInvestigationTimeKind.Preset) {
      const preset: MetricInvestigationTimePreset | null =
        MetricInvestigationTime.findPreset(presets, selection.presetId);

      return Boolean(
        preset && MetricInvestigationTime.isUsableWindow(preset.window),
      );
    }

    if (selection.kind === MetricInvestigationTimeKind.Relative) {
      return MetricInvestigationTime.isRelativeRange(selection.range);
    }

    if (selection.kind === MetricInvestigationTimeKind.Custom) {
      return MetricInvestigationTime.isUsableWindow(selection.window);
    }

    return false;
  }

  /*
   * What an investigation shows before anybody picks anything: the page's
   * preferred pick when it can be shown, else the first preset the page
   * offers, else the past hour.
   */
  public static getDefaultSelection(input: {
    presets: Array<MetricInvestigationTimePreset>;
    preferred?: MetricInvestigationTimeSelection | null | undefined;
  }): MetricInvestigationTimeSelection {
    if (
      input.preferred &&
      MetricInvestigationTime.isUsableSelection(input.preferred, input.presets)
    ) {
      return input.preferred;
    }

    const firstUsablePreset: MetricInvestigationTimePreset | undefined =
      input.presets.find((preset: MetricInvestigationTimePreset): boolean => {
        return MetricInvestigationTime.isUsableWindow(preset.window);
      });

    if (firstUsablePreset) {
      return {
        kind: MetricInvestigationTimeKind.Preset,
        presetId: firstUsablePreset.id,
      };
    }

    return {
      kind: MetricInvestigationTimeKind.Relative,
      range: DEFAULT_RELATIVE_RANGE,
    };
  }

  /*
   * The window a pick shows: a preset's as the page worked it out, a
   * relative range's ending at `now`, a custom pick's own. Null when the
   * pick cannot be shown (a preset the page no longer offers).
   */
  public static resolveWindow(input: {
    selection: MetricInvestigationTimeSelection;
    presets: Array<MetricInvestigationTimePreset>;
    now: Date;
  }): InBetween<Date> | null {
    const selection: MetricInvestigationTimeSelection = input.selection;

    if (selection.kind === MetricInvestigationTimeKind.Preset) {
      const preset: MetricInvestigationTimePreset | null =
        MetricInvestigationTime.findPreset(input.presets, selection.presetId);

      return preset
        ? MetricInvestigationTime.toUsableWindow(preset.window)
        : null;
    }

    if (selection.kind === MetricInvestigationTimeKind.Relative) {
      return MetricInvestigationTime.resolveRelativeWindow(
        selection.range,
        input.now,
      );
    }

    return MetricInvestigationTime.toUsableWindow(selection.window);
  }

  public static isSameSelection(
    first: MetricInvestigationTimeSelection | null | undefined,
    second: MetricInvestigationTimeSelection | null | undefined,
  ): boolean {
    if (!first || !second) {
      return !first && !second;
    }

    if (
      first.kind === MetricInvestigationTimeKind.Preset &&
      second.kind === MetricInvestigationTimeKind.Preset
    ) {
      return first.presetId === second.presetId;
    }

    if (
      first.kind === MetricInvestigationTimeKind.Relative &&
      second.kind === MetricInvestigationTimeKind.Relative
    ) {
      return first.range === second.range;
    }

    if (
      first.kind === MetricInvestigationTimeKind.Custom &&
      second.kind === MetricInvestigationTimeKind.Custom
    ) {
      return MetricInvestigationTime.isSameWindow(first.window, second.window);
    }

    return false;
  }

  /*
   * The pick as the time picker's value: a relative range keeps its preset,
   * so the picker highlights it; a preset and a custom window are both a
   * custom window to the picker, which names a preset itself (see
   * MetricInvestigationTimePicker).
   */
  public static toPickerValue(
    selection: MetricInvestigationTimeSelection,
    window: InBetween<Date>,
  ): RangeStartAndEndDateTime {
    if (selection.kind === MetricInvestigationTimeKind.Relative) {
      return { range: selection.range, startAndEndDate: window };
    }

    return { range: TimeRange.CUSTOM, startAndEndDate: window };
  }

  /*
   * What a pick in the time picker's own list means: a relative range, or a
   * custom window from its Custom Range editor. Null for a custom pick with
   * no usable window.
   */
  public static fromPickerValue(
    value: RangeStartAndEndDateTime | null | undefined,
  ): MetricInvestigationTimeSelection | null {
    if (!value) {
      return null;
    }

    if (MetricInvestigationTime.isRelativeRange(value.range)) {
      return {
        kind: MetricInvestigationTimeKind.Relative,
        range: value.range,
      };
    }

    if (value.range !== TimeRange.CUSTOM) {
      return null;
    }

    const window: InBetween<Date> | null =
      MetricInvestigationTime.toUsableWindow(value.startAndEndDate);

    return window
      ? { kind: MetricInvestigationTimeKind.Custom, window: window }
      : null;
  }

  /*
   * The custom pick a drag across a chart zooms to: the window dragged out,
   * either way round, never past the end of the window on screen (the last
   * bucket is usually still filling up; see TimeRangeZoomUtil). Null for a
   * drag that is not a window, such as one that never left its bucket.
   */
  public static getZoomSelection(input: {
    startTime: Date;
    endTime: Date;
    currentWindow: InBetween<Date>;
  }): MetricInvestigationCustomTime | null {
    const zoomed: RangeStartAndEndDateTime | null =
      TimeRangeZoomUtil.getZoomedRange({
        startTime: input.startTime,
        endTime: input.endTime,
        currentRange: {
          range: TimeRange.CUSTOM,
          startAndEndDate: input.currentWindow,
        },
      });

    const window: InBetween<Date> | null =
      MetricInvestigationTime.toUsableWindow(zoomed?.startAndEndDate);

    return window
      ? { kind: MetricInvestigationTimeKind.Custom, window: window }
      : null;
  }

  // How a pick is kept in the URL.
  public static toUrlValue(
    selection: MetricInvestigationTimeSelection,
  ): MetricInvestigationTimeUrlValue {
    if (selection.kind === MetricInvestigationTimeKind.Preset) {
      return { time: selection.presetId };
    }

    if (selection.kind === MetricInvestigationTimeKind.Relative) {
      return { time: selection.range };
    }

    return {
      time: CUSTOM_TIME_URL_VALUE,
      start: OneUptimeDate.toString(
        new Date(toEpochMs(selection.window.startValue)),
      ),
      end: OneUptimeDate.toString(
        new Date(toEpochMs(selection.window.endValue)),
      ),
    };
  }

  /*
   * The pick a URL keeps, or null when it keeps none this page can show: a
   * preset the page does not offer (a link from another incident's page), a
   * custom window with a bound missing, unreadable or after the other, or
   * anything else. A preset is matched before a relative range, so a page
   * may name a preset after one.
   */
  public static fromUrlValue(input: {
    time: string | null | undefined;
    start?: string | null | undefined;
    end?: string | null | undefined;
    presets: Array<MetricInvestigationTimePreset>;
  }): MetricInvestigationTimeSelection | null {
    const time: string = (input.time || "").trim();

    if (!time) {
      return null;
    }

    if (time === CUSTOM_TIME_URL_VALUE) {
      const startMs: number = toEpochMs(input.start);
      const endMs: number = toEpochMs(input.end);

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return null;
      }

      const window: InBetween<Date> = new InBetween<Date>(
        new Date(startMs),
        new Date(endMs),
      );

      return MetricInvestigationTime.isUsableWindow(window)
        ? { kind: MetricInvestigationTimeKind.Custom, window: window }
        : null;
    }

    const preset: MetricInvestigationTimePreset | null =
      MetricInvestigationTime.findPreset(input.presets, time);

    if (preset) {
      return MetricInvestigationTime.isUsableWindow(preset.window)
        ? { kind: MetricInvestigationTimeKind.Preset, presetId: preset.id }
        : null;
    }

    if (MetricInvestigationTime.isRelativeRange(time)) {
      return { kind: MetricInvestigationTimeKind.Relative, range: time };
    }

    return null;
  }
}
