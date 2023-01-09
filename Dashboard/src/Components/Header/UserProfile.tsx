import React, { FunctionComponent, ReactElement } from 'react';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Route from 'Common/Types/API/Route';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import BlankProfilePic from 'CommonUI/src/Images/users/blank-profile.svg';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import IconDropdwonItem from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownItem';
import IconDropdwonMenu from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownMenu';

export interface ComponentProps {
    onClickUserProfle: () => void;
}

const DashboardUserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <HeaderIconDropdownButton
                iconImageUrl={BlankProfilePic}
                name="User Profile"
            >
                <IconDropdwonMenu>
                    <IconDropdwonItem
                        title="Profile"
                        onClick={() => {
                            props.onClickUserProfle();
                        }}
                        icon={IconProp.User}
                    />

                    <IconDropdwonItem
                        title="Log out"
                        url={RouteMap[PageMap.LOGOUT] as Route}
                        icon={IconProp.Logout}
                    />
                </IconDropdwonMenu>
            </HeaderIconDropdownButton>
        </>
    );
};

export default DashboardUserProfile;
