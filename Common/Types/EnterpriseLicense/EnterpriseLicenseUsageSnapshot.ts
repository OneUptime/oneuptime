/*
 * A point-in-time, privacy-preserving view of enterprise license usage for
 * the Admin Dashboard. Email hashes stay on the server; instance ids are
 * enough to render statuses from the exact same cutoff as the aggregate.
 */
export default interface EnterpriseLicenseUsageSnapshot {
  currentUserCount: number | null;
  activeInstanceIds: Array<string>;
  masterAdminEmails: Array<string>;
  calculatedAt: string;
  lastUsageReportedAt: string | null;
  nextInstanceStatusChangeAt: string | null;
}
