import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar, momentLocalizer, DateLocalizer } from 'react-big-calendar';
import React, { FunctionComponent, ReactElement, useMemo } from 'react';
import moment from 'moment-timezone';
import OneUptimeDate from 'Common/Types/Date';
import CalendarEvent from 'Common/Types/Calendar/CalendarEvent';

const localizer: DateLocalizer = momentLocalizer(moment);

export interface ComponentProps {
    id?: string | undefined;
    events: Array<CalendarEvent>;
}


const CalendarElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const { defaultDate } = useMemo(
        () => ({
            defaultDate: OneUptimeDate.getCurrentDate(),
        }),
        []
    )

    return (
        <div id={props.id} className='mt-5 h-[42rem]'>
            <Calendar
                defaultDate={defaultDate}
                events={props.events}
                localizer={localizer}
                showMultiDayTimes
            />
        </div>
    );
};

export default CalendarElement;
