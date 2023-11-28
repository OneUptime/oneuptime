import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Calendar, momentLocalizer, DateLocalizer } from 'react-big-calendar';
import React, { FunctionComponent, ReactElement } from 'react';
import moment from 'moment';

const localizer: DateLocalizer = momentLocalizer(moment);

export interface ComponentProps {
    id?: string | undefined;
}

const CalendarElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div id={props.id}>
            <Calendar
                events={[]}
                startAccessor="start"
                endAccessor="end"
                style={{ height: 500 }}
                localizer={localizer}
            />
        </div>
    );
};

export default CalendarElement;
