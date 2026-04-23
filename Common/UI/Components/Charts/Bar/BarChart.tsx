import { BarChart } from "../ChartLibrary/BarChart/BarChart";
import { AvailableChartColorsKeys } from "../ChartLibrary/Utils/ChartColors";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import DataPointUtil from "../Utils/DataPoint";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";
import NoDataMessage from "../ChartGroup/NoDataMessage";

export const BarChartPalette: Array<AvailableChartColorsKeys> = [
  "indigo",
  "rose",
  "emerald",
  "amber",
  "cyan",
  "gray",
  "pink",
  "lime",
  "fuchsia",
];

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  sync: boolean;
  heightInPx?: number | undefined;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
  showLegend?: boolean | undefined;
}

export interface BarInternalProps extends ComponentProps {
  syncid: string;
}

const BarChartElement: FunctionComponent<BarInternalProps> = (
  props: BarInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);

  const categories: Array<string> = props.data.map((item: SeriesPoint) => {
    return item.seriesName;
  });

  useEffect(() => {
    const records: Array<ChartDataPoint> = DataPointUtil.getChartDataPoints({
      seriesPoints: props.data || [],
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

  return (
    <div className="relative">
      <BarChart
        className={className}
        style={style}
        data={records}
        tickGap={1}
        index={"Time"}
        categories={categories}
        colors={BarChartPalette}
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        yAxisWidth={60}
        syncid={props.sync ? props.syncid : undefined}
        onValueChange={() => {}}
        referenceLines={props.referenceLines}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default BarChartElement;
