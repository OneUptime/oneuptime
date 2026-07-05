/*
 * Summary of a self-hosted OneUptime instance that uses an enterprise
 * license. Returned by the license server (oneuptime.com) on validate and
 * report-user-count calls, stored in GlobalConfig on the customer's
 * instances, and shown in the license modal.
 *
 * Kept as a `type` of plain primitives (not an interface) so it stays
 * structurally compatible with JSONObject and safe to store in JSON columns.
 */
type EnterpriseLicenseInstanceSummary = {
  instanceId: string;
  host: string | null;
  userCount: number | null;
  // ISO date string of the most recent usage report from this instance.
  lastReportedAt: string | null;
};

export default EnterpriseLicenseInstanceSummary;
