import {
  getLocaleClockHourOption,
  getNumberLocale,
} from "../../../Types/DateLanguage";
import { Blue500 } from "../../../Types/BrandColors";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import {
  getReadingDirection,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "../../../Types/ReadingDirection";
import { getLineDirection } from "../../Utils/LineDirection";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { StyledDayEvent, layoutDayEvents } from "./CalendarDayLayout";
import {
  CalendarEventAppearance,
  getOverlayEventStyle,
  getSoftEventStyle,
  OVERLAY_EVENT_CLASS_NAME,
  SOFT_EVENT_CLASS_NAME,
} from "./CalendarEventTone";
import {
  CalendarToolbarStatusContext,
  ConnectedCalendarToolbar,
} from "./CalendarToolbar";
import moment from "moment-timezone";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  Calendar,
  Components,
  Culture,
  DateHeaderProps,
  DateLocalizer,
  DateRange,
  DayLayoutFunction,
  EventProps,
  EventPropGetter,
  EventWrapperProps,
  Formats,
  HeaderProps,
  Messages,
  momentLocalizer,
  View,
} from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./Calendar.css";

// Exported so tests lay days out with exactly the localizer the calendar uses.
export const calendarLocalizer: DateLocalizer = momentLocalizer(moment);

/*
 * react-big-calendar treats any block whose start and end are both exactly
 * midnight as an all-day event and moves it out of the grid into the strip
 * above it. A rotation that hands off at midnight produces exactly that
 * shape, so every shift of a daily midnight rotation left the grid and became
 * a bar in the header. Only CalendarEvent.allDay decides what is all-day.
 */
calendarLocalizer.startAndEndAreDateOnly = (): boolean => {
  return false;
};

/*
 * How long a day column is, in minutes. The moment localizer counts real
 * minutes, so a daylight-saving day gets 23 or 25 hour rows, but it places
 * blocks by wall-clock minute and draws the time gutter from a 24-hour day.
 * Counting wall-clock minutes (the base localizer's own formula) gives every
 * column 24 rows. The change day then lines up with the gutter and the other
 * days, and its last hour exists: on the spring-forward day, a hand-off after
 * 11 PM used to fall off the end of a 23-row column.
 */
calendarLocalizer.getTotalMin = (start: Date, end: Date): number => {
  return (
    calendarLocalizer.diff(start, end, "minutes") +
    calendarLocalizer.getDstOffset(start, end)
  );
};

/*
 * What react-big-calendar hands its localizer's sortEvents: an event's start,
 * end and all-day flag, read with the calendar's accessors. The typings name
 * the function differently from the library it types, and leave out daySpan.
 */
export interface CalendarSortableEvent {
  start: Date;
  end: Date;
  allDay?: boolean | undefined;
}

export type CalendarEventSort = (pair: {
  evtA: CalendarSortableEvent;
  evtB: CalendarSortableEvent;
}) => number;

export type CalendarDaySpan = (start: Date, end: Date) => number;

/*
 * The localizer for one set of events: the page's own events are laid out
 * first, and the overlays - events from another calendar
 * (CalendarEventAppearance.Overlay) - in the rows they leave.
 *
 * A month's cell shows its first few rows of blocks and "+N more" for the
 * rest, and react-big-calendar fills the rows in its own order: blocks of
 * more than a day first, then a day's blocks by length and start time. A
 * busy calendar from outside the project (a team's shifts, a holiday
 * calendar, a change freeze across the week) took a cell's rows and folded
 * the page's own maintenance into "+N more". So an overlay sorts after every
 * event of the page's own, and is never one of the blocks of more than a day
 * laid out first (daySpan, which the library reads for nothing else); among
 * the page's own events, and among the overlays, the library's order stands.
 *
 * Both are handed only an event's dates; the start is the event's own Date
 * (the default accessor), so an overlay is known by its start. Without
 * overlays it is the calendar's one localizer.
 */
