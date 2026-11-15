import FilterOperator from "./Types/FilterOperator";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import OneUptimeDate from "../../../Types/Date";

/*
 * WHAT A DATE FILTER, OR A DATE AND TIME FILTER, ASKS FOR (#7719).
 *
 * A date and time filter shows and takes a minute (#7593), and a date
 * filter a day: each moment it is given is a span of time - the whole
 * minute, 11:15:00.000 to 11:15:59.999, or the whole day in the reader's
 * zone, 00:00 to 23:59:59.999. The operators split the timeline at those
 * spans, so Is, Before and After never overlap and never leave a gap:
 *
 *   Is 11:15                  11:15:00.000 <= t <= 11:15:59.999
 *   Before 11:15              t < 11:15:00.000
 *   After 11:15               t > 11:15:59.999, from 11:16
 *   Between 09:00 and 17:30   09:00:00.000 <= t <= 17:30:59.999
 *
 * and the same with days for a date filter. Is used to ask for the instant
 * 11:15:00.000 and matched nothing a person ever did; Between left out its
 * last minute; After 11:15 held 11:15:30. A row stamped 11:15:42 is now
 * "11:15", as the chip that reads the filter back says (FilterViewer).
 *
 * The server binds every bound as the exact instant sent: the query's
 * operators go over the wire with their raw Dates, in full ISO form, and
 * Postgres (QueryUtil) compares InBetween with >= and <=, GreaterThan with
 * > and LessThan with <; ClickHouse (StatementGenerator) does the same.
 */

export interface DateFilterState {
  operator: FilterOperator;
  start: Date | null;
  end: Date | null;
}

