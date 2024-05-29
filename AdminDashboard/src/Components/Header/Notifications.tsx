import IconProp from 'Common/Types/Icon/IconProp';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import NotificationItem from 'CommonUI/src/Components/Header/Notifications/NotificationItem';
import Notifications from 'CommonUI/src/Components/Header/Notifications/Notifications';
import React, { ReactElement, useState } from 'react';

const DashboardHeader: () => JSX.Element = (): ReactElement => {
    const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

    return (
        <HeaderIconDropdownButton
            name="Notifications"
            onClick={() => {
                setIsDropdownVisible(true);
            }}
            showDropdown={isDropdownVisible}
            icon={IconProp.Notification}
            badge={4}
        >
            <Notifications>
                <NotificationItem
                    title="Sample Title"
                    description="Sample Description"
                    createdAt={new Date()}
                    icon={IconProp.Home}
                    onClick={() => {
                        setIsDropdownVisible(false);
                    }}
                />
            </Notifications>
        </HeaderIconDropdownButton>
    );
};

export default DashboardHeader;
