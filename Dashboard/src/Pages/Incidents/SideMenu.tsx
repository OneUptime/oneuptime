import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import SideMenuSection from 'CommonUI/src/Components/SideMenu/SideMenuSection';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';


const DashboardSideMenu: FunctionComponent = (

): ReactElement => {
    return (
        <SideMenu>
            <SideMenuSection title="Incidents">
                <SideMenuItem
                    link={{
                        title: 'All Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[PageMap.INCIDENTS] as Route
                        ),
                    }}
                    icon={IconProp.List}
                />

                <SideMenuItem
                    link={{
                        title: 'Unresolved Incidents',
                        to: RouteUtil.populateRouteParams(
                            RouteMap[
                                PageMap.UNRESOLVED_INCIDENTS
                            ] as Route
                        ),
                    }}
                    icon={IconProp.Error}
                />
            </SideMenuSection>
</SideMenu>
    );
};

export default DashboardSideMenu;
