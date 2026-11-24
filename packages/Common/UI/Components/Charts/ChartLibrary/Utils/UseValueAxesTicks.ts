import React from "react";
import ChartReferenceLineProps from "../../Types/ReferenceLineProps";
import {
  ValueAxisFormatter,
  ValueAxisPrecision,
} from "../../Types/YAxis/YAxis";
import {
  ValueAxisDomainEnd,
  ValueAxisTicks,
  getChartAxisValues,
  getTickFormatter,
  getValueAxisTicks,
} from "../../Utils/ValueAxisTicks";
import { getYAxisWidthForLabelsInPx } from "../../Utils/YAxisWidth";
import {
  ChartOwnScale,
  ChartSecondYAxis,
  SECOND_Y_AXIS_ID,
  getCategoryOwnScale,
  getMarkYAxisProps,
} from "./SecondYAxis";

/*
 * THE LINE, AREA AND BAR CHARTS' VALUE AXES, STEPPED EVENLY IN ROUND STEPS
 * (issues #10079, #10117, #10118).
 *
 * Each axis is worked out over the values drawn against it - its categories'
 * values in every row, a stack's sums, a band's ends and the reference lines
 * that stretch it - and stepped by the chart in round steps of the unit it
 * is written in, natural steps of time for a duration axis (ValueAxisTicks).
 * Its ticks are written with the figures its step needs, and it is as wide
 * as the widest of them: never narrower than its host measured
 * (YAxisWidth), so nothing else moves.
 */

