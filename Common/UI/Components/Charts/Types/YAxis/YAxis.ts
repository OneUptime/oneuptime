import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export enum YAxisPrecision {
  NoDecimals = "NoDecimals",
  OneDecimal = "OneDecimal",
  TwoDecimals = "TwoDecimals",
  ThreeDecimals = "ThreeDecimals",
}

export interface YAxisOptions {
  type: YAxisType;
  min: YAxisMaxMin;
  max: YAxisMaxMin;
  formatter: (value: number) => string;
  precision: 
}

export default interface YAxis {
  legend: string;
  options: YAxisOptions;
}
