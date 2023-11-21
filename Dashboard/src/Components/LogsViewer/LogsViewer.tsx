import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import LogsViewer from 'CommonUI/src/Components/LogsViewer/LogsViewer';
import Log from 'Model/AnalyticsModels/Log';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import AnalyticsModelAPI, {
    ListResult,
} from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import ComponentLoader from 'CommonUI/src/Components/ComponentLoader/ComponentLoader';
import API from 'CommonUI/src/Utils/API/API';
import ObjectID from 'Common/Types/ObjectID';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import Realtime from 'CommonUI/src/Utils/Realtime';
import { ModelEventType } from 'Common/Utils/Realtime';
import ProjectUtil from 'CommonUI/src/Utils/Project';

export interface ComponentProps {
    id: string;
    telemetryServiceIds: Array<ObjectID>;
}

const DashboardLogsViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [logs, setLogs] = React.useState<Array<Log>>([]);
    const [error, setError] = React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const fetchItems: Function = async () => {
        setError('');
        setIsLoading(true);

        try {
            const listResult: ListResult<Log> =
                await AnalyticsModelAPI.getList<Log>(
                    Log,
                    {
                        serviceId: props.telemetryServiceIds[0],
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        body: true,
                        time: true,
                        projectId: true,
                        serviceId: true,
                        spanId: true,
                        traceId: true,
                        severityText: true,
                    },
                    {
                        time: SortOrder.Descending,
                    },
                    {}
                );

            // reverse the logs so that the newest logs are at the bottom
            listResult.data.reverse();

            setLogs(listResult.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        fetchItems().catch((err: unknown) => {
            setError(API.getFriendlyMessage(err));
        });

        const disconnectFunction: () => void =
            Realtime.listenToAnalyticsModelEvent(
                {
                    modelType: Log,
                    query: {},
                    eventType: ModelEventType.Create,
                    tenantId: ProjectUtil.getCurrentProjectId()!,
                    select: {
                        body: true,
                        time: true,
                        projectId: true,
                        serviceId: true,
                        spanId: true,
                        traceId: true,
                        severityText: true,
                    },
                },
                (model: Log) => {
                    setLogs((logs: Array<Log>) => {
                        return [...logs, model];
                    });
                }
            );

        return () => {
            disconnectFunction();
        };
    }, []);

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (isLoading) {
        return <ComponentLoader />;
    }

    return (
        <div id={props.id}>
            <LogsViewer onFilterChanged={() => {}} logs={logs} />
        </div>
    );
};

export default DashboardLogsViewer;