export const getCalendarLocalizer: (
  events: Array<CalendarEvent>,
) => DateLocalizer = (events: Array<CalendarEvent>): DateLocalizer => {
  const overlayStarts: WeakSet<Date> = new WeakSet<Date>();
  let hasOverlays: boolean = false;

  for (const event of events) {
    if (
      event.appearance === CalendarEventAppearance.Overlay &&
      event.start instanceof Date
    ) {
      overlayStarts.add(event.start);
      hasOverlays = true;
    }
  }

  if (!hasOverlays) {
    return calendarLocalizer;
  }

  const librarySort: CalendarEventSort =
    calendarLocalizer.sortEvents as unknown as CalendarEventSort;

  const libraryDaySpan: CalendarDaySpan = (
    calendarLocalizer as unknown as { daySpan: CalendarDaySpan }
  ).daySpan;

  const sortEvents: CalendarEventSort = (pair: {
    evtA: CalendarSortableEvent;
    evtB: CalendarSortableEvent;
  }): number => {
    const overlayA: number = overlayStarts.has(pair.evtA.start) ? 1 : 0;
    const overlayB: number = overlayStarts.has(pair.evtB.start) ? 1 : 0;

    return overlayA - overlayB || librarySort(pair);
  };

  const daySpan: CalendarDaySpan = (start: Date, end: Date): number => {
    const span: number = libraryDaySpan(start, end);

    return overlayStarts.has(start) ? Math.min(span, 1) : span;
  };

  /*
   * A copy with every one of the calendar's own settings: react-big-calendar
   * spreads the localizer's own properties into the one it works with.
   */
  const localizer: DateLocalizer = Object.assign(
    Object.create(Object.getPrototypeOf(calendarLocalizer)) as DateLocalizer,
    calendarLocalizer,
  );

  localizer.sortEvents = sortEvents as unknown as DateLocalizer["sortEvents"];
  (localizer as unknown as { daySpan: CalendarDaySpan }).daySpan = daySpan;

  return localizer;
};

/*
 * The label for a block that starts in this column and runs past it.
 * react-big-calendar writes "7:26 PM –", implying it continues into the next
 * day. A block that ends at the midnight closing this column does not: the
 * next day has nothing of it to show (see CalendarDayLayout), so it gets its
 * end time here instead, "7:26 PM – 12:00 AM".
 */
const formatTimeRangeStart: (
  range: DateRange,
  formatTime: (date: Date) => string,
) => string = (
  range: DateRange,
  formatTime: (date: Date) => string,
): string => {
  const followingMidnight: moment.Moment = moment(range.start)
    .startOf("day")
    .add(1, "day");

  // Whole minutes, as on the grid: a hand-off a few seconds after midnight is still one at midnight.
  if (moment(range.end).isSame(followingMidnight, "minute")) {
    return `${formatTime(range.start)} – ${formatTime(range.end)}`;
  }

  return `${formatTime(range.start)} – `;
};

export const formatEventTimeRangeStart: (
  range: DateRange,
  culture?: Culture,
  local?: DateLocalizer,
) => string = (
  range: DateRange,
  culture?: Culture,
  local?: DateLocalizer,
): string => {
  return formatTimeRangeStart(range, (date: Date): string => {
    return local
      ? local.format(date, "LT", culture)
      : moment(date).format("LT");
  });
};

/*
 * A day's number as a calendar writes it, in every language: "1", "۱" -
 * never react-big-calendar's own "01", whose leading zero no wall or phone
 * calendar writes ("۰۱" on a Persian page). In the month's grid, and beside
 * the day's name above a week's columns.
 */
const CALENDAR_FORMATS: Formats = {
  dateFormat: "D",
  dayFormat: "D ddd",
  eventTimeRangeStartFormat: formatEventTimeRangeStart,
};

const ENGLISH_LANGUAGE: string = "en";

/*
 * The dates and times the views write - the month's and the week's titles,
 * the day names, the day numbers in the grid, the hours down the side, an
 * event's times - in the reader's language. English keeps react-big-
 * calendar's own wording (the moment localizer's). Another language gets
 * the browser's (Intl), always on the Gregorian calendar the grid is laid
 * out in (Persian would otherwise name the month of its own calendar above
 * a Gregorian grid), and in the language's own figures, as every other date
 * on the page is (Common/Types/DateLanguage): "اکتبر ۲۰۲۶" over "۱", "۲".
 */
