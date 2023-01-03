import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import RouteMap from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';
const IncidentsPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Incidents'}
            sideMenu={<SideMenu project={props.currentProject || undefined} />}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Incidents',
                    to: RouteMap[PageMap.INCIDENTS] as Route,
                },
            ]}
        >
            <IncidentsTable
                currentProject={props.currentProject || undefined}
                viewPageRoute={props.pageRoute}
                query={{
                    projectId: DashboardNavigation.getProjectId().toString(),
                }}
            />
        </Page>
    );
};

export default IncidentsPage;
