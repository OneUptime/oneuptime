import { LineChart } from "../ChartLibrary/LineChart/LineChart";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import SeriesPoint from "../Types/SeriesPoints";
import { XAxis } from "../Types/XAxis/XAxis";
import YAxis from "../Types/YAxis/YAxis";
import ChartCurve from "../Types/ChartCurve";
import XAxisPrecision from "../Types/XAxis/XAxisPrecision";

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
  props: ComponentProps,
): ReactElement => {

  const [records, setRecords] = React.useState<Record<string, any>[]>([]);

  const categories: Array<string> = props.data.map((item: SeriesPoint) => {
    return item.seriesName;
  });

  useEffect(() => {

    if (!props.data || props.data.length === 0) {
      setRecords([]);
    }

    const maxXValue: number | Date = props.xAxis.options.max; 
    const minXValue: number | Date = props.xAxis.options.min;
    const precision: XAxisPrecision = props.xAxis.options.precision;

    for (const seriesData of props.data) {
      const yAxisLegend: string = seriesData.seriesName;
      for (const data of seriesData.data) {

        const xAxisValue: string = props.xAxis.options.formatter(data.x);
        const yValue: number = data.y;
      }
    }

  }, [props.data]);



  return (
    <LineChart
      className="h-80"
      data={records}
      index={props.xAxis.legend}
      categories={categories}
      colors={["indigo", "rose", "amber"]}
      valueFormatter={dataFormatter}
      
      showTooltip={true}
      yAxisWidth={60}
      onValueChange={(v) => {
        return console.log(v);
      }}
    />
  );
};

export default LineChartElement;
