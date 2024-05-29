import ScheduledMaintenanceTable from '../../Components/ScheduledMaintenance/ScheduledMaintenanceTable';
import DashboardNavigation from '../../Utils/Navigation';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';

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
