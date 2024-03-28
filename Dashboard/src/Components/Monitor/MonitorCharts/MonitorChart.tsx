
import React from 'react';
import OneUptimeDate from 'Common/Types/Date';
import { CheckOn } from 'Common/Types/Monitor/CriteriaFilter';
import {
    Chart,
    ChartType,
} from 'CommonUI/src/Components/Charts/ChartGroup/ChartGroup';
import {
    ChartCurve,
    LineChartPoint,
    XScale,
    XScalePrecision,
    XScaleType,
    XValue,
    YScale,
    YScaleType,
} from 'CommonUI/src/Components/Charts/Line/LineChart';
import MonitorMetricsByMinute from 'Model/AnalyticsModels/MonitorMetricsByMinute';
import MonitorChartTooltip from './MonitorChartTooltip';

export class MonitorCharts {
    public static getMonitorCharts(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
        checkOns: Array<CheckOn>;
    }): Array<Chart> {
        const { monitorMetricsByMinute, checkOns } = data;

        const charts: Array<Chart> = checkOns.map(
            (checkOn: CheckOn, index: number) => {
                return {
                    id: `chart-${index}`,
                    type: ChartType.LINE,
                    title: MonitorCharts.getChartTitle({ checkOn: checkOn }),
                    description: MonitorCharts.getChartDescription({
                        checkOn: checkOn,
                    }),
                    props: {
                        data: [
                            {
                                id: `line-${index}`,
                                data: monitorMetricsByMinute
                                    .filter((item: MonitorMetricsByMinute) => {
                                        return item.metricType === checkOn;
                                    })
                                    .map((item: MonitorMetricsByMinute) => {
                                        return {
                                            x: item.createdAt!,
                                            y: item.metricValue!,
                                        };
                                    }),
                            },
                        ],
                        xScale: MonitorCharts.getXScaleFor({
                            monitorMetricsByMinute,
                        }),
                        yScale: MonitorCharts.getYScaleFor({
                            checkOn: checkOn,
                        }),
                        axisBottom: {
                            legend: '',
                            format: (value: XValue): string => {
                                return OneUptimeDate.getLocalHourAndMinuteFromDate(
                                    value as Date
                                );
                            },
                        },
                        curve: MonitorCharts.getCurveFor({ checkOn: checkOn }),
                        axisLeft: {
                            legend: '',
                        },
                        getHoverTooltip: (data: { points: Array<LineChartPoint> }) => {
                            return <MonitorChartTooltip xLegend='Time' yLegend={checkOn} points={data.points}  />;
                        }
                    },
                    sync: true,
                };
            }
        );

        return charts;
    }

    private static getCurveFor(data: { checkOn: CheckOn }): ChartCurve {
        if (data.checkOn === CheckOn.ResponseStatusCode) {
            return ChartCurve.STEP_AFTER;
        }

        return ChartCurve.LINEAR;
    }

    public static getChartTitle(data: { checkOn: CheckOn }): string {
        return data.checkOn;
    }

    public static getChartDescription(data: { checkOn: CheckOn }): string {
        if (data.checkOn === CheckOn.ResponseTime) {
            return 'Response Time in ms for this monitor';
        } else if (data.checkOn === CheckOn.ResponseStatusCode) {
            return 'Response Status Code for this monitor';
        }
        return '';
    }

    public static getXScaleFor(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    }): XScale {
        const startTime: Date | undefined =
            data.monitorMetricsByMinute[0]?.createdAt || undefined;
        const endTime: Date | undefined =
            data.monitorMetricsByMinute[data.monitorMetricsByMinute.length - 1]
                ?.createdAt || undefined;

        return {
            type: XScaleType.TIME,
            min: startTime || 'auto',
            max: endTime || 'auto',
            precision: XScalePrecision.MINUTE,
        };
    }

    public static getYScaleFor(data: { checkOn: CheckOn }): YScale {
        if (data.checkOn === CheckOn.ResponseTime) {
            return {
                type: YScaleType.LINEAR,
                min: 0,
                max: 10000,
            };
        } else if (data.checkOn === CheckOn.ResponseStatusCode) {
            return {
                type: YScaleType.LINEAR,
                min: 0,
                max: 600,
            };
        }

        return {
            type: YScaleType.LINEAR,
            min: 'auto',
            max: 'auto',
        };
    }
}
