import { DisableTelemetry } from "../../EnvironmentConfig";
import TelemetryContext from "./TelemetryContext";
import OpenTelemetryAPI, { Span } from "@opentelemetry/api";
import Telemetry from "../Telemetry";

export interface SpanAttributes {
  userId?: string | undefined;
  projectId?: string | undefined;
  requestId?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
  monitorId?: string | undefined;
  statusPageId?: string | undefined;
  scheduledMaintenanceId?: string | undefined;
  onCallDutyPolicyId?: string | undefined;
  onCallDutyPolicyScheduleId?: string | undefined;
  incidentEpisodeId?: string | undefined;
  alertEpisodeId?: string | undefined;
  workspaceType?: string | undefined;
  channelId?: string | undefined;
  [key: string]: string | number | boolean | undefined;
}

export default class SpanUtil {
  /**
   * Add attributes to the current unit of work.
   *
   * This does two things:
   *  1. Merges the attributes into the ambient {@link TelemetryContext} so that
   *     every span and log produced later in this request/job/check inherits
   *     them (OTel span attributes do NOT propagate parent -> child on their
   *     own, so this is what actually makes context flow downstream).
   *  2. Tags the currently active span immediately, if there is one.
   *
   * Safe to call even when there is no active span or scope, or when telemetry
   * is disabled.
   */
  public static addAttributesToCurrentSpan(attributes: SpanAttributes): void {
    if (DisableTelemetry) {
      return;
    }

    // Propagate to all downstream spans + logs via the ambient context.
    TelemetryContext.setAttributes(attributes);

    const span: Span | undefined = OpenTelemetryAPI.trace.getActiveSpan();

    if (!span) {
      return;
    }

    this.addAttributesToSpan({ span, attributes });
  }

  /**
   * Record a thrown value on the currently active span, without ending it.
   *
   * For code that CATCHES an error and signals failure by another route —
   * Express middleware calling `next(err)` being the canonical case. The
   * @CaptureSpan frame around such a method sees a normal return, so its own
   * recorder never runs and the error would otherwise be invisible on that
   * span.
   *
   * Always prefer this to calling `span.recordException(err)` directly: the
   * OTel SDK types the event from `exception.code` before `exception.name`,
   * and every OneUptime ExceptionCode is an HTTP status, so the raw call
   * produces exception groups literally named "400" and "422". This path also
   * applies fault classification, so a rejected API key produces a `fault`
   * event rather than an Issue.
   *
   * Safe to call with no active span or with telemetry disabled.
   */
  public static recordExceptionOnCurrentSpan(exception: unknown): void {
    if (DisableTelemetry) {
      return;
    }

    const span: Span | undefined = OpenTelemetryAPI.trace.getActiveSpan();

    if (!span) {
      return;
    }

    Telemetry.recordExceptionOnSpan({ span, exception });
  }

  /**
   * Add attributes to a specific span.
   */
  public static addAttributesToSpan(data: {
    span: Span;
    attributes: SpanAttributes;
  }): void {
    const { span, attributes } = data;

    for (const key in attributes) {
      const value: string | number | boolean | undefined = attributes[key];

      if (value !== undefined && value !== null) {
        span.setAttribute(key, value);
      }
    }
  }
}
