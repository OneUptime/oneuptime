import { AreaChart } from "../ChartLibrary/AreaChart/AreaChart";
import { AvailableChartColorsKeys } from "../ChartLibrary/Utils/ChartColors";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
} from "react";
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

export const AreaChartPalette: Array<AvailableChartColorsKeys> = [
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
];

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
  showLegend?: boolean | undefined;
  /**
   * Render a shaded "expected range" band underneath the plotted lines.
   * The caller passes two series in `data` carrying the lower and upper
   * bounds; both must share the same x-axis as the data series. Their
   * seriesNames are passed here so the renderer can promote them to a
   * band fill and exclude them from the regular line categories.
   */
  anomalyBandLowerSeriesName?: string | undefined;
  anomalyBandUpperSeriesName?: string | undefined;
}

export interface AreaInternalProps extends ComponentProps {
  syncid: string;
}

const AreaChartElement: FunctionComponent<AreaInternalProps> = (
  props: AreaInternalProps,
): ReactElement => {
  const [records, setRecords] = React.useState<Array<ChartDataPoint>>([]);

  const bandLower: string | undefined = props.anomalyBandLowerSeriesName;
  const bandUpper: string | undefined = props.anomalyBandUpperSeriesName;

  /*
   * The band's lower/upper series share the data array but should not
   * be drawn as standalone lines in the legend — recharts renders them
   * as the shaded fill instead.
   */
  const categories: Array<string> = props.data
    .map((item: SeriesPoint) => {
      return item.seriesName;
    })
    .filter((name: string) => {
      return name !== bandLower && name !== bandUpper;
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

  const hasNoData: boolean =
    !props.data ||
    props.data.length === 0 ||
    props.data.every((series: SeriesPoint) => {
      return series.data.length === 0;
    });

  /*
   * Translate yAxis.options.min/max into recharts inputs. "auto" maps to
   * autoMinValue=true (or maxValue omitted) so recharts zooms to the
   * data range instead of pinning the floor at 0.
   */
  const yAxisMinOption: number | "auto" = props.yAxis.options.min;
  const yAxisMaxOption: number | "auto" = props.yAxis.options.max;
  const autoMinValue: boolean = yAxisMinOption === "auto";
  const minValueProp: { minValue: number } | Record<string, never> =
    typeof yAxisMinOption === "number" ? { minValue: yAxisMinOption } : {};
  const maxValueProp: { maxValue: number } | Record<string, never> =
    typeof yAxisMaxOption === "number" ? { maxValue: yAxisMaxOption } : {};

  return (
    <div
      className="relative flex flex-1"
      style={props.heightInPx ? { height: `${props.heightInPx}px` } : undefined}
    >
      <AreaChart
        data={records}
        tickGap={1}
        index={"Time"}
        categories={categories}
        colors={AreaChartPalette}
        valueFormatter={props.yAxis.options.formatter || undefined}
        showTooltip={true}
        showLegend={props.showLegend !== false}
        connectNulls={true}
        curve={props.curve || ChartCurve.MONOTONE}
        syncid={props.sync ? props.syncid : undefined}
        yAxisWidth={64}
        autoMinValue={autoMinValue}
        {...minValueProp}
        {...maxValueProp}
        onValueChange={() => {}}
        referenceLines={props.referenceLines}
        formattedExemplarPoints={
          formattedExemplars.length > 0 ? formattedExemplars : undefined
        }
        onExemplarClick={props.onExemplarClick}
        anomalyBandLowerKey={bandLower}
        anomalyBandUpperKey={bandUpper}
      />
      {hasNoData && <NoDataMessage />}
    </div>
  );
};

export default AreaChartElement;
