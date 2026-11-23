import { DiscoveryScanStatus } from "./DiscoveryScanStatus";
import {
  getRefusalText,
  RefusalWithValues,
} from "../../Types/Exception/RefusalWithValues";
import { translationKey } from "../../Types/Translator";

/*
 * RUNNING A DISCOVERY SCAN AGAIN, ON DEMAND (OneUptime issue #10334).
 *
 * A scan that does not repeat used to run once, when it was created, and
 * never again: the only ways to sweep the same range a second time were to
 * create the same scan again from scratch - a duplicate in the list every
 * time - or to switch on a schedule nobody wanted. Run Again runs the scan
 * it is pressed on, with its own target, probe, method and credentials, and
 * the new run's results replace the old ones on the same row, as a
 * scheduled run's do.
 *
 * The server's half is NetworkDeviceDiscoveryScanService.runAgain, behind
 * POST /network-device-discovery-scan/:scanId/run
 * (Common/Server/API/NetworkDeviceDiscoveryScanRunAPI); the Dashboard's is
 * the Run Again button on the scan's row (Network > Discovery). Both read
 * this file, so the route, which runs may be asked for and the words of a
 * refusal cannot drift apart.
 *
 * Each refusal is a key of the Dashboard's locales (this file is one of the
 * extractor's sources, keys only): the server answers in English, and the
 * Dashboard says the sentence in the reader's language
 * (Common/UI/Utils/ErrorInSentence). The one with a value in it - the
 * probe's name - is a RefusalWithValues, read back out of the English.
 *
 * React-free and server-safe.
 */

// The route that asks for a run, as the server registers it.
export const DISCOVERY_SCAN_RUN_PATH: string =
  "/network-device-discovery-scan/:scanId/run";

// The same route for one scan, as the Dashboard asks it.
export const getDiscoveryScanRunRoute: (scanId: string) => string = (
  scanId: string,
): string => {
  return DISCOVERY_SCAN_RUN_PATH.replace(":scanId", scanId);
};

/*
 * The statuses a scan may be run again from: a run that has ended, whether
 * it finished or failed. A Pending scan is queued already and an In
 * Progress one is sweeping; asking again would only queue the same sweep
 * behind itself, or - worse - flip a running scan back to Pending under the
 * probe sweeping it, so its result would be discarded as a superseded run's.
 */
export const DISCOVERY_SCAN_RUNNABLE_STATUSES: ReadonlyArray<string> =
  Object.freeze([DiscoveryScanStatus.Completed, DiscoveryScanStatus.Failed]);

// Whether a scan in this state may be run again now.
export const canDiscoveryScanRunAgain: (
  scan: { status?: string | undefined | null } | null | undefined,
) => boolean = (
  scan: { status?: string | undefined | null } | null | undefined,
): boolean => {
  return DISCOVERY_SCAN_RUNNABLE_STATUSES.includes(scan?.status || "");
};

/*
 * What the route answers when the run is queued: the scan as it now stands,
 * so a client can show it queued without reading the scan again.
 */
export interface DiscoveryScanRunResult {
  scanId: string;
  // "Pending": queued for its probe.
  status: string;
  // When the run was asked for, as an ISO 8601 string.
  runRequestedAt: string;
}

// A run asked for while the probe is sweeping the scan.
export const DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL: string = translationKey(
  "This scan is already running. Run it again once this run finishes.",
);

// A run asked for while the scan is queued for its probe already.
export const DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL: string = translationKey(
  "This scan is already queued to run. It starts when its probe picks it up.",
);

/*
 * A scan that is gone: deleted, or deleted with its probe (a scan's probe
 * column deletes the scan with the probe).
 */
export const DISCOVERY_SCAN_NOT_FOUND_REFUSAL: string = translationKey(
  "This scan no longer exists. Refresh the list to see the latest scans.",
);

/*
 * A scan whose probe is gone, or is another project's: the window between a
 * probe's delete and the cascade that deletes its scans, or a row written
 * out of band. Edit is where a scan's probe is picked.
 */
export const DISCOVERY_SCAN_PROBE_GONE_REFUSAL: string = translationKey(
  "This scan's probe no longer exists, so the scan cannot run. Pick another probe in Edit.",
);

/*
 * A probe that is not connected to OneUptime (Probe.connectionStatus, which
 * Workers/Jobs/Probe/UpdateConnectionStatus keeps): it would never pick the
 * run up, so the run is not queued at all. Queued, the scan would sit
 * Pending for as long as the probe stayed away, and a Pending scan's
 * previous results cannot be reviewed - the last good inventory would be
 * out of reach until the probe came back. Refused, it stays reviewable, and
 * the person knows why nothing is running.
 */
export const DISCOVERY_SCAN_PROBE_OFFLINE_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This scan's probe, {{probe}}, is not connected to OneUptime, so the scan cannot run now. Start the probe, or pick another probe in Edit.",
  ),
  terms: [],
};

// The same, for a probe with no name.
export const DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL: string =
  translationKey(
    "This scan's probe is not connected to OneUptime, so the scan cannot run now. Start the probe, or pick another probe in Edit.",
  );

// The refusal for an offline probe, as the server answers it.
export const getDiscoveryScanProbeOfflineRefusal: (
  probeName: string | null | undefined,
) => string = (probeName: string | null | undefined): string => {
  const name: string = (probeName || "").trim();

  if (!name) {
    return DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL;
  }

  return getRefusalText(DISCOVERY_SCAN_PROBE_OFFLINE_REFUSAL, { probe: name });
};

/*
 * Who may run a scan: whoever may edit the project's discovery scans. A run
 * replaces a scan's results and puts it back in the queue, which is a
 * change to that scan - the same change an edit of its target makes - so
 * it takes what an edit takes, not what creating a new scan takes.
 */
export const DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL: string = translationKey(
  "You may not edit this project's discovery scans, so you cannot run one.",
);
