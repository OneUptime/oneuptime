import React, { FunctionComponent, ReactElement, useState } from 'react';
import RowLabel from './RowLabel';
import Bar, { GanttChartBar } from '../Bar/Index';
import Icon from '../../Icon/Icon';
import IconProp from 'Common/Types/Icon/IconProp';

export interface GanttChartRow {
    rowInfo: {
        id: string;
        title: string | ReactElement;
        description: string | ReactElement;
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
    level: number;
}

const Row: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { row } = props;

    let { level } = props;

    if (!level) {
        level = 0;
    }

    const hasChildRows: boolean = row.childRows.length > 0;

    const shouldShowChildRows: boolean = level < 2;

    const [showChildRows, setShowChildRows] = useState(shouldShowChildRows);

    const paddingCount: number = level * 4;

    return (
        // rectangle div with curved corners and text inside in tailwindcss
        <div>
            <div
                className={`flex w-full border-b-2 border-gray-200  border-l-2 border-l-gray-400 border-r-2 border-r-gray-400`}
            >
                <div className="flex w-1/4 border-r-2 border-gray-300">
                    <div className={`pl-${paddingCount} pt-2 pb-2 pr-2 flex`}>
                        <div className="w-5 h-5 ml-3 mt-1">
                            {hasChildRows && (
                                <Icon
                                    icon={
                                        showChildRows
                                            ? IconProp.ChevronDown
                                            : IconProp.ChevronRight
                                    }
                                    className="cursor-pointer h-4 w-4 text-gray-500 hover:text-gray-800 font-semibold"
                                    onClick={() => {
                                        return setShowChildRows(!showChildRows);
                                    }}
                                />
                            )}
                        </div>
                        <RowLabel
                            title={row.rowInfo.title}
                            description={row.rowInfo.description}
                        />
                    </div>
                </div>
                <div className="flex w-3/4">
                    {row.bars.map((bar: GanttChartBar, i: number) => {
                        return (
                            <Bar
                                key={i}
                                bar={bar}
                                chartTimelineEnd={props.chartTimelineEnd}
                                chartTimelineStart={props.chartTimelineStart}
                                timelineWidth={props.timelineWidth}
                                areOtherBarsSelected={
                                    props.selectedBarIds.length > 0
                                }
                                onSelect={(barId: string) => {
                                    // check if the bar is already selected
                                    if (props.selectedBarIds.includes(barId)) {
                                        return;
                                    }

                                    props.onBarSelectChange([
                                        ...props.selectedBarIds,
                                        barId,
                                    ]);
                                }}
                                onDeselect={(barId: string) => {
                                    // check if the bar is already selected
                                    if (!props.selectedBarIds.includes(barId)) {
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
            {showChildRows && (
                <div>
                    {row.childRows.map((childRow: GanttChartRow, i: number) => {
                        return (
                            <div key={i}>
                                <Row
                                    level={level + 1}
                                    row={childRow}
                                    chartTimelineEnd={props.chartTimelineEnd}
                                    chartTimelineStart={
                                        props.chartTimelineStart
                                    }
                                    timelineWidth={props.timelineWidth}
                                    selectedBarIds={props.selectedBarIds}
                                    onBarSelectChange={props.onBarSelectChange}
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Row;
