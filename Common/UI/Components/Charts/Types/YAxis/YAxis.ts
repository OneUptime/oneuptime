import YAxisMaxMin from "./YAxisMaxMin";
import YAxisType from "./YAxisType";

export interface YAxisOptions {
    type: YAxisType;
    min: YAxisMaxMin;
    max: YAxisMaxMin;
  }
  
  export default interface YAxis {
    legend: string;
    options: YAxisOptions;
  }
