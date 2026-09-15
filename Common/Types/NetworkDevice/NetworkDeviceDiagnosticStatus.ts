/*
 * The lifecycle of one on-demand device diagnostic (ping / traceroute), as
 * the strings its `status` column holds. Mirrors DiscoveryScanStatus: the
 * column is a ShortText, and the same four words are read by the claim
 * query, the probe's result report, and the dashboard's poll loop, so they
 * live in one place.
 *
 * Values are NOT a TypeScript enum: they are persisted strings, and a plain
 * object keeps them readable in a query, in jsonb and in a log line.
 */
export const NetworkDeviceDiagnosticStatus: {
  Pending: string;
  InProgress: string;
  Completed: string;
  Failed: string;
} = {
  // Created by the dashboard, waiting for the device's probe to claim it.
  Pending: "Pending",
  // Claimed by the probe and running right now.
  InProgress: "In Progress",
  // The probe reported a result. `pingResult` / `traceRouteResult` is set.
  Completed: "Completed",
  /*
   * The probe could not run it (unsupported type, unusable hostname, an
   * exception) — `statusMessage` says why. A device that simply did not
   * answer is NOT a failure: that is a Completed ping with isOnline false.
   */
  Failed: "Failed",
};

/*
 * The statuses after which nothing more will be written to the row. The
 * dashboard stops polling on any of these.
 */
export const NETWORK_DEVICE_DIAGNOSTIC_SETTLED_STATUSES: Array<string> = [
  NetworkDeviceDiagnosticStatus.Completed,
  NetworkDeviceDiagnosticStatus.Failed,
];

export function isNetworkDeviceDiagnosticSettled(
  status: string | undefined | null,
): boolean {
  return (
    typeof status === "string" &&
    NETWORK_DEVICE_DIAGNOSTIC_SETTLED_STATUSES.includes(status)
  );
}
