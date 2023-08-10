import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import RouteParams from '../../../Utils/RouteParams';
import SideMenu from './SideMenu';
import ExecutionLogTimelineTable from '../../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const onCallDutyPolicyIdString: string | null = Navigation.getParamByName(
        RouteParams.ModelID,
        RouteMap[PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW]!
    );

    if (!onCallDutyPolicyIdString) {
        throw new Error('No on call duty policy id found');
    }

    const onCallDutyPolicyId: ObjectID = new ObjectID(onCallDutyPolicyIdString);

    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <ModelPage
            title="On-Call Policy"
            modelType={OnCallDutyPolicy}
            modelId={onCallDutyPolicyId}
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
                {
                    title: 'Timeline',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                        ] as Route,
                        {
                            modelId: onCallDutyPolicyId,
                            subModelId: modelId,
                        }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={onCallDutyPolicyId} />}
        >
            <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />
        </ModelPage>
    );
};

export default Settings;
