import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import Text from "Common/Types/Text";
import {
  Chart,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";

import MonitorMetricsByMinute, {
  MonitorMetricsMiscData,
} from "Common/Models/AnalyticsModels/MonitorMetricsByMinute";
import Probe from "Common/Models/DatabaseModels/Probe";
import DataPoint from "Common/UI/Components/Charts/Types/DataPoint";
import SeriesPoints from "Common/UI/Components/Charts/Types/SeriesPoints";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import OneUptimeDate from "Common/Types/Date";

export class MonitorCharts {
  public static getDataForCharts(data: {
    monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    checkOn: CheckOn;
    miscData: MonitorMetricsMiscData | undefined;
  }): Array<DataPoint> {
    return data.monitorMetricsByMinute
      .filter((item: MonitorMetricsByMinute) => {
        return (
          item.metricType === data.checkOn &&
          JSONFunctions.isEqualObject(
            item.miscData as JSONObject,
            data.miscData as JSONObject,
          )
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
  }): Array<MonitorMetricsMiscData> {
    const miscData: Array<MonitorMetricsMiscData | undefined> =
      data.monitorMetricsByMinute
        .filter((item: MonitorMetricsByMinute) => {
          return item.metricType === data.checkOn;
        })
        .map((item: MonitorMetricsByMinute) => {
          return item.miscData || undefined;
        });

    return miscData
      .filter(
        (
          value: MonitorMetricsMiscData | undefined,
          index: number,
          self: Array<MonitorMetricsMiscData | undefined>,
        ) => {
          return (
            self.findIndex((t: MonitorMetricsMiscData | undefined) => {
              return JSONFunctions.isEqualObject(
                t as JSONObject,
                value as JSONObject,
              );
            }) === index
          );
        },
      )
      .filter((item: MonitorMetricsMiscData | undefined) => {
        return Boolean(item);
      }) as Array<MonitorMetricsMiscData>;
  }

  public static getSeriesName(data: {
    checkOn: CheckOn;
    miscData: MonitorMetricsMiscData | undefined;
    probes: Array<Probe>;
  }): string {
    if (data.miscData) {
      if (data.miscData.diskPath) {
        return data.miscData.diskPath;
      }

      if (data.miscData.probeId) {
        const probe: Probe | undefined = data.probes.find((probe: Probe) => {
          return probe._id?.toString() === data.miscData?.probeId?.toString();
        });

        if (probe) {
          return probe.name || "Probe";
        }
      }
    }

    return data.checkOn;
  }

  public static getChartData(data: {
    monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    checkOn: CheckOn;
    miscData: MonitorMetricsMiscData | undefined;
    probes?: Array<Probe>;
  }): SeriesPoints {
    const { monitorMetricsByMinute, checkOn } = data;

    return {
      seriesName: this.getSeriesName({
        checkOn: checkOn,
        miscData: data.miscData,
        probes: data.probes || [],
      }),
      data: MonitorCharts.getDataForCharts({
        monitorMetricsByMinute,
        checkOn: checkOn,
        miscData: data.miscData,
      }),
    };
  }

  public static getChartProps(data: {
    monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    checkOn: CheckOn;
    miscData: Array<MonitorMetricsMiscData> | undefined;
    probes: Array<Probe>;
  }): Chart {
    const { monitorMetricsByMinute, checkOn } = data;

    const chartData: Array<SeriesPoints> = [];

    if (!data.miscData) {
      chartData.push(
        MonitorCharts.getChartData({
          monitorMetricsByMinute,
          checkOn,
          miscData: undefined,
        }),
      );
    }

    for (const miscData of data.miscData || []) {
      chartData.push(
        MonitorCharts.getChartData({
          monitorMetricsByMinute,
          checkOn,
          miscData: miscData,
          probes: data.probes,
        }),
      );
    }

    return {
      id: `chart-${Text.generateRandomNumber()}`,
      type: ChartType.LINE,
      title: MonitorCharts.getChartTitle({
        checkOn: checkOn,
      }),
      description: MonitorCharts.getChartDescription({
        checkOn: checkOn,
      }),
      props: {
        data: chartData,
        xAxis: MonitorCharts.getXAxisFor({
          monitorMetricsByMinute,
          checkOn: checkOn,
        }),
        yAxis: MonitorCharts.getYAxisFor({
          checkOn: checkOn,
        }),
        curve: MonitorCharts.getCurveFor({ checkOn: checkOn }),
        sync: true,
      },
    };
  }

  public static getMonitorCharts(data: {
    monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    checkOns: Array<CheckOn>;
    probes: Array<Probe>;
  }): Array<Chart> {
    const { monitorMetricsByMinute, checkOns } = data;

    const charts: Array<Chart> = [];

    for (const checkOn of checkOns) {
      const distinctMiscData: Array<MonitorMetricsMiscData> =
        MonitorCharts.getDistinctMiscDataFromMonitorMetricsByMinute({
          monitorMetricsByMinute,
          checkOn,
        }).filter((item: MonitorMetricsMiscData | undefined) => {
          return Boolean(item);
        });

      if (distinctMiscData.length > 0) {
        charts.push(
          MonitorCharts.getChartProps({
            monitorMetricsByMinute,
            checkOn,
            miscData: distinctMiscData,
            probes: data.probes,
          }),
        );
      } else {
        charts.push(
          MonitorCharts.getChartProps({
            monitorMetricsByMinute,
            checkOn,
            miscData: undefined,
            probes: data.probes,
          }),
        );
      }
    }

    return charts;
  }

  private static getCurveFor(data: { checkOn: CheckOn }): ChartCurve {
    if (data.checkOn === CheckOn.ResponseStatusCode) {
      return ChartCurve.STEP;
    }

    return ChartCurve.LINEAR;
  }

  public static getChartTitle(data: { checkOn: CheckOn }): string {
    if (data.checkOn === CheckOn.IsOnline) {
      return "Monitor Status (Online/Offline)";
    }

    return data.checkOn;
  }

  public static getChartDescription(data: { checkOn: CheckOn }): string {
    if (data.checkOn === CheckOn.ResponseTime) {
      return "Response Time in ms for this monitor.";
    } else if (data.checkOn === CheckOn.ResponseStatusCode) {
      return "Response Status Code for this monitor.";
    } else if (data.checkOn === CheckOn.DiskUsagePercent) {
      return "Disk Usage in % for this server.";
    } else if (data.checkOn === CheckOn.MemoryUsagePercent) {
      return "Memory Usage in % for this server.";
    } else if (data.checkOn === CheckOn.CPUUsagePercent) {
      return "CPU Usage in % for this server.";
    } else if (data.checkOn === CheckOn.IsOnline) {
      return "Online or Offline Monitor Status. 1 is Online, 0 is Offline.";
    }

    return "";
  }

  public static getXAxisFor(data: {
    monitorMetricsByMinute: Array<MonitorMetricsByMinute>;
    checkOn: CheckOn;
  }): XAxis {
    let startTime: Date | undefined =
      data.monitorMetricsByMinute[0]?.createdAt || undefined;
    let endTime : Date | undefined =
      data.monitorMetricsByMinute[data.monitorMetricsByMinute.length - 1]?.createdAt || undefined;

    let xAxisAggregationType: XAxisAggregateType = XAxisAggregateType.Average;

    if (data.checkOn === CheckOn.ResponseStatusCode) {
      xAxisAggregationType = XAxisAggregateType.Max;
    }

    if (data.checkOn === CheckOn.IsOnline) {
      xAxisAggregationType = XAxisAggregateType.Min;
    }

    if (data.checkOn === CheckOn.ResponseTime) {
      xAxisAggregationType = XAxisAggregateType.Average;
    }

    if (
      data.checkOn === CheckOn.DiskUsagePercent ||
      data.checkOn === CheckOn.MemoryUsagePercent ||
      data.checkOn === CheckOn.CPUUsagePercent
    ) {
      xAxisAggregationType = XAxisAggregateType.Average;
    }


    if(!startTime || !endTime) {
      startTime = OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);  
      endTime = OneUptimeDate.getCurrentDate();
    }

    return {
      legend: "Time",
      options: {
        type: XAxisType.Time,
        aggregateType: xAxisAggregationType,
        min: startTime,
        max: endTime,
      },
    };
  }

  public static getYAxisFor(data: { checkOn: CheckOn }): YAxis {
    if (data.checkOn === CheckOn.ResponseTime) {
      return {
        legend: "Response Time (in ms)",
        options: {
          type: YAxisType.Number,
          min: 0,
          max: "auto",
          precision: YAxisPrecision.NoDecimals,
          formatter: (value: number) => {
            return `${value} ms`;
          },
        },
      };
    } else if (data.checkOn === CheckOn.ResponseStatusCode) {
      return {
        legend: "Response Code",
        options: {
          type: YAxisType.Number,
          min: 0,
          max: 600,
          precision: YAxisPrecision.NoDecimals,
          formatter: (value: number) => {
            return `${value}`;
          },
        },
      };
    } else if (
      data.checkOn === CheckOn.DiskUsagePercent ||
      data.checkOn === CheckOn.MemoryUsagePercent ||
      data.checkOn === CheckOn.CPUUsagePercent
    ) {
      return {
        legend: data.checkOn,
        options: {
          type: YAxisType.Number,
          min: 0,
          max: 100,
          precision: YAxisPrecision.TwoDecimals,
          formatter: (value: number) => {
            return `${value}%`;
          },
        },
      };
    }

    return {
      legend: data.checkOn,
      options: {
        type: YAxisType.Number,
        min: "auto",
        max: "auto",
        precision: YAxisPrecision.NoDecimals,
        formatter: (value: number) => {
          return `${value}`;
        },
      },
    };
  }
}
