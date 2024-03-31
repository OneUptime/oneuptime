import React from 'react';
import { CheckOn } from 'Common/Types/Monitor/CriteriaFilter';
import {
    Chart,
    ChartType,
} from 'CommonUI/src/Components/Charts/ChartGroup/ChartGroup';
import {
    AxisBottom,
    AxisLeft,
    AxisType,
    ChartCurve,
    LineChartDataItem,
    LineChartPoint,
    XScale,
    XScalePrecision,
    XScaleType,
    YScale,
    YScaleType,
} from 'CommonUI/src/Components/Charts/Line/LineChart';
import MonitorMetricsByMinute from 'Model/AnalyticsModels/MonitorMetricsByMinute';
import MonitorChartTooltip from './MonitorChartTooltip';
import { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Text from 'Common/Types/Text';

export class MonitorCharts {
    public static getDataForCharts(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
        checkOn: CheckOn;
        miscData: JSONObject | undefined;
    }): Array<LineChartDataItem> {
        return data.monitorMetricsByMinute
            .filter((item: MonitorMetricsByMinute) => {
                return (
                    item.metricType === data.checkOn &&
                    JSONFunctions.isEqualObject(item.miscData, data.miscData)
                );
            })
            .map((item: MonitorMetricsByMinute) => {
                return {
                    x: item.createdAt!,
                    y: item.metricValue!,
                };
            });
    }

    public static getDistinctMiscDataFromMonitorMetricsByMinute(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
        checkOn: CheckOn;
    }): Array<JSONObject | undefined> {
        const miscData: Array<JSONObject | undefined> =
            data.monitorMetricsByMinute
                .filter((item: MonitorMetricsByMinute) => {
                    return item.metricType === data.checkOn;
                })
                .map((item: MonitorMetricsByMinute) => {
                    return item.miscData || undefined;
                });

        return miscData.filter(
            (
                value: JSONObject | undefined,
                index: number,
                self: Array<JSONObject | undefined>
            ) => {
                return (
                    self.findIndex((t: JSONObject | undefined) => {
                        return JSONFunctions.isEqualObject(t, value);
                    }) === index
                );
            }
        );
    }

    public static getChartProps(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
        checkOn: CheckOn;
        miscData: JSONObject | undefined;
    }): Chart {
        const { monitorMetricsByMinute, checkOn } = data;

        const axisBottom: AxisBottom = MonitorCharts.getAxisBottomFor();

        const axisLeft: AxisLeft = MonitorCharts.getAxisLeftFor({
            checkOn: checkOn,
        });

        return {
            id: `chart-${Text.generateRandomNumber()}`,
            type: ChartType.LINE,
            title: MonitorCharts.getChartTitle({
                checkOn: checkOn,
                miscData: data.miscData,
            }),
            description: MonitorCharts.getChartDescription({
                checkOn: checkOn,
            }),
            props: {
                data: [
                    {
                        id: `line-${Text.generateRandomNumber()}`,
                        data: MonitorCharts.getDataForCharts({
                            monitorMetricsByMinute,
                            checkOn: checkOn,
                            miscData: data.miscData,
                        }),
                    },
                ],
                xScale: MonitorCharts.getXScaleFor({
                    monitorMetricsByMinute,
                }),
                yScale: MonitorCharts.getYScaleFor({
                    checkOn: checkOn,
                }),
                axisBottom: axisBottom,
                curve: MonitorCharts.getCurveFor({ checkOn: checkOn }),
                axisLeft: axisLeft,
                getHoverTooltip: (data: { points: Array<LineChartPoint> }) => {
                    return (
                        <MonitorChartTooltip
                            axisBottom={{
                                ...axisBottom,
                                legend: MonitorCharts.getAxisBottomLegend(),
                            }}
                            axisLeft={{
                                ...axisLeft,
                                legend: MonitorCharts.getAxisLeftLegend({
                                    checkOn,
                                }),
                            }}
                            points={data.points}
                        />
                    );
                },
            },
            sync: true,
        };
    }

    public static getMonitorCharts(data: {
        monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
        checkOns: Array<CheckOn>;
    }): Array<Chart> {
        const { monitorMetricsByMinute, checkOns } = data;

        const charts: Array<Chart> = [];

        for (const checkOn of checkOns) {
            const distinctMiscData: Array<JSONObject | undefined> =
                MonitorCharts.getDistinctMiscDataFromMonitorMetricsByMinute({
                    monitorMetricsByMinute,
                    checkOn,
                });

            if (distinctMiscData.length > 0) {
                for (const miscData of distinctMiscData) {
                    charts.push(
                        MonitorCharts.getChartProps({
                            monitorMetricsByMinute,
                            checkOn,
                            miscData,
                        })
                    );
                }
            } else {
                charts.push(
                    MonitorCharts.getChartProps({
                        monitorMetricsByMinute,
                        checkOn,
                        miscData: undefined,
                    })
                );
            }
        }

        return charts;
    }

    private static getAxisBottomLegend(): string {
        return 'Time';
    }

    public static getAxisLeftLegend(data: { checkOn: CheckOn }): string {
        return data.checkOn;
    }

    private static getAxisBottomFor(): AxisBottom {
        return {
            legend: '',
            type: AxisType.Time,
        };
    }

    private static getAxisLeftFor(data: { checkOn: CheckOn }): AxisLeft {
        return {
            legend: data.checkOn,
            type: AxisType.Number,
        };
    }

    private static getCurveFor(data: { checkOn: CheckOn }): ChartCurve {
        if (data.checkOn === CheckOn.ResponseStatusCode) {
            return ChartCurve.STEP_AFTER;
        }

        return ChartCurve.LINEAR;
    }

    public static getChartTitle(data: {
        checkOn: CheckOn;
        miscData: JSONObject | undefined;
    }): string {
        if (data.checkOn === CheckOn.DiskUsagePercent) {
            return (
                'Disk Usage (in %)' +
                (data.miscData ? ` for ${data.miscData['diskPath']}` : '')
            );
        }

        return data.checkOn;
    }

    public static getChartDescription(data: { checkOn: CheckOn }): string {
        if (data.checkOn === CheckOn.ResponseTime) {
            return 'Response Time in ms for this monitor.';
        } else if (data.checkOn === CheckOn.ResponseStatusCode) {
            return 'Response Status Code for this monitor.';
        } else if (data.checkOn === CheckOn.DiskUsagePercent) {
            return 'Disk Usage in % for this server.';
        } else if (data.checkOn === CheckOn.MemoryUsagePercent) {
            return 'Memory Usage in % for this server.';
        } else if (data.checkOn === CheckOn.CPUUsagePercent) {
            return 'CPU Usage in % for this server.';
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
        } else if (
            data.checkOn === CheckOn.DiskUsagePercent ||
            data.checkOn === CheckOn.MemoryUsagePercent ||
            data.checkOn === CheckOn.CPUUsagePercent
        ) {
            return {
                type: YScaleType.LINEAR,
                min: 0,
                max: 100,
            };
        }

        return {
            type: YScaleType.LINEAR,
            min: 'auto',
            max: 'auto',
        };
    }
}
