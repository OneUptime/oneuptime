import React, { FunctionComponent, ReactElement } from 'react';
import RowLabel from './RowLabel';
import Bar, { GanttChartBar } from '../Bar/Index';

export interface GanttChartRow {
    id: string;
    title: string;
    description: string;
}

export interface ComponentProps {
    row: GanttChartRow;
    bars: GanttChartBar[];
    isLastRow: boolean;
    chartTimelineStart: number;
    chartTimelineEnd: number;
    timelineWidth: number;
}

const Row: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        // rectangle div with curved corners and text inside in tailwindcss

        <div
            className={`flex w-full ${
                props.isLastRow ? '' : 'border-b-2'
            } border-gray-200  border-l-2 border-l-gray-400 border-r-2 border-r-gray-400`}
        >
            <div className="w-1/4 p-2 border-r-2 border-gray-300">
                <RowLabel
                    title={props.row.title}
                    description={props.row.description}
                />
            </div>
            <div className="flex">
                {props.bars.map((bar: GanttChartBar) => {
                    return (
                        <Bar
                            key={bar.id}
                            bar={bar}
                            chartTimelineEnd={props.chartTimelineEnd}
                            chartTimelineStart={props.chartTimelineStart}
                            timelineWidth={props.timelineWidth}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default Row;
