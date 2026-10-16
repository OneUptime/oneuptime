/*
 * Where one report of usage to a cloud marketplace stands.
 *
 * A report is written down (Pending) before it is sent, with everything the
 * marketplace deduplicates on - so a send that fails, or whose answer is lost,
 * is retried with the very same record and is never billed twice.
 */
enum MarketplaceUsageReportStatus {
  // Written, not yet confirmed by the marketplace. Retried until it is.
  Pending = "Pending",
  // The marketplace accepted it (or had already accepted the same record).
  Reported = "Reported",
  // The marketplace refused it for good, or it could not be sent in time.
  Failed = "Failed",
}

export default MarketplaceUsageReportStatus;
