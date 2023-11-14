import ObjectID from 'Common/Types/ObjectID';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import LogsViewer from 'CommonUI/src/Components/LogsViewer/LogsViewer';
import Log from 'Model/AnalyticsModels/Log';

export interface ComponentProps {
    telemetryServiceIds: Array<ObjectID>;
}

const LabelsElement: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {

    const [logs, setLogs] = React.useState<Array<Log>>([]);

    useEffect(() => {
        setLogs([]);
    }, []);

    return (
        <div>
           <LogsViewer logs={logs} />
        </div>
    );
};

export default LabelsElement;
