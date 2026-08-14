import CapturedMetric from "./CapturedMetric";

export interface CustomCodeMonitorResultObject {
  [key: string]: CustomCodeMonitorResult;
}

/** JSON-safe data returned from a custom or synthetic monitor script. */
export type CustomCodeMonitorResult =
  | string
  | number
  | boolean
  | null
  | CustomCodeMonitorResultObject
  | Array<CustomCodeMonitorResult>;

export interface RetryAttempt {
  attemptNumber: number;
  scriptError?: string | undefined;
  executionTimeInMS: number;
}

export default interface CustomCodeMonitorResponse {
  result: CustomCodeMonitorResult | undefined;
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
