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
  /*
   * OneUptime version this instance last reported, for example "11.5.13".
   * Null for instances that have not reported since upgrading to a build
   * that sends its version, and for dev builds with no APP_VERSION baked in.
   */
  version: string | null;
};

export default EnterpriseLicenseInstanceSummary;
