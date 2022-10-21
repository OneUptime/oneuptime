import React, { FunctionComponent, ReactElement } from 'react';
import EventItem from '../EventItem/EventItem';



export interface ComponentProps {

}

const ActiveEvent: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (<div className="active-event-box">
        <div className="active-event-box-header">
            <div className="active-event-box-header-title">
                Active Incident
            </div>
        </div>
        <EventItem />
    </div>)
};

export default ActiveEvent;
