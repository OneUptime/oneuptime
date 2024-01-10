import React, { FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../PageComponentProps';
import ExecutionLogsTable from '../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return <ExecutionLogsTable />;
};

export default Settings;
