import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../../PageComponentProps';
import GanttChart, {
    GanttChartProps,
} from 'CommonUI/src/Components/GanttChart/Index';
import Card from 'CommonUI/src/Components/Card/Card';
import { Black, White } from 'Common/Types/BrandColors';
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
import OneUptimeDate from 'Common/Types/Date';

const TraceView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

    const [error, setError] = React.useState<string | null>(null);

    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const [spans, setSpans] = React.useState<Span[]>([]);

    const [ganttChart, setGanttChart] = React.useState<GanttChartProps | null>(
        null
    );

    const fetchItems: Function = async (): Promise<void> => {
        try {
            setIsLoading(true);

            // get trace with this id and then get all the parentSpanId with this traceid.

            const parentSpan: Span | null = await ModelAPI.getItem<Span>({
                id: modelId,
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
                },
            });

            if (parentSpan === null) {
                setError('Span not found');
                setIsLoading(false);
                return;
            }

            // now get all the spans with the traceId

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
                },
                query: {
                    traceId: parentSpan?.traceId,
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

    React.useEffect(() => {
        fetchItems().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
        });
    }, []);

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

        const divisibilityFactor: number = 1000; // 1000 to convert from nanoseconds to ms
        const intervalUnit: string = 'ms';

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
            bars: spans.map((span: Span) => {
                return {
                    id: span.spanId!,
                    title: span.name!,
                    titleColor: White!,
                    barColor: Black!,
                    barTimelineStart:
                        (span.startTimeUnixNano! - timelineStartTimeUnixNano) /
                        divisibilityFactor,
                    barTimelineEnd:
                        (span.endTimeUnixNano! - timelineStartTimeUnixNano) /
                        divisibilityFactor,
                    rowId: span.spanId!,
                    tooltip: getBarTooltip(span, divisibilityFactor),
                };
            }),
            timeline: {
                start: startTimeline,
                end: endTimeline,
                interval: interval,
                intervalUnit: intervalUnit,
            },
        };

        setGanttChart(ganttChart);
    }, [spans]);

    const getBarTooltip: Function = (
        span: Span,
        divisibilityFactor: number
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
                                    divisibilityFactor
                            )}{' '}
                            ms
                        </div>
                    </div>
                </div>
            </div>
        );
    };

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
        </Fragment>
    );
};

export default TraceView;
