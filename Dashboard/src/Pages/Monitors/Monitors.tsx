import React, { FunctionComponent, ReactElement } from 'react';
import PageContainer from 'CommonUI/src/Components/Dashboard/Container/PageContainer/PageContainer';
import Sidebar from 'CommonUI/src/Components/Dashboard/Sidebar/Sidebar';
import SidebarItem from 'CommonUI/src/Components/Dashboard/Sidebar/SidebarItem';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import SubPage from 'CommonUI/src/Components/Basic/SubPage';
import Route from 'Common/Types/API/Route';
import Dictionary from 'Common/Types/Dictionary';
import PageComponentProps from '../PageComponentProps';

const Monitors: FunctionComponent<PageComponentProps> = ({
    pageRoute,
}: PageComponentProps): ReactElement => {
    const RouteDictionary: Dictionary<Route> = {
        List: new Route('/'),
        Create: new Route('/create'),
        Detail: new Route('/monitor/:slug'),
    };

    return (
        <PageContainer
            title="OneUptime | Monitors"
            sideBar={
                <Sidebar title="Monitors">
                    <SidebarItem
                        title="All Monitors"
                        route={pageRoute.addRoute(
                            RouteDictionary['List'] as Route
                        )}
                    />
                    <SidebarItem
                        title="Create a new Monitor"
                        route={pageRoute.addRoute(
                            RouteDictionary['Create'] as Route
                        )}
                    />
                </Sidebar>
            }
        >
            <SubPage
                route={pageRoute.addRoute(RouteDictionary['List'] as Route)}
            >
                <MonitorTable />
            </SubPage>

            <SubPage
                route={pageRoute.addRoute(RouteDictionary['Create'] as Route)}
            >
                <MonitorTable />
            </SubPage>

            <SubPage
                route={pageRoute.addRoute(RouteDictionary['Detail'] as Route)}
            >
                <MonitorTable />
            </SubPage>
        </PageContainer>
    );
};

export default Monitors;
