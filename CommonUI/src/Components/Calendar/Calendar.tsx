import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar, momentLocalizer, DateLocalizer } from 'react-big-calendar';
import React, { FunctionComponent, ReactElement, useMemo } from 'react';
import moment from 'moment-timezone';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import StartAndEndTime from 'Common/Types/Time/StartAndEndTime';

const localizer: DateLocalizer = momentLocalizer(moment);

export interface ComponentProps {
    id?: string | undefined;
    events: Array<CalendarEvent>;
    defaultCalendarView?: DefaultCalendarView;
    onRangeChange: (startAndEndTime: StartAndEndTime) => void;
}

export enum DefaultCalendarView {
    Month = 'month',
    Week = 'week',
    Day = 'day',
    Agenda = 'agenda',
}

const CalendarElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { defaultDate } = useMemo(() => {
        return {
            defaultDate: OneUptimeDate.getCurrentDate(),
        };
    }, []);

    return (
        <div id={props.id} className="mt-5 h-[42rem]">
            <Calendar
                defaultDate={defaultDate}
                events={props.events}
                localizer={localizer}
                showMultiDayTimes
                defaultView={props.defaultCalendarView || 'day'}
                onRangeChange={(range: Date[] | { start: Date; end: Date }) => {
                    if (Array.isArray(range)) {
                        return;
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
