import OpenTelemetryAPI, {
  Context,
  Link,
  ROOT_CONTEXT,
  SpanContext,
} from "@opentelemetry/api";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import Telemetry from "../Telemetry";

/*
 * The trace context a queue job carries from the span that enqueued it to
 * the job's own trace.
 *
 * A job is the root of a trace of its own (QueueWorker, `root: true`): it can
 * run long after the request that enqueued it has answered, and one
 * telemetry request's job alone holds thousands of spans. So the job does not
 * continue the enqueuer's trace. Its root span LINKS to the span that
 * enqueued it - Queue.addJob, inside the request or job that called it - as
 * OpenTelemetry's messaging conventions ask of a consumer. Before this, a job
 * and the request behind it could only be matched by their timestamps.
 *
 * The context rides in the job's data under JOB_TRACE_CONTEXT_KEY, as W3C
 * `traceparent` / `tracestate`. BullMQ's own telemetry option would carry it
 * in the job's options instead, but it also wraps every queue and worker
 * operation in spans of its own and makes each job a child of its enqueuer.
 * QueueWorker takes the key out of job.data before the handler sees the job,
 * so no handler, workflow or webhook ever reads it.
 *
 * Repeatable jobs carry none: a cron registered at startup would link every
 * run, for the life of the schedule, to the boot that registered it.
 */

export const JOB_TRACE_CONTEXT_KEY: string = "_oneuptimeTraceContext";

export default class QueueJobTraceContext {
  /*
   * The data to enqueue: `data` as it is, or a copy that also carries the
   * active span's context. The caller's object is never changed - the
   * reconnect registry of repeatable jobs keeps hold of it.
   */
  public static addToJobData(data: JSONObject): JSONObject {
    if (
      !Telemetry.isSpanExportEnabled() ||
      !OpenTelemetryAPI.trace.getActiveSpan() ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return data;
    }

    const carrier: Dictionary<string> = {};

    OpenTelemetryAPI.propagation.inject(
      OpenTelemetryAPI.context.active(),
      carrier,
    );

    if (!carrier["traceparent"]) {
      return data;
    }

    return {
      ...data,
      [JOB_TRACE_CONTEXT_KEY]: carrier,
    };
  }

  /*
   * Take the enqueuer's context out of a job's data, so the handler sees the
   * data as it was enqueued, and return a link to the span that enqueued it
   * - or null when the job carries none, or nothing readable.
   */
  public static takeFromJobData(data: unknown): Link | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    const jobData: Record<string, unknown> = data as Record<string, unknown>;

    if (!(JOB_TRACE_CONTEXT_KEY in jobData)) {
      return null;
    }

    const carrier: unknown = jobData[JOB_TRACE_CONTEXT_KEY];
    delete jobData[JOB_TRACE_CONTEXT_KEY];

    if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) {
      return null;
    }

    try {
      const enqueuedIn: Context = OpenTelemetryAPI.propagation.extract(
        ROOT_CONTEXT,
        carrier,
      );
      const spanContext: SpanContext | undefined =
        OpenTelemetryAPI.trace.getSpanContext(enqueuedIn);

      if (
        !spanContext ||
        !OpenTelemetryAPI.trace.isSpanContextValid(spanContext)
      ) {
        return null;
      }

      return { context: spanContext };
    } catch {
      // A carrier no propagator can read is no link, never a failed job.
      return null;
    }
  }
}
