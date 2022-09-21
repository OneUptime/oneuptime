import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import MonitorTable from '../../Components/Monitor/MonitorTable';
import DashboardSideMenu from './SideMenu';

const NotOperationalMonitors: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'Home'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Home',
                    to: RouteMap[PageMap.HOME] as Route,
                },
                {
                    title: 'Not Operational Monitors',
                    to: RouteMap[PageMap.NOT_OPERATIONAL_MONITORS] as Route,
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
             <MonitorTable currentProject={props.currentProject || undefined} viewPageRoute={RouteMap[PageMap.MONITORS] as Route} query={{
                projectId: props.currentProject?._id,
                currentMonitorStatus: {
                    isOperationalState: false
                }
            }}
                noItemsMessage='Nice work! All monitors in operational state.'
                title='Monitors Not Operational'
                description='Here is a list of all the monitors which are not in operational state.'
            />
        </Page>
    );
};

export default NotOperationalMonitors;
