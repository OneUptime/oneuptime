import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import ExecutionLogTimelineTable from '../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />;
};

export default Settings;
