import React, { FunctionComponent, ReactElement } from 'react';
import EventHistoryDayList from './EventHistoryDayList';
import NoEventDay from './NoEventDay';



export interface ComponentProps {
    // startDate: Date;
    // endDate: Date;

}

const ActiveEvent: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (<div className="event-history-box">
        <NoEventDay/>
        <EventHistoryDayList />
        <EventHistoryDayList />
        <EventHistoryDayList/>
    </div>)
};

export default ActiveEvent;
