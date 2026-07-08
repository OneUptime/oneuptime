import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import MonitorService from "../../../Services/MonitorService";
import MonitorStatusTimelineService from "../../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Monitor model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Monitor().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const QueryMonitorsTool: ObservabilityTool = {
  name: "query_monitors",
  description:
    "List monitors in this project with their current status. Pass monitorId to also get that monitor's recent status timeline (when it went up or down).",
  inputSchema: {
    type: "object",
    properties: {
      monitorId: {
        type: "string",
        description:
          "Get one monitor by its ID, including its recent status timeline.",
      },
      nameSearch: {
        type: "string",
        description: "Filter monitors whose name contains this text.",
      },
      limit: {
        type: "number",
        description: "Maximum monitors to return (default 25, max 50).",
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
    const monitorId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "monitorId",
    );

    if (monitorId) {
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: monitorId,
        select: {
          _id: true,
          name: true,
          monitorType: true,
          currentMonitorStatus: {
            name: true,
          },
        },
        props: ctx.props,
      });

      const timeline: Array<MonitorStatusTimeline> =
        await MonitorStatusTimelineService.findBy({
          query: {
            monitorId: monitorId,
          },
          select: {
            createdAt: true,
            monitorStatus: {
              name: true,
            },
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          limit: 20,
          skip: 0,
          props: ctx.props,
        });

      const rows: Array<JSONObject> = [];

      if (monitor) {
        rows.push({
          record: "monitor",
          id: monitor.id?.toString(),
          name: monitor.name,
          type: monitor.monitorType,
          currentStatus: monitor.currentMonitorStatus?.name,
        });
      }

      for (const item of timeline) {
        rows.push({
          record: "statusChange",
          status: item.monitorStatus?.name,
          at: item.createdAt,
        });
      }

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Monitor ${monitor?.name || monitorId.toString()} + status timeline`,
        citationTarget: {
          type: AIChatCitationTargetType.MonitorView,
          params: { monitorId: monitorId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 25,
      min: 1,
      max: 50,
    });
    const nameSearch: string | undefined = ToolArgs.getString(
      args,
      "nameSearch",
    );

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: nameSearch
        ? {
            name: QueryHelper.search(nameSearch),
          }
        : {},
      select: {
        _id: true,
        name: true,
        monitorType: true,
        currentMonitorStatus: {
          name: true,
        },
      },
      sort: {
        name: SortOrder.Ascending,
      },
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = monitors.map((monitor: Monitor) => {
      return {
        id: monitor.id?.toString(),
        name: monitor.name,
        type: monitor.monitorType,
        currentStatus: monitor.currentMonitorStatus?.name,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Monitors (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Monitors,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
    };
  },
};
