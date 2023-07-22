import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Link from 'Common/Types/Link';
import Navigation from 'CommonUI/src/Utils/Navigation';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    let subItemMenuLink: Link | undefined = undefined;

    if (
        Navigation.isOnThisPage(
            RouteMap[PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE]!
        )
    ) {
        subItemMenuLink = {
            title: 'Timeline',
            to: Navigation.getCurrentRoute(),
        };
    }

    return (
        <SideMenu>
            <SideMenuSection title="Alerts & Notifications">
                <SideMenuItem
                    link={{
                        title: 'Notification Methods',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.USER_SETTINGS_NOTIFICATION_METHODS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Bell}
                />
                <SideMenuItem
                    link={{
                        title: 'Notification Settings',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Settings}
                />
                <SideMenuItem
                    link={{
                        title: 'On-Call Rules',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.USER_SETTINGS_ON_CALL_RULES
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Call}
                />
            </SideMenuSection>
            <SideMenuSection title="Logs">
                <SideMenuItem
                    link={{
                        title: 'On Call Logs',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.USER_SETTINGS_ON_CALL_LOGS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Logs}
                    subItemIcon={IconProp.Clock}
                    subItemLink={subItemMenuLink}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
