import React, { ReactElement, FunctionComponent } from 'react';
import NotificationItem, {
    NotificationObject,
} from './NotificationItem/NotificationItem';
import './NotificationPanel.scss';
export interface ComponentProps {
    noticationElements: Array<NotificationObject>;
}

const NotificationPanel: FunctionComponent<ComponentProps> = ({
    noticationElements,
}: ComponentProps): ReactElement => {
    return (
        <div className="notification-panel">
            <div className="notification-header">
                <h5>Notifications</h5>
                <button className="">Mark all as read</button>
            </div>
            <div className="notification-body">
                {noticationElements.map(
                    (
                        { content, date, link, read }: NotificationObject,
                        index: number
                    ) => {
                        return (
                            <NotificationItem
                                content={content}
                                date={date}
                                link={link}
                                read={read}
                                key={index}
                            />
                        );
                    }
                ) || "You don't have any notifications"}
            </div>
        </div>
    );
};

export default NotificationPanel;
