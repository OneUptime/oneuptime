import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import SideMenu from './SideMenu';
import ScheduledMaintenancesTable from '../../Components/ScheduledMaintenance/ScheduledMaintenanceTable';

const ScheduledMaintenancesPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Scheduled Maintenance Events'}
            sideMenu={<SideMenu project={props.currentProject || undefined} />}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Scheduled Maintenance',
                    to: RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route,
                },
            ]}
        >
            <ScheduledMaintenancesTable
                currentProject={props.currentProject || undefined}
                viewPageRoute={props.pageRoute}
                query={{
                    projectId: props.currentProject?._id,
                }}
            />
        </Page>
    );
};

export default ScheduledMaintenancesPage;
