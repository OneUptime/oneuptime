import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../../PageComponentProps';
import GanttChart, {
    GanttChartProps,
} from 'CommonUI/src/Components/GanttChart/Index';
import Card from 'CommonUI/src/Components/Card/Card';
import ObjectID from 'Common/Types/ObjectID';
import Navigation from 'CommonUI/src/Utils/Navigation';
import ListResult from 'CommonUI/src/Utils/BaseDatabase/ListResult';
import Span from 'Model/AnalyticsModels/Span';
import ModelAPI from 'CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import API from 'CommonUI/src/Utils/API/API';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import SpanUtil from '../../../../../../Utils/SpanUtil';
import OneUptimeDate from 'Common/Types/Date';
import Color from 'Common/Types/Color';
import DashboardLogsViewer from '../../../../../../Components/LogsViewer/LogsViewer';

const TraceView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [selectedSpans, setSelectedSpans] = React.useState<string[]>([]);

    const oneuptimeSpanId: ObjectID = Navigation.getLastParamAsObjectID(0);
    const telemetryServiceId: ObjectID = Navigation.getLastParamAsObjectID(2);

    const [error, setError] = React.useState<string | null>(null);

    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const [spans, setSpans] = React.useState<Span[]>([]);

    const [traceId, setTraceId] = React.useState<string | null>(null);

    const [ganttChart, setGanttChart] = React.useState<GanttChartProps | null>(
        null
    );

    const fetchItems: Function = async (): Promise<void> => {
        try {
            setIsLoading(true);

            // get trace with this id and then get all the parentSpanId with this traceid.

            const parentSpan: Span | null = await ModelAPI.getItem<Span>({
                id: oneuptimeSpanId,
                modelType: Span,
                select: {
                    startTime: true,
                    endTime: true,
                    startTimeUnixNano: true,
                    endTimeUnixNano: true,
                    name: true,
                    traceId: true,
                    parentSpanId: true,
                    spanId: true,
                    kind: true,
                },
            });

            if (parentSpan === null) {
                setError('Span not found');
                setIsLoading(false);
                return;
            }

            // now get all the spans with the traceId

            const traceId: string = parentSpan.traceId!;

            setTraceId(traceId);

            const childSpans: ListResult<Span> = await ModelAPI.getList<Span>({
                modelType: Span,
                select: {
                    startTime: true,
                    endTime: true,
                    startTimeUnixNano: true,
                    endTimeUnixNano: true,
                    name: true,
                    traceId: true,
                    parentSpanId: true,
                    spanId: true,
                    kind: true,
                },
                query: {
                    traceId: traceId,
                },
                sort: {
                    startTimeUnixNano: SortOrder.Ascending,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
            });

            let spans: Span[] = [parentSpan, ...childSpans.data];

            // filter by unique span id.

            spans = spans.filter((span: Span, index: number, self: Span[]) => {
                return (
                    index ===
                    self.findIndex((s: Span) => {
                        return s.spanId?.toString() === span.spanId?.toString();
                    })
                );
            });

            setSpans(spans);

            setIsLoading(false);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
    };

    const getBarTooltip: Function = (
        span: Span,
        divisibilityFactorAndIntervalUnit: {
            divisibilityFactor: number;
            intervalUnit: string;
        }
    ): ReactElement => {
        return (
            <div className="px-1">
                <div className="bar-tooltip-title text-sm text-gray-700 font-medium my-2">
                    {span.name}
                </div>
                <div className="bar-tooltip-description text-gray-600 text-xs space-y-1 my-2">
                    <div className="flex space-x-1">
                        <div>Start:</div>{' '}
                        <div>
                            {OneUptimeDate.getDateAsFormattedString(
                                span.startTime!
                            )}
                        </div>
                    </div>
                    <div className="flex space-x-1">
                        <div>End:</div>{' '}
                        <div>
                            {OneUptimeDate.getDateAsFormattedString(
                                span.endTime!
                            )}
                        </div>
                    </div>
                    <div className="flex space-x-1">
                        <div>Duration:</div>{' '}
                        <div>
                            {Math.round(
                                (span.endTimeUnixNano! -
                                    span.startTimeUnixNano!) /
                                    divisibilityFactorAndIntervalUnit.divisibilityFactor
                            )}{' '}
                            {divisibilityFactorAndIntervalUnit.intervalUnit}
                        </div>
                    </div>
                    <div className="flex space-x-1">
                        <div>Span Kind:</div>{' '}
                        <div>
                            {SpanUtil.getSpanKindFriendlyName(span.kind!)}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    React.useEffect(() => {
        fetchItems().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
        });
    }, []);

    const getDivisibilityFactor: Function = (
        totalTimelineTimeInUnixNano: number
    ): {
        divisibilityFactor: number;
        intervalUnit: string;
    } => {
        let intervalUnit: string = 'ms';
        let divisibilityFactor: number = 1000; // default is in milliseconds

        if (totalTimelineTimeInUnixNano < 1000) {
            intervalUnit = 'ns';
            divisibilityFactor = 1; // this is in nanoseconds
        } else if (totalTimelineTimeInUnixNano < 1000000) {
            intervalUnit = 'μs';
            divisibilityFactor = 1000; // this is in microseconds
        } else if (totalTimelineTimeInUnixNano < 1000000000) {
            intervalUnit = 'ms';
            divisibilityFactor = 1000000; // this is in microseconds
        } else if (totalTimelineTimeInUnixNano < 1000000000000) {
            intervalUnit = 's';
            divisibilityFactor = 1000000000; // this is in seconds
        }

        return {
            divisibilityFactor: divisibilityFactor,
            intervalUnit: intervalUnit,
        };
    };

    React.useEffect(() => {
        // convert spans to gantt chart

        if (spans.length === 0) {
            return;
        }

        let timelineStartTimeUnixNano: number = spans[0]!.startTimeUnixNano!;

        let timelineEndTimeUnixNano: number =
            spans[spans.length - 1]!.endTimeUnixNano!;

        for (const span of spans) {
            if (span.startTimeUnixNano! < timelineStartTimeUnixNano) {
                timelineStartTimeUnixNano = span.startTimeUnixNano!;
            }

            if (span.endTimeUnixNano! > timelineEndTimeUnixNano) {
                timelineEndTimeUnixNano = span.endTimeUnixNano!;
            }
        }

        const startTimeline: number = 0;

        const divisibilityFactorAndIntervalUnit: {
            divisibilityFactor: number;
            intervalUnit: string;
        } = getDivisibilityFactor(
            timelineEndTimeUnixNano - timelineStartTimeUnixNano
        );

        const divisibilityFactor: number =
            divisibilityFactorAndIntervalUnit.divisibilityFactor;

        const endTimeline: number =
            (timelineEndTimeUnixNano - timelineStartTimeUnixNano) /
            divisibilityFactor; // divide by 1000 to convert from nanoseconds to ms

        const intervalTemp: number = Math.round(endTimeline / 100) * 10;

        const numberOfDigitsInIntervalTemp: number =
            intervalTemp.toString().length;

        const interval: number = Math.pow(10, numberOfDigitsInIntervalTemp);

        const ganttChart: GanttChartProps = {
            id: 'chart',
            rows: spans.map((span: Span) => {
                return {
                    id: span.spanId!,
                    title: span.name!,
                    description: span.spanId!,
                };
            }),
            onBarSelectChange(barIds: Array<string>) {
                setSelectedSpans(barIds);
            },
            bars: spans.map((span: Span) => {
                const spanColor: {
                    barColor: Color;
                    titleColor: Color;
                } = SpanUtil.getGanttChartBarColor(span);

                return {
                    id: span.spanId!,
                    title: span.name!,
                    titleColor: spanColor.titleColor,
                    barColor: spanColor.barColor,
                    barTimelineStart:
                        (span.startTimeUnixNano! - timelineStartTimeUnixNano) /
                        divisibilityFactor,
                    barTimelineEnd:
                        (span.endTimeUnixNano! - timelineStartTimeUnixNano) /
                        divisibilityFactor,
                    rowId: span.spanId!,
                    tooltip: getBarTooltip(
                        span,
                        divisibilityFactorAndIntervalUnit
                    ),
                };
            }),
            timeline: {
                start: startTimeline,
                end: Math.ceil(endTimeline / interval) * interval,
                interval: interval,
                intervalUnit: divisibilityFactorAndIntervalUnit.intervalUnit,
            },
        };

        setGanttChart(ganttChart);
    }, [spans]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Fragment>
            <Card
                title={'Traces'}
                description={'Traces for the request operation.'}
            >
                <div className="overflow-x-auto">
                    {ganttChart ? (
                        <GanttChart chart={ganttChart} />
                    ) : (
                        <ErrorMessage error={'No spans found'} />
                    )}
                </div>
            </Card>

            {traceId && (
                <DashboardLogsViewer
                    id={'traces-logs-viewer'}
                    noLogsMessage="No logs found for this trace."
                    telemetryServiceIds={[telemetryServiceId]}
                    traceIds={[traceId]}
                    spanIds={selectedSpans}
                    enableRealtime={false}
                />
            )}
        </Fragment>
    );
};

export default TraceView;
