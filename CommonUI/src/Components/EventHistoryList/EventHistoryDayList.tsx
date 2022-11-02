import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import EventHistoryItem, { ComponentProps as ItemComponentProps } from '../EventItem/EventItem';


export interface ComponentProps {
    date: Date,
    items: Array<ItemComponentProps>
    isLastItem? :boolean | undefined
}

const EventHistoryDayList: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (<div className='flex bottom-grey-border' style={{ marginLeft: "-10px", marginRight: "-10px", marginBottom: props.isLastItem ? "0px": "20px", borderBottomWidth: props.isLastItem ? "0px": "1px" }}>

        <div style={{ padding: "20px", paddingRight: "0px" }}>
            {OneUptimeDate.getDateAsLocalFormattedString(props.date, true)}
        </div>
        <div style={{ padding: "10px", paddingTop: "0px" }}>
            {props.items.map((item, i) => {
                return <EventHistoryItem key={i} {...item} />
            })}
        </div>
    </div>)
};

export default EventHistoryDayList;