export const getCalendarFormats: (language: string | undefined) => Formats = (
  language: string | undefined,
): Formats => {
  const code: string = (language || ENGLISH_LANGUAGE).trim();

  if (
    !code ||
    code === ENGLISH_LANGUAGE ||
    code.startsWith(`${ENGLISH_LANGUAGE}-`)
  ) {
    return CALENDAR_FORMATS;
  }

  const formatter: (
    options: Intl.DateTimeFormatOptions,
  ) => (date: Date) => string = (
    options: Intl.DateTimeFormatOptions,
  ): ((date: Date) => string) => {
    let format: Intl.DateTimeFormat;

    try {
      format = new Intl.DateTimeFormat(getNumberLocale(code), {
        calendar: "gregory",
        ...options,
      } as Intl.DateTimeFormatOptions);
    } catch {
      // A language Intl does not know: English, as the grid would be.
      format = new Intl.DateTimeFormat(ENGLISH_LANGUAGE, options);
    }

    return (date: Date): string => {
      return format.format(date);
    };
  };

  const between: (
    first: (date: Date) => string,
  ) => (range: DateRange) => string = (
    first: (date: Date) => string,
  ): ((range: DateRange) => string) => {
    return (range: DateRange): string => {
      return `${first(range.start)} – ${first(range.end)}`;
    };
  };

  /*
   * The hours on the language's own clock: a German or Japanese grid says
   * 00:00 and 08:00, a Korean or Arabic one 오전 8:00 and 8:00 ص - a
   * 12-hour time has no leading zero (issue #7279).
   */
  const time: (date: Date) => string = formatter({
    hour: getLocaleClockHourOption(getNumberLocale(code) || code),
    minute: "2-digit",
  });

  return {
    // The day numbers in the month's grid, as English's: "1", "۱".
    dateFormat: formatter({ day: "numeric" }),
    weekdayFormat: formatter({ weekday: "short" }),
    dayFormat: formatter({ weekday: "short", day: "numeric" }),
    dayHeaderFormat: formatter({
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    monthHeaderFormat: formatter({ month: "long", year: "numeric" }),
    dayRangeHeaderFormat: between(formatter({ month: "long", day: "numeric" })),
    agendaHeaderFormat: between(
      formatter({ year: "numeric", month: "numeric", day: "numeric" }),
    ),
    agendaDateFormat: formatter({
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    agendaTimeFormat: time,
    agendaTimeRangeFormat: between(time),
    timeGutterFormat: time,
    eventTimeRangeFormat: between(time),
    eventTimeRangeStartFormat: (range: DateRange): string => {
      return formatTimeRangeStart(range, time);
    },
    eventTimeRangeEndFormat: (range: DateRange): string => {
      return ` – ${time(range.end)}`;
    },
  };
};

/*
 * A DAY'S NAME IN A NARROW COLUMN.
 *
 * A calendar names the days above its columns in their short form: "Mon",
 * "Mo", "月". Persian has no short form - Intl's short names are its full
 * ones ("چهارشنبه") - so a narrow month (a phone's, a calendar beside the
 * side menu) cut them to "چها…", where Persian's one-letter names ("چ"),
 * as its printed calendars write them, fit. In a language whose short
 * names are its full names, each name above a column carries both: the
 * full name, and the one-letter name a column too narrow for the full one
 * shows instead (Calendar.css, a container query on the column). A screen
 * reader reads the full name either way. Every other language names its
 * days as before.
 */
const shortWeekdayNamesCache: Map<string, boolean> = new Map<string, boolean>();

// Sunday 4 January 1970, then the six days after it: a week of names.
const A_WEEK: Array<Date> = [0, 1, 2, 3, 4, 5, 6].map((day: number): Date => {
  return new Date(Date.UTC(1970, 0, 4 + day));
});

// Whether `language` writes a day of the week shorter than its full name.
export const hasShortWeekdayNames: (language: string | undefined) => boolean = (
  language: string | undefined,
): boolean => {
  const code: string = (language || ENGLISH_LANGUAGE).trim();

  // English names its days with moment's "Mon".
  if (
    !code ||
    code === ENGLISH_LANGUAGE ||
    code.startsWith(`${ENGLISH_LANGUAGE}-`)
  ) {
    return true;
  }

  const cached: boolean | undefined = shortWeekdayNamesCache.get(code);

  if (cached !== undefined) {
    return cached;
  }

  let hasShortNames: boolean = true;

  try {
    const short: Intl.DateTimeFormat = new Intl.DateTimeFormat(
      getNumberLocale(code),
      {
        calendar: "gregory",
        weekday: "short",
        timeZone: "UTC",
      } as Intl.DateTimeFormatOptions,
    );
    const long: Intl.DateTimeFormat = new Intl.DateTimeFormat(
      getNumberLocale(code),
      {
        calendar: "gregory",
        weekday: "long",
        timeZone: "UTC",
      } as Intl.DateTimeFormatOptions,
    );

    hasShortNames = A_WEEK.some((day: Date): boolean => {
      return short.format(day) !== long.format(day);
    });
  } catch {
    // A language Intl does not know: English's names, as the grid's are.
    hasShortNames = true;
  }

  shortWeekdayNamesCache.set(code, hasShortNames);

  return hasShortNames;
};

export interface NarrowDayNameFormats {
  // A month's column: "ش".
  weekday: (date: Date) => string;
  // A week's column, with its day of the month: "د ۲۶".
  weekdayAndDay: (date: Date) => string;
}

// The one-letter names a narrow column shows, in `language`.
export const getNarrowDayNameFormats: (
  language: string | undefined,
) => NarrowDayNameFormats = (
  language: string | undefined,
): NarrowDayNameFormats => {
  const formatter: (
    options: Intl.DateTimeFormatOptions,
  ) => (date: Date) => string = (
    options: Intl.DateTimeFormatOptions,
  ): ((date: Date) => string) => {
    let format: Intl.DateTimeFormat;

    try {
      format = new Intl.DateTimeFormat(
        getNumberLocale(language || ENGLISH_LANGUAGE),
        {
          calendar: "gregory",
          ...options,
        } as Intl.DateTimeFormatOptions,
      );
    } catch {
      format = new Intl.DateTimeFormat(ENGLISH_LANGUAGE, options);
    }

    return (date: Date): string => {
      return format.format(date);
    };
  };

  return {
    weekday: formatter({ weekday: "narrow" }),
    weekdayAndDay: formatter({ weekday: "narrow", day: "numeric" }),
  };
};

/*
 * The class on a calendar whose language has no short names for its days:
 * its columns measure themselves, so a narrow one shows a day's one-letter
 * name (Calendar.css).
 */
export const LONG_DAY_NAMES_CLASS_NAME: string =
  "oneuptime-calendar--long-day-names";

export interface CalendarDayNameProps {
  // The day's name as the calendar writes it: "چهارشنبه", "چهارشنبه ۲۸".
  label: string;
  // Its name in a column too narrow for it: "چ", "چ ۲۸".
  narrowLabel: string;
}

/*
 * The name above a day's column, in a language whose short names are its
 * full names: the full name, and the one-letter name a narrow column shows
 * in its place (Calendar.css). Read out whole.
 */
export const CalendarDayName: FunctionComponent<CalendarDayNameProps> = (
  props: CalendarDayNameProps,
): ReactElement => {
  return (
    <span
      role="columnheader"
      aria-sort="none"
      className="oneuptime-calendar-day-name"
    >
      <span className="oneuptime-calendar-day-name__full" aria-hidden="true">
        {props.label}
      </span>
      <span className="oneuptime-calendar-day-name__narrow" aria-hidden="true">
        {props.narrowLabel}
      </span>
      <span className="sr-only">{props.label}</span>
    </span>
  );
};

const dayLayoutAlgorithm: DayLayoutFunction<CalendarEvent> = (
  args: Parameters<DayLayoutFunction<CalendarEvent>>[0],
): Array<{ event: CalendarEvent; style: React.CSSProperties }> => {
  return layoutDayEvents<CalendarEvent>({
    events: args.events,
    slotMetrics: args.slotMetrics,
    accessors: args.accessors,
  }).map((styled: StyledDayEvent<CalendarEvent>) => {
    return { event: styled.event, style: styled.style };
  });
};

export interface ComponentProps {
  id?: string | undefined;
  events: Array<CalendarEvent>;
  /*
   * Events painted BEHIND the grid rather than as blocks in it. Used to shade
   * regions that are meaningful by their absence — an on-call schedule's
   * uncovered hours, for example, which would otherwise be indistinguishable
   * from a grid that simply failed to load.
   */
  backgroundEvents?: Array<CalendarEvent> | undefined;
  defaultCalendarView?: DefaultCalendarView;
  /*
   * Which date the calendar initially opens on. Defaults to "now". Callers that
   * render events shifted into a display timezone pass the same-shifted "now" so
   * the grid opens on that zone's current day rather than the browser's.
   */
  defaultDate?: Date | undefined;
  /*
   * "Now" as the grid should see it: it places the current-time line and picks
   * the highlighted day. Defaults to the browser clock. Callers that shift
   * events into a display timezone must shift this the same way, or the line
   * is drawn at the browser's time on a grid showing another zone. It is called
   * again each time the line moves, so it must read the clock, not return a
   * fixed date.
   */
  getNow?: (() => Date) | undefined;
  onRangeChange: (startAndEndTime: StartAndEndTime) => void;
  /*
   * The views the toolbar offers, in its order. Defaults to month, week, day
   * and agenda.
   */
  views?: Array<DefaultCalendarView> | undefined;
  // A click on an event's block.
  onEventClick?: ((event: CalendarEvent) => void) | undefined;
  /*
   * What an event's block shows instead of its title: an element a keyboard
   * reaches, such as a link to the event. react-big-calendar draws the block
   * itself as a div no keyboard can focus.
   */
  renderEventContent?: ((event: CalendarEvent) => ReactElement) | undefined;
  /*
   * Something beside a day's number in the month view - a button that
   * schedules something on that day. Null for a day without one.
   */
  renderDayAction?: ((date: Date) => ReactElement | null) | undefined;
  /*
   * How the blocks are painted (CalendarEventTone): solid in their colour,
   * as people are on the on-call schedules (the default), or soft - a pale
   * wash with a stripe of the colour - for colours that are states.
   */
  eventAppearance?: CalendarEventAppearance | undefined;
  /*
   * Drawn in the toolbar after the period's name: what the calendar is
   * doing, such as "Loading events..." while a period is read.
   */
  toolbarStatus?: ReactElement | undefined;
}

export enum DefaultCalendarView {
  Month = "month",
  Week = "week",
  Day = "day",
  Agenda = "agenda",
}

const CALENDAR_VIEWS: View[] = ["month", "week", "day", "agenda"];

/*
 * The toolbar's words and the "+2 more" of a full month cell, in the
 * reader's language. react-big-calendar writes them in English otherwise.
 */
export const getCalendarMessages: (
  translator: Translator,
) => Messages<CalendarEvent> = (
  translator: Translator,
): Messages<CalendarEvent> => {
  return {
    today: translator.translateText("Today"),
    previous: translator.translateText("Back"),
    next: translator.translateText("Next"),
    month: translator.translateText("Month"),
    week: translator.translateText("Week"),
    day: translator.translateText("Day"),
    agenda: translator.translateText("Agenda"),
    date: translator.translateText("Date"),
    time: translator.translateText("Time"),
    event: translator.translateText("Event"),
    allDay: translator.translateText("All day"),
    noEventsInRange: translator.translateText(
      "There are no events in this range.",
    ),
    showMore: (count: number): string => {
      return translator.translatePlural(
        { one: "+{{count}} more", other: "+{{count}} more" },
        count,
      );
    },
  };
};

/*
 * The class a block carries when its title reads the other way from the
 * page (LineDirection): an English maintenance title, a person's name in
 * Latin letters, on a Persian page. Calendar.css turns the block's words
 * that way, so a title cut short in a narrow day loses its end ("Database
 * upg..."), not its start ("...rade"), and a short one still starts where
 * the page's lines do. A title that reads as the page does carries none.
 */
export const EVENT_TITLE_DIRECTION_CLASS_NAMES: Record<
  ReadingDirection,
  string
> = {
  ltr: "oneuptime-calendar-event--reads-ltr",
  rtl: "oneuptime-calendar-event--reads-rtl",
};

export const getEventTitleClassName: (
  title: string | undefined,
  pageLanguage: string | undefined,
) => string | undefined = (
  title: string | undefined,
  pageLanguage: string | undefined,
): string | undefined => {
  const direction: ReadingDirection | undefined = getLineDirection(
    title,
    pageLanguage,
  );

  return direction ? EVENT_TITLE_DIRECTION_CLASS_NAMES[direction] : undefined;
};

/*
 * The box react-big-calendar draws each block in. An overlay's block - an
 * event from another calendar - opens nothing, so a keyboard does not stop
 * on it: the week's and the day's blocks are buttons a keyboard reaches
 * (TimeGridEvent), and an overlay's showed no focus ring for a stop that did
 * nothing. A screen reader still reads it where it is. Every other block is
 * left as the library draws it.
 */
export type CalendarEventWrapperProps = EventWrapperProps<CalendarEvent> & {
  children?: React.ReactNode;
};

// What the wrapper changes on the block it is handed.
interface CalendarEventBlockProps {
  tabIndex?: number | undefined;
  role?: string | undefined;
}

export const CalendarEventWrapper: FunctionComponent<
  CalendarEventWrapperProps
> = (props: CalendarEventWrapperProps): ReactElement => {
  const child: React.ReactNode = props.children;

  if (
    props.event?.appearance === CalendarEventAppearance.Overlay &&
    React.isValidElement(child)
  ) {
    const block: ReactElement<CalendarEventBlockProps> =
      child as ReactElement<CalendarEventBlockProps>;

    return React.cloneElement(block, {
      ...(block.props.tabIndex !== undefined ? { tabIndex: -1 } : {}),
      ...(block.props.role === "button" ? { role: undefined } : {}),
    });
  }

  return <>{child}</>;
};

const CalendarElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // The page's own events before the overlays of their day (getCalendarLocalizer).
  const localizer: DateLocalizer = useMemo(() => {
    return getCalendarLocalizer(props.events);
  }, [props.events]);

  const messages: Messages<CalendarEvent> = useMemo(() => {
    return getCalendarMessages(translator);
  }, [translator]);

  const formats: Formats = useMemo(() => {
    return getCalendarFormats(translator.language);
  }, [translator.language]);

  // Persian: no short names for its days (CalendarDayName).
  const hasShortDayNames: boolean = useMemo(() => {
    return hasShortWeekdayNames(translator.language);
  }, [translator.language]);

  /*
   * A page read right to left lays a day's blocks out from its right edge:
   * where two blocks overlap, the first sits on the day's start side, as
   * it does on the left of a page read left to right. react-big-calendar
   * places each block by its own left edge unless it is told the page reads
   * the other way (rtl), so the first block sat on the far side of a
   * Persian day and the next one on its start side.
   */
  const isRightToLeft: boolean =
    getReadingDirection(translator.language) === RIGHT_TO_LEFT;

  /*
   * The pieces a caller replaces: an event's content, and the header of a
   * month view's day. Rebuilt only when the caller's renderers change, so
   * react-big-calendar does not remount every cell on each render.
   */
  const components: Components<CalendarEvent> = useMemo(() => {
    /*
     * The toolbar is always the product's own (CalendarToolbar). It is one
     * component for the calendar's life, and reads what to say beside the
     * period from a context: a new component whenever that changed would
     * remount the toolbar, and take the focus off the arrow a keyboard just
     * pressed.
     */
    const replaced: Components<CalendarEvent> = {
      toolbar: ConnectedCalendarToolbar,
      eventWrapper: CalendarEventWrapper,
    };

    const renderEventContent:
      | ((event: CalendarEvent) => ReactElement)
      | undefined = props.renderEventContent;

    if (renderEventContent) {
      replaced.event = (eventProps: EventProps<CalendarEvent>) => {
        return renderEventContent(eventProps.event);
      };
    }

    const renderDayAction: ((date: Date) => ReactElement | null) | undefined =
      props.renderDayAction;

    /*
     * A language with no short names for its days names each column with
     * its full name and its one-letter one, which a narrow column shows
     * (CalendarDayName): a month's columns by the day of the week, a week's
     * with its day of the month.
     */
    if (!hasShortDayNames) {
      const narrow: NarrowDayNameFormats = getNarrowDayNameFormats(
        translator.language,
      );

      replaced.month = {
        header: (headerProps: HeaderProps) => {
          return (
            <CalendarDayName
              label={headerProps.label}
              narrowLabel={narrow.weekday(headerProps.date)}
            />
          );
        },
      };
      replaced.week = {
        header: (headerProps: HeaderProps) => {
          return (
            <CalendarDayName
              label={headerProps.label}
              narrowLabel={narrow.weekdayAndDay(headerProps.date)}
            />
          );
        },
      };
    }

    if (renderDayAction) {
      replaced.month = {
        ...(replaced.month || {}),
        dateHeader: (headerProps: DateHeaderProps) => {
          const action: ReactElement | null = headerProps.isOffRange
            ? null
            : renderDayAction(headerProps.date);

          /*
           * The day's number is react-big-calendar's own button (it opens
           * the day), at the cell's right edge as before; the action sits
           * at its left.
           */
          return (
            <div className="oneuptime-calendar-date-header">
              {action}
              {headerProps.drilldownView ? (
                <button
                  type="button"
                  className="rbc-button-link"
                  onClick={headerProps.onDrillDown}
                >
                  {headerProps.label}
                </button>
              ) : (
                <span>{headerProps.label}</span>
              )}
            </div>
          );
        },
      };
    }

    return replaced;
  }, [
    props.renderEventContent,
    props.renderDayAction,
    hasShortDayNames,
    translator.language,
  ]);

  const views: Array<View> = useMemo(() => {
    return props.views && props.views.length > 0
      ? props.views.map((view: DefaultCalendarView): View => {
          return view as View;
        })
      : CALENDAR_VIEWS;
  }, [props.views]);

  const { defaultDate } = useMemo(() => {
    return {
      defaultDate: props.defaultDate || OneUptimeDate.getCurrentDate(),
    };
  }, [props.defaultDate]);

  /*
   * The strip above the week/day grid only ever holds all-day events. With
   * none, it is an empty band that pushes part of the day out of view. Only
   * `allDay` counts, because startAndEndAreDateOnly is disabled above.
   */
  const hasAllDayEvents: boolean = useMemo(() => {
    return props.events.some((event: CalendarEvent) => {
      return Boolean(event.allDay);
    });
  }, [props.events]);

  const backgroundEventSet: Set<CalendarEvent> = useMemo(() => {
    return new Set<CalendarEvent>(props.backgroundEvents || []);
  }, [props.backgroundEvents]);

  const eventStyleGetter: EventPropGetter<any> = (
    event: CalendarEvent,
  ): { className?: string | undefined; style?: React.CSSProperties } => {
    const ownClassName: string | undefined = event.className
      ? event.className.toString()
      : undefined;

    /*
     * react-big-calendar runs background events through this getter too. The
     * block styling below used to paint every uncovered band as a solid
     * Blue500 block, which looks exactly like a shift and is one of the user
     * colours. Background events are drawn by the stylesheet (the hatched
     * .rbc-background-event), taking only a colour the caller asked for.
     */
    if (backgroundEventSet.has(event)) {
      const backgroundStyle: React.CSSProperties = event.color
        ? { backgroundColor: event.color.toString() }
        : {};

      return ownClassName
        ? { style: backgroundStyle, className: ownClassName }
        : { style: backgroundStyle };
    }

    // The block's words read the way its title does (getEventTitleClassName).
    const className: string | undefined =
      [ownClassName, getEventTitleClassName(event.title, translator.language)]
        .filter(Boolean)
        .join(" ") || undefined;

    const backgroundColor: string =
      event.color?.toString() || Blue500.toString();

    // The event's own appearance wins over the calendar's.
    const appearance: CalendarEventAppearance | undefined =
      (event.appearance as CalendarEventAppearance | undefined) ||
      props.eventAppearance;

    if (appearance === CalendarEventAppearance.Overlay) {
      const overlayStyle: React.CSSProperties = {
        ...getOverlayEventStyle(backgroundColor),
        borderRadius: "0.375rem",
        display: "block",
      };

      return {
        style: overlayStyle,
        className: className
          ? `${className} ${OVERLAY_EVENT_CLASS_NAME}`
          : OVERLAY_EVENT_CLASS_NAME,
      };
    }

    if (appearance === CalendarEventAppearance.Soft) {
      const softStyle: React.CSSProperties = {
        // Its stripe on the leading edge of a block on this page.
        ...getSoftEventStyle(
          backgroundColor,
          getReadingDirection(translator.language),
        ),
        borderRadius: "0.375rem",
        border: "0px",
        display: "block",
      };

      return {
        style: softStyle,
        className: className
          ? `${className} ${SOFT_EVENT_CLASS_NAME}`
          : SOFT_EVENT_CLASS_NAME,
      };
    }

    const computedTextColor: string =
      event.textColor?.toString() ||
      (Color.shouldUseDarkText(new Color(backgroundColor))
        ? "#111827"
        : "#ffffff");

    const style: React.CSSProperties = {
      backgroundColor,
      color: computedTextColor,
      borderRadius: "0.375rem",
      border: "0px",
      display: "block",
    };

    /*
     * The accent colour reaches CSS as a custom property rather than as a
     * border here, so the stylesheet decides how to draw it (an inset stripe
     * today) and the two can be changed together in one place.
     */
    if (event.accentColor) {
      (style as Record<string, string>)["--oneuptime-event-accent"] =
        event.accentColor.toString();
    }

    return className ? { style, className } : { style };
  };

  /*
   * react-big-calendar's default tooltip is the title, which is already
   * truncated in the block itself — so hovering a clipped label tells the
   * reader exactly as little as looking at it did. Prefer `desc`, which callers
   * use for the full, multi-line explanation of what the block means.
   */
  const eventTooltipGetter: (event: CalendarEvent) => string = (
    event: CalendarEvent,
  ): string => {
    return event.desc?.toString() || event.title;
  };

  return (
    <div
      id={props.id}
      className={`oneuptime-calendar mt-5 h-[46rem] rounded-xl bg-white${
        hasAllDayEvents ? "" : " oneuptime-calendar--no-all-day"
      }${hasShortDayNames ? "" : ` ${LONG_DAY_NAMES_CLASS_NAME}`}`}
    >
      <CalendarToolbarStatusContext.Provider value={props.toolbarStatus}>
        <Calendar
          defaultDate={defaultDate}
          events={props.events}
          backgroundEvents={props.backgroundEvents || []}
          localizer={localizer}
          formats={formats}
          rtl={isRightToLeft}
          dayLayoutAlgorithm={dayLayoutAlgorithm}
          {...(props.getNow ? { getNow: props.getNow } : {})}
          {...(props.onEventClick
            ? {
                onSelectEvent: (event: CalendarEvent): void => {
                  props.onEventClick?.(event);
                },
              }
            : {})}
          components={components}
          messages={messages}
          showMultiDayTimes
          views={views}
          defaultView={props.defaultCalendarView || "week"}
          eventPropGetter={eventStyleGetter}
          tooltipAccessor={eventTooltipGetter}
          popup
          onRangeChange={(range: Date[] | { start: Date; end: Date }) => {
            if (Array.isArray(range)) {
              return props.onRangeChange({
                startTime: range[0] as Date,
                endTime: OneUptimeDate.getEndOfDay(
                  range[range.length - 1] as Date,
                ),
              });
            }

            props.onRangeChange({
              startTime: range.start,
              endTime: range.end,
            });
          }}
        />
      </CalendarToolbarStatusContext.Provider>
    </div>
  );
};

export default CalendarElement;
