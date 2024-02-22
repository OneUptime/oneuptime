import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import Timeline, { GanttChartTimeline } from './Timeline/Index';
import { GanttChartRow } from './Row/Index';
import ChartContainer from './ChartContainer';
import { GanttChartBar } from './Bar/Index';
import Rows from './Rows';

export interface GanttChartProps {
    id: string;
    rows: GanttChartRow[];
    bars: GanttChartBar[];
    timeline: GanttChartTimeline;
    onBarSelectChange: (barIds: string[]) => void;
}

export interface ComponentProps {
    chart: GanttChartProps;
}

const GanttChart: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const eachIntervalDefaultWidth: number = 100; // in pixels

    const [selectedBarIds, setSelectedBarIds] = React.useState<string[]>([]);

    const [chartWidth, setChartWidth] = React.useState<number>(0);
    const [timelineWidth, setTimelineWidth] = React.useState<number>(2000);

    const [eachIntervalWidth, setEachIntervalWidth] = React.useState<number>(
        eachIntervalDefaultWidth
    );

    const numberOfInterval: number =
        (props.chart.timeline.end - props.chart.timeline.start) /
        props.chart.timeline.interval;

    const totalIntervalWidth: number =
        eachIntervalDefaultWidth * numberOfInterval;

    useEffect(() => {
        if (chartWidth < totalIntervalWidth) {
            setChartWidth(totalIntervalWidth);
        } else {
            setEachIntervalWidth(chartWidth / numberOfInterval);
        }

        setTimelineWidth(chartWidth * 0.75); // 75 % of chart width, 25% for category spacer
    }, [chartWidth]);

    return (
        <ChartContainer
            onWidthChange={(width: number) => {
                setChartWidth(width);
            }}
        >
            <div
                style={{
                    width: `${chartWidth}px`,
                }}
            >
                {/** Remve 25% because of category spacer */}
                <Timeline
                    timeline={props.chart.timeline}
                    eachIntervalWidth={
                        eachIntervalWidth - 0.25 * eachIntervalWidth
                    }
                />

                <Rows
                    timelineWidth={timelineWidth}
                    chartTimelineEnd={props.chart.timeline.end}
                    chartTimelineStart={props.chart.timeline.start}
                    rows={props.chart.rows}
                    bars={props.chart.bars}
                    selectedBarIds={selectedBarIds}
                    onBarSelectChange={(barIds: string[]) => {
                        setSelectedBarIds(barIds);
                        props.chart.onBarSelectChange(barIds);
                    }}
                />
            </div>
        </ChartContainer>
    );
};

export default GanttChart;
