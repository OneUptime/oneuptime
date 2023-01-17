import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import DashboardSideMenu from './SideMenu';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import DashboardNavigation from '../../Utils/Navigation';

const Home: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Home'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Home',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
            ]}
            sideMenu={
                <DashboardSideMenu
                    project={props.currentProject || undefined}
                />
            }
        >
            <IncidentsTable
                viewPageRoute={RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENTS] as Route)}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    currentIncidentState: {
                        isResolvedState: false,
                    },
                }}
                noItemsMessage="Nice work! No unresolved incidents so far."
                title="Unresolved Incidents"
                description="Here is a list of all the unresolved incidents for this project."
            />
        </Page>
    );
};

export default Home;