// A moment as a filter holds it: a Date, or the string a URL or a saved view gives back.
export const toFilterDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (!value) {
    return null;
  }

  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    try {
      date = OneUptimeDate.fromString(value);
    } catch {
      date = null;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

/*
 * The first and the last moment of the span a filter's moment stands for:
 * its minute, or its day in the reader's zone - the zone the date field
 * reads a picked day in (Input) and the chip writes it in, so the day asked
 * for is the day shown, whatever zone the browser is in.
 */
export const getDateFilterSpanStart: (
  date: Date,
  isDateTime: boolean,
) => Date = (date: Date, isDateTime: boolean): Date => {
  return isDateTime
    ? OneUptimeDate.getStartOfMinute(date)
    : OneUptimeDate.getStartOfDay(date, OneUptimeDate.getCurrentTimezone());
};

export const getDateFilterSpanEnd: (date: Date, isDateTime: boolean) => Date = (
  date: Date,
  isDateTime: boolean,
): Date => {
  return isDateTime
    ? OneUptimeDate.getEndOfMinute(date)
    : OneUptimeDate.getEndOfDay(date, OneUptimeDate.getCurrentTimezone());
};

// The query value a filter's operator and moments ask for; undefined until it has them.
export const buildDateFilterValue: (
  state: DateFilterState,
  isDateTime: boolean,
) => unknown = (state: DateFilterState, isDateTime: boolean): unknown => {
  switch (state.operator) {
    case FilterOperator.Is: {
      if (!state.start) {
        return undefined;
      }

      return new InBetween<Date>(
        getDateFilterSpanStart(state.start, isDateTime),
        getDateFilterSpanEnd(state.start, isDateTime),
      );
    }
    case FilterOperator.Before:
      return state.start
        ? new LessThan<Date>(getDateFilterSpanStart(state.start, isDateTime))
        : undefined;
    case FilterOperator.After:
      return state.start
        ? new GreaterThan<Date>(getDateFilterSpanEnd(state.start, isDateTime))
        : undefined;
    case FilterOperator.Between: {
      if (!state.start || !state.end) {
        return undefined;
      }

      return new InBetween<Date>(
        getDateFilterSpanStart(state.start, isDateTime),
        getDateFilterSpanEnd(state.end, isDateTime),
      );
    }
    case FilterOperator.IsEmpty:
      return new IsNull();
    case FilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return undefined;
  }
};

/*
 * The operator and moments a query value was built from, to draw the
 * filter's controls again - after a reload, from a saved view or a link.
 * A span of exactly one minute (one day, for a date filter) is Is; an
 * EqualTo, which Is built before #7719 and an old saved view or link can
 * still hold, is Is too.
 */
export const readDateFilterValue: (
  rawValue: unknown,
  isDateTime: boolean,
) => DateFilterState = (
  rawValue: unknown,
  isDateTime: boolean,
): DateFilterState => {
  if (rawValue instanceof InBetween) {
    const start: Date | null = toFilterDate(rawValue.startValue as unknown);
    const end: Date | null = toFilterDate(rawValue.endValue as unknown);

    if (
      start &&
      end &&
      start.getTime() === getDateFilterSpanStart(start, isDateTime).getTime() &&
      end.getTime() === getDateFilterSpanEnd(start, isDateTime).getTime()
    ) {
      return { operator: FilterOperator.Is, start, end: null };
    }

    return { operator: FilterOperator.Between, start, end };
  }

  if (rawValue instanceof GreaterThan) {
    return {
      operator: FilterOperator.After,
      start: toFilterDate(rawValue.value as unknown),
      end: null,
    };
  }

  if (rawValue instanceof LessThan) {
    return {
      operator: FilterOperator.Before,
      start: toFilterDate(rawValue.value as unknown),
      end: null,
    };
  }

  if (rawValue instanceof EqualTo) {
    return {
      operator: FilterOperator.Is,
      start: toFilterDate(rawValue.value as unknown),
      end: null,
    };
  }

  if (rawValue instanceof IsNull) {
    return { operator: FilterOperator.IsEmpty, start: null, end: null };
  }

  if (rawValue instanceof NotNull) {
    return { operator: FilterOperator.IsNotEmpty, start: null, end: null };
  }

  return { operator: FilterOperator.Is, start: null, end: null };
};

type BoundsFunction = (value: unknown) => Array<number> | null;

// A value's bounds as instants, to tell whether two values ask for the same.
const getBounds: BoundsFunction = (value: unknown): Array<number> | null => {
  const times: (values: Array<unknown>) => Array<number> | null = (
    values: Array<unknown>,
  ): Array<number> | null => {
    const dates: Array<Date | null> = values.map(toFilterDate);

    if (
      dates.some((date: Date | null): boolean => {
        return !date;
      })
    ) {
      return null;
    }

    return dates.map((date: Date | null): number => {
      return date!.getTime();
    });
  };

  if (value instanceof InBetween) {
    return times([value.startValue, value.endValue]);
  }

  if (value instanceof GreaterThan || value instanceof LessThan) {
    return times([value.value]);
  }

  return null;
};

/*
 * A date filter's value as the query sends it: the span its moments stand
 * for, whatever made the value - the filter's own controls, a link, a saved
 * view from before #7719 (whose Is was an EqualTo on the instant, and whose
 * Between ended on its last minute's first second). So the rows the list
 * asks for are the rows its chip names. A value already asking for its span
 * is handed back as it is; one with no moment to read, and a value that is
 * not a date filter's, too.
 */
export const toDateFilterQueryValue: (
  value: unknown,
  isDateTime: boolean,
) => unknown = (value: unknown, isDateTime: boolean): unknown => {
  if (
    !(value instanceof InBetween) &&
    !(value instanceof GreaterThan) &&
    !(value instanceof LessThan) &&
    !(value instanceof EqualTo)
  ) {
    return value;
  }

  const built: unknown = buildDateFilterValue(
    readDateFilterValue(value, isDateTime),
    isDateTime,
  );

  if (built === undefined || built === null) {
    return value;
  }

  const builtBounds: Array<number> | null = getBounds(built);
  const valueBounds: Array<number> | null = getBounds(value);

  if (
    builtBounds &&
    valueBounds &&
    Object.getPrototypeOf(built) === Object.getPrototypeOf(value) &&
    builtBounds.join(",") === valueBounds.join(",")
  ) {
    return value;
  }

  return built;
};
