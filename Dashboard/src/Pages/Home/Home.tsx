import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from 'CommonUI/src/Components/Page/Page';
import Route from 'Common/Types/API/Route';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Project from 'Model/Models/Project';
import DashboardSideMenu from './SideMenu';
import IncidentsTable from '../../Components/Incident/IncidentsTable';
import DashboardNavigation from '../../Utils/Navigation';

export interface ComponentProps extends PageComponentProps {
    isLoadingProjects: boolean;
    projects: Array<Project>;
}

const Home: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    useEffect(() => {
        if (!props.isLoadingProjects && props.projects.length === 0) {
            Navigation.navigate(RouteMap[PageMap.WELCOME] as Route);
        }
    }, [props.projects]);

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
                viewPageRoute={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENTS] as Route
                )}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    currentIncidentState: {
                        isResolvedState: false,
                    },
                }}
                noItemsMessage="Nice work! No Active Incidents so far."
                title="Active Incidents"
                description="Here is a list of all the Active Incidents for this project."
            />
        </Page>
    );
};

export default Home;
