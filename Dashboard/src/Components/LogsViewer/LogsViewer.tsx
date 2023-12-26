import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import LogsViewer from 'CommonUI/src/Components/LogsViewer/LogsViewer';
import Log from 'Model/AnalyticsModels/Log';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import AnalyticsModelAPI, {
    ListResult,
} from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import ObjectID from 'Common/Types/ObjectID';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import Realtime from 'CommonUI/src/Utils/Realtime';
import { ModelEventType } from 'Common/Utils/Realtime';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import { FilterOption } from 'CommonUI/src/Components/LogsViewer/LogsFilters';
import Query from 'CommonUI/src/Utils/AnalyticsModelAPI/Query';
import Search from 'Common/Types/BaseDatabase/Search';
import InBetween from 'Common/Types/BaseDatabase/InBetween';

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
    const [filterOptions, setFilterOptions] = React.useState<FilterOption>({});

    useEffect(() => {
        fetchItems().catch((err: unknown) => {
            setError(API.getFriendlyMessage(err));
        });
    }, [filterOptions]);

    const fetchItems: Function = async () => {
        setError('');
        setIsLoading(true);

        const query: Query<Log> = {
            serviceId: props.telemetryServiceIds[0],
        };

        if (filterOptions.searchText) {
            query.body = new Search(filterOptions.searchText);
        }

        if (filterOptions.endTime && filterOptions.startTime) {
            query.createdAt = new InBetween(
                filterOptions.startTime,
                filterOptions.endTime
            );
        }

        if (filterOptions.logSeverity) {
            query.severityText = filterOptions.logSeverity;
        }

        try {
            const listResult: ListResult<Log> =
                await AnalyticsModelAPI.getList<Log>(
                    Log,
                    query,
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

    return (
        <div id={props.id}>
            <LogsViewer
                isLoading={isLoading}
                onFilterChanged={(filterOptions: FilterOption) => {
                    setFilterOptions(filterOptions);
                }}
                logs={logs}
            />
        </div>
    );
};

export default DashboardLogsViewer;
