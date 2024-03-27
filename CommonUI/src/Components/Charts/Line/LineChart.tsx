import React, { FunctionComponent, ReactElement } from "react";
import { ResponsiveLine } from "@nivo/line";
import OneUptimeDate from "Common/Types/Date";
import { Indigo500 } from "Common/Types/BrandColors";

export interface LineChartDataItem { 
    x: string | number | Date;
    y: number;
}

export enum ChartCurve {
    LINEAR = "linear",
    MONOTONE_X = "monotoneX",
    STEP = "step",
    STEP_BEFORE = "stepBefore",
    STEP_AFTER = "stepAfter",
}

export enum XScaleType { 
    TIME = 'time',
}

export enum XScalePrecision {
    SECOND = 'second',
    MINUTE = 'minute',
    HOUR = 'hour',
    DAY = 'day',
    MONTH = 'month',
    YEAR = 'year',

}

export interface XScale { 
    type: XScaleType;
    min: string | Date;
    max: string | Date;
    precision: XScalePrecision;
}

export interface LineChartData { 
    id: string;
    data: Array<LineChartDataItem>;
}

export enum YScaleType {
    LINEAR = 'linear',
}

export interface YScale {
    type: YScaleType;
    min: 'auto' | number;
    max: 'auto' | number;
}

export interface AxisBottom {
    legend: string;
}

export interface AxisLeft {
    legend: string;
}

export interface ComponentProps {
    data: LineChartData;
    curve?: ChartCurve;
    xScale: XScale;
    yScale: YScale;
    axisBottom: AxisBottom;
    axisLeft: AxisLeft;
}

const LineChart: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const data = [
        {
            id: "Response Time",
            data: [
                { x: OneUptimeDate.getCurrentDate(), y: 10 },
                { x: OneUptimeDate.getSomeMinutesAfter(1), y: 15 },
                { x: OneUptimeDate.getSomeMinutesAfter(2), y: 12 },
                { x: OneUptimeDate.getSomeMinutesAfter(4), y: 8 },
                { x: OneUptimeDate.getSomeMinutesAfter(5), y: 11 },
            ],
        }
    ];


    return (
        <div className="h-96 w-full">

            <ResponsiveLine
                data={data}
                onMouseEnter={(data) => console.log(data)}
                onMouseLeave={(data) => console.log(data)}
                margin={{ bottom: 30, left: 30 }}
                curve={props.curve || ChartCurve.LINEAR}
                markers={[
                    {
                      axis: 'x',
                      legend: 'x marker',
                      lineStyle: {
                        stroke: '#b0413e',
                        strokeWidth: 2
                      },
                      value: OneUptimeDate.getSomeMinutesAfter(2)
                    }
                  ]}
                xScale={{
                    type: props.xScale.type,
                    max: props.xScale.max,
                    min: props.xScale.min,
                    precision: props.xScale.precision,
                }}
                yScale={{
                    type: props.yScale.type,
                    min: props.yScale.min,
                    max: props.yScale.max,
                }}
                xFormat="time:%Y-%m-%d %H:%M:%S"
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    legend: props.axisBottom.legend,
                }}
                useMesh={true}
                axisLeft={{
                    legend: props.axisLeft.legend,
                }}
                enableSlices="x"
                sliceTooltip={({ slice }) => (
                    <div
                        style={{
                            background: 'white',
                            padding: '9px 12px',
                            border: '1px solid #ccc',
                        }}
                    >
                        {slice.points.map((point) => (
                            <div
                                key={point.id}
                                style={{
                                    color: Indigo500.toString(), // Set the line color to purple
                                    padding: '3px 0',
                                }}
                            >
                                {point.serieId} [{point.data.xFormatted},{' '}
                                {point.data.yFormatted}]
                            </div>
                        ))}
                    </div>
                )}
                colors={[Indigo500.toString()]} // Set the line color to purple
            />

        </div>
    );
};

export default LineChart;