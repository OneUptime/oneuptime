import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardSideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';
const MonitorPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Monitors'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Monitors',
                    to: RouteMap[PageMap.MONITORS] as Route,
                },
            ]}
            sideMenu={
                <DashboardSideMenu
                    project={props.currentProject || undefined}
                />
            }
        >
            <MonitorTable
                currentProject={props.currentProject || undefined}
                viewPageRoute={RouteMap[PageMap.MONITORS] as Route}
                query={{
                    projectId: DashboardNavigation.getProjectId().toString(),
                }}
            />
        </Page>
    );
};

export default MonitorPage;
