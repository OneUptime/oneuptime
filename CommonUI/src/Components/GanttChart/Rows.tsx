import React, { FunctionComponent, ReactElement } from 'react';
import Row, { GanttChartRow } from './Row/Index';


export interface ComponentProps {
    rows: Array<GanttChartRow>;
    chartTimelineStart: number;
    chartTimelineEnd: number;
    timelineWidth: number;
    selectedBarIds: string[];
    onBarSelectChange: (barIds: string[]) => void;
}

const Rows: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {


    const getRow = (data: {
        row: GanttChartRow;
    }) => {

        const { row } = data;

        return (
            <Row
                chartTimelineStart={props.chartTimelineStart}
                chartTimelineEnd={props.chartTimelineEnd}
                timelineWidth={props.timelineWidth}
                row={row}
                selectedBarIds={props.selectedBarIds}
                onBarSelectChange={props.onBarSelectChange}
            />
        );
    }

    return (
        <div className="w-full border-b-2 border-gray-400">
            {props.rows.map((row: GanttChartRow, i: number) => {

                return (<div key={i}>
                    {getRow({
                        row: row
                    })}
                </div>)

            })}
        </div>
    );
};

export default Rows;
