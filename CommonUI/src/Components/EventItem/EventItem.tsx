import Route from 'Common/Types/API/Route';
import { Blue } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';
import Link from '../Link/Link';



export interface ComponentProps {
    eventTitle: string;
    eventDescription?: string | undefined;
    currentEventStatus: string;
    currentEventStatusDateTime: Date;
    currentEventStatusNote?: string | undefined;
    eventType: string;
    eventViewRoute?: Route | undefined
}

const EventItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (<div>
        <div className="active-event-box-body" style={{ marginBottom: "0px", paddingBottom: "0px" }}>
            <h2 className="active-event-box-body-title">
                {props.eventTitle}
            </h2>
            {props.eventDescription && <p className="active-event-box-body-description">
                Description
            </p>}
        </div>
        <div className="active-event-box-body" style={{ marginTop: "0px", paddingTop: "0px" }}>
            {props.currentEventStatusNote && <div className="active-event-box-body-description"> <span className="bold">{props.currentEventStatus} - </span>{props.currentEventStatusNote || ''}</div>}
            <div className="active-event-box-body-timestamp">{props.currentEventStatus} on {OneUptimeDate.getDateAsLocalFormattedString(
                props.currentEventStatusDateTime,
                false
            )}. {props.eventViewRoute ? <span><Link className='underline pointer' to={props.eventViewRoute} style={{
                color: Blue.toString()
            }}><>{props.eventType} Details</></Link></span> : <></>}</div>
        </div>
    </div>)
};

export default EventItem;
