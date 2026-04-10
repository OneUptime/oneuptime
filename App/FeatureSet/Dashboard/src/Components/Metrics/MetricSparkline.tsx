import React, { FunctionComponent, ReactElement } from "react";
import { SparkAreaChart } from "Common/UI/Components/Charts/ChartLibrary/SparkChart/SparkChart";

export interface SparklinePoint {
  time: string;
  value: number;
}

export interface MetricSparklineProps {
  points: Array<SparklinePoint>;
  isLoading?: boolean | undefined;
  color?: string | undefined;
  widthClassName?: string | undefined;
  heightClassName?: string | undefined;
}

const MetricSparkline: FunctionComponent<MetricSparklineProps> = (
  props: MetricSparklineProps,
): ReactElement => {
  const width: string = props.widthClassName || "w-32";
  const height: string = props.heightClassName || "h-8";

  if (props.isLoading) {
    return (
      <div
        className={`${width} ${height} animate-pulse rounded bg-gray-100`}
      />
    );
  }

  if (!props.points || props.points.length < 2) {
    return (
      <div
        className={`${width} ${height} flex items-center justify-center text-[10px] text-gray-300`}
      >
        no data
      </div>
    );
  }

  return (
    <div className={`${width} ${height}`}>
      <SparkAreaChart
        data={props.points as unknown as Array<Record<string, unknown>>}
        categories={["value"]}
        index="time"
        colors={["blue"]}
        fill="gradient"
        className="h-full w-full"
      />
    </div>
  );
};

export default MetricSparkline;
