import CapturedMetric from "./CapturedMetric";
import { JSONObject } from "../../JSON";

export interface RetryAttempt {
  attemptNumber: number;
  scriptError?: string | undefined;
  executionTimeInMS: number;
}

export default interface CustomCodeMonitorResponse {
  result: string | number | boolean | JSONObject | undefined;
  scriptError?: string | undefined;
  logMessages: string[];
  capturedMetrics: CapturedMetric[];
  executionTimeInMS: number;
  /*
   * Populated only when more than one attempt occurred (i.e. at least one retry).
   * Includes every attempt — the last entry corresponds to the final result above.
   */
  retryAttempts?: Array<RetryAttempt> | undefined;
  totalAttempts?: number | undefined;
}
