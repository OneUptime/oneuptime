import React, { ReactElement, useState } from 'react';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import Notifications from 'CommonUI/src/Components/Header/Notifications/Notifications';
import NotificationItem from 'CommonUI/src/Components/Header/Notifications/NotificationItem';
import IconProp from 'Common/Types/Icon/IconProp';

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
