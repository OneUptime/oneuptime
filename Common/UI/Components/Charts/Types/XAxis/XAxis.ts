import XAxisMaxMin from "./XAxisMaxMin";
import XAxisPrecision from "./XAxisPrecision";
import XAxisType from "./XAxisType";

export interface XAxisOptions {
    type: XAxisType;
    min: XAxisMaxMin;
    max: XAxisMaxMin;
    precision: XAxisPrecision;
}

export interface XAxis {
    legend: string;
    options: XAxisOptions;
  }

