import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";

/*
 * Ingest failures that are expected and that nobody can act on: the job names
 * a monitor that does not exist (e.g. a secret key referencing a deleted
 * monitor), or one that is disabled or archived. The telemetry worker
 * completes these jobs instead of failing them - retrying provides no value
 * and only creates noise.
 */
export function isNonActionableIngestError(error: unknown): boolean {
  return (
    error instanceof BadDataException &&
    (error.message === ExceptionMessages.MonitorNotFound ||
      error.message === ExceptionMessages.MonitorDisabled ||
      error.message === ExceptionMessages.MonitorArchived)
  );
}
