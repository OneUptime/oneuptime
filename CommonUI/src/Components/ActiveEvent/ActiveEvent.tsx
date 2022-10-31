import Route from 'Common/Types/API/Route';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import EventItem from '../EventItem/EventItem';

export interface ComponentProps {
    cardTitle: string;
    cardTitleRight?: string | undefined;
    cardColor: Color;
    eventTitle: string;
    eventDescription?: string | undefined;
    currentEventStatus: string;
    currentEventStatusDateTime: Date;
    currentEventStatusNote?: string | undefined;
    eventType: string; 
    eventViewRoute?: Route | undefined;
    footerEventStatus?: string | undefined; 
    footerDateTime?: Date | undefined; 
}

const ActiveEvent: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (<div className="active-event-box" style={{
        borderColor: props.cardColor.toString()
    }}>
        <div className="active-event-box-header" style={{
            backgroundColor: props.cardColor.toString()
        }}>
            <div className="active-event-box-header-title flex justify-space-between">
                <div>
                    {props.cardTitle}
                </div>
                <div className="active-event-box-right-title">
                    {props.cardTitleRight}
                </div>
            </div>
        </div>
        <EventItem {...props} />
    </div>)
};

export default ActiveEvent;
