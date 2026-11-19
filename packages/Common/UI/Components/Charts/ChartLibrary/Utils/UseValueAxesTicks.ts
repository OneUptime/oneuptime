import React from "react";
import ChartReferenceLineProps from "../../Types/ReferenceLineProps";
import { ValueAxisFormatter } from "../../Types/YAxis/YAxis";
import {
  ValueAxisDomainEnd,
  ValueAxisTicks,
  getChartAxisValues,
  getValueAxisTicks,
} from "../../Utils/ValueAxisTicks";
import { getYAxisWidthForLabelsInPx } from "../../Utils/YAxisWidth";
import { ChartSecondYAxis } from "./SecondYAxis";

/*
 * THE LINE, AREA AND BAR CHARTS' VALUE AXES, STEPPED SO NEIGHBOURING TICKS
 * READ APART (issue #10079).
 *
 * Each axis is worked out over the values drawn against it - its categories'
 * values in every row, a stack's sums, a band's ends and the reference lines
 * that stretch it - as recharts steps it (ValueAxisTicks). An axis whose
 * ticks already read apart is handed to recharts as it always was. One whose
 * ticks would read alike is stepped by the chart, its ticks written with the
 * figures its step needs, and is as wide as the widest of them: never
 * narrower than its host measured (YAxisWidth), so nothing else moves.
 */

export interface ChartValueAxisPlan {
  ticks: ValueAxisTicks;
  // Its width in pixels.
  width: number;
}

export interface ChartValueAxesPlan {
  first: ChartValueAxisPlan;
  // Undefined for a chart with no second axis.
  second: ChartValueAxisPlan | undefined;
}

const NOT_STEPPED: ValueAxisTicks = {
  ticks: undefined,
  domain: undefined,
  precision: undefined,
  labels: [],
};

function getAxisWidth(axisTicks: ValueAxisTicks, measured: number): number {
  return axisTicks.precision
    ? getYAxisWidthForLabelsInPx({
        labels: axisTicks.labels,
        minWidthInPx: measured,
      })
    : measured;
}

export function useValueAxesTicks(input: {
  data: ReadonlyArray<Record<string, unknown>>;
  categories: ReadonlyArray<string>;
  secondYAxis: ChartSecondYAxis | undefined;
  referenceLines: ReadonlyArray<ChartReferenceLineProps> | undefined;
  firstDomain: ReadonlyArray<ValueAxisDomainEnd>;
  secondDomain: ReadonlyArray<ValueAxisDomainEnd>;
  allowDecimals: boolean;
  valueFormatter: ValueAxisFormatter;
  // The first axis's width as its host measured it.
  yAxisWidth: number;
  // Each category's bars on one another, one stack per axis.
  isStacked?: boolean | undefined;
  // An expected-range band's lower and upper keys, drawn against the first axis.
  bandKeys?: [string, string] | undefined;
  // The chart draws no value axis it steps (a vertical or a percent bar chart).
  isFirstAxisLeftToRecharts?: boolean | undefined;
}): ChartValueAxesPlan {
  const secondCategories: ReadonlyArray<string> =
    input.secondYAxis?.categories || [];

  const values: { first: Array<number>; second: Array<number> } =
    React.useMemo((): { first: Array<number>; second: Array<number> } => {
      const isOnSecondAxis: (category: string) => boolean = (
        category: string,
      ): boolean => {
        return (
          Boolean(input.secondYAxis) && secondCategories.includes(category)
        );
      };
      const lineValuesOn: (onSecond: boolean) => Array<number | undefined> = (
        onSecond: boolean,
      ): Array<number | undefined> => {
        return (input.referenceLines || [])
          .filter((line: ChartReferenceLineProps): boolean => {
            return (
              Boolean(line.extendsDomain) &&
              Boolean(line.isOnSecondYAxis && input.secondYAxis) === onSecond
            );
          })
          .map((line: ChartReferenceLineProps): number | undefined => {
            return line.value;
          });
      };

      return {
        first: getChartAxisValues({
          rows: input.data,
          categories: input.categories.filter((category: string): boolean => {
            return !isOnSecondAxis(category);
          }),
          isStacked: input.isStacked,
          bandKeys: input.bandKeys,
          lineValues: lineValuesOn(false),
        }),
        second: input.secondYAxis
          ? getChartAxisValues({
              rows: input.data,
              categories: input.categories.filter(isOnSecondAxis),
              isStacked: input.isStacked,
              lineValues: lineValuesOn(true),
            })
          : [],
      };
    }, [
      input.data,
      input.categories,
      input.secondYAxis,
      input.referenceLines,
      input.isStacked,
      input.bandKeys?.[0],
      input.bandKeys?.[1],
    ]);

  const firstTicks: ValueAxisTicks = input.isFirstAxisLeftToRecharts
    ? NOT_STEPPED
    : getValueAxisTicks({
        values: values.first,
        domain: input.firstDomain,
        allowDecimals: input.allowDecimals,
        formatter: input.valueFormatter,
      });

  const secondTicks: ValueAxisTicks | undefined = input.secondYAxis
    ? getValueAxisTicks({
        values: values.second,
        domain: input.secondDomain,
        allowDecimals: input.allowDecimals,
        formatter: input.secondYAxis.valueFormatter,
      })
    : undefined;

  return {
    first: {
      ticks: firstTicks,
      width: getAxisWidth(firstTicks, input.yAxisWidth),
    },
    second:
      input.secondYAxis && secondTicks
        ? {
            ticks: secondTicks,
            width: getAxisWidth(secondTicks, input.secondYAxis.width),
          }
        : undefined,
  };
}
