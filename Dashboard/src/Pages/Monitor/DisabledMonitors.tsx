import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardSideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';

const DisabledMonitors: FunctionComponent<PageComponentProps> = (
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
                    title: 'Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS] as Route
                    ),
                },
                {
                    title: 'Disabled Monitors',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.MONITORS_DISABLED] as Route
                    ),
                },
            ]}
            sideMenu={
                <DashboardSideMenu
                    project={props.currentProject || undefined}
                />
            }
        >
            <MonitorTable
                viewPageRoute={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITORS] as Route
                )}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    disableActiveMonitoring: true,
                }}
                noItemsMessage="No disabled monitors. All monitors in active state."
                title="Disabled Monitors"
                description="Here is a list of all the monitors which are in disabled state."
            />
        </Page>
    );
};

export default DisabledMonitors;
