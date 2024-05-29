import ExecutionLogTimelineTable from '../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable';
import PageComponentProps from '../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { FunctionComponent, ReactElement } from 'react';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />;
};

export default Settings;
