import { LineChart } from "../ChartLibrary/LineChart/LineChart";
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
}

const LineChartElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.sync) {
    return <></>;
  }

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

  return (
    <LineChart
      className="h-80"
      data={records}
      tickGap={1}
      index={"Time"}
      categories={categories}
      colors={[
        "indigo",
        "rose",
        "emerald",
        "amber",
        "cyan",
        "gray",
        "pink",
        "lime",
        "fuchsia",
      ]}
      valueFormatter={props.yAxis.options.formatter || undefined}
      showTooltip={true}
      connectNulls={true}
      curve={props.curve}
      yAxisWidth={60}
    />
  );
};

export default LineChartElement;
