import React, { FunctionComponent, ReactElement } from 'react';
import EventHistoryItem from '../EventItem/EventItem';



export interface ComponentProps {

}

const EventHistoryDayList: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (<div className='flex bottom-grey-border' style={{ marginLeft: "-10px", marginRight: "-10px", marginBottom: "20px" }}>
        
        <div style={{ padding: "20px", paddingRight: "0px" }}>
            Oct 20, 2022
        </div>
        <div style={{ padding: "10px", paddingTop: "0px" }}>
            <EventHistoryItem />
            <EventHistoryItem />
        </div>
    </div>)
};

export default EventHistoryDayList;
