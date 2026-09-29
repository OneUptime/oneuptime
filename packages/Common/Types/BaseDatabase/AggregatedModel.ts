import { JSONValue } from "../JSON";

export default interface AggregateModel {
  [x: string]: JSONValue;
  timestamp: Date;
  value: number;
}
