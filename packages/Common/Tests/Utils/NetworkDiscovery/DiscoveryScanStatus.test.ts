import {
  DISCOVERY_SCAN_IMPORTABLE_STATUSES,
  DiscoveryScanStatus,
  isDiscoveryScanInProgress,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanStatus";
import { describe, expect, it } from "@jest/globals";

/*
 * The shared vocabulary for a discovery scan's lifecycle.
 *
 * `status` is a ShortText column holding one of four persisted strings, and
 * those strings were written as bare literals in a dozen places — the two
 * probe-ingest endpoints, the requeue/reaper worker, the auto-import worker
 * and its engine, the scan service's retire payload, the Discovery page. That
 * was fine until one question had to be answered identically in several of
 * them: "which statuses may auto-import read from" (OneUptime issue #3599)
 * has to match in the worker's query, in the engine's re-read AND in the
 * compare-and-set that stamps the scan afterwards.
 *
 * These tests pin the values (they are persisted, so a rename is a migration,
 * not an edit) and the membership of the importable set, which is a product
 * decision rather than a spelling.
 */

describe("DiscoveryScanStatus", () => {
  /*
   * Persisted strings. A row written last year holds "In Progress" with that
   * exact spelling and space; changing any of these silently stops matching
   * every existing row.
   */
  it("spells the four persisted statuses exactly", () => {
    expect(DiscoveryScanStatus.Pending).toBe("Pending");
    expect(DiscoveryScanStatus.InProgress).toBe("In Progress");
    expect(DiscoveryScanStatus.Completed).toBe("Completed");
    expect(DiscoveryScanStatus.Failed).toBe("Failed");
  });
});

describe("DISCOVERY_SCAN_IMPORTABLE_STATUSES", () => {
  /*
   * The change #3599 asked for: a sweep uploads what it has found every 30
   * seconds, so a running scan's row already holds real hosts. Waiting for
   * the whole range is what left 527 discovered switches unimportable for a
   * day.
   */
  it("includes a scan that is still sweeping", () => {
    expect(DISCOVERY_SCAN_IMPORTABLE_STATUSES).toContain(
      DiscoveryScanStatus.InProgress,
    );
  });

  it("includes a finished scan", () => {
    expect(DISCOVERY_SCAN_IMPORTABLE_STATUSES).toContain(
      DiscoveryScanStatus.Completed,
    );
  });

  /*
   * Excluded for opposite reasons, and both matter. A Pending row's results
   * describe a run that has been superseded — the ingest endpoint discards
   * results for one on exactly that ground, so importing from it would import
   * a run the product has already disowned. A Failed row's results are real,
   * but the operator has been told that run failed; importing from it should
   * be their decision, through the rule's Run Now.
   */
  it("excludes a queued scan and a failed one", () => {
    expect(DISCOVERY_SCAN_IMPORTABLE_STATUSES).not.toContain(
      DiscoveryScanStatus.Pending,
    );
    expect(DISCOVERY_SCAN_IMPORTABLE_STATUSES).not.toContain(
      DiscoveryScanStatus.Failed,
    );
  });

  it("holds exactly those two, so a new status is a deliberate decision", () => {
    expect([...DISCOVERY_SCAN_IMPORTABLE_STATUSES].sort()).toEqual([
      "Completed",
      "In Progress",
    ]);
  });

  /*
   * Read by a query builder, a re-read and a compare-and-set that must all
   * mean the same thing — so nothing may push onto it at runtime.
   */
  it("is frozen", () => {
    expect(Object.isFrozen(DISCOVERY_SCAN_IMPORTABLE_STATUSES)).toBe(true);
  });
});

describe("isDiscoveryScanInProgress", () => {
  it("is true only for a scan that is mid-sweep", () => {
    expect(isDiscoveryScanInProgress({ status: "In Progress" })).toBe(true);
    expect(isDiscoveryScanInProgress({ status: "Completed" })).toBe(false);
    expect(isDiscoveryScanInProgress({ status: "Pending" })).toBe(false);
    expect(isDiscoveryScanInProgress({ status: "Failed" })).toBe(false);
  });

  /*
   * Nullish-safe: this is called from a table cell against rows read with
   * whatever columns that page selected, so "the column is not here" must
   * answer "not in progress" rather than throw inside a render.
   */
  it("answers false rather than throwing for a row it cannot read", () => {
    expect(isDiscoveryScanInProgress(null)).toBe(false);
    expect(isDiscoveryScanInProgress(undefined)).toBe(false);
    expect(isDiscoveryScanInProgress({})).toBe(false);
    expect(isDiscoveryScanInProgress({ status: undefined })).toBe(false);
    expect(isDiscoveryScanInProgress({ status: null })).toBe(false);
  });

  // Persisted spelling, not a case-insensitive match.
  it("does not accept a different spelling of the same idea", () => {
    expect(isDiscoveryScanInProgress({ status: "in progress" })).toBe(false);
    expect(isDiscoveryScanInProgress({ status: "InProgress" })).toBe(false);
  });
});
