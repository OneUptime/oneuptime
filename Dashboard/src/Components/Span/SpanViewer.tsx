import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import LogsViewer from 'CommonUI/src/Components/LogsViewer/LogsViewer';
import Log from 'Model/AnalyticsModels/Log';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import AnalyticsModelAPI, {
    ListResult,
} from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import ProjectUtil from 'CommonUI/src/Utils/Project';
import Select from 'CommonUI/src/Utils/BaseDatabase/Select';
import { PromiseVoidFunction } from 'Common/Types/FunctionTypes';
import Span from 'Model/AnalyticsModels/Span';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import Tabs from 'CommonUI/src/Components/Tabs/Tabs';
import { GetReactElementFunction } from 'CommonUI/src/Types/FunctionTypes';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import TelemetryService from 'Model/Models/TelemetryService';
import TelemetryServiceElement from '../TelemetryService/TelemetryServiceElement';
import SpanUtil, { DivisibilityFactor } from '../../Utils/SpanUtil';

export interface ComponentProps {
    id: string;
    openTelemetrySpanId: string;
    traceStartTimeInUnixNano: number;
    onClose: () => void;
    telemetryService: TelemetryService;
    divisibilityFactor: DivisibilityFactor;
}

const SpanViewer: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [logs, setLogs] = React.useState<Array<Log>>([]);
    const [error, setError] = React.useState<string>('');
    const [isLoading, setIsLoading] = React.useState<boolean>(false);
    const [span, setSpan] = React.useState<Span | null>(null);

    const { telemetryService, onClose } = props;

    const selectLog: Select<Log> = {
        body: true,
        time: true,
        projectId: true,
        serviceId: true,
        spanId: true,
        traceId: true,
        severityText: true,
        attributes: true,
    };

    const selectSpan: Select<Span> = {
        projectId: true,
        serviceId: true,
        spanId: true,
        traceId: true,
        events: true,
        startTime: true,
        endTime: true,
        startTimeUnixNano: true,
        endTimeUnixNano: true,
        attributes: true,
        durationUnixNano: true,
    };

    useEffect(() => {
        fetchItems().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
        });
    }, []);

    const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            const listResult: ListResult<Log> =
                await AnalyticsModelAPI.getList<Log>({
                    modelType: Log,
                    query: {
                        spanId: props.openTelemetrySpanId,
                        projectId: ProjectUtil.getCurrentProjectId()!,
                    },
                    limit: LIMIT_PER_PROJECT,
                    skip: 0,
                    select: selectLog,
                    sort: {
                        time: SortOrder.Descending,
                    },
                    requestOptions: {},
                });

            // reverse the logs so that the newest logs are at the bottom
            listResult.data.reverse();

            setLogs(listResult.data);

            const spanResult: ListResult<Span> =
                await AnalyticsModelAPI.getList<Span>({
                    modelType: Span,
                    query: {
                        spanId: props.openTelemetrySpanId,
                        projectId: ProjectUtil.getCurrentProjectId()!,
                    },
                    select: selectSpan,
                    limit: 1,
                    skip: 0,
                    sort: {},
                    requestOptions: {},
                });

            if (spanResult.data.length > 0) {
                setSpan(spanResult.data[0] || null);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    const getLogsContentElement: GetReactElementFunction = (): ReactElement => {
        return (
            <LogsViewer
                isLoading={isLoading}
                onFilterChanged={() => {}}
                logs={logs}
                showFilters={false}
                noLogsMessage={'No logs found for this span.'}
            />
        );
    };

    const getAttributesContentElement: GetReactElementFunction =
        (): ReactElement => {
            return <></>;
        };

    const getEventsContentElement: GetReactElementFunction =
        (): ReactElement => {
            return <></>;
        };

    const getErrorsContentElement: GetReactElementFunction =
        (): ReactElement => {
            return <></>;
        };

    const getBasicInfo: GetReactElementFunction = (): ReactElement => {
        if (!span) {
            return <></>;
        }

        return (
            <Detail<Span>
                item={span}
                fields={[
                    {
                        key: 'spanId',
                        title: 'Span ID',
                        description: 'The unique identifier of the span.',
                        fieldType: FieldType.Text,
                        opts: {
                            isCopyable: true,
                        },
                    },
                    {
                        key: 'traceId',
                        title: 'Trace ID',
                        description: 'The unique identifier of the trace.',
                        fieldType: FieldType.Text,
                        opts: {
                            isCopyable: true,
                        },
                    },
                    {
                        key: 'serviceId',
                        title: 'Telemetry Service',
                        description: 'The unique identifier of the service.',
                        fieldType: FieldType.Element,
                        getElement: () => {
                            return (
                                <TelemetryServiceElement
                                    telemetryService={telemetryService}
                                    onNavigateComplete={() => {
                                        onClose();
                                    }}
                                />
                            );
                        },
                    },
                    {
                        key: 'startTime',
                        title: 'Start Time',
                        description: 'The time the span started.',
                        fieldType: FieldType.DateTime,
                    },
                    {
                        key: 'endTime',
                        title: 'End Time',
                        description: 'The time the span ended.',
                        fieldType: FieldType.DateTime,
                    },
                    {
                        key: 'startTimeUnixNano',
                        title: 'Starts At',
                        description: 'When did this span start in this trace?',
                        fieldType: FieldType.Element,
                        getElement: (span: Span) => {
                            return (
                                <div>
                                    {SpanUtil.getSpanStartsAtAsString({
                                        timelineStartTimeUnixNano:
                                            props.traceStartTimeInUnixNano,
                                        divisibilityFactor:
                                            props.divisibilityFactor,
                                        spanStartTimeUnixNano:
                                            span.startTimeUnixNano!,
                                    })}
                                </div>
                            );
                        },
                    },
                    {
                        key: 'endTimeUnixNano',
                        title: 'Ends At',
                        description: 'When did this span end in this trace?',
                        fieldType: FieldType.Element,
                        getElement: (span: Span) => {
                            return (
                                <div>
                                    {SpanUtil.getSpanEndsAtAsString({
                                        timelineStartTimeUnixNano:
                                            props.traceStartTimeInUnixNano,
                                        divisibilityFactor:
                                            props.divisibilityFactor,
                                        spanEndTimeUnixNano:
                                            span.endTimeUnixNano!,
                                    })}
                                </div>
                            );
                        },
                    },
                    {
                        key: 'durationUnixNano',
                        title: 'Duration',
                        description: 'The duration of the span.',
                        fieldType: FieldType.Element,
                        getElement: (span: Span) => {
                            return (
                                <div>
                                    {SpanUtil.getSpanDurationAsString({
                                        divisibilityFactor:
                                            props.divisibilityFactor,
                                        spanDurationInUnixNano:
                                            span.durationUnixNano!,
                                    })}
                                </div>
                            );
                        },
                    },
                    {
                        key: 'kind',
                        title: 'Span Kind',
                        description: 'The kind of span.',
                        fieldType: FieldType.Text,
                    },
                ]}
            />
        );
    };

    return (
        <div id={props.id}>
            <Tabs
                tabs={[
                    {
                        name: 'Basic Info',
                        children: getBasicInfo(),
                    },
                    {
                        name: 'Logs',
                        children: getLogsContentElement(),
                    },
                    {
                        name: 'Attributes',
                        children: getAttributesContentElement(),
                    },
                    {
                        name: 'Events',
                        children: getEventsContentElement(),
                    },
                    {
                        name: 'Errors',
                        children: getErrorsContentElement(),
                    },
                ]}
                onTabChange={() => {}}
            />

            {span && <></>}
        </div>
    );
};

export default SpanViewer;
