import React, { FunctionComponent, ReactElement } from 'react';
import Timeline from './Timeline/Timeline';


export interface GanttChartProps {
    id: string;
}

export interface ComponentProps {
    chart: GanttChartProps;
}

const GanttChart: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <div>
            <Timeline timeline={{
                start: 0,
                end: 100,
                interval: 10,
                intervalUnit: 'ms'
            }} />
        </div>
    );
};

export default GanttChart;
