import { AreaChart } from "../ChartLibrary/AreaChart/AreaChart";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import DataPointUtil from "../Utils/DataPoint";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  curve: ChartCurve;
  sync: boolean;
  heightInPx?: number | undefined;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
}

export interface AreaInternalProps extends ComponentProps {
  syncid: string;
}

const AreaChartElement: FunctionComponent<AreaInternalProps> = (
  props: AreaInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);

  const categories: Array<string> = props.data.map((item: SeriesPoint) => {
    return item.seriesName;
  });

  useEffect(() => {
    if (!props.data || props.data.length === 0) {
      setRecords([]);
      return;
    }

    const records: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: props.data,
      xAxis: props.xAxis,
      yAxis: props.yAxis,
    });

    setRecords(records);
  }, [props.data]);

  const className: string = props.heightInPx ? `` : "h-80";
  const style: React.CSSProperties = props.heightInPx
    ? { height: `${props.heightInPx}px` }
    : {};

  const hasNoData: boolean =
    !props.data ||
    props.data.length === 0 ||
    props.data.every((series: SeriesPoint) => {
      return series.data.length === 0;
    });

  if (hasNoData) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={style}
      >
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    );
  }

  return (
    <AreaChart
      className={className}
      style={style}
      data={records}
      tickGap={1}
      index={"Time"}
      categories={categories}
      colors={[
        "blue",
        "emerald",
        "violet",
        "amber",
        "cyan",
        "pink",
        "lime",
        "fuchsia",
        "indigo",
        "rose",
      ]}
      valueFormatter={props.yAxis.options.formatter || undefined}
      showTooltip={true}
      connectNulls={true}
      curve={props.curve || ChartCurve.MONOTONE}
      syncid={props.sync ? props.syncid : undefined}
      yAxisWidth={60}
      onValueChange={() => {}}
      referenceLines={props.referenceLines}
    />
  );
};

export default AreaChartElement;
