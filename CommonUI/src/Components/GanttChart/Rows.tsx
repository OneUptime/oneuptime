import React, { FunctionComponent, ReactElement } from 'react';
import Row from './Row/Index';
import { GanttChartRow } from './Row/Row';

export interface ComponentProps {
    rows: Array<GanttChartRow>;
    chartTimelineStart: number;
    chartTimelineEnd: number;
    timelineWidth: number;
    selectedBarIds: string[];
    onBarSelectChange: (barIds: string[]) => void;
    multiSelect?: boolean | undefined;
}

const Rows: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    type GetRowFunction = (data: { row: GanttChartRow }) => ReactElement;

    const getRow: GetRowFunction = (data: {
        row: GanttChartRow;
    }): ReactElement => {
        const { row } = data;

        return (
            <Row
                chartTimelineStart={props.chartTimelineStart}
                chartTimelineEnd={props.chartTimelineEnd}
                timelineWidth={props.timelineWidth}
                row={row}
                multiSelect={props.multiSelect}
                selectedBarIds={props.selectedBarIds}
                onBarSelectChange={props.onBarSelectChange}
            />
        );
    };

    return (
        <div className="w-full border-b-2 border-gray-400">
            {props.rows.map((row: GanttChartRow, i: number) => {
                return (
                    <div key={i}>
                        {getRow({
                            row: row,
                        })}
                    </div>
                );
            })}
        </div>
    );
};

export default Rows;
