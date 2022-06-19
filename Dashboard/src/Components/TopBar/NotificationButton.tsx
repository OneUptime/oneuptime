import React, { ReactElement, FunctionComponent } from 'react';
import IconButton from 'CommonUI/src/Components/Basic/Button/MenuButton/IconButton';
import { IconProp, SizeProp } from 'CommonUI/src/Components/Basic/Icon/Icon';
import NotificationPanel from 'CommonUI/src/Components/Dashboard/NotificationPanel/NotificationPanel';

const NotificationButton: FunctionComponent = (): ReactElement => {
    return (
        <IconButton icon={IconProp.Notification} size={SizeProp.Large}>
            <NotificationPanel
                noticationElements={[
                    {
                        date: new Date(),
                        content: 'You have a new notificaton',
                        link: '#',
                        read: true,
                    },
                    {
                        date: new Date(),
                        content: 'You have a new notificaton',
                        link: '#',
                        read: false,
                    },
                    {
                        date: new Date(),
                        content: 'You have a new notificaton',
                        link: '#',
                        read: true,
                    },
                ]}
            />
        </IconButton>
    );
};

export default NotificationButton;
