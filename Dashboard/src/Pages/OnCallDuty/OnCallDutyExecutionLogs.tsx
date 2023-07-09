import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import ExecutionLogsTable from '../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Page
            title={'On-Call Duty'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'On Call Duty',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY] as Route
                    ),
                },
                {
                    title: 'Execution Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ExecutionLogsTable />
        </Page>
    );
};

export default Settings;
