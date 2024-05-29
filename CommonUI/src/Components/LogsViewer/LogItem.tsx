import CopyTextButton from '../CopyTextButton/CopyTextButton';
import OneUptimeDate from 'Common/Types/Date';
import Log, { LogSeverity } from 'Model/AnalyticsModels/Log';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';

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

    let bodyColor: string = 'text-slate-200';

    type GetCopyButtonFunction = (textToBeCopied: string) => ReactElement;

    const getCopyButton: GetCopyButtonFunction = (textToBeCopied: string) => {
        return (
            <CopyTextButton
                textToBeCopied={textToBeCopied}
                className="ml-5 font-medium px-3 my-0.5 py-0.5 text-xs bg-slate-900 text-slate-300 rounded hover:bg-slate-600 border-slate-700 border-solid border-0"
            />
        );
    };

    if (
        props.log.severityText === LogSeverity.Warning ||
        props.log.severityText === LogSeverity.Trace ||
        props.log.severityText === LogSeverity.Debug
    ) {
        bodyColor = 'text-amber-400';
    } else if (props.log.severityText === LogSeverity.Error) {
        bodyColor = 'text-rose-400';
    }

    if (isCollapsed) {
        return (
            <div
                className="text-slate-200 flex cursor-pointer hover:border-slate-700 px-2 border-transparent border-2 rounded-md"
                onClick={() => {
                    setIsCollapsed(false);
                }}
            >
                {props.log.time && (
                    <div
                        className="text-slate-500 courier-prime flex-none"
                        style={{
                            width: '230px !important',
                        }}
                    >
                        {OneUptimeDate.getDateAsLocalFormattedString(
                            props.log.time
                        )}{' '}
                        &nbsp;{' '}
                    </div>
                )}
                {props.log.severityText === LogSeverity.Information && (
                    <div className="text-sky-400 courier-prime flex-none">
                        [INFO] &nbsp;
                    </div>
                )}
                {props.log.severityText === LogSeverity.Warning && (
                    <div className="text-amber-400 courier-prime flex-none">
                        [WARN] &nbsp;
                    </div>
                )}
                {props.log.severityText === LogSeverity.Trace && (
                    <div className="text-amber-400 courier-prime flex-none">
                        [TRACE] &nbsp;
                    </div>
                )}
                {props.log.severityText === LogSeverity.Debug && (
                    <div className="text-amber-400 courier-prime flex-none">
                        [DEBUG] &nbsp;
                    </div>
                )}
                {props.log.severityText === LogSeverity.Error && (
                    <div className="text-rose-400 courier-prime flex-none">
                        [ERROR] &nbsp;
                    </div>
                )}
                {props.log.severityText === LogSeverity.Fatal && (
                    <div className="text-rose-400 courier-prime flex-none">
                        [FATAL] &nbsp;
                    </div>
                )}

                <div className={`${bodyColor} courier-prime`}>
                    {props.log.body?.toString()}
                </div>
            </div>
        );
    }

    return (
        <div
            className="text-slate-200 cursor-pointer hover:border-slate-700 px-2 border-transparent border-2 rounded-md mb-1"
            onClick={() => {
                setIsCollapsed(true);
            }}
        >
            {props.log.time && (
                <div className="text-slate-500 courier-prime">
                    {OneUptimeDate.getDateAsFormattedString(props.log.time)}{' '}
                    &nbsp;{' '}
                </div>
            )}
            {props.log.severityText === LogSeverity.Information && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-sky-400 courier-prime">
                        [INFO] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Unspecified && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-sky-400 courier-prime">
                        [UNKNOWN] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Warning && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-amber-400 courier-prime">
                        [WARN] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Trace && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-amber-400 courier-prime">
                        [TRACE] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Debug && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-amber-400 courier-prime">
                        [DEBUG] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Error && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-rose-400 courier-prime">
                        [ERROR] &nbsp;
                    </div>
                </div>
            )}
            {props.log.severityText === LogSeverity.Fatal && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SEVERITY:
                    </div>
                    <div className="text-rose-400 courier-prime">
                        [FATAL] &nbsp;
                    </div>
                </div>
            )}

            <div className="flex">
                <div className="font-medium text-slate-200 courier-prime mr-2">
                    MESSAGE:&nbsp;
                </div>
                <div className={`${bodyColor} courier-prime`}>
                    {props.log.body?.toString()}
                </div>
            </div>

            {props.log.traceId && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        TRACE:&nbsp;&nbsp;&nbsp;
                    </div>
                    <div className={`${bodyColor} courier-prime`}>
                        {props.log.traceId?.toString()}
                    </div>
                    {getCopyButton(props.log.traceId?.toString() || '')}
                </div>
            )}

            {props.log.spanId && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        SPAN:&nbsp;&nbsp;&nbsp;&nbsp;
                    </div>
                    <div className={`${bodyColor} courier-prime`}>
                        {props.log.spanId?.toString()}
                    </div>
                    {getCopyButton(props.log.spanId?.toString() || '')}
                </div>
            )}

            {props.log.attributes && (
                <div className="flex">
                    <div className="font-medium text-slate-200 courier-prime mr-2">
                        ATTRIBUTES:
                    </div>
                    <div className={`${bodyColor} courier-prime`}>
                        {JSON.stringify(props.log.attributes, null, 2)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LogItem;
