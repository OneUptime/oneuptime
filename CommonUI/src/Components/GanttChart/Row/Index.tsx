import React, { FunctionComponent, ReactElement } from 'react';
import RowLabel from './RowLabel';
import Bar, { GanttChartBar } from '../Bar/Index';

export interface GanttChartRow {
    rowInfo: {
        id: string;
        title: string;
        description: string;
    };
    childRows: GanttChartRow[];
    bars: Array<GanttChartBar>; // usually will have only one bar, this is for future proofing
}

export interface ComponentProps {
    row: GanttChartRow;
    chartTimelineStart: number;
    chartTimelineEnd: number;
    timelineWidth: number;
    selectedBarIds: string[];
    onBarSelectChange: (barIds: string[]) => void;
    children?: ReactElement;
}

const Row: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getRow = (data: { row: GanttChartRow }) => {
        const { row } = data;

        return (
            // rectangle div with curved corners and text inside in tailwindcss
            <div>
                <div
                    className={`flex w-full border-b-2 border-gray-200  border-l-2 border-l-gray-400 border-r-2 border-r-gray-400`}
                >
                    <div className="w-1/4 p-2 border-r-2 border-gray-300">
                        <RowLabel
                            title={row.rowInfo.title}
                            description={row.rowInfo.description}
                        />
                    </div>
                    <div className="flex">
                        {row.bars.map((bar: GanttChartBar, i: number) => {
                            return (
                                <Bar
                                    key={i}
                                    bar={bar}
                                    chartTimelineEnd={props.chartTimelineEnd}
                                    chartTimelineStart={
                                        props.chartTimelineStart
                                    }
                                    timelineWidth={props.timelineWidth}
                                    areOtherBarsSelected={
                                        props.selectedBarIds.length > 0
                                    }
                                    onSelect={(barId: string) => {
                                        // check if the bar is already selected
                                        if (
                                            props.selectedBarIds.includes(barId)
                                        ) {
                                            return;
                                        }

                                        props.onBarSelectChange([
                                            ...props.selectedBarIds,
                                            barId,
                                        ]);
                                    }}
                                    onDeselect={(barId: string) => {
                                        // check if the bar is already selected
                                        if (
                                            !props.selectedBarIds.includes(
                                                barId
                                            )
                                        ) {
                                            return;
                                        }

                                        props.onBarSelectChange(
                                            props.selectedBarIds.filter(
                                                (id: string) => {
                                                    return id !== barId;
                                                }
                                            )
                                        );
                                    }}
                                />
                            );
                        })}
                    </div>
                </div>
                {row.childRows.map((childRow: GanttChartRow, i: number) => {
                    return (
                        <div key={i}>
                            {getRow({
                                row: childRow,
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    return getRow({ row: props.row });
};

export default Row;
