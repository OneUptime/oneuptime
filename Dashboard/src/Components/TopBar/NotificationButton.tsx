import React, { ReactElement, FunctionComponent } from 'react';
import MenuItem from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuItem';
import MenuLegend from 'CommonUI/src/Components/Basic/Button/MenuButton/MenuLegend';
import IconButton from 'CommonUI/src/Components/Basic/Button/MenuButton/IconButton';
import { IconProp } from 'CommonUI/src/Components/Basic/Icon/Icon';

const NotificationButton: FunctionComponent = (): ReactElement => {
    return (
        <IconButton icon={IconProp.Notification}>
            <MenuLegend title={'Basic'} />
            <MenuItem title="Monitors" />
            <MenuItem title="Incident" />
            <MenuItem title="Status Page" />
            <MenuLegend title={'Advanced'} />
            <MenuItem title="Automated Script" />
            <MenuItem title="Logs" />
        </IconButton>
    );
};

export default NotificationButton;
