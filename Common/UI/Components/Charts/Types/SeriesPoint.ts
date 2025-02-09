import Color from "../../../../Types/Color";
import DataPoint from "./DataPoint";

export interface SeriesPoint extends DataPoint {
  seriesName: string;
  seriesColor: Color;
}
