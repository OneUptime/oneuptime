/*
 * The lifecycle of one network discovery scan, as the four strings its
 * `status` column actually holds.
 *
 * The column is a ShortText rather than an enum column, and the four values
 * were written as bare literals in a dozen places: the probe-ingest claim and
 * result endpoints, the requeue/reaper worker, the auto-import worker and its
 * engine, the scan service's retire payload, and the Discovery page. That is
 * fine until a question has to be answered the same way in several of them —
 * and "which statuses may auto-import read from" is exactly such a question
 * (OneUptime issue #3599), because the answer has to match in the worker's
 * query, in the engine's re-read, and in the compare-and-set that stamps the
 * scan afterwards. Three literals that agree today are three literals that
 * can disagree tomorrow.
 *
 * Values are NOT a TypeScript enum: they are already persisted strings, and a
 * plain object keeps them readable in a query, in jsonb and in a log line.
 */
export const DiscoveryScanStatus: {
  Pending: string;
  InProgress: string;
  Completed: string;
  Failed: string;
} = {
  // Queued, waiting for its probe to claim it.
  Pending: "Pending",
  /*
   * Claimed by a probe and being swept RIGHT NOW. Since sweeps report
   * incrementally, such a scan can already hold real results — see
   * DISCOVERY_SCAN_IMPORTABLE_STATUSES.
   */
  InProgress: "In Progress",
  // The sweep finished and reported. Its results are final for that run.
  Completed: "Completed",
  /*
   * The sweep failed, or the server's reaper gave up on the probe. Any
   * results on the row are from before the failure and are real, but partial
   * in a way nobody chose.
   */
  Failed: "Failed",
};

/*
 * The statuses whose stored results are worth importing from automatically.
 *
 * "In Progress" belongs here because a discovery sweep is no longer atomic:
 * the probe uploads what it has found every 30 seconds while it is still
 * working (Probe/Jobs/Discovery/FetchScans.ts). Before that, auto-import
 * waited for the whole range — so on a 15,360-address scan the hundreds of
 * switches already found, stored and visible in the product were unimportable
 * for as long as the sweep ran (OneUptime issue #3599, compounded by the
 * 24-hour sweep of #3598).
 *
 * "Pending" and "Failed" are deliberately absent, and for opposite reasons. A
 * Pending row's results describe a run that has been superseded — the ingest
 * endpoint discards results for one on exactly that ground. A Failed row's
 * results are real, but the operator has been told that run failed, so
 * importing from it should be their decision, through the rule's Run Now.
 *
 * Frozen because it is read by a query builder, a re-read and a
 * compare-and-set that must all mean the same thing.
 */
export const DISCOVERY_SCAN_IMPORTABLE_STATUSES: Array<string> = Object.freeze([
  DiscoveryScanStatus.Completed,
  DiscoveryScanStatus.InProgress,
]) as Array<string>;

/*
 * True when the scan is mid-sweep, so anything on its row is a running total
 * rather than a verdict. Nullish-safe: a row read without the column, or one
 * from a shape this code does not control, is not "in progress".
 */
export function isDiscoveryScanInProgress(
  scan: { status?: string | undefined | null } | null | undefined,
): boolean {
  return scan?.status === DiscoveryScanStatus.InProgress;
}
