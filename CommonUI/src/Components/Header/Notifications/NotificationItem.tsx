import React, { ReactElement } from "react";
import CircularIconImage from "../../Basic/Icon/CircularIconImage";
import { IconProp } from "../../Basic/Icon/Icon";
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    icon: IconProp,
    title: string, 
    description: string, 
    createdAt: Date
}

const NotificationItem = (props: ComponentProps): ReactElement => {
    return (<a className="text-reset notification-item" href="/">
        <div className="d-flex">
            <CircularIconImage icon={props.icon} />
            <div className="flex-grow-1">
                <h6 className="mt-0 mb-1">{props.title}</h6>
                <div className="font-size-12 text-muted">
                    <p className="mb-1">{props.description}</p>
                    <p className="mb-0"><i className="mdi mdi-clock-outline" />{OneUptimeDate.fromNow(props.createdAt)} </p>
                </div>
            </div>
        </div>
    </a>)
}


export default NotificationItem;