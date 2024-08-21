import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export interface YAxisOptions {
  type: YAxisType;
  min: YAxisMaxMin;
  max: YAxisMaxMin;
  formatter: (value: number) => string;
}

export default interface YAxis {
  legend: string;
  options: YAxisOptions;
}
