import Log from 'Model/AnalyticsModels/Log';
import React, { FunctionComponent, ReactElement } from 'react';
import LogItem from './LogItem';

export interface ComponentProps {
   logs: Array<Log>
}

const LogsViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className='shadow rounded bg-slate-600 p-2'>
            {props.logs.map((log: Log) => {
                return <LogItem log={log} />;
            })}
        </div>
    );
};

export default LogsViewer;
