import { FilterOperator } from "./FilterChipDropdownTypes";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import OneUptimeDate from "Common/Types/Date";

/*
 * What a date-range chip holds, and what the database is asked for it.
 *
 * The facet bar stores every chip's selection as `Array<string>` so the whole
 * bar can go through one URL param and one saved view without a per-chip
 * codec. A date range is two dates, so it is encoded as ONE string — the two
 * instants joined by a slash — rather than two array entries:
 *
 *   is / before / after   →  ["2026-07-16T00:00:00.000Z"]
 *   between               →  ["2026-07-01T00:00:00.000Z/2026-07-05T23:59:59.999Z"]
 *
 * One entry, because the shared selection plumbing treats an array as a *set*:
 * `normalizeFacetValues` drops duplicates, so a two-entry "between the 1st and
 * the 1st" would collapse to a single date and silently stop filtering, and the
 * single-select clamp in `sanitizeFacetSelectionState` would truncate any range
 * to its start. Keeping the pair inside one value sidesteps both, and costs
 * nothing: ISO-8601 instants contain no slash, so the split is unambiguous.
 *
 * Deliberately free of React, like FacetSelectionState next to it, so the
 * mapping from "what the chip says" to "what the database is asked" can be
 * pinned in tests without a renderer.
 */

/** The separator between the two instants of a `between` selection. */
export const FACET_DATE_RANGE_SEPARATOR: string = "/";

export interface FacetDateRange {
  start: Date | null;
  end: Date | null;
}

export type ToFacetDateFunction = (
  value: string | null | undefined,
) => Date | null;

/*
 * A calendar date, optionally followed by a time.
 *
 * Everything this chip stores went through `Date.toISOString()`, and everything
 * the shared date Input hands back went through `OneUptimeDate.toString()`,
 * which is the same call — so anything not starting with YYYY-MM-DD is not
 * something either of them wrote.
 *
 * The check is deliberately made BEFORE parsing rather than by testing the
 * result: `OneUptimeDate.fromString` falls back to the browser's own lenient
 * parser, which reads "0" as the year 2000. A junk value that silently becomes
 * a filter for January 2000 is worse than one that is rejected, because the
 * table then shows nothing and the chip explains it as a date the user never
 * picked.
 */
const CALENDAR_DATE_PREFIX: RegExp = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * A single instant from the stored form, or `null` when it is not one.
 *
 * Everything reaching here is user-editable — a URL a teammate pasted, a view
 * saved by an older build, a date input mid-keystroke — so an unreadable value
 * has to come back as "no date" rather than as something the query builder
 * would happily turn into a filter.
 */
export const toFacetDate: ToFacetDateFunction = (
  value: string | null | undefined,
): Date | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!CALENDAR_DATE_PREFIX.test(trimmed)) {
    return null;
  }

  try {
    const parsed: Date = OneUptimeDate.fromString(trimmed);

    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

export type ParseFacetDateRangeFunction = (
  values: Array<string> | null | undefined,
) => FacetDateRange;

/**
 * Decode a chip's stored selection back into the two instants it stands for.
 *
 * Only the first entry is read: the clamp in `sanitizeFacetSelectionState`
 * already reduces a date facet to one value, and honouring extras here would
 * mean the chip and the query disagreed about which of them counted.
 */
export const parseFacetDateRange: ParseFacetDateRangeFunction = (
  values: Array<string> | null | undefined,
): FacetDateRange => {
  if (!Array.isArray(values) || values.length === 0) {
    return { start: null, end: null };
  }

  const raw: string = typeof values[0] === "string" ? values[0] : "";
  const parts: Array<string> = raw.split(FACET_DATE_RANGE_SEPARATOR);

  return {
    start: toFacetDate(parts[0]),
    end: toFacetDate(parts[1]),
  };
};

export type SerializeFacetDateRangeFunction = (
  range: FacetDateRange,
  operator: FilterOperator,
) => Array<string>;

/**
 * Encode exactly what the popover's inputs currently hold — including a range
 * with only one end filled in.
 *
 * A half-filled range has to survive the round trip, because the user is
 * mid-way through entering it: the chip is a controlled component with no
 * private copy of the dates, so anything this drops is a date that vanishes
 * from under the cursor the moment the first of the two is picked.
 *
 * It is not, however, a filter yet — `isFacetDateRangeActive` says no and
 * `buildFacetDateRangeQuery` returns undefined, so the column stays
 * unconstrained and the chip stays unlit until both ends are in.
 *
 * The operator still decides how much is *kept*: switching from "between" back
 * to "before" drops the end date rather than leaving it behind, where nothing
 * on screen would show it and nothing in the query would use it.
 */
export const serializeFacetDateRange: SerializeFacetDateRangeFunction = (
  range: FacetDateRange,
  operator: FilterOperator,
): Array<string> => {
  if (operator === "is_empty" || operator === "is_not_empty") {
    return [];
  }

  if (operator === "between") {
    if (!range.start && !range.end) {
      return [];
    }

    const start: string = range.start ? range.start.toISOString() : "";
    const end: string = range.end ? range.end.toISOString() : "";

    return [`${start}${FACET_DATE_RANGE_SEPARATOR}${end}`];
  }

  if (!range.start) {
    return [];
  }

  return [range.start.toISOString()];
};

export type IsFacetDateRangeActiveFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
) => boolean;

