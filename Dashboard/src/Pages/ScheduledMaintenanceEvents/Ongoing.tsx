import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import ScheduledMaintenanceTable from '../../Components/ScheduledMaintenance/ScheduledMaintenanceTable';
import DashboardNavigation from '../../Utils/Navigation';
const ScheduledMaintenancesPage: FunctionComponent<
    PageComponentProps
> = (): ReactElement => {
    return (
        <ScheduledMaintenanceTable
            viewPageRoute={
                RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route
            }
            query={{
                projectId: DashboardNavigation.getProjectId()?.toString(),
                currentScheduledMaintenanceState: {
                    isOngoingState: true,
                },
            }}
            noItemsMessage="No ongoing events so far."
            title="Ongoing Scheduled Maintenances"
            description="Here is a list of all the ongoing events for this project."
        />
    );
};

export default ScheduledMaintenancesPage;
