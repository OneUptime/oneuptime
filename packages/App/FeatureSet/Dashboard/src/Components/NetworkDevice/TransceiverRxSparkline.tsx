import {
  SparklineGeometry,
  getSparklineGeometry,
} from "./TransceiverViewModel";
import { TransceiverRxPowerTrendPoint } from "Common/Utils/NetworkDevice/TransceiverHealthUtil";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  points: Array<TransceiverRxPowerTrendPoint>;
  // The best daily average of the window, drawn as a dashed line.
  baselineDbm?: number | undefined;
  isDropping?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
  className?: string | undefined;
}

/*
 * A month of an optic's received power, one point a day: plain SVG, so it
 * draws the same in a table cell, in the details panel and in a test, with
 * no chart library behind it. The dashed line is the best day the "falling"
 * rule measures against; the line turns amber once the light has dropped
 * far enough below it to alert.
 */
const TransceiverRxSparkline: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const width: number = props.width ?? 96;
  const height: number = props.height ?? 24;

  if (props.points.length < 2) {
    return (
      <span
        className="text-xs text-gray-400"
        data-testid="transceiver-rx-sparkline-empty"
      >
        {translator.translateText("Trend after a second day")}
      </span>
    );
  }

  const geometry: SparklineGeometry = getSparklineGeometry({
    values: props.points.map((point: TransceiverRxPowerTrendPoint) => {
      return point.averageDbm;
    }),
    baseline: props.baselineDbm,
    width: width,
    height: height,
  });

  const first: TransceiverRxPowerTrendPoint = props.points[0]!;
  const last: TransceiverRxPowerTrendPoint =
    props.points[props.points.length - 1]!;

  const label: string = translator.translateTemplate(
    "Received power, daily average: {{first}} dBm on {{firstDay}}, {{last}} dBm on {{lastDay}}",
    {
      first: first.averageDbm.toFixed(2),
      firstDay: first.day,
      last: last.averageDbm.toFixed(2),
      lastDay: last.day,
    },
  );

  const lastPoint: { x: number; y: number } =
    geometry.points[geometry.points.length - 1]!;

  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`${props.isDropping ? "text-amber-600" : "text-indigo-500"} ${props.className || ""}`}
      data-testid="transceiver-rx-sparkline"
    >
      <title>{label}</title>
      {geometry.baselineY !== undefined ? (
        <line
          x1={0}
          x2={width}
          y1={geometry.baselineY}
          y2={geometry.baselineY}
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeWidth={1}
          strokeDasharray="2 2"
          data-testid="transceiver-rx-sparkline-baseline"
        />
      ) : (
        <></>
      )}
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={geometry.points
          .map((point: { x: number; y: number }) => {
            return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
          })
          .join(" ")}
      />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={2}
        fill="currentColor"
      />
    </svg>
  );
};

export default TransceiverRxSparkline;
