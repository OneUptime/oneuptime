import React, { FunctionComponent, ReactElement, useState } from 'react';
import IconProp from 'Common/Types/Icon/IconProp';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import BlankProfilePic from 'CommonUI/src/Images/users/blank-profile.svg';
import HeaderIconDropdownButton from 'CommonUI/src/Components/Header/HeaderIconDropdownButton';
import IconDropdownItem from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownItem';
import IconDropdownMenu from 'CommonUI/src/Components/Header/IconDropdown/IconDropdownMenu';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { DASHBOARD_URL } from 'CommonUI/src/Config';
import User from 'CommonUI/src/Utils/User';

const DashboardUserProfile: FunctionComponent = (): ReactElement => {
    const [isDropdownVisible, setIsDropdownVisible] = useState<boolean>(false);

    return (
        <>
            <HeaderIconDropdownButton
                iconImageUrl={BlankProfilePic}
                name="User Profile"
                showDropdown={isDropdownVisible}
                onClick={() => {
                    setIsDropdownVisible(true);
                }}
            >
                <IconDropdownMenu>
                    {User.isMasterAdmin() ? (
                        <IconDropdownItem
                            title="Exit Admin"
                            onClick={() => {
                                setIsDropdownVisible(false);
                                Navigation.navigate(DASHBOARD_URL);
                            }}
                            icon={IconProp.ExternalLink}
                        />
                    ) : (
                        <></>
                    )}

                    <IconDropdownItem
                        title="Log out"
                        onClick={() => {
                            setIsDropdownVisible(false);
                        }}
                        url={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.LOGOUT] as Route
                        )}
                        icon={IconProp.Logout}
                    />
                </IconDropdownMenu>
            </HeaderIconDropdownButton>
        </>
    );
};

export default DashboardUserProfile;
