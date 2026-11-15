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
        ExceptionMessages.MonitorDisabledBecauseOfScheduledMaintenanceEvent)
  );
}
