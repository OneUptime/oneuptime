import XAxisMaxMin from "./XAxisMaxMin";
import XAxisType from "./XAxisType";

export interface XAxisOptions {
  type: XAxisType;
  min: XAxisMaxMin;
  max: XAxisMaxMin;
}

export interface XAxis {
  legend: string;
  options: XAxisOptions;
}
