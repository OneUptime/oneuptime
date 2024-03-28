import React, { FunctionComponent, ReactElement } from 'react';
import { AxisBottom, AxisLeft, LineChartPoint } from 'CommonUI/src/Components/Charts/Line/LineChart';

export interface ComponentProps {
    points: Array<LineChartPoint>;
    axisBottom: AxisBottom;
    axisLeft: AxisLeft;
}

const MonitorChartTooltip: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <div className='bg-white rounded-md shadow-md p-5 text-sm'>
            {props.points.map((point: LineChartPoint, index: number) => {
                return (<div key={index} className='space-y-2'>
                    <div className="flex">
                        <div className="w-1/2 text-left font-medium">{props.axisLeft.legend}</div>
                        <div className="w-1/2 text-right">
                            {point.y.toString()}
                        </div>
                    </div>
                    <div className="flex">
                        <div className="w-1/2 text-left font-medium">{props.axisBottom.legend}</div>
                        <div className="w-1/2 text-right">
                            {point.x.toString()}
                        </div>
                    </div>
                </div>)
            })}
        </div>
    );
};

export default MonitorChartTooltip;
