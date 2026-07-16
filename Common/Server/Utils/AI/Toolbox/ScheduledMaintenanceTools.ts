import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import OneUptimeDate from "../../../../Types/Date";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model class is fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new ScheduledMaintenance().getReadPermissions();
    }
    return cachedReadPermissions;
  };

function joinNames(items: Array<{ name?: string }> | undefined): string {
  return (items || [])
    .map((item: { name?: string }) => {
      return item.name || "";
    })
    .filter((value: string) => {
      return value.length > 0;
    })
    .join(", ");
}

export const QueryScheduledMaintenanceTool: ObservabilityTool = {
  name: "query_scheduled_maintenance",
  description:
    "Query scheduled maintenance events (planned maintenance windows) in this project — past, ongoing and upcoming. Returns events whose window overlaps the requested range, with their state, window and affected monitors. Pass scheduledMaintenanceId to get full details of one event. Use the event's window to judge whether telemetry changes were expected maintenance rather than a real problem.",
  inputSchema: {
    type: "object",
    properties: {
      scheduledMaintenanceId: {
        type: "string",
        description:
          "Get one scheduled maintenance event by its ID (includes description and affected monitors).",
      },
      pastDays: {
        type: "number",
        description:
          "Include events whose window ends within this many days in the past (default 30, max 365).",
      },
      upcomingDays: {
        type: "number",
        description:
          "Include events whose window starts within this many days in the future (default 30, max 365).",
      },
      limit: {
        type: "number",
        description: "Maximum events to return (default 10, max 25).",
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
    const scheduledMaintenanceId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "scheduledMaintenanceId",
    );

    if (scheduledMaintenanceId) {
      const event: ScheduledMaintenance | null =
        await ScheduledMaintenanceService.findOneById({
          id: scheduledMaintenanceId,
          select: {
            _id: true,
            title: true,
            description: true,
            scheduledMaintenanceNumber: true,
            createdAt: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: {
              name: true,
            },
            monitors: {
              _id: true,
              name: true,
            },
            labels: {
              name: true,
            },
          },
          props: ctx.props,
        });

      /*
       * Surface the blast radius (affected monitors) and the exact window so
       * the model can scope log/trace/metric queries to the maintenance
       * period instead of guessing which hours were "expected downtime".
       */
      const rows: Array<JSONObject> = event
        ? [
            {
              id: event.id?.toString(),
              scheduledMaintenanceNumber: event.scheduledMaintenanceNumber,
              title: event.title,
              description: event.description,
              state: event.currentScheduledMaintenanceState?.name,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              createdAt: event.createdAt,
              affectedMonitors: joinNames(event.monitors) || undefined,
              labels: joinNames(event.labels) || undefined,
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Scheduled maintenance ${
          event?.scheduledMaintenanceNumber
            ? `#${event.scheduledMaintenanceNumber}`
            : scheduledMaintenanceId.toString()
        }`,
        citationTarget: {
          type: AIChatCitationTargetType.ScheduledMaintenanceView,
          params: {
            scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.table({
                title:
                  `Scheduled maintenance #${event?.scheduledMaintenanceNumber ?? ""}`.trim(),
                columns: [
                  { key: "title", title: "Title", type: "text" },
                  { key: "state", title: "State", type: "text" },
                  { key: "startsAt", title: "Starts", type: "date" },
                  { key: "endsAt", title: "Ends", type: "date" },
                  {
                    key: "affectedMonitors",
                    title: "Affected monitors",
                    type: "text",
                  },
                ],
                rows: rows,
                link: {
                  type: AIChatCitationTargetType.ScheduledMaintenanceView,
                  params: {
                    scheduledMaintenanceId: scheduledMaintenanceId.toString(),
                  },
                },
              })
            : undefined,
      };
    }

    const pastDays: number = ToolArgs.getNumber(args, "pastDays", {
      defaultValue: 30,
      min: 0,
      max: 365,
    });
    const upcomingDays: number = ToolArgs.getNumber(args, "upcomingDays", {
      defaultValue: 30,
      min: 0,
      max: 365,
    });
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });

    const now: Date = OneUptimeDate.getCurrentDate();
    const windowStart: Date = OneUptimeDate.addRemoveDays(now, -1 * pastDays);
    const windowEnd: Date = OneUptimeDate.addRemoveDays(now, upcomingDays);

    // Overlap: the event's window intersects [windowStart, windowEnd].
    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          startsAt: QueryHelper.lessThanEqualTo(windowEnd),
          endsAt: QueryHelper.greaterThanEqualTo(windowStart),
        },
        select: {
          _id: true,
          title: true,
          scheduledMaintenanceNumber: true,
          startsAt: true,
          endsAt: true,
          currentScheduledMaintenanceState: {
            name: true,
          },
          monitors: {
            name: true,
          },
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      });

    const rows: Array<JSONObject> = events.map(
      (event: ScheduledMaintenance) => {
        return {
          id: event.id?.toString(),
          scheduledMaintenanceNumber: event.scheduledMaintenanceNumber,
          title: event.title,
          state: event.currentScheduledMaintenanceState?.name,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          affectedMonitors: joinNames(event.monitors) || undefined,
        };
      },
    );

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Scheduled maintenance, -${pastDays}d/+${upcomingDays}d (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.ScheduledMaintenanceEvents,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Scheduled maintenance (${rows.length})`,
              description: `Windows overlapping the last ${pastDays}d and next ${upcomingDays}d`,
              columns: [
                {
                  key: "scheduledMaintenanceNumber",
                  title: "#",
                  type: "number",
                },
                { key: "title", title: "Title", type: "text" },
                { key: "state", title: "State", type: "text" },
                { key: "startsAt", title: "Starts", type: "date" },
                { key: "endsAt", title: "Ends", type: "date" },
              ],
              rows: rows,
              link: {
                type: AIChatCitationTargetType.ScheduledMaintenanceEvents,
              },
            })
          : undefined,
    };
  },
};
