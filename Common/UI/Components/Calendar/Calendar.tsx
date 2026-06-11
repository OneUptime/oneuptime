import { Blue500 } from "../../../Types/BrandColors";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import moment from "moment-timezone";
import React, { FunctionComponent, ReactElement, useEffect, useMemo } from "react";
import {
  Calendar,
  DateLocalizer,
  EventPropGetter,
  momentLocalizer,
  View,
} from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./Calendar.css";

const localizer: DateLocalizer = momentLocalizer(moment);

export interface ComponentProps {
  id?: string | undefined;
  events: Array<CalendarEvent>;
  defaultCalendarView?: DefaultCalendarView;
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
      defaultDate: OneUptimeDate.getCurrentDate(),
    };
  }, []);

  // react-big-calendar does not fire onRangeChange on the initial render.
  // Compute the initial range here so callers can fetch events immediately.
  useEffect(() => {
    const view: DefaultCalendarView =
      props.defaultCalendarView || DefaultCalendarView.Week;
    const now: Date = defaultDate;

    let startTime: Date;
    let endTime: Date;

    if (view === DefaultCalendarView.Week) {
      startTime = moment(now).startOf("week").toDate();
      endTime = moment(now).endOf("week").toDate();
    } else if (view === DefaultCalendarView.Month) {
      startTime = moment(now).startOf("month").toDate();
      endTime = moment(now).endOf("month").toDate();
    } else if (view === DefaultCalendarView.Day) {
      startTime = moment(now).startOf("day").toDate();
      endTime = moment(now).endOf("day").toDate();
    } else {
      // Agenda: 30-day window
      startTime = moment(now).startOf("day").toDate();
      endTime = moment(now).add(30, "days").endOf("day").toDate();
    }

    props.onRangeChange({ startTime, endTime });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventStyleGetter: EventPropGetter<any> = (
    event: CalendarEvent,
  ): { className?: string | undefined; style?: React.CSSProperties } => {
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

    return {
      style,
    };
  };

  return (
    <div
      id={props.id}
      className="oneuptime-calendar mt-5 h-[42rem] rounded-xl bg-white"
    >
      <Calendar
        defaultDate={defaultDate}
        events={props.events}
        localizer={localizer}
        showMultiDayTimes
        views={CALENDAR_VIEWS}
        defaultView={props.defaultCalendarView || "week"}
        eventPropGetter={eventStyleGetter}
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
