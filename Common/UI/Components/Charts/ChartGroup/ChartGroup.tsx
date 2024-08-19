import LineChart, { ComponentProps as LineChartProps } from "../Line/LineChart";
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
  props: LineChartProps;
}

export interface ComponentProps {
  charts: Array<Chart>;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  return (
    <div className="lg:grid grid-cols-1 gap-5">
      {props.charts.map((chart: Chart, index: number) => {
        switch (chart.type) {
          case ChartType.LINE:
            return (
              <div key={index} className="p-6 rounded-md bg-white shadow">
                <h2
                  data-testid="card-details-heading"
                  id="card-details-heading"
                  className="text-lg font-medium leading-6 text-gray-900"
                >
                  {chart.title}
                </h2>
                {chart.description && (
                  <p
                    data-testid="card-description"
                    className="mt-1 text-sm text-gray-500 w-full"
                  >
                    {chart.description}
                  </p>
                )}
                <LineChart
                  key={index}
                  {...chart.props}
                />
              </div>
            );
          default:
            return <></>;
        }
      })}
    </div>
  );
};

export default ChartGroup;
