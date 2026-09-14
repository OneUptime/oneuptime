/*
 * What kind of work was in flight when something happened.
 *
 * This is the axis that makes class-based fault classification safe. The same
 * exception class means different things depending on who asked for the work:
 *
 *   throw new BadDataException("Monitor type required to create monitor.")
 *      -> inside an HTTP request: the caller sent a bad request. Not our bug.
 *
 *   throw new BadDataException("No job found with name: " + name)
 *      -> inside a cron registration: an internal invariant we violated.
 *         Very much our bug.
 *
 * They are indistinguishable at the throw site and perfectly distinguishable
 * by unit of work, so ErrorClassResolver promotes user-error and
 * expected-denial back to code-fault everywhere except an HTTP request.
 *
 * Seed this EXPLICITLY at every entry point. TelemetryContext.runWithContext
 * inherits the enclosing scope's attributes, so an unset value would let a
 * request's "http-request" marker leak into background work started from
 * inside that request.
 */
export enum UnitOfWork {
  HttpRequest = "http-request",
  WorkerJob = "worker-job",
  CronJob = "cron-job",
  ProbeCheck = "probe-check",
  Notification = "notification",
  Startup = "startup",
}

/**
 * Which deployment role produced this telemetry.
 *
 * Distinct from UnitOfWork, and distinct from `service.name`: the Helm chart
 * runs the worker as a separate Deployment but from the same image and the
 * same entrypoint (it only flips DISABLE_QUEUE_WORKERS), so worker pods report
 * `service.name = "api"`. Until that changes — which re-keys every worker
 * exception fingerprint and therefore needs its own release — this attribute
 * is how "which component" becomes filterable.
 */
export enum TelemetryComponent {
  Api = "api",
  Worker = "worker",
  Cron = "cron",
  Probe = "probe",
  Notification = "notification",
}

/**
 * Ambient TelemetryContext / span attribute keys. String constants rather than
 * inline literals so the emit path, drop filters, dashboards and tests cannot
 * drift apart on spelling.
 */
export const UNIT_OF_WORK_ATTRIBUTE_KEY: string = "oneuptime.unit_of_work";
export const COMPONENT_ATTRIBUTE_KEY: string = "oneuptime.component";

/** Span/log attribute carrying the resolved fault domain. */
export const ERROR_CLASS_ATTRIBUTE_KEY: string = "error.class";
