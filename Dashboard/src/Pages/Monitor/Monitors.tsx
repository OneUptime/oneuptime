import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardSideMenu from './SideMenu';
import DashboardNavigation from '../../Utils/Navigation';
import Banner from 'CommonUI/src/Components/Banner/Banner';
import URL from 'Common/Types/API/URL';

const MonitorPage: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Monitors'}
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
            ]}
            sideMenu={
                <DashboardSideMenu
                    project={props.currentProject || undefined}
                />
            }
        >
            <Banner
                openInNewTab={true}
                title="Monitoring Demo"
                description="Watch this video which will help monitor any resource you have with OneUptime"
                link={URL.fromString('https://youtu.be/_fQ_F4EisBQ')}
            />
            <MonitorTable
                viewPageRoute={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.MONITORS] as Route
                )}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
            />
        </Page>
    );
};

export default MonitorPage;
