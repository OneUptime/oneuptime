import React, { FunctionComponent, ReactElement, useState } from 'react';
import UserProfile from 'CommonUI/src/Components/Header/UserProfile/UserProfile';
import UserProfileMenu from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenu';
import UserProfileMenuItem from 'CommonUI/src/Components/Header/UserProfile/UserProfileMenuItem';
import UserProfileDropdownDivider from 'CommonUI/src/Components/Header/UserProfile/UserProfileDropdownDivider';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import URL from 'Common/Types/API/URL';
import Route from 'Common/Types/API/Route';
import { Red } from 'Common/Types/BrandColors';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import UserUtil from 'CommonUI/src/Utils/User';
import UserProfileModal from './UserProfileModal';


const DashboardUserProfile: FunctionComponent = (): ReactElement => {

    const [showProfileModal, setShowProfileModal] =
        useState<boolean>(false);

    return (
        <>
            <UserProfile
                userFullName={UserUtil.getName()}
                userProfilePicture={URL.fromString(
                    'https://blog.media.io/images/images2021/cool-good-tiktok-profile-pictures.jpg'
                )}
            >
                <UserProfileMenu>
                    <UserProfileMenuItem
                        title="Profile"
                        onClick={() => {
                            setShowProfileModal(true);
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

            {
                showProfileModal && (
                    <UserProfileModal
                        onClose={() => {
                            setShowProfileModal(false);
                        }}
                    />
                )
            }
        </>
    );
};

export default DashboardUserProfile;
