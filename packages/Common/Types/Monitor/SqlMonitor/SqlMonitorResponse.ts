import { JSONObject } from "../../JSON";
import ProbeAttempt from "../../Probe/ProbeAttempt";

/*
 * The compact projection of a SQL query result that a probe reports back to
 * OneUptime. Full result sets never leave the probe / the customer network:
 * only a row count, the first cell (scalar), and the first row are returned.
 * This bounds payload size and avoids replicating customer data into
 * OneUptime storage.
 */
export default interface SqlMonitorResponse {
  isOnline: boolean;
  responseTimeInMs: number;
  failureCause: string;
  // Number of rows the query returned (capped at maxRows). Null on error.
  rowCount: number | null;
  // First column of the first row — the natural value for COUNT(*)-style checks.
  scalarValue: string | number | boolean | null;
  // First row as a name→value map (values coerced to primitives). Null on error.
  firstRow: JSONObject | null;
  // True when the result was truncated because it exceeded maxRows.
  isRowsCapped?: boolean | undefined;
  // Sanitized DB/driver error message (never contains credentials/DSN). Null on success.
  queryError: string | null;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
