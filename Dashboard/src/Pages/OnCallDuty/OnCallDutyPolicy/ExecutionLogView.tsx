import ExecutionLogTimelineTable from '../../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable';
import PageMap from '../../../Utils/PageMap';
import RouteMap from '../../../Utils/RouteMap';
import RouteParams from '../../../Utils/RouteParams';
import PageComponentProps from '../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

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

    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <Fragment>
            <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />
        </Fragment>
    );
};

export default Settings;
