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

  const { onHoverPoint, points } = props;

  /*
   * Hover handling lives on the wrapper div (not the recharts chart)
   * because the AreaChart only fires its own onMouseMove when a Tooltip
   * child is mounted; the sparkline is intentionally Tooltip-less to
   * stay compact, so we map the cursor's x position to the closest
   * data point ourselves. Equivalent to recharts' default cursor
   * snapping on a uniform x-axis, which the sparkline uses.
   */
  const handleMouseMove: React.MouseEventHandler<HTMLDivElement> = useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!onHoverPoint || !points || points.length === 0) {
        return;
      }
      const rect: DOMRect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const ratio: number = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width),
      );
      const index: number = Math.min(
        points.length - 1,
        Math.max(0, Math.round(ratio * (points.length - 1))),
      );
      onHoverPoint(points[index] ?? null);
    },
    [onHoverPoint, points],
  );

  const handleMouseLeave: React.MouseEventHandler<HTMLDivElement> =
    useCallback((): void => {
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
    <div
      className={`${width} ${height} rounded-md`}
      onMouseMove={onHoverPoint ? handleMouseMove : undefined}
      onMouseLeave={onHoverPoint ? handleMouseLeave : undefined}
    >
      <SparkAreaChart
        data={props.points as unknown as Array<Record<string, unknown>>}
        categories={["value"]}
        index="time"
        colors={["indigo"]}
        fill="gradient"
        className="h-full w-full"
      />
    </div>
  );
};

export default MetricSparkline;
