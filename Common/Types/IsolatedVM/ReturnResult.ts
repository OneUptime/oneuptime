import CapturedMetric from "../Monitor/CustomCodeMonitor/CapturedMetric";

export default interface ReturnResult {
  returnValue: any;
  logMessages: string[];
  capturedMetrics: CapturedMetric[];
}
