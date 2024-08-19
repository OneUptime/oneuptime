import { LineChart } from "@tremor/react";
import React, { FunctionComponent, ReactElement } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";

const chartdata = [
  {
    date: "Jan 22",
    SolarPanels: 2890,
    Inverters: 2338,
  },
  {
    date: "Feb 22",
    SolarPanels: 2756,
    Inverters: 2103,
  },
  {
    date: "Mar 22",
    SolarPanels: 3322,
    Inverters: 2194,
  },
  {
    date: "Apr 22",
    SolarPanels: 3470,
    Inverters: 2108,
  },
  {
    date: "May 22",
    SolarPanels: 3475,
    Inverters: 1812,
  },
  {
    date: "Jun 22",
    SolarPanels: 3129,
    Inverters: 1726,
  },
  {
    date: "Jul 22",
    SolarPanels: 3490,
    Inverters: 1982,
  },
  {
    date: "Aug 22",
    SolarPanels: 2903,
    Inverters: 2012,
  },
  {
    date: "Sep 22",
    SolarPanels: 2643,
    Inverters: 2342,
  },
  {
    date: "Oct 22",
    SolarPanels: 2837,
    Inverters: 2473,
  },
  {
    date: "Nov 22",
    SolarPanels: 2954,
    Inverters: 3848,
  },
  {
    date: "Dec 22",
    SolarPanels: 3239,
    Inverters: 3736,
  },
];

const dataFormatter = (number: number) => {
  return `$${Intl.NumberFormat("us").format(number).toString()}`;
};

export interface ComponentProps {
  data: Array<SeriesPoint>;
  xAxis: XAxis;
  yAxis: YAxis;
  curve: ChartCurve;
  sync: boolean;
}

const LineChartElement: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <LineChart
      className="h-80"
      data={chartdata}
      index="date"
      categories={["SolarPanels", "Inverters"]}
      colors={["indigo", "rose"]}
      valueFormatter={dataFormatter}
      yAxisWidth={60}
      onValueChange={(v) => {
        return console.log(v);
      }}
    />
  );
};

export default LineChartElement;
