import CapturedMetric from "../Monitor/CustomCodeMonitor/CapturedMetric";

export default interface ReturnResult {
  returnValue: any;
  logMessages: string[];
  capturedMetrics: CapturedMetric[];
  /**
   * Populated when user-supplied code threw (or timed out). The runner still
   * returns collected side-channel data (logs, metrics, and any host-realm
   * context objects the caller passed in) so partial state survives the throw.
   */
  scriptError?: Error | undefined;
}
