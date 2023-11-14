import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Log from 'Model/AnalyticsModels/Log';
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    log: Log;
}

const LogItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isCollapsed, setIsCollapsed] = React.useState<boolean>(true);

    useEffect(() => {
        setIsCollapsed(true);
    }, []);

    if (isCollapsed) {
        return (
            <div className="text-slate-200 flex">
                {props.log.time && (
                    <div className="text-slate-500">
                        {OneUptimeDate.getDateAsFormattedString(props.log.time)}{' '}
                        &nbsp;{' '}
                    </div>
                )}
                {props.log.severityText === 'Information' && (
                    <div className="text-sky-400">[INFO] &nbsp;</div>
                )}
                {props.log.severityText === 'Warning' && (
                    <div className="text-amber-400">[WARN] &nbsp;</div>
                )}
                {props.log.severityText === 'Error' && (
                    <div className="text-rose-400">[ERROR] &nbsp;</div>
                )}
                <div>{props.log.body?.toString()}</div>
            </div>
        );
    }

    return <div className="text-slate-200">{props.log.body}</div>;
};

export default LogItem;
