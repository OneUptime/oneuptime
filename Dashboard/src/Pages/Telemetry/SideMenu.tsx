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
            <SideMenuSection title="Basic">
                <SideMenuItem
                    link={{
                        title: 'Services',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.TELEMETRY_SERVICES] as Route
                        ),
                    }}
                    icon={IconProp.SquareStack}
                />
            </SideMenuSection>
        </SideMenu>
    );
};

export default DashboardSideMenu;
