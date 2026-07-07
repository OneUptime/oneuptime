import Alert from "../../../../Models/DatabaseModels/Alert";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
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

// Derived from the model ACL so the tool gate can never drift from RBAC.
const READ_PERMISSIONS: Array<Permission> = new Alert().getReadPermissions();

export const QueryAlertsTool: ObservabilityTool = {
  name: "query_alerts",
  description:
    "Query alerts in this project. Returns the most recent alerts with their current state and severity. Pass alertId to get full details of one alert.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "Get one alert by its ID (includes description).",
      },
      createdWithinHours: {
        type: "number",
        description:
          "Only alerts created within this many hours (default 24, max 720).",
      },
      limit: {
        type: "number",
        description: "Maximum alerts to return (default 10, max 25).",
      },
    },
  },
  requiredPermissions: READ_PERMISSIONS,
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    if (alertId) {
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          _id: true,
          title: true,
          description: true,
          alertNumber: true,
          createdAt: true,
          currentAlertState: {
            name: true,
          },
          alertSeverity: {
            name: true,
          },
        },
        props: ctx.props,
      });

      const rows: Array<JSONObject> = alert
        ? [
            {
              id: alert.id?.toString(),
              alertNumber: alert.alertNumber,
              title: alert.title,
              description: alert.description,
              state: alert.currentAlertState?.name,
              severity: alert.alertSeverity?.name,
              createdAt: alert.createdAt,
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Alert ${alert?.alertNumber ? `#${alert.alertNumber}` : alertId.toString()}`,
        citationTarget: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: alertId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.alertList({
                title: `Alert #${alert?.alertNumber ?? ""}`.trim(),
                items: rows,
                link: {
                  type: AIChatCitationTargetType.AlertView,
                  params: { alertId: alertId.toString() },
                },
              })
            : undefined,
      };
    }

    const createdWithinHours: number = ToolArgs.getNumber(
      args,
      "createdWithinHours",
      { defaultValue: 24, min: 1, max: 720 },
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * createdWithinHours,
    );

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        createdAt: QueryHelper.inBetween(startTime, endTime),
      },
      select: {
        _id: true,
        title: true,
        alertNumber: true,
        createdAt: true,
        currentAlertState: {
          name: true,
        },
        alertSeverity: {
          name: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = alerts.map((alert: Alert) => {
      return {
        id: alert.id?.toString(),
        alertNumber: alert.alertNumber,
        title: alert.title,
        state: alert.currentAlertState?.name,
        severity: alert.alertSeverity?.name,
        createdAt: alert.createdAt,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Alerts, last ${createdWithinHours}h (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Alerts,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.alertList({
              title: `Alerts (${rows.length})`,
              description: `Created in the last ${createdWithinHours}h`,
              items: rows,
              link: { type: AIChatCitationTargetType.Alerts },
            })
          : undefined,
    };
  },
};