/**
 * Does this selection narrow the list? Drives the chip's active styling and the
 * bar's "n filters" count, and is read from the same encoding the query is
 * built from — so a chip can never look lit over an unfiltered table.
 */
export const isFacetDateRangeActive: IsFacetDateRangeActiveFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
): boolean => {
  if (operator === "is_empty" || operator === "is_not_empty") {
    return true;
  }

  const range: FacetDateRange = parseFacetDateRange(values);

  if (!range.start) {
    return false;
  }

  return operator !== "between" || Boolean(range.end);
};

/** Stands in for an end of the range the user has not filled in yet. */
export const FACET_DATE_PLACEHOLDER: string = "…";

export type FormatFacetDateRangeFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
) => string;

/**
 * What the chip reads once a date is picked — "Jul 16, 2026", or
 * "Jul 01, 2026 – Jul 05, 2026" for a range.
 *
 * Day precision, matching what the inputs let the user choose. Printing the
 * midnight instant those dates really are would put a time on the chip that the
 * popover has no way to change.
 */
export const formatFacetDateRange: FormatFacetDateRangeFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
): string => {
  const range: FacetDateRange = parseFacetDateRange(values);

  const asDay: (date: Date | null) => string = (date: Date | null): string => {
    return date
      ? OneUptimeDate.getDateAsLocalFormattedString(date, true)
      : FACET_DATE_PLACEHOLDER;
  };

  if (operator === "between") {
    return `${asDay(range.start)} – ${asDay(range.end)}`;
  }

  return asDay(range.start);
};

export interface BuildFacetDateRangeQueryOptions {
  /**
   * Treat the picked values as instants rather than as days. Defaults to
   * false, which is what a `<input type="date">` produces and what every date
   * column filter in the product has always meant by "is".
   */
  isDateTime?: boolean | undefined;
}

export type BuildFacetDateRangeQueryFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
  options?: BuildFacetDateRangeQueryOptions | undefined,
) => unknown;

/**
 * The column constraint behind a date-range selection.
 *
 * Mirrors Common/UI/Components/Filters/DateFilter.tsx operator for operator,
 * because this chip replaced that popup entry on the tables that grew a facet
 * bar: the same picked dates have to keep returning the same rows, or a saved
 * link stops meaning what it meant.
 *
 * That includes the day-granularity reading of "is" (the whole day, not the
 * midnight instant) and the deliberately loose edges of "before" / "after",
 * which compare against the picked instant as-is — so "after the 16th" includes
 * the 16th, exactly as the popup has always behaved.
 *
 * `undefined` means "do not constrain this column": the honest answer to a
 * half-filled range, and to a value this build cannot read at all.
 */
export const buildFacetDateRangeQuery: BuildFacetDateRangeQueryFunction = (
  values: Array<string> | null | undefined,
  operator: FilterOperator,
  options?: BuildFacetDateRangeQueryOptions | undefined,
): unknown => {
  if (operator === "is_empty") {
    return new IsNull();
  }

  if (operator === "is_not_empty") {
    return new NotNull();
  }

  const isDateTime: boolean = Boolean(options?.isDateTime);
  const range: FacetDateRange = parseFacetDateRange(values);

  if (!range.start) {
    return undefined;
  }

  switch (operator) {
    case "is":
      /*
       * A day, not an instant. `EqualTo` on a timestamp column would only ever
       * match a poll that landed on the exact millisecond the user picked, so
       * "last seen on the 16th" would reliably return nothing.
       */
      return isDateTime
        ? new InBetween<Date>(range.start, range.start)
        : new InBetween<Date>(
            OneUptimeDate.getStartOfDay(range.start),
            OneUptimeDate.getEndOfDay(range.start),
          );

    case "before":
      return new LessThan<Date>(range.start);

    case "after":
      return new GreaterThan<Date>(range.start);

    case "between":
      if (!range.end) {
        return undefined;
      }

      return isDateTime
        ? new InBetween<Date>(range.start, range.end)
        : new InBetween<Date>(
            OneUptimeDate.getStartOfDay(range.start),
            OneUptimeDate.getEndOfDay(range.end),
          );

    default:
      /*
       * "is not" and anything a newer build might add. A date column has no
       * single-field expression for "not on this day" that keeps NULLs honest,
       * so the chip does not offer it and this refuses to invent one.
       */
      return undefined;
  }
};
