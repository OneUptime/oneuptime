import { Blue } from 'Common/Types/BrandColors';
import React, { FunctionComponent, ReactElement } from 'react';



export interface ComponentProps {

}

const EventItem: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (<div>
        <div className="active-event-box-body" style={{ marginBottom: "0px", paddingBottom: "0px" }}>
            <h2 className="active-event-box-body-title">
                Incident Title
            </h2>
            <p className="active-event-box-body-description">
                Description
            </p>
        </div>
        <div className="active-event-box-body" style={{marginTop: "0px", paddingTop: "0px"}}>
            <div className="active-event-box-body-description"> <span className="bold">Current Status</span> - Currernt Status Description</div>
            <div className="active-event-box-body-timestamp">Current Status on 12 Oct 2020. <span><a className='underline pointer' style={{
                color: Blue.toString()
            }}>Incident Details</a></span></div>
        </div>
    </div>)
};

export default EventItem;
