import React, { FunctionComponent, ReactElement } from 'react';
import UserProfile from 'CommonUI/src/Components/Header/UserProfile/UserProfile';
import UserProfileMenu from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenu';
import UserProfileMenuItem from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenuItem';
import UserProfileDropdownDivider from 'CommonUI/src/Components/Header/UserProfile/UserProfileDropdownDivider';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Route from 'Common/Types/API/Route';
import { Red } from 'Common/Types/BrandColors';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import UserUtil from 'CommonUI/src/Utils/User';
import OneUptimeLogo from 'CommonUI/src/Images/users/blank-profile.svg';

export interface ComponentProps {
    onClickUserProfle: () => void;
}

const DashboardUserProfile: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <>
            <UserProfile
                userFullName={UserUtil.getName()}
                userProfilePicture={Route.fromString(
                    `/dashboard/public/${OneUptimeLogo}`
                )}
            >
                <UserProfileMenu>
                    <UserProfileMenuItem
                        title="Profile"
                        onClick={() => {
                            props.onClickUserProfle();
                        }}
                        icon={IconProp.User}
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
        </>
    );
};

export default DashboardUserProfile;
