import React, { FunctionComponent, ReactElement } from "react";
import { sumExceptionTrend } from "Common/Types/Telemetry/ExceptionListStats";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A row's small trend chart: one bar per slice of the list's time range,
 * oldest on the left, each as tall as its share of the busiest slice. A
 * slice with no occurrence keeps a hairline, so a quiet stretch reads as
 * quiet rather than as missing. Drawn as plain SVG, not a charting library:
 * a page holds fifty of these.
 */

export const SPARKLINE_WIDTH: number = 96;
export const SPARKLINE_HEIGHT: number = 24;
// The hairline a slice with no occurrence keeps, and the shortest real bar.
const EMPTY_BAR_HEIGHT: number = 1;
const MIN_BAR_HEIGHT: number = 3;

export interface ExceptionTrendBar {
  x: number;
  width: number;
  height: number;
  count: number;
}

// Where each bar goes, in the chart's own coordinates. Pure, for the tests.
export function getExceptionTrendBars(
  trend: ReadonlyArray<number>,
): Array<ExceptionTrendBar> {
  if (trend.length === 0) {
    return [];
  }

  const slot: number = SPARKLINE_WIDTH / trend.length;
  const width: number = Math.max(1, slot - 1);
  let max: number = 0;

  for (const count of trend) {
    max = Math.max(max, count);
  }

  return trend.map((count: number, index: number): ExceptionTrendBar => {
    const height: number =
      count > 0 && max > 0
        ? Math.max(MIN_BAR_HEIGHT, Math.round((count / max) * SPARKLINE_HEIGHT))
        : EMPTY_BAR_HEIGHT;

    return { x: index * slot, width, height, count };
  });
}

export interface ExceptionTrendSparklineProps {
  trend: ReadonlyArray<number>;
  // A resolved or archived exception's chart is drawn grey.
  isMuted?: boolean | undefined;
}

const ExceptionTrendSparkline: FunctionComponent<
  ExceptionTrendSparklineProps
> = (props: ExceptionTrendSparklineProps): ReactElement => {
  const translator: Translator = useTranslator();
  const total: number = sumExceptionTrend(props.trend);
  const label: string = translator.translatePlural(
    {
      one: "{{count}} event in this time range",
      other: "{{count}} events in this time range",
    },
    total,
  );

  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="exception-row-trend"
      width={SPARKLINE_WIDTH}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      className={`block flex-shrink-0 ${
        props.isMuted ? "text-gray-300" : "text-red-400"
      }`}
    >
      <title>{label}</title>
      {getExceptionTrendBars(props.trend).map(
        (bar: ExceptionTrendBar, index: number): ReactElement => {
          return (
            <rect
              key={index}
              x={bar.x}
              y={SPARKLINE_HEIGHT - bar.height}
              width={bar.width}
              height={bar.height}
              rx={0.5}
              fill="currentColor"
              opacity={bar.count > 0 ? 1 : 0.35}
            />
          );
        },
      )}
    </svg>
  );
};

export default ExceptionTrendSparkline;
