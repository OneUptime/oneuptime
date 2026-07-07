import Alert from "../../../../Models/DatabaseModels/Alert";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

const UPDATE_PERMISSIONS = new Alert().getUpdatePermissions();

async function changeAlertStateTool(data: {
  args: JSONObject;
  ctx: ToolContext;
  verb: "acknowledge" | "resolve";
}): Promise<ToolExecutionResult> {
  const { args, ctx, verb } = data;

  const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");
  if (!alertId) {
    throw new BadDataException(
      "alertId is required. Use query_alerts to find it first.",
    );
  }

  const userId: ObjectID | undefined = ctx.props.userId;
  if (!userId) {
    throw new BadDataException(
      "No authenticated user in context; cannot change the alert.",
    );
  }

  // Confirm the alert is visible to this user under their RBAC.
  const alert: Alert | null = await AlertService.findOneById({
    id: alertId,
    select: {
      _id: true,
      alertNumber: true,
      title: true,
    },
    props: ctx.props,
  });

  if (!alert) {
    throw new BadDataException(
      "Alert not found (or you do not have access to it).",
    );
  }

  if (verb === "acknowledge") {
    await AlertService.acknowledgeAlert(alertId, userId);
  } else {
    await AlertService.resolveAlert(alertId, userId);
  }

  const newStateName: string =
    verb === "acknowledge" ? "Acknowledged" : "Resolved";

  const alertIdString: string = alertId.toString();

  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    {
      id: alertIdString,
      alertNumber: alert.alertNumber,
      title: alert.title,
      newState: newStateName,
    },
  ]);

  return {
    dataForLlm: `Alert #${alert.alertNumber} ("${alert.title}") is now ${newStateName}.\n${serialized.text}`,
    rowCount: 1,
    citationLabel: `${newStateName} alert #${alert.alertNumber}`,
    citationTarget: {
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: alertIdString },
    },
    redactionCount: serialized.redactionCount,
    isTruncated: false,
    widget: WidgetBuilder.resourceCard({
      title: `Alert ${newStateName.toLowerCase()}`,
      resourceType: "Alert",
      heading: `#${alert.alertNumber} · ${alert.title}`,
      subheading: `Now ${newStateName}`,
      fields: [
        { label: "Number", value: `#${alert.alertNumber ?? ""}` },
        { label: "State", value: newStateName },
      ],
      link: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertIdString },
      },
    }),
  };
}

export const AcknowledgeAlertTool: ObservabilityTool = {
  name: "acknowledge_alert",
  description:
    "Acknowledge an alert (move it to the acknowledged state) by its alertId. Find the alertId with query_alerts first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The alert's ID (required).",
      },
    },
    required: ["alertId"],
  },
  requiredPermissions: UPDATE_PERMISSIONS,
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Acknowledge alert ${ToolArgs.getString(args, "alertId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeAlertStateTool({ args, ctx, verb: "acknowledge" });
  },
};

export const ResolveAlertTool: ObservabilityTool = {
  name: "resolve_alert",
  description:
    "Resolve an alert (move it to the resolved state) by its alertId. Find the alertId with query_alerts first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The alert's ID (required).",
      },
    },
    required: ["alertId"],
  },
  requiredPermissions: UPDATE_PERMISSIONS,
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Resolve alert ${ToolArgs.getString(args, "alertId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeAlertStateTool({ args, ctx, verb: "resolve" });
  },
};
