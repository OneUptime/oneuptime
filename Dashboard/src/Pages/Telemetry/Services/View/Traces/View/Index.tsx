import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../../PageComponentProps';
import GanttChart, { GanttChartProps } from 'CommonUI/src/Components/GanttChart/Index';
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

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {


    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [error, setError] = React.useState<string | null>(null);

    const [isLoading, setIsLoading] = React.useState<boolean>(false);

    const [spans, setSpans] = React.useState<Span[]>([]);

    const [ganttChart, setGanttChart] = React.useState<GanttChartProps | null>(null);

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
                }
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
                    traceId: parentSpan?.traceId
                },
                sort: {
                    startTimeUnixNano: SortOrder.Ascending
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,

            });

            const spans: Span[] = [parentSpan, ...childSpans.data];

            setSpans(spans);

            setIsLoading(false);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }
    }

    React.useEffect(() => {
        fetchItems().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
        });
    }, []);


    if(isLoading){
        return <PageLoader isVisible={true} />;
    }

    if(error){
        return <ErrorMessage error={error}/>;
    }

    React.useEffect(() => {
        // convert spans to gantt chart

        const ganttChart: GanttChartProps = {
            id: 'chart',
            rows: spans.map((span: Span) => {
                return {
                    id: span.spanId!,
                    title: span.name!,
                    description: span.spanId!,
                }
            }),
            bars: spans.map((span: Span) => {
                return {
                    id: span.spanId!,
                    title: span.name!,
                    titleColor: White!,
                    barColor: Black!,
                    barTimelineStart: span.startTimeUnixNano!,
                    barTimelineEnd: span.endTimeUnixNano!,
                    rowId: span.spanId!,
                }
            }),
            timeline: {
                start: spans[0] ? spans[0].startTimeUnixNano! : 0,
                end: spans && spans[spans.length - 1] ? spans[spans.length - 1]!.endTimeUnixNano! : 0,
                interval: 10,
                intervalUnit: 'ms',
            },
        };

        setGanttChart(ganttChart);
    }, [spans]);

    return (
        <Fragment>
            <Card
                title={'Traces'}
                description={'Traces for the request operation.'}
            >
                <div className="overflow-x-auto">
                    {ganttChart ? <GanttChart
                        chart={ganttChart}
                    /> : <ErrorMessage error={'No spans found'} />}
                </div>
            </Card>
        </Fragment>
    );
};

export default ServiceDelete;
