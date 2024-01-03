import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
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

    return <ExecutionLogsTable onCallDutyPolicyId={modelId} />;
};

export default Settings;
