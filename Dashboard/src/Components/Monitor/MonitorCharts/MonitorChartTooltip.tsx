import React, { FunctionComponent, ReactElement } from 'react';
import { LineChartPoint } from 'CommonUI/src/Components/Charts/Line/LineChart';

export interface ComponentProps {
    points: Array<LineChartPoint>;
    xLegend: string;
    yLegend: string;
}

const MonitorChartTooltip: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            {props.points.map((point: LineChartPoint, index: number) => {
                return (<div key={index}>
                    <div className="flex">
                        <div className="w-1/2 text-left">{props.yLegend}</div>
                        <div className="w-1/2 text-right">
                            {point.y.toString()}
                        </div>
                    </div>
                    <div className="flex">
                        <div className="w-1/2 text-left">{props.xLegend}</div>
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
