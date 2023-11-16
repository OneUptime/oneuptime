import Log from 'Model/AnalyticsModels/Log';
import React, { FunctionComponent, ReactElement, Ref } from 'react';
import LogItem from './LogItem';

export interface ComponentProps {
    logs: Array<Log>;
}

const LogsViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [screenHeight, setScreenHeight] = React.useState<number>(
        window.innerHeight
    );
    const [autoScroll, setAutoScroll] = React.useState<boolean>(true);
    const logsViewerRef: Ref<HTMLDivElement> =
        React.useRef<HTMLDivElement>(null);

    // Update the screen height when the window is resized

    React.useEffect(() => {
        const handleResize: any = (): void => {
            setScreenHeight(window.innerHeight);
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // if scrolled up set autoscrol to false, if scrolled to the bottom set it to true

    React.useEffect(() => {
        const logsViewer: HTMLDivElement | null = logsViewerRef.current;

        if (!logsViewer) {
            return;
        }

        const scrollPosition: number =
            logsViewer.scrollTop + logsViewer.offsetHeight;
        const scrollHeight: number = logsViewer.scrollHeight;

        if (scrollPosition < scrollHeight) {
            setAutoScroll(false);
        } else {
            setAutoScroll(true);
        }
    }, [props.logs]);

    // Keep scroll to the bottom of the log

    React.useEffect(() => {
        if (!autoScroll) {
            return;
        }

        const logsViewer: HTMLDivElement | null = logsViewerRef.current;

        if (logsViewer) {
            logsViewer.scrollTop = logsViewer.scrollHeight;
        }
    }, [props.logs]);

    return (
        <div
            ref={logsViewerRef}
            className="shadow-xl rounded-xl bg-slate-800 p-5 overflow-hidden hover:overflow-y-auto"
            style={{
                height: screenHeight - 330,
            }}
        >
            {props.logs.map((log: Log, i: number) => {
                return <LogItem key={i} log={log} />;
            })}
        </div>
    );
};

export default LogsViewer;