export interface ChartValueAxisPlan {
  ticks: ValueAxisTicks;
  // Its width in pixels.
  width: number;
  // How recharts writes its ticks (getTickFormatter).
  tickFormatter: (value: number) => string;
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
  tooltipPrecision: undefined,
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

// The ticks an axis was handed before, while they are the same numbers.
function useSameTicks(
  ticks: Array<number> | undefined,
): Array<number> | undefined {
  const numbers: string = ticks ? `[${ticks.join(",")}]` : "";

  return React.useMemo((): Array<number> | undefined => {
    return ticks;
  }, [numbers]);
}

// One tick formatter while the axis's formatter, its step and its largest tick stay.
function useTickFormatter(
  formatter: ValueAxisFormatter,
  precision: ValueAxisPrecision | undefined,
): (value: number) => string {
  const step: number | undefined = precision?.step;
  const largestTick: number | undefined = precision?.largestTick;

  return React.useMemo((): ((value: number) => string) => {
    return getTickFormatter(
      formatter,
      step === undefined ? undefined : { step: step, largestTick: largestTick },
    );
  }, [formatter, step, largestTick]);
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
  /*
   * For a first axis of spans of time, the seconds one value stands for:
   * it steps in natural units of time (issue #10118). The second axis's
   * is its own (ChartSecondYAxis).
   */
  durationUnitInSeconds?: number | undefined;
  /*
   * The most ticks the plot has room for, both axes alike (usePlotRoom);
   * six while the plot is not yet laid out.
   */
  mostTicks?: number | undefined;
  /*
   * The scales of their own (issue #10080): their categories and lines are
   * drawn to no axis, so neither axis takes them in.
   */
  ownScales?: ReadonlyArray<ChartOwnScale> | undefined;
}): ChartValueAxesPlan {
  const secondCategories: ReadonlyArray<string> =
    input.secondYAxis?.categories || [];

  const values: { first: Array<number>; second: Array<number> } =
    React.useMemo((): { first: Array<number>; second: Array<number> } => {
      const isOnOwnScale: (category: string) => boolean = (
        category: string,
      ): boolean => {
        return Boolean(getCategoryOwnScale(category, input.ownScales));
      };
      const isOnSecondAxis: (category: string) => boolean = (
        category: string,
      ): boolean => {
        return (
          Boolean(input.secondYAxis) &&
          secondCategories.includes(category) &&
          !isOnOwnScale(category)
        );
      };
      // Where a line is drawn, as getMarkYAxisProps puts it.
      const lineValuesOn: (onSecond: boolean) => Array<number | undefined> = (
        onSecond: boolean,
      ): Array<number | undefined> => {
        return (input.referenceLines || [])
          .filter((line: ChartReferenceLineProps): boolean => {
            const yAxisId: string | undefined = getMarkYAxisProps(
              line.isOnSecondYAxis,
              input.secondYAxis,
              line.ownScaleId,
              input.ownScales,
            ).yAxisId;

            return (
              Boolean(line.extendsDomain) &&
              (onSecond ? yAxisId === SECOND_Y_AXIS_ID : yAxisId === undefined)
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
            return !isOnSecondAxis(category) && !isOnOwnScale(category);
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
      input.ownScales,
      input.referenceLines,
      input.isStacked,
      input.bandKeys?.[0],
      input.bandKeys?.[1],
    ]);

  /*
   * Worked out again only when what it is worked out from changes: the
   * values drawn, either axis's ends, formatter or unit of time.
   */
  const secondYAxis: ChartSecondYAxis | undefined = input.secondYAxis;
  const secondFormatter: ValueAxisFormatter | undefined =
    secondYAxis?.valueFormatter;
  const secondDurationUnitInSeconds: number | undefined =
    secondYAxis?.durationUnitInSeconds;
  const axesTicks: {
    first: ValueAxisTicks;
    second: ValueAxisTicks | undefined;
  } = React.useMemo((): {
    first: ValueAxisTicks;
    second: ValueAxisTicks | undefined;
  } => {
    return {
      first: input.isFirstAxisLeftToRecharts
        ? NOT_STEPPED
        : getValueAxisTicks({
            values: values.first,
            domain: input.firstDomain,
            allowDecimals: input.allowDecimals,
            formatter: input.valueFormatter,
            durationUnitInSeconds: input.durationUnitInSeconds,
            mostTicks: input.mostTicks,
          }),
      second: secondFormatter
        ? getValueAxisTicks({
            values: values.second,
            domain: input.secondDomain,
            allowDecimals: input.allowDecimals,
            formatter: secondFormatter,
            durationUnitInSeconds: secondDurationUnitInSeconds,
            mostTicks: input.mostTicks,
          })
        : undefined,
    };
  }, [
    values,
    input.firstDomain[0],
    input.firstDomain[1],
    input.secondDomain[0],
    input.secondDomain[1],
    input.allowDecimals,
    input.valueFormatter,
    input.isFirstAxisLeftToRecharts,
    input.durationUnitInSeconds,
    input.mostTicks,
    secondFormatter,
    secondDurationUnitInSeconds,
  ]);

  /*
   * recharts reads an axis again whenever its ticks or its tick formatter
   * are new objects. They stay the same ones while the ticks are the same
   * numbers and the axis's formatter and step stay: however often the chart
   * is drawn again (its legend hovered, a dot clicked), and whatever new
   * arrays its host hands it, as the host's own formatter did before the
   * chart stepped its axes.
   */
  const firstTickValues: Array<number> | undefined = useSameTicks(
    axesTicks.first.ticks,
  );
  const secondTickValues: Array<number> | undefined = useSameTicks(
    axesTicks.second?.ticks,
  );
  const firstTickFormatter: (value: number) => string = useTickFormatter(
    input.valueFormatter,
    axesTicks.first.precision,
  );
  // With no second axis, a formatter nothing reads.
  const secondTickFormatter: (value: number) => string = useTickFormatter(
    secondFormatter || input.valueFormatter,
    axesTicks.second?.precision,
  );

  return {
    first: {
      ticks: { ...axesTicks.first, ticks: firstTickValues },
      width: getAxisWidth(axesTicks.first, input.yAxisWidth),
      tickFormatter: firstTickFormatter,
    },
    second:
      secondYAxis && axesTicks.second
        ? {
            ticks: { ...axesTicks.second, ticks: secondTickValues },
            width: getAxisWidth(axesTicks.second, secondYAxis.width),
            tickFormatter: secondTickFormatter,
          }
        : undefined,
  };
}
