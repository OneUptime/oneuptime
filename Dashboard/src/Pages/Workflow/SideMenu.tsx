import React, { FunctionComponent, ReactElement } from 'react';
import Route from 'Common/Types/API/Route';
import IconProp from 'Common/Types/Icon/IconProp';
import SideMenu from 'CommonUI/src/Components/SideMenu/SideMenu';
import SideMenuItem from 'CommonUI/src/Components/SideMenu/SideMenuItem';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

const DashboardSideMenu: FunctionComponent = (): ReactElement => {
    return (
        <SideMenu>
            <SideMenuItem
                link={{
                    title: 'Workflows',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS] as Route
                    ),
                }}
                icon={IconProp.Workflow}
            />
            <SideMenuItem
                link={{
                    title: 'Global Variables',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route
                    ),
                }}
                icon={IconProp.Variable}
            />

            <SideMenuItem
                link={{
                    title: 'Runs & Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.WORKFLOWS_LOGS] as Route
                    ),
                }}
                icon={IconProp.Logs}
            />
        </SideMenu>
    );
};

export default DashboardSideMenu;
