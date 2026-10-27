import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";

// What one read of a window - one page of it, for the kinds that page - found.
export interface TelemetryWindowRead {
  events: Array<NormalizedSecurityEvent>;
  // Every row the database returned for it.
  recordsRead: number;
  /*
   * The rows of the paged read alone: where the next page starts. 0 for a
   * kind that reads a window whole.
   */
  pageRows: number;
  // A page came back full: the window has more to read after it.
  hasMore: boolean;
}
