import Page from 'CommonUI/src/Components/Page/Page';
import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type PageComponentProps from '../PageComponentProps';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import type Route from 'Common/Types/API/Route';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';
import Navigation from 'CommonUI/src/Utils/Navigation';

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
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route
                    ),
                },
            ]}
        >
            <IncidentsTable
                viewPageRoute={Navigation.getCurrentRoute()}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />
        </Page>
    );
};

export default IncidentsPage;
