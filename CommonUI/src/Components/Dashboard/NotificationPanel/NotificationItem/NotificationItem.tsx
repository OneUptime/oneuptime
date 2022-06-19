import React, { ReactElement, FunctionComponent } from 'react';
import Icon, { IconProp, SizeProp } from '../../../Basic/Icon/Icon';
import './NotificationItem.scss';
export interface NotificationObject {
    date: Date;
    content: string;
    link: string;
    read: boolean;
}

export interface ComponentProps extends NotificationObject {}

const NotificationItem: FunctionComponent<ComponentProps> = ({
    read,
    date,
    content,
    link,
}: ComponentProps): ReactElement => {
    return (
        <div className={`notification-item ${!read && 'not-read'}`}>
            <div className="notification-date">
                <span>{new Date(date).toDateString()}</span>
            </div>
            <div>
                <p>{content}</p>
            </div>
            <a href={link} className="notification-link">
                Learn more{' '}
                <Icon
                    icon={IconProp['ChevronRight']}
                    size={SizeProp['Small']}
                />
            </a>
        </div>
    );
};

export default NotificationItem;
