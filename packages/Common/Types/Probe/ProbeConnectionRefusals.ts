/*
 * WHAT A PROBE THAT CANNOT CONNECT IS TOLD (#7273).
 *
 * A self-hosted probe that could not register or report read "ProbeId or
 * ProbeKey is missing", "Invalid Probe ID or Probe Key" and "Probe not
 * found" in its own logs - the server's answers, which the probe prints -
 * with nothing that said what to set or where to copy it. Each says now
 * what happened and what to do next: the probe's ID and key are on its
 * page under Monitors > Settings > Probes, and go in PROBE_ID and
 * PROBE_KEY where it runs; a report with a part missing comes from a probe
 * of another release than the server's.
 *
 * Read by the server's probe routes (Telemetry's ProbeAuthorization,
 * ProbeIngest) and by the probe itself (packages/Probe). An ID and a key
 * that match no probe are answered alike, whichever of the two is wrong,
 * so the answer never says whether a probe has that ID. React-free and
 * server-safe.
 */

// Where a project's own probe's ID and key are, in the Dashboard.
export const PROBE_CREDENTIALS_PLACE: string = "Monitors > Settings > Probes";

// What to copy, and where it goes.
const COPY_ID_AND_KEY: string = `Open the probe under ${PROBE_CREDENTIALS_PLACE}, copy its Probe ID and Probe Key, and set them as PROBE_ID and PROBE_KEY where the probe runs`;

// What a probe of another release than the server's does next.
const UPDATE_THE_PROBE: string =
  "Update the probe to the release this OneUptime server runs, then restart it.";

export const ProbeConnectionRefusals: {
  missingIdOrKey: string;
  wrongIdOrKey: string;
  unknownProbe: string;
  missingRegistrationProbeKey: string;
  missingStatusReport: string;
  missingMonitorResponse: string;
  missingSnmpTrap: string;
  missingTestId: string;
} = {
  // A request that carried no probe ID, or no key.
  missingIdOrKey: `The request did not carry a probe ID and key. ${COPY_ID_AND_KEY}.`,
  // An ID and a key that match no probe: either may be the wrong one.
  wrongIdOrKey: `No probe has this ID and key. ${COPY_ID_AND_KEY}, then restart it.`,
  /*
   * A request the key check let through, whose probe OneUptime then could
   * not tell: one deleted in between.
   */
  unknownProbe:
    "OneUptime could not tell which probe sent this request. Check that PROBE_ID and PROBE_KEY are set where the probe runs, then restart it.",
  // A global probe that asked to register without a key of its own.
  missingRegistrationProbeKey:
    "The registration did not carry a probe key. Give this probe a long random PROBE_KEY (GLOBAL_PROBE_n_KEY in Docker Compose), then start it again.",
  missingStatusReport: `This probe's offline report had nothing in it. ${UPDATE_THE_PROBE}`,
  missingMonitorResponse: `This probe sent a monitor result with nothing in it. ${UPDATE_THE_PROBE}`,
  missingSnmpTrap: `This probe sent an SNMP trap with nothing in it. ${UPDATE_THE_PROBE}`,
  missingTestId: `This probe sent a monitor test's result without saying which test it was. ${UPDATE_THE_PROBE}`,
};

/*
 * A report or a request whose body does not hold what the route reads, in
 * the shape it reads it (#11057): a probe of another release than the
 * server's. Said with what the probe sent and what is wrong with it, named
 * as the probe's code names it, so whoever reads the probe's log can tell
 * which part, and with what to do next. These read "syslogMessages not
 * found in request body", "pingResult must be an object" and "scanId not
 * found" before.
 */
export const getUnreadableProbeReport: (data: {
  // What the probe sent: "a diagnostic's result", "syslog messages".
  report: string;
  // What is wrong with it: "networkDeviceDiagnosticId is missing".
  problem: string;
}) => string = (data: { report: string; problem: string }): string => {
  return `This probe sent ${data.report} this OneUptime server cannot read (${data.problem}). ${UPDATE_THE_PROBE}`;
};

/*
 * A result for a job the server has no record of this probe running: a
 * diagnostic or a discovery scan that was cancelled or deleted while the
 * probe ran it, or one of another probe's - the same words, so the answer
 * never says whether the job is somebody else's (#11057).
 */
export const getNotThisProbesJob: (job: string) => string = (
  job: string,
): string => {
  return `This ${job} is not one this probe was asked to run. It may have been cancelled or deleted, so its result was not kept.`;
};

/*
 * What the probe itself says when it cannot start or connect: in its own
 * log, before it stops or while it tries again.
 */
export const ProbeStartupMessages: {
  noServerAddress: string;
  noProbeKey: string;
  noProbeId: string;
  couldNotConnect: string;
} = {
  noServerAddress:
    "Neither ONEUPTIME_URL nor PROBE_INGEST_URL is set, so this probe does not know which OneUptime server to report to. Set ONEUPTIME_URL to the server's address, such as https://oneuptime.com, then start the probe again.",
  noProbeKey: `PROBE_KEY is not set, so this probe cannot sign in to OneUptime. ${COPY_ID_AND_KEY}, then start the probe again.`,
  noProbeId: `PROBE_ID is not set, so OneUptime cannot tell which probe this is. ${COPY_ID_AND_KEY}, then start the probe again. A global probe sets REGISTER_PROBE_KEY instead.`,
  couldNotConnect:
    "This probe could not connect to OneUptime. Check that ONEUPTIME_URL, PROBE_ID and PROBE_KEY are right where the probe runs: the error below says why.",
};

export default ProbeConnectionRefusals;
