import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar, momentLocalizer, DateLocalizer, View } from 'react-big-calendar';
import React, { FunctionComponent, ReactElement, useMemo } from 'react';
import moment from 'moment-timezone';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';
import StartAndEndTime from 'Common/Types/Time/StartAndEndTime';
import Color from 'Common/Types/Color';
import { Blue } from 'Common/Types/BrandColors';

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

    const eventStyleGetter = (event: CalendarEvent) => {
        var backgroundColor = event.color?.toString() || Blue.toString();
        var style = {
            backgroundColor: backgroundColor,
            borderRadius: '0px',
            opacity: 0.8,
            color: event.textColor?.toString() || Color.shouldUseDarkText(new Color(backgroundColor))
                ? '#000000'
                : '#ffffff',
            border: '0px',
            display: 'block'
        };
        return {
            style: style
        };
    };


    return (
        <div id={props.id} className="mt-5 h-[42rem]">
            <Calendar
                defaultDate={defaultDate}
                events={props.events}
                localizer={localizer}
                showMultiDayTimes
                defaultView={props.defaultCalendarView || 'day'}
                eventPropGetter={eventStyleGetter}
                onRangeChange={(range: Date[] | { start: Date; end: Date }) => {

                    if (Array.isArray(range)) {

                        if(range.length === 1){ // this is day.
                            return props.onRangeChange({
                                startTime: range[0] as Date,
                                endTime: OneUptimeDate.getEndOfDay(range[range.length - 1] as Date),
                            });
                        }

                        return props.onRangeChange({
                            startTime: range[0] as Date,
                            endTime: range[range.length - 1] as Date,
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
