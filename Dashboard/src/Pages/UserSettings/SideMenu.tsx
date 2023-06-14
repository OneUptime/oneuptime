import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
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
                        title: 'Notification Rules',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.USER_SETTINGS_NOTIFICATION_RULES
                            ] as Route
                        ),
                    }}
                    icon={IconProp.AdjustmentVertical}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
