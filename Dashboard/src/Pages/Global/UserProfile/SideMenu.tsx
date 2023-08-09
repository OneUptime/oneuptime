import React, { ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageMap from '../../../Utils/PageMap';

const DashboardSideMenu: () => JSX.Element = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuItem
                link={{
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route
                    ),
                }}
                icon={IconProp.Info}
            />

            <SideMenuItem
                link={{
                    title: 'Password Management',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route
                    ),
                }}
                icon={IconProp.Lock}
            />

            <SideMenuItem
                link={{
                    title: 'Profile Picture',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_PROFILE_PICTURE] as Route
                    ),
                }}
                icon={IconProp.Image}
            />
        </SideMenu>
    );
};

export default DashboardSideMenu;
