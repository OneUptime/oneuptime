import ChartReferenceLineProps, {
  DEFAULT_REFERENCE_LINE_DASH,
} from "../Types/ReferenceLineProps";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The chart's reference lines; a line with no label takes no entry.
  lines: Array<ChartReferenceLineProps>;
  className?: string | undefined;
}

// The stroke beside a label: long enough for three of the default dashes.
const SWATCH_WIDTH: number = 20;
const SWATCH_HEIGHT: number = 8;

/*
 * A chart's reference lines, named under the chart: each label beside a
 * short stroke in its line's colour, width and dash, so "At risk (25%)"
 * and "Budget exhausted" are told apart as on the plot itself.
 *
 * A label written at the end of its line sat on whatever the plot had
 * there: the series it marks when the series ran close to the line, and the
 * time axis's last tick when the line lay at the bottom of the plot. Here
 * nothing is written over the plot, the entries wrap on a narrow screen,
 * and they read in the page's direction, the strokes beside them included.
 */
const ReferenceLineLegend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * In the order the lines are drawn from the top of the plot down: the
   * legend reads like the plot beside it, so two lines of one colour and
   * dash (two policy tiers) are told apart by place as well as by name.
   */
  const lines: Array<ChartReferenceLineProps> = props.lines
    .filter((line: ChartReferenceLineProps): boolean => {
      return Boolean(line.label?.trim());
    })
    .sort(
      (
        first: ChartReferenceLineProps,
        second: ChartReferenceLineProps,
      ): number => {
        return second.value - first.value;
      },
    );

  if (lines.length === 0) {
    return <></>;
  }

  return (
    <ul
      data-testid="chart-reference-line-legend"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${
        props.className || ""
      }`}
    >
      {lines.map(
        (line: ChartReferenceLineProps, index: number): ReactElement => {
          return (
            <li
              key={`${index}-${line.value}`}
              data-testid="chart-reference-line-legend-item"
              className="inline-flex min-w-0 items-center gap-1.5 text-xs text-gray-700"
            >
              <svg
                aria-hidden="true"
                data-testid="chart-reference-line-legend-stroke"
                width={SWATCH_WIDTH}
                height={SWATCH_HEIGHT}
                viewBox={`0 0 ${SWATCH_WIDTH} ${SWATCH_HEIGHT}`}
                className="shrink-0"
              >
                <line
                  x1={0}
                  y1={SWATCH_HEIGHT / 2}
                  x2={SWATCH_WIDTH}
                  y2={SWATCH_HEIGHT / 2}
                  stroke={line.color}
                  strokeWidth={1.5}
                  strokeDasharray={
                    line.strokeDasharray || DEFAULT_REFERENCE_LINE_DASH
                  }
                />
              </svg>
              <span className="min-w-0 break-words">{line.label}</span>
            </li>
          );
        },
      )}
    </ul>
  );
};

export default ReferenceLineLegend;
