import CapturedMetric from "./CapturedMetric";
import { JSONObject } from "../../JSON";

export default interface CustomCodeMonitorResponse {
  result: string | number | boolean | JSONObject | undefined;
  scriptError?: string | undefined;
  logMessages: string[];
  capturedMetrics: CapturedMetric[];
  executionTimeInMS: number;
}
