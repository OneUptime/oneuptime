import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardNavigation from '../../Utils/Navigation';
const NotOperationalMonitors: FunctionComponent = (): ReactElement => {
    return (
        <MonitorTable
            viewPageRoute={RouteUtil.populateRouteParams(
                RouteMap[PageMap.MONITORS] as Route
            )}
            query={{
                projectId: DashboardNavigation.getProjectId()?.toString(),
                currentMonitorStatus: {
                    isOperationalState: false,
                },
            }}
            noItemsMessage="All monitors in operational state."
            title="Inoperational Monitors"
            description="Here is a list of all the monitors which are not in operational state."
        />
    );
};

export default NotOperationalMonitors;
