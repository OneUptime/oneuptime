import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import EventHistoryItem, { ComponentProps as ItemComponentProps } from '../EventItem/EventItem';


export interface ComponentProps {
    date: Date,
    items: Array<ItemComponentProps>
}

const EventHistoryDayList: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (<div className='flex bottom-grey-border' style={{ marginLeft: "-10px", marginRight: "-10px", marginBottom: "20px" }}>

        <div style={{ padding: "20px", paddingRight: "0px" }}>
            {OneUptimeDate.getDateAsLocalFormattedString(props.date)}
        </div>
        <div style={{ padding: "10px", paddingTop: "0px" }}>
            {props.items.map((item) => {
                return <EventHistoryItem {...item} />
            })}
        </div>
    </div>)
};

export default EventHistoryDayList;
