import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "Common/Server/Utils/Probe/ProbeReportIdentity";

/*
 * Ingest failures that are expected and that nobody can act on: the job names
 * a monitor that does not exist (e.g. a secret key referencing a deleted
 * monitor), or one that is not being monitored - archived, disabled, or
 * paused while a manually created incident on it is unresolved or a
 * maintenance event it is attached to has not ended (MonitorResource refuses
 * a result for each of these). The telemetry worker completes these jobs
 * instead of failing them - retrying provides no value and only creates noise.
 *
 * So is a probe's result for a monitor that probe does not check
 * (ProbeNotAssignedToMonitor, issue #8161): the probe was taken off the
 * monitor, or the monitor switched off for it, while a check it had already
 * claimed was in flight - or the monitor is one probes never check. Neither
 * the monitor's probes nor its type change between attempts, so every retry
 * is refused the same way. The refusal itself stands - a probe never writes
 * results for a monitor it does not check - and MonitorResource logs it once,
 * at warn, naming the probe and the monitor, so a probe that keeps reporting
 * for monitors it is not assigned to is still seen.
 *
 * And so is a probe's result held to its sender (ProbeReportIdentity, issue
 * #8424): one that names another probe than the one that sent it
 * (PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE), and a job that does not say
 * which probe sent it - a result or a trap (REPORTING_PROBE_NOT_KNOWN_MESSAGE).
 * Both are read from the job's own data, which no attempt changes. These are
 * not harmless the way a probe taken off a monitor is - a probe that reports
 * another's results is misbehaving or tampered with - but retrying adds
 * nothing to the signal: the probe ingest worker logs each refusal once, at
 * warn, naming the probe that sent it and the probe it named
 * (ProcessProbeIngest), and the probe ingest route refuses the same result
 * with a 400 before it is ever queued.
 *
 * And so is a monitor test's result for a test that was not handed to the
 * probe that sent it, or that no longer exists (MonitorTestNotHandedToProbe,
 * issue #8539): the test was claimed by another probe after this probe's
 * claim went stale, or it was deleted. The write is keyed on the test and
 * the probe, and neither changes between attempts. ProcessProbeIngest logs
 * the refusal once, at warn, naming the probe and the test.
 */
export function isNonActionableIngestError(error: unknown): boolean {
  return (
    error instanceof BadDataException &&
    (error.message === ExceptionMessages.MonitorNotFound ||
      error.message === ExceptionMessages.MonitorDisabled ||
      error.message === ExceptionMessages.MonitorArchived ||
      error.message ===
        ExceptionMessages.MonitorDisabledBecauseOfManualIncident ||
      error.message ===
        ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent ||
      error.message === ExceptionMessages.ProbeNotAssignedToMonitor ||
      error.message === PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE ||
      error.message === REPORTING_PROBE_NOT_KNOWN_MESSAGE ||
      error.message === ExceptionMessages.MonitorTestNotHandedToProbe)
  );
}
