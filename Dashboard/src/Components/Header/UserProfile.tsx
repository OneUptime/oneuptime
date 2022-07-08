import React, { FunctionComponent, ReactElement } from 'react';
import UserProfile from 'CommonUI/src/Components/Header/UserProfile/UserProfile';
import UserProfileMenu from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenu';
import UserProfileMenuItem from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenuItem';
import UserProfileDropdownDivider from 'CommonUI/src/Components/Header/UserProfile/UserProfileDropdownDivider';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Name from 'Common/Types/Name';
import URL from 'Common/Types/API/URL';
import Route from 'Common/Types/API/Route';
import { Red } from 'CommonUI/src/Utils/BrandColors';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardUserProfile: FunctionComponent = (): ReactElement => {
    return (
        <UserProfile
            userFullName={new Name('Nawaz Dhandala')}
            userProfilePicture={URL.fromString(
                'https://blog.media.io/images/images2021/cool-good-tiktok-profile-pictures.jpg'
            )}
        >
            <UserProfileMenu>
                <UserProfileMenuItem
                    title="Profile"
                    route={new Route('/logout')}
                    icon={IconProp.User}
                />
                <UserProfileMenuItem
                    title="Billing"
                    route={new Route('/logout')}
                    icon={IconProp.Billing}
                />
                <UserProfileMenuItem
                    title="User Settings"
                    route={new Route('/logout')}
                    icon={IconProp.Settings}
                />
                <UserProfileDropdownDivider />
                <UserProfileMenuItem
                    title="Log out"
                    route={RouteMap[PageMap.LOGOUT] as Route}
                    icon={IconProp.Logout}
                    iconColor={Red}
                />
            </UserProfileMenu>
        </UserProfile>
    );
};

export default DashboardUserProfile;
