import { JSONObject } from "../../JSON";

export default interface CapturedMetric {
  name: string;
  value: number;
  attributes?: JSONObject | undefined;
}
