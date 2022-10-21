// import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import React, { FunctionComponent, ReactElement } from 'react';



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
        <div className="active-event-box-body">
            <h2 className="active-event-box-body-title">
                Incident Title
            </h2>
            <p className="active-event-box-body-description">
                Description
            </p>
        </div>
        <div className="active-event-box-body" style={{marginTop: "0px", paddingTop: "0px"}}>
            <div className="active-event-box-body-description"> <span className="bold">Current Status</span> - Currernt Status Description</div>
            <div className="active-event-box-body-timestamp">12 Oct 2020</div>
        </div>
    </div>)
};

export default ActiveEvent;
