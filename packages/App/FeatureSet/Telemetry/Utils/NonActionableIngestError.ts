import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

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
      error.message === ExceptionMessages.ProbeNotAssignedToMonitor)
  );
}
