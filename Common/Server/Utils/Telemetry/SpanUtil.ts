import OpenTelemetryAPI, { Span } from "@opentelemetry/api";
import { DisableTelemetry } from "../../EnvironmentConfig";

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
   * Add attributes to the currently active span.
   * Safe to call even when there is no active span or telemetry is disabled.
   */
  public static addAttributesToCurrentSpan(
    attributes: SpanAttributes,
  ): void {
    if (DisableTelemetry) {
      return;
    }

    const span: Span | undefined = OpenTelemetryAPI.trace.getActiveSpan();

    if (!span) {
      return;
    }

    this.addAttributesToSpan({ span, attributes });
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

  /**
   * Build span attributes from a request-like object.
   * Similar to getLogAttributesFromRequest in Logger but for spans.
   */
  public static getSpanAttributesFromRequest(
    req?: { requestId?: string; tenantId?: { toString(): string }; userAuthorization?: { userId?: { toString(): string } } } | null,
  ): SpanAttributes {
    if (!req) {
      return {};
    }

    const attributes: SpanAttributes = {};

    if (req.requestId) {
      attributes["requestId"] = req.requestId;
    }

    if (req.tenantId) {
      attributes["projectId"] = req.tenantId.toString();
    }

    if (req.userAuthorization?.userId) {
      attributes["userId"] =
        req.userAuthorization.userId.toString();
    }

    return attributes;
  }
}
