import { Box, CartesianMarkerProps } from '@nivo/core';
import { LegendProps } from '@nivo/legends';
import { Point, ResponsiveLine } from '@nivo/line';
import { BrightColors } from 'Common/Types/BrandColors';
import Color from 'Common/Types/Color';
import OneUptimeDate from 'Common/Types/Date';
import React, { FunctionComponent, ReactElement } from 'react';

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
    seriesName: string;
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

export enum AxisType {
    Date = 'date',
    Time = 'time',
    Number = 'number',
}

export interface AxisBottom {
    legend: string;
    type: AxisType;
}

export interface AxisLeft {
    legend: string;
    type: AxisType;
}

export interface LineChartPoint {
    x: XValue;
    y: YValue;
    seriesName: string;
    seriesColor: Color;
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
    getHoverTooltip?: (data: { points: Array<LineChartPoint> }) => ReactElement;
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

    let legends: Array<LegendProps> = [];

    const showLegends: boolean = props.data.length > 1;

    const margin: Box = { bottom: 60, left: 60, top: 20 };

    if (showLegends) {
        margin.right = 200;

        legends = [
            {
                anchor: 'bottom-right',
                direction: 'column',
                justify: false,
                translateX: 100,
                translateY: 0,
                itemsSpacing: 0,
                itemDirection: 'left-to-right',
                itemWidth: 80,
                itemHeight: 20,
                itemOpacity: 0.75,
                symbolSize: 12,
                symbolShape: 'circle',
                symbolBorderColor: 'rgba(0, 0, 0, .5)',
                effects: [
                    {
                        on: 'hover',
                        style: {
                            itemBackground: 'rgba(0, 0, 0, .03)',
                            itemOpacity: 1,
                        },
                    },
                ],
            },
        ];
    }

    return (
        <div className="h-96 w-full">
            <ResponsiveLine
                data={props.data.map((series: LineChartData) => {
                    return {
                        id: series.seriesName,
                        data: series.data,
                    };
                })}
                onMouseMove={(data: Point) => {
                    if (props.onHoverXAxis) {
                        const xValue: XValue = (
                            (data as any).points as Array<any>
                        )?.[0]?.data?.x;
                        props.onHoverXAxis(xValue);
                    }
                }}
                margin={margin}
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
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    legend: props.axisBottom.legend,
                    format: (value: XValue) => {
                        if (props.axisBottom.type === AxisType.Date) {
                            return OneUptimeDate.getDateAsLocalFormattedString(
                                value as Date
                            );
                        }

                        if (props.axisBottom.type === AxisType.Time) {
                            return OneUptimeDate.getLocalHourAndMinuteFromDate(
                                value as Date
                            );
                        }

                        return value.toString();
                    },
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

                    return props.getHoverTooltip({
                        points: data.slice.points.map((point: Point) => {
                            return {
                                x: point.data.x as XValue,
                                y: point.data.y as YValue,
                                seriesName: point.serieId.toString(),
                                seriesColor: new Color(point.color),
                            };
                        }),
                    });
                }}
                colors={BrightColors.map((item: Color) => {
                    return item.toString();
                })}
                legends={legends}
            />
        </div>
    );
};

export default LineChart;
