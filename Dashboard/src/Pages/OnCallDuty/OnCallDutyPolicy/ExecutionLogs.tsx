import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import ObjectID from 'Common/Types/ObjectID';
import SideMenu from './SideMenu';
import RouteParams from '../../../Utils/RouteParams';
import ExecutionLogsTable from '../../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = new ObjectID(
        Navigation.getParamByName(
            RouteParams.ModelID,
            RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS]! as Route
        ) as string
    );

    return (
        <ModelPage
            title="On-Call Policy"
            modelType={OnCallDutyPolicy}
            modelId={modelId}
            modelNameField="name"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'On-Call Duty',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View On-Call Policy',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Logs',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                        ] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ExecutionLogsTable onCallDutyPolicyId={modelId} />
        </ModelPage>
    );
};

export default Settings;
