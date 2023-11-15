import Log from 'Model/AnalyticsModels/Log';
import React, { FunctionComponent, ReactElement } from 'react';
import LogItem from './LogItem';

export interface ComponentProps {
    logs: Array<Log>;
}

const LogsViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="shadow rounded-xl bg-slate-800 p-5">
            {props.logs.map((log: Log, i: number) => {
                return <LogItem key={i} log={log} />;
            })}
        </div>
    );
};

export default LogsViewer;
