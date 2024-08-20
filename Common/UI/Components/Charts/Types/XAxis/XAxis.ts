import XValue from "../XValue";
import XAxisMaxMin from "./XAxisMaxMin";
import XAxisPrecision from "./XAxisPrecision";
import XAxisType from "./XAxisType";

export interface XAxisOptions {
  type: XAxisType;
  min: XAxisMaxMin;
  max: XAxisMaxMin;
  precision: XAxisPrecision;
  formatter: (value: XValue) => string;
}

export interface XAxis {
  legend: string;
  options: XAxisOptions;
}
