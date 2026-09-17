import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../Services/ScheduledMaintenanceService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
  TimeRangeSchemaProperties,
} from "./ToolTypes";

/*
 * Gate on Monitor read permissions. This is defense-in-depth only: every
 * source query below runs under the requesting user's props, so a user who
 * cannot see monitors / exceptions / maintenance simply gets no rows from that
 * source — never another user's data. Resolved lazily to avoid the
 * import-time circular-dependency TypeError other tools document.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

// One normalized entry in the merged "what changed" feed.
interface ChangeEvent {
  at: Date;
  change: string;
  detail: string;
}

export const RecentChangesTool: ObservabilityTool = {
  name: "recent_changes",
  description:
    "Get a single chronological feed of what changed in a time window: newly-seen exceptions, monitor status changes (up/down), and scheduled maintenance overlapping the window. This is the highest-yield way to answer 'what changed right before this started?' during root-cause analysis — call it with the window around when a problem began.",
  inputSchema: {
    type: "object",
    properties: {
      ...TimeRangeSchemaProperties,
      limitPerSource: {
        type: "number",
        description:
          "Maximum items to pull from each source (exceptions, monitor changes, maintenance) before merging. Default 15, max 30.",
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
    const timeRange: { startTime: Date; endTime: Date } = ToolArgs.getTimeRange(
      args,
      { defaultHours: 24, maxDays: 30 },
    );
    const startTime: Date = timeRange.startTime;
    const endTime: Date = timeRange.endTime;

    const limitPerSource: number = ToolArgs.getNumber(args, "limitPerSource", {
      defaultValue: 15,
      min: 1,
      max: 30,
    });

    const events: Array<ChangeEvent> = [];

    // 1) Newly-seen exceptions — their first occurrence falls inside the window.
    try {
      const exceptions: Array<TelemetryException> =
        await TelemetryExceptionService.findBy({
          query: {
            firstSeenAt: QueryHelper.inBetween(startTime, endTime),
          } as never,
          select: {
            message: true,
            exceptionType: true,
            firstSeenAt: true,
            occuranceCount: true,
          },
          sort: { firstSeenAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const exception of exceptions) {
        if (!exception.firstSeenAt) {
          continue;
        }
        events.push({
          at: exception.firstSeenAt,
          change: "new_exception",
          detail: `${exception.exceptionType || "Exception"}: ${exception.message || ""} (x${exception.occuranceCount ?? 0})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: exceptions source skipped: ${error}`);
    }

    // 2) Monitor status changes (up/down) inside the window.
    try {
      const statusChanges: Array<MonitorStatusTimeline> =
        await MonitorStatusTimelineService.findBy({
          query: {
            createdAt: QueryHelper.inBetween(startTime, endTime),
          },
          select: {
            createdAt: true,
            monitor: { name: true },
            monitorStatus: { name: true },
          },
          sort: { createdAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const statusChange of statusChanges) {
        if (!statusChange.createdAt) {
          continue;
        }
        events.push({
          at: statusChange.createdAt,
          change: "monitor_status_change",
          detail: `${statusChange.monitor?.name || "Monitor"} → ${statusChange.monitorStatus?.name || "unknown"}`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: monitor source skipped: ${error}`);
    }

    /*
     * 3) Scheduled maintenance overlapping the window (started before it ended,
     *    ends after it started).
     */
    try {
      const maintenanceEvents: Array<ScheduledMaintenance> =
        await ScheduledMaintenanceService.findBy({
          query: {
            startsAt: QueryHelper.lessThanEqualTo(endTime),
            endsAt: QueryHelper.greaterThanEqualTo(startTime),
          },
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            currentScheduledMaintenanceState: { name: true },
          },
          sort: { startsAt: SortOrder.Descending },
          limit: limitPerSource,
          skip: 0,
          props: ctx.props,
        });

      for (const maintenance of maintenanceEvents) {
        if (!maintenance.startsAt) {
          continue;
        }
        events.push({
          at: maintenance.startsAt,
          change: "scheduled_maintenance",
          detail: `${maintenance.title || "Maintenance"} (${maintenance.currentScheduledMaintenanceState?.name || "scheduled"})`,
        });
      }
    } catch (error) {
      logger.debug(`recent_changes: maintenance source skipped: ${error}`);
    }

    // Merge into one chronological feed, most recent first.
    events.sort((a: ChangeEvent, b: ChangeEvent) => {
      return b.at.getTime() - a.at.getTime();
    });

    const rows: Array<JSONObject> = events.map((event: ChangeEvent) => {
      return {
        at: event.at,
        change: event.change,
        detail: event.detail,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Changes ${startTime.toISOString()} → ${endTime.toISOString()} (${serialized.rowCount} events)`,
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
