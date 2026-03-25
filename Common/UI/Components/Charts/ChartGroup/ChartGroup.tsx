import Text from "../../../../Types/Text";
import LineChart, { ComponentProps as LineChartProps } from "../Line/LineChart";
import BarChartElement, {
  ComponentProps as BarChartProps,
} from "../Bar/BarChart";
import AreaChartElement, {
  ComponentProps as AreaChartProps,
} from "../Area/AreaChart";
import React, { FunctionComponent, ReactElement } from "react";

export enum ChartType {
  LINE = "line",
  BAR = "bar",
  AREA = "area",
}

export interface Chart {
  id: string;
  title: string;
  description?: string | undefined;
  type: ChartType;
  props: LineChartProps | BarChartProps | AreaChartProps;
}

export interface ComponentProps {
  charts: Array<Chart>;
  hideCard?: boolean | undefined;
  heightInPx?: number | undefined;
  chartCssClass?: string | undefined;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const syncId: string = Text.generateRandomText(10);

  const isLastChart: (index: number) => boolean = (index: number): boolean => {
    return index === props.charts.length - 1;
  };

  type GetChartContentFunction = (
    chart: Chart,
    index: number,
  ) => ReactElement;

  const getChartContent: GetChartContentFunction = (
    chart: Chart,
    index: number,
  ): ReactElement => {
    switch (chart.type) {
      case ChartType.LINE:
        return (
          <LineChart
            key={index}
            {...(chart.props as LineChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
          />
        );
      case ChartType.BAR:
        return (
          <BarChartElement
            key={index}
            {...(chart.props as BarChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
          />
        );
      case ChartType.AREA:
        return (
          <AreaChartElement
            key={index}
            {...(chart.props as AreaChartProps)}
            syncid={syncId}
            heightInPx={props.heightInPx}
          />
        );
      default:
        return <></>;
    }
  };

  // When hideCard is true, render charts in a clean vertical stack with dividers
  if (props.hideCard) {
    return (
      <div className="space-y-0">
        {props.charts.map((chart: Chart, index: number) => {
          return (
            <div
              key={index}
              className={`${!isLastChart(index) ? "border-b border-gray-100" : ""} ${props.chartCssClass || ""}`}
            >
              <div className="px-1 pt-5 pb-4">
                <div className="mb-1">
                  <h3 className="text-sm font-semibold text-gray-700 tracking-tight">
                    {chart.title}
                  </h3>
                  {chart.description && (
                    <p className="mt-0.5 text-xs text-gray-400 hidden md:block">
                      {chart.description}
                    </p>
                  )}
                </div>
                {getChartContent(chart, index)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // When showing cards, use the grid layout
  const gridCols: string =
    props.charts.length > 1 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  return (
    <div
      className={`grid grid-cols-1 ${gridCols} gap-4 space-y-4 lg:space-y-0`}
    >
      {props.charts.map((chart: Chart, index: number) => {
        return (
          <div
            key={index}
            className={`p-5 rounded-lg border border-gray-200 bg-white shadow-sm ${props.chartCssClass || ""}`}
          >
            <h2
              data-testid="card-details-heading"
              id="card-details-heading"
              className="text-base font-semibold leading-6 text-gray-900"
            >
              {chart.title}
            </h2>
            {chart.description && (
              <p
                data-testid="card-description"
                className="mt-0.5 text-sm text-gray-500 w-full hidden md:block"
              >
                {chart.description}
              </p>
            )}
            {getChartContent(chart, index)}
          </div>
        );
      })}
    </div>
  );
};

export default ChartGroup;
