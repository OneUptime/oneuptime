import React, { FunctionComponent, ReactElement } from 'react';
import CircularIconImage from '../../Icon/CircularIconImage';
import Icon from '../../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    icon: IconProp;
    title: string;
    description: string;
    createdAt: Date;
    onClick?: (() => void) | undefined;
}

const NotificationItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <a
            className="text-reset notification-item"
            href="/"
            onClick={props.onClick}
        >
            <div className="d-flex">
                <CircularIconImage icon={props.icon} />
                <div className="flex-grow-1">
                    <h6 className="mt-0 mb-1">{props.title}</h6>
                    <div className="font-size-12 text-muted">
                        <p className="mb-1">{props.description}</p>
                        <p className="mb-0 flex">
                            <Icon icon={IconProp.Time} />
                            <div
                                style={{
                                    marginTop: '1px',
                                    marginRight: '3px',
                                }}
                            >
                                {OneUptimeDate.fromNow(props.createdAt)}{' '}
                            </div>
                        </p>
                    </div>
                </div>
            </div>
        </a>
    );
};

export default NotificationItem;
