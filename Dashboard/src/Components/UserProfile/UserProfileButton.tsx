import React, { ReactElement, FunctionComponent, useState, MouseEventHandler } from 'react';
import OutsideClickHandler from 'react-outside-click-handler';
import TopbarMenu from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/TopbarMenu';
import MenuLinkItem from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenu/MenuLinkItem';
import { MenuIconButton } from 'CommonUI/src/Components/Dashboard/TopBar/TopbarMenuButton/MenuButton';
import { faUser } from '@fortawesome/free-solid-svg-icons';
import UserInfo from './UserInfo';

const UserProfileButton: FunctionComponent = (): ReactElement => {
    const [showProfile, setShowProfile] = useState(false);
    const toggle: Function = () => {
        return setShowProfile(!showProfile);
    };

    return (
        <OutsideClickHandler
            onOutsideClick={() => {
                if (showProfile) {
                    toggle();
                }
            }}
        >
            <MenuIconButton
                icon={faUser}
                showModal={showProfile}
                onClick={toggle as MouseEventHandler}
                modalContent={
                    <TopbarMenu
                        items={[
                            <UserInfo
                                name="Caleb Okpara"
                                role="Administrator"
                                key={1}
                            />,
                            <MenuLinkItem text="Profile" key={2} />,
                            <MenuLinkItem text="Sign out" key={3} />,
                        ]}
                    />
                }
            />
        </OutsideClickHandler>
    );
};

export default UserProfileButton;
