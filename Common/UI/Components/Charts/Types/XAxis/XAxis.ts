import XAxisMaxMin from "./XAxisMaxMin";
import XAxisType from "./XAxisType";

export enum XAxisAggregateType {
  Average = "Average", 
  Sum = "Sum",
  Max = "Max",
  Min = "Min",
}

export interface XAxisOptions {
  type: XAxisType;
  min: XAxisMaxMin;
  max: XAxisMaxMin;
  aggregateType: XAxisAggregateType;
}

export interface XAxis {
  legend: string;
  options: XAxisOptions;
}
