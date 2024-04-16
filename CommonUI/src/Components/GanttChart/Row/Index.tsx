import React, { FunctionComponent, ReactElement } from 'react';
import Row, { GanttChartRow } from './Row';

export interface ComponentProps {
    row: GanttChartRow;
    chartTimelineStart: number;
    chartTimelineEnd: number;
    timelineWidth: number;
    selectedBarIds: string[];
    onBarSelectChange: (barIds: string[]) => void;
    children?: ReactElement;
}

const RowIndex: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <Row {...props} level={0} />;
};

export default RowIndex;
