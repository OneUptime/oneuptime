import { Blue500 } from "../../../Types/BrandColors";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
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

const CALENDAR_FORMATS: Formats = {
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
 * on the page is (Common/Types/DateLanguage): "اکتبر ۲۰۲۶" over "۰۱", "۰۲".
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
      format = new Intl.DateTimeFormat(code, {
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

  // Two-digit hours: a German or Japanese grid says 00:00 and 08:00.
  const time: (date: Date) => string = formatter({
    hour: "2-digit",
    minute: "2-digit",
  });

  return {
    // The day numbers in the month's grid: "01", "۰۱".
    dateFormat: formatter({ day: "2-digit" }),
    weekdayFormat: formatter({ weekday: "short" }),
    dayFormat: formatter({ weekday: "short", day: "2-digit" }),
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

    if (renderDayAction) {
      replaced.month = {
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
  }, [props.renderEventContent, props.renderDayAction]);

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
    const className: string | undefined = event.className
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

      return className
        ? { style: backgroundStyle, className }
        : { style: backgroundStyle };
    }

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
        ...getSoftEventStyle(backgroundColor),
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
      }`}
    >
      <CalendarToolbarStatusContext.Provider value={props.toolbarStatus}>
        <Calendar
          defaultDate={defaultDate}
          events={props.events}
          backgroundEvents={props.backgroundEvents || []}
          localizer={localizer}
          formats={formats}
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
