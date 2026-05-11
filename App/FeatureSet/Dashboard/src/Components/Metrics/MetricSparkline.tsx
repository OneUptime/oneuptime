import React, { FunctionComponent, ReactElement, useCallback } from "react";
import { SparkAreaChart } from "Common/UI/Components/Charts/ChartLibrary/SparkChart/SparkChart";

export interface SparklinePoint {
  time: string;
  value: number;
}

export interface MetricSparklineProps {
  points: Array<SparklinePoint>;
  isLoading?: boolean | undefined;
  widthClassName?: string | undefined;
  heightClassName?: string | undefined;
  /*
   * Fires while the cursor moves over the chart with the data point
   * under the cursor; fires with `null` when the cursor leaves. Lets
   * the row swap the displayed lastValue for the hovered point's value
   * and revert on mouse-out.
   */
  onHoverPoint?: ((point: SparklinePoint | null) => void) | undefined;
}

const MetricSparkline: FunctionComponent<MetricSparklineProps> = (
  props: MetricSparklineProps,
): ReactElement => {
  const width: string = props.widthClassName || "w-40";
  const height: string = props.heightClassName || "h-10";

  const { onHoverPoint } = props;

  const handleChartMouseMove: (state: any) => void = useCallback(
    (state: any): void => {
      if (!onHoverPoint) {
        return;
      }
      const payload: unknown = state?.activePayload?.[0]?.payload;
      if (!payload || typeof payload !== "object") {
        onHoverPoint(null);
        return;
      }
      const record: Record<string, unknown> = payload as Record<
        string,
        unknown
      >;
      const time: unknown = record["time"];
      const value: unknown = record["value"];
      if (typeof time !== "string" || typeof value !== "number") {
        onHoverPoint(null);
        return;
      }
      onHoverPoint({ time, value });
    },
    [onHoverPoint],
  );

  const handleChartMouseLeave: () => void = useCallback((): void => {
    if (onHoverPoint) {
      onHoverPoint(null);
    }
  }, [onHoverPoint]);

  if (props.isLoading) {
    return (
      <div
        className={`${width} ${height} animate-pulse rounded-md bg-gray-100`}
      />
    );
  }

  if (!props.points || props.points.length < 2) {
    return (
      <div
        className={`${width} ${height} flex items-center justify-center rounded-md border border-dashed border-gray-200 text-[10px] text-gray-300`}
      >
        no data
      </div>
    );
  }

  return (
    <div className={`${width} ${height} rounded-md`}>
      <SparkAreaChart
        data={props.points as unknown as Array<Record<string, unknown>>}
        categories={["value"]}
        index="time"
        colors={["indigo"]}
        fill="gradient"
        className="h-full w-full"
        onChartMouseMove={onHoverPoint ? handleChartMouseMove : undefined}
        onChartMouseLeave={onHoverPoint ? handleChartMouseLeave : undefined}
      />
    </div>
  );
};

export default MetricSparkline;
