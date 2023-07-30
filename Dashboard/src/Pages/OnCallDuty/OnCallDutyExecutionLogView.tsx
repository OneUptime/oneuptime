import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ExecutionLogTimelineTable from '../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable';
import DashboardSideMenu from './SideMenu';
import Page from 'CommonUI/src/Components/Page/Page';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

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
                    title: 'On-Call Duty',
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
                {
                    title: 'Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_EXECUTION_LOGS] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />
        </Page>
    );
};

export default Settings;
