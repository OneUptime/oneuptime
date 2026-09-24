import { Blue500 } from "../../../Types/BrandColors";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import { StyledDayEvent, layoutDayEvents } from "./CalendarDayLayout";
import moment from "moment-timezone";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  Calendar,
  Culture,
  DateLocalizer,
  DateRange,
  DayLayoutFunction,
  EventPropGetter,
  Formats,
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
 * The label for a block that starts in this column and runs past it.
 * react-big-calendar writes "7:26 PM –", implying it continues into the next
 * day. A block that ends at the midnight closing this column does not: the
 * next day has nothing of it to show (see CalendarDayLayout), so it gets its
 * end time here instead, "7:26 PM – 12:00 AM".
 */
export const formatEventTimeRangeStart: (
  range: DateRange,
  culture?: Culture,
  local?: DateLocalizer,
) => string = (
  range: DateRange,
  culture?: Culture,
  local?: DateLocalizer,
): string => {
  const formatTime: (date: Date) => string = (date: Date): string => {
    return local
      ? local.format(date, "LT", culture)
      : moment(date).format("LT");
  };

  const followingMidnight: moment.Moment = moment(range.start)
    .startOf("day")
    .add(1, "day");

  // Whole minutes, as on the grid: a hand-off a few seconds after midnight is still one at midnight.
  if (moment(range.end).isSame(followingMidnight, "minute")) {
    return `${formatTime(range.start)} – ${formatTime(range.end)}`;
  }

  return `${formatTime(range.start)} – `;
};

const CALENDAR_FORMATS: Formats = {
  eventTimeRangeStartFormat: formatEventTimeRangeStart,
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
}

export enum DefaultCalendarView {
  Month = "month",
  Week = "week",
  Day = "day",
  Agenda = "agenda",
}

const CALENDAR_VIEWS: View[] = ["month", "week", "day", "agenda"];

const CalendarElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
      <Calendar
        defaultDate={defaultDate}
        events={props.events}
        backgroundEvents={props.backgroundEvents || []}
        localizer={calendarLocalizer}
        formats={CALENDAR_FORMATS}
        dayLayoutAlgorithm={dayLayoutAlgorithm}
        {...(props.getNow ? { getNow: props.getNow } : {})}
        showMultiDayTimes
        views={CALENDAR_VIEWS}
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
    </div>
  );
};

export default CalendarElement;
