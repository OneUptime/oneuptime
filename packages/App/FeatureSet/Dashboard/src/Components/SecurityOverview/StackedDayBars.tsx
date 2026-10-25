import { DayCount } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { formatDayLabel, getLabelledDayIndexes } from "./DayLabels";
import React, { FunctionComponent, ReactElement } from "react";

export interface StackedSeries {
  key: string;
  // A CSS color.
  color: string;
  /*
   * What the series is called, when its key is not: a project's case
   * priority is counted by id and named by its name. Looked up in the
   * reader's language either way.
   */
  label?: string | undefined;
}

// What a series is called, in the reader's language.
function seriesName(series: StackedSeries, translator: Translator): string {
  const name: string = series.label || series.key;

  return translator.translateText(name) || name;
}

export interface ComponentProps {
  days: Array<DayCount>;
  // Bottom to top, and the legend's order.
  series: Array<StackedSeries>;
  ariaLabel: string;
  heightInPx?: number | undefined;
}

/*
 * A day-by-day bar chart, each bar split by what it is made of - cases by
 * priority, detections by source. Drawn with plain elements rather than a
 * charting library: thirty bars need no axes engine, and plain elements take
 * the theme, print, and read out to a screen reader as a table.
 */
const StackedDayBars: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const height: number = props.heightInPx || 140;
  const max: number = Math.max(
    1,
    ...props.days.map((day: DayCount): number => {
      return day.total;
    }),
  );
  const labelled: Set<number> = getLabelledDayIndexes(props.days.length);

  return (
    <div>
      <div className="flex gap-2">
        <div
          className="flex w-6 flex-shrink-0 flex-col justify-between py-0.5 text-right text-[10px] tabular-nums text-gray-400"
          style={{ height: `${height}px` }}
          aria-hidden="true"
        >
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="flex items-end gap-[3px] border-b border-l border-gray-200 px-1"
            style={{ height: `${height}px` }}
            role="img"
            aria-label={translator.translateText(props.ariaLabel)}
          >
            {props.days.map((day: DayCount): ReactElement => {
              const parts: Array<string> = props.series
                .filter((series: StackedSeries): boolean => {
                  return (day.byKey[series.key] || 0) > 0;
                })
                .map((series: StackedSeries): string => {
                  return `${seriesName(series, translator)} ${
                    day.byKey[series.key] || 0
                  }`;
                });
              const title: string = `${formatDayLabel(day.day)}: ${day.total}${
                parts.length > 0 ? ` (${parts.join(", ")})` : ""
              }`;

              return (
                <div
                  key={day.day}
                  className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={title}
                >
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-80"
                    style={{
                      height: `${(day.total / max) * 100}%`,
                      minHeight: day.total > 0 ? "2px" : "0px",
                    }}
                  >
                    {props.series.map((series: StackedSeries): ReactElement => {
                      const value: number = day.byKey[series.key] || 0;

                      if (value <= 0 || day.total <= 0) {
                        return <React.Fragment key={series.key} />;
                      }

                      return (
                        <div
                          key={series.key}
                          style={{
                            height: `${(value / day.total) * 100}%`,
                            backgroundColor: series.color,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-[3px] px-1 pt-1" aria-hidden="true">
            {props.days.map((day: DayCount, index: number): ReactElement => {
              return (
                <div
                  key={day.day}
                  className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-gray-400"
                >
                  {labelled.has(index) ? formatDayLabel(day.day) : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {props.series.map((series: StackedSeries): ReactElement => {
          return (
            <span
              key={series.key}
              className="inline-flex items-center gap-1.5 text-xs text-gray-600"
            >
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: series.color }}
              />
              {seriesName(series, translator)}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export default StackedDayBars;
