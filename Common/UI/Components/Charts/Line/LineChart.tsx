import { LineChart } from "../ChartLibrary/LineChart/LineChart";
import React, { FunctionComponent, ReactElement, useEffect, useMemo } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import ChartDataPoint from "../ChartLibrary/Types/ChartDataPoint";
import FormattedExemplarPoint from "../ChartLibrary/Types/FormattedExemplarPoint";
import DataPointUtil from "../Utils/DataPoint";
import ChartReferenceLineProps from "../Types/ReferenceLineProps";
import ExemplarPoint from "../Types/ExemplarPoint";
import XAxisUtil from "../Utils/XAxis";
import NoDataMessage from "../ChartGroup/NoDataMessage";

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  curve: ChartCurve;
  sync: boolean;
  heightInPx?: number | undefined;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
  exemplarPoints?: Array<ExemplarPoint> | undefined;
  onExemplarClick?: ((exemplar: ExemplarPoint) => void) | undefined;
}

export interface LineInternalProps extends ComponentProps {
  syncid: string;
}

const LineChartElement: FunctionComponent<LineInternalProps> = (
  props: LineInternalProps,
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

  // Format exemplar x values to match the chart's x-axis labels
  const formattedExemplars: Array<FormattedExemplarPoint> = useMemo(() => {
    if (!props.exemplarPoints || props.exemplarPoints.length === 0) {
      return [];
    }

    const formatter: (value: Date) => string = XAxisUtil.getFormatter({
      xAxisMax: props.xAxis.options.max,
      xAxisMin: props.xAxis.options.min,
    });

    return props.exemplarPoints.map((exemplar: ExemplarPoint) => {
      return {
        formattedX: formatter(exemplar.x),
        y: exemplar.y,
        original: exemplar,
      };
    });
  }, [props.exemplarPoints, props.xAxis]);

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
      <LineChart
        className={className}
        style={style}
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
        syncid={props.sync ? props.syncid : undefined}
        yAxisWidth={60}
        onValueChange={() => {}}
        referenceLines={props.referenceLines}
        formattedExemplarPoints={
          formattedExemplars.length > 0 ? formattedExemplars : undefined
        }
        onExemplarClick={props.onExemplarClick}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default LineChartElement;
