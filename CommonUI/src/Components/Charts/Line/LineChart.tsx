import React, { FunctionComponent, ReactElement } from 'react';
import { Point, ResponsiveLine } from '@nivo/line';
import { Indigo500 } from 'Common/Types/BrandColors';
import { CartesianMarkerProps } from '@nivo/core';

export type XValue = string | number | Date;
export type YValue = number;

export interface LineChartDataItem {
    x: XValue;
    y: YValue;
}

export enum ChartCurve {
    LINEAR = 'linear',
    MONOTONE_X = 'monotoneX',
    STEP = 'step',
    STEP_BEFORE = 'stepBefore',
    STEP_AFTER = 'stepAfter',
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

export type XScaleMaxMin = 'auto' | number | Date;
export type YScaleMaxMin = 'auto' | number;

export interface XScale {
    type: XScaleType;
    min: XScaleMaxMin;
    max: XScaleMaxMin;
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
    min: YScaleMaxMin;
    max: YScaleMaxMin;
}

export interface AxisBottom {
    legend: string;
    format: (value: XValue) => string;
}

export interface AxisLeft {
    legend: string;
}

export interface ComponentProps {
    data: Array<LineChartData>;
    curve?: ChartCurve;
    xScale: XScale;
    yScale: YScale;
    axisBottom: AxisBottom;
    axisLeft: AxisLeft;
    onHoverXAxis?: (x: XValue) => void;
    xAxisMarker?: {
        value: XValue | undefined;
    };
    getHoverTooltip?: (data: { points: readonly Point[] }) => ReactElement;
}

const LineChart: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const markers: Array<CartesianMarkerProps> = [];

    if (props.xAxisMarker && props.xAxisMarker.value) {
        markers.push({
            axis: 'x',
            legend: '',
            lineStyle: {
                stroke: '#cbd5e1',
                strokeWidth: 2,
            },
            value: props.xAxisMarker.value,
        });
    }

    return (
        <div className="h-96 w-full">
            <ResponsiveLine
                data={props.data}
                onMouseMove={(data: Point) => {
                    if (props.onHoverXAxis) {
                        const xValue: XValue = (
                            (data as any).points as Array<any>
                        )?.[0]?.data?.x;
                        props.onHoverXAxis(xValue);
                    }
                }}
                margin={{ bottom: 60, left: 60, top: 20 }}
                curve={props.curve || ChartCurve.LINEAR}
                markers={markers}
                xScale={{
                    type: props.xScale.type,
                    max: props.xScale.max as any,
                    min: props.xScale.min as any,
                    precision: props.xScale.precision,
                }}
                yScale={{
                    type: props.yScale.type,
                    min: props.yScale.min,
                    max: props.yScale.max,
                }}
                xFormat={props.axisBottom.format}
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
                sliceTooltip={(data: {
                    slice: {
                        points: readonly Point[];
                    };
                }) => {
                    if (!props.getHoverTooltip) {
                        return <></>;
                    }

                    return props.getHoverTooltip({ points: data.slice.points });
                }}
                colors={[Indigo500.toString()]} // Set the line color to purple
            />
        </div>
    );
};

export default LineChart;
