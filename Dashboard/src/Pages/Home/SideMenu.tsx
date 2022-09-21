import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Overview">
                <SideMenuItem
                    link={{
                        title: 'Unresolved Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.HOME] as Route
                        ),
                    }}
                    icon={IconProp.Alert}
                />
                <SideMenuItem
                    link={{
                        title: 'Monitors Not Operational',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.NOT_OPERATIONAL_MONITORS] as Route
                        ),
                    }}
                    icon={IconProp.Activity}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
