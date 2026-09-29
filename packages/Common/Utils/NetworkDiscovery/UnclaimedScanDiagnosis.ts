import OneUptimeDate from "../../Types/Date";
import ColumnLength from "../../Types/Database/ColumnLength";

/*
 * Why a network discovery scan is still sitting in "Pending".
 *
 * A scan leaves "Pending" in exactly one place: the probe asks
 * /probe/discovery-scan/list and the server claims a row for it
 * (App/FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan.ts). Nothing on the
 * server can make that happen — if the probe never asks, the row simply never
 * moves.
 *
 * Until this existed, that outcome was completely silent. The scans list
 * showed "Pending" and an em-dash in Responded Hosts, forever, with no
 * timestamp, no probe state and no message anywhere in the product; the only
 * evidence lived in the probe container's log, if the operator had it. That is
 * what OneUptime issue #3287 reported: four scans submitted over an hour, all
 * "Pending", nothing to act on.
 *
 * So this module writes the sentence the operator was missing. It is pure and
 * lives in Common so the wording can be unit-tested without a database, the
 * same way ScanTargetUtil's messages are.
 *
 * It deliberately does NOT fail the scan. A scan nobody has claimed is still
 * perfectly runnable the moment the probe comes back, and a recurring one
 * would tangle with the re-queue pass; what was missing was information, not a
 * state change.
 */

/*
 * How long a scan may sit unclaimed before the job says anything.
 *
 * The probe polls every minute, so this is fifteen consecutive failed polls —
 * long enough that a restarting probe, a redeploy or a brief network blip
 * never produces a message, short enough to be useful while the operator is
 * still looking at the page they just submitted from.
 *
 * It is NOT the whole guard against false positives: a scan queued behind
 * another scan on the same probe is legitimately Pending for as long as that
 * sweep takes (the claim endpoint hands out one at a time), so the caller
 * excludes probes that currently have a scan In Progress. This threshold only
 * decides how long an IDLE probe gets before its silence is worth reporting.
 */
export const UNCLAIMED_PENDING_MINUTES: number = 15;

export interface UnclaimedScanProbeState {
  // The probe the scan was assigned to, as the operator named it.
  probeName?: string | undefined;
  /*
   * The probe's own connection state, as maintained every minute by
   * Workers/Jobs/Probe/UpdateConnectionStatus.ts. This is the half of the
   * diagnosis the operator cannot work out for themselves.
   */
  isProbeConnected: boolean;
  // When the probe last authenticated a request. Null if it never has.
  lastAliveAt?: Date | null | undefined;
}

/*
 * The two cases below are genuinely different problems with different fixes,
 * and telling them apart is the entire point of this message: a probe that is
 * not connected is an infrastructure problem the operator can see and fix,
 * whereas a probe that IS connected and still is not claiming scans means the
 * probe is running but its discovery job is not — an old image, a wedged
 * sweep, or a probe that cannot reach the probe-ingest route specifically.
 */
export function buildUnclaimedScanDiagnosis(
  probeState: UnclaimedScanProbeState,
): string {
  const probeLabel: string = probeState.probeName
    ? `Probe "${truncateProbeName(probeState.probeName)}"`
    : "The assigned probe";

  if (!probeState.isProbeConnected) {
    const lastSeen: string = probeState.lastAliveAt
      ? `It was last seen ${OneUptimeDate.fromNow(probeState.lastAliveAt)}.`
      : "It has never connected.";

    return (
      `Not started yet: ${probeLabel} is not connected to OneUptime, so it has not picked this scan up. ` +
      `${lastSeen} The scan will run on its own as soon as the probe reconnects.`
    );
  }

  return (
    `Not started yet: ${probeLabel} is connected but has not picked this scan up for over ` +
    `${UNCLAIMED_PENDING_MINUTES} minutes. Check that the probe is running a version that supports ` +
    `network discovery, and that it can reach the probe-ingest endpoint. The scan will run on its own ` +
    `once the probe starts claiming scans again.`
  );
}

/*
 * statusMessage is a varchar(500) and this job writes through the full
 * update pipeline, which does NOT clamp — an over-long value would throw and
 * the diagnosis would be lost rather than truncated. The only unbounded part
 * of the sentence is the probe's name (itself a ShortText column, so at most
 * 100 characters), and it is cut here so the arithmetic holds for every
 * possible name. See the test that asserts the worst case still fits.
 */
const MAX_PROBE_NAME_LENGTH: number = 60;

function truncateProbeName(name: string): string {
  if (name.length <= MAX_PROBE_NAME_LENGTH) {
    return name;
  }

  return name.substring(0, MAX_PROBE_NAME_LENGTH) + "…";
}

/*
 * Exported so the job and its tests agree on the ceiling they are checking
 * against, rather than both hard-coding 500.
 */
export const MAX_SCAN_STATUS_MESSAGE_LENGTH: number = ColumnLength.LongText;
