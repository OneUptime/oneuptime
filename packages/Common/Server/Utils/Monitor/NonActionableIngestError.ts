import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import logger, { LogAttributes } from "../Logger";
import {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
  REPORTING_PROBE_NOT_KNOWN_MESSAGE,
} from "../Probe/ProbeReportIdentity";

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
 *
 * Shared from here (issue #8069): the telemetry worker completes such a job,
 * and a caller that evaluates one monitor after another goes on to the next
 * (logMonitorEvaluationError).
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

/*
 * What a caller that evaluates one monitor after another logs when
 * MonitorResource throws for one of them - a worker's sweep of heartbeat,
 * server or incoming email monitors, a device's poll or SNMP trap fanned out
 * to the monitors watching it (issue #8069).
 *
 * Each caller leaves out the monitors that are not being monitored before it
 * calls, so a refusal (isNonActionableIngestError) reaches it only when the
 * monitor was paused, archived, disabled or deleted between the caller's
 * read and MonitorResource's own. That is nothing anyone can act on - the
 * monitor is simply not being monitored now - so it is logged at debug, the
 * way the telemetry worker completes such a job quietly, and the caller goes
 * on with the next monitor. Anything else is logged at error, as before.
 *
 * True when it was such a refusal.
 */
export function logMonitorEvaluationError(data: {
  error: unknown;
  // What failed, as the error line says it: "Error evaluating monitor X".
  message: string;
  attributes?: LogAttributes | undefined;
}): boolean {
  if (isNonActionableIngestError(data.error)) {
    logger.debug(
      `${data.message}: refused, as expected for a monitor that changed mid-check (${(data.error as BadDataException).message}). Going on.`,
      data.attributes,
    );

    return true;
  }

  logger.error(data.message, data.attributes);
  logger.error(data.error, data.attributes);

  return false;
}
