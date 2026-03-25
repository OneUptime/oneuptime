import { AreaChart } from "../ChartLibrary/AreaChart/AreaChart";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import DataPointUtil from "../Utils/DataPoint";

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  curve: ChartCurve;
  sync: boolean;
  heightInPx?: number | undefined;
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
    />
  );
};

export default AreaChartElement;
