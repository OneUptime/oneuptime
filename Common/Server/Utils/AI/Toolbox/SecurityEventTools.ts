import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import SecurityEventService from "../../../Services/SecurityEventService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  TimeRangeSchemaProperties,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * AI toolbox over the SecurityEvent table — the "AI security analyst"
 * surface. Read-only; executes under the requesting user's permission
 * props like every other analytics tool.
 */

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily — this module loads through the service import graph
 * before the model class is fully wired, so calling a model method at
 * import time throws a circular-dependency TypeError.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new SecurityEvent().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const SearchSecurityEventsTool: ObservabilityTool = {
  name: "search_security_events",
  description:
    "Search SIEM security events (normalized to OCSF). Filter by time range, severity, event class, message text, user, host, or any observable (IP, hostname, username). Use this to investigate what security activity involved a given entity, or what fired recently.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      severityNames: {
        type: "array",
        items: { type: "string" },
        description:
          'Filter by OCSF severity, e.g. ["Critical", "High"] or ["Medium"].',
      },
      classNames: {
        type: "array",
        items: { type: "string" },
        description:
          'Filter by OCSF event class, e.g. ["Authentication", "Detection Finding", "DNS Activity"].',
      },
      messageSearchText: {
        type: "string",
        description: "Only events whose message contains this text.",
      },
      principalUser: {
        type: "string",
        description: "Only events where this user is the actor.",
      },
      principalHost: {
        type: "string",
        description: "Only events where this host is the actor.",
      },
      observable: {
        type: "string",
        description:
          "Only events mentioning this observable anywhere (user, hostname, IP, domain). Broader than principalUser/principalHost.",
      },
      limit: {
        type: "number",
        description: "Maximum events to return (default 25, max 50).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: 50,
    });

    const query: JSONObject = {
      time: new InBetween(startTime, endTime),
    };

    const severityNames: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "severityNames",
    );
    if (severityNames) {
      query["severityName"] = new Includes(severityNames);
    }

    const classNames: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "classNames",
    );
    if (classNames) {
      query["className"] = new Includes(classNames);
    }

    const messageSearchText: string | undefined = ToolArgs.getString(
      args,
      "messageSearchText",
    );
    if (messageSearchText) {
      query["message"] = new Search(messageSearchText);
    }

    const principalUser: string | undefined = ToolArgs.getString(
      args,
      "principalUser",
    );
    if (principalUser) {
      query["principalUser"] = principalUser;
    }

    const principalHost: string | undefined = ToolArgs.getString(
      args,
      "principalHost",
    );
    if (principalHost) {
      query["principalHost"] = principalHost;
    }

    const observable: string | undefined = ToolArgs.getString(
      args,
      "observable",
    );
    if (observable) {
      query["observables"] = new Includes([observable]);
    }

    const events: Array<SecurityEvent> = await SecurityEventService.findBy({
      query: query as never,
      select: {
        time: true,
        severityName: true,
        className: true,
        message: true,
        principalUser: true,
        principalHost: true,
        principalIp: true,
        targetHost: true,
        vendorName: true,
        ruleName: true,
      } as never,
      sort: {
        time: SortOrder.Descending,
      } as never,
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = events.map(
      (event: SecurityEvent): JSONObject => {
        return {
          time: event.time,
          severity: event.severityName,
          class: event.className,
          message: event.message,
          principalUser: event.principalUser,
          principalHost: event.principalHost,
          principalIp: event.principalIp,
          targetHost: event.targetHost,
          vendor: event.vendorName,
          rule: event.ruleName,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Security events ${startTime.toISOString()} – ${endTime.toISOString()} (${serialized.rowCount} shown)`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Security Events (${rows.length})`,
              description: `${startTime.toISOString()} – ${endTime.toISOString()}`,
              columns: [
                { key: "time", title: "Time", type: "date" },
                { key: "severity", title: "Severity", type: "text" },
                { key: "class", title: "Class", type: "text" },
                { key: "message", title: "Message", type: "text" },
                { key: "principalHost", title: "Host", type: "text" },
              ],
              rows: rows,
            })
          : undefined,
    };
  },
};

// Sample size for the in-code aggregation below.
const SUMMARY_SAMPLE_LIMIT: number = 500;

export const SecurityEventSummaryTool: ObservabilityTool = {
  name: "security_event_summary",
  description:
    "Summarize security event volume by event class and severity over a time range. Use this first to understand the shape of security activity before drilling into raw events with search_security_events.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      observable: {
        type: "string",
        description:
          "Optionally scope the summary to events mentioning this observable (user, hostname, IP).",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const { startTime, endTime } = ToolArgs.getTimeRange(args, {
      defaultHours: 24,
      maxDays: 30,
    });

    const query: JSONObject = {
      time: new InBetween(startTime, endTime),
    };

    const observable: string | undefined = ToolArgs.getString(
      args,
      "observable",
    );
    if (observable) {
      query["observables"] = new Includes([observable]);
    }

    /*
     * Aggregate in code over a bounded sample rather than raw SQL: findBy
     * runs the model layer's permission scoping, which raw aggregation
     * would bypass. The sample cap is stated in the result so the model
     * knows when counts are a floor rather than a total.
     */
    const events: Array<SecurityEvent> = await SecurityEventService.findBy({
      query: query as never,
      select: {
        className: true,
        severityName: true,
      } as never,
      sort: {
        time: SortOrder.Descending,
      } as never,
      limit: SUMMARY_SAMPLE_LIMIT,
      skip: 0,
      props: ctx.props,
    });

    const countsByKey: Map<string, JSONObject> = new Map<string, JSONObject>();

    for (const event of events) {
      const className: string = event.className || "Base Event";
      const severity: string = event.severityName || "Unknown";
      const key: string = `${className}|${severity}`;

      const existing: JSONObject | undefined = countsByKey.get(key);

      if (existing) {
        existing["count"] = (existing["count"] as number) + 1;
      } else {
        countsByKey.set(key, {
          class: className,
          severity: severity,
          count: 1,
        });
      }
    }

    const rows: Array<JSONObject> = Array.from(countsByKey.values()).sort(
      (a: JSONObject, b: JSONObject): number => {
        return (b["count"] as number) - (a["count"] as number);
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const sampleNote: string =
      events.length >= SUMMARY_SAMPLE_LIMIT
        ? ` (based on the most recent ${SUMMARY_SAMPLE_LIMIT} events — counts are a floor)`
        : "";

    return {
      dataForLlm: serialized.text + sampleNote,
      rowCount: serialized.rowCount,
      citationLabel: `Security event summary ${startTime.toISOString()} – ${endTime.toISOString()}${sampleNote}`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: "Security events by class and severity",
              description: `${startTime.toISOString()} – ${endTime.toISOString()}${sampleNote}`,
              columns: [
                { key: "class", title: "Event Class", type: "text" },
                { key: "severity", title: "Severity", type: "text" },
                { key: "count", title: "Count", type: "number" },
              ],
              rows: rows,
            })
          : undefined,
    };
  },
};
