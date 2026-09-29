import DataPoint from "./DataPoint";

export default interface SeriesPoints {
  data: Array<DataPoint>;
  seriesName: string;
}
