import { JSONObject } from "../../JSON";

export default interface CustomCodeMonitor {
  result: string | number | boolean | JSONObject | undefined;
  scriptError?: string | undefined;
  logMessages: string[];
  executionTimeInMS: number;
}
