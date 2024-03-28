import React, { FunctionComponent, ReactElement } from 'react';
import { LineChartPoint } from 'CommonUI/src/Components/Charts/Line/LineChart';

export interface ComponentProps {
    point: LineChartPoint;
    xLegend: string;
    yLegend: string;
}

const MonitorChartTooltip: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <div className="flex">
                <div className="w-1/2 text-left">{props.yLegend}</div>
                <div className="w-1/2 text-right">
                    {props.point.y.toString()}
                </div>
            </div>
            <div className="flex">
                <div className="w-1/2 text-left">{props.xLegend}</div>
                <div className="w-1/2 text-right">
                    {props.point.x.toString()}
                </div>
            </div>
        </div>
    );
};

export default MonitorChartTooltip;
