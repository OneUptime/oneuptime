import React, { FunctionComponent, ReactElement, useState } from 'react';
import LineChart, { ComponentProps as LineChartProps } from '../Line/LineChart';

export enum ChartGroupInterval {
    ONE_HOUR = '1 hour',
}

export enum ChartType {
    LINE = 'line',
}

export interface Chart {
    id: string;
    type: ChartType; 
    props: LineChartProps;
    sync: boolean;
}

export interface ComponentProps {
    charts: Array<Chart>;
    interval: ChartGroupInterval;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const [syncValue, setSyncValue] = useState<number | string | Date | undefined>(undefined);

    return (
        <div>
            {props.charts.map((chart, index) => {
                switch (chart.type) {
                    case ChartType.LINE:
                        return <LineChart key={index} {...chart.props} xAxisMarker={{
                            value: chart.sync ? syncValue : undefined,
                        }} onHoverXAxis={(value: string | number | Date)=>{
                            if(chart.sync){
                                setSyncValue(value)
                            }
                        }} />;
                    default:
                        return <></>;
                }
            })}
        </div>
    );
};

export default ChartGroup;
