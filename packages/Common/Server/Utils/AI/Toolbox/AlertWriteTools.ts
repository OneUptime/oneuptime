import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventType,
} from "../../Workspace/WorkspaceMemberActions";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Acknowledging or resolving an alert changes its state: the permission to
 * create its state timeline row, as the dashboard's state panel asks.
 *
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedStateChangePermissions: Array<Permission> | null = null;
const resolveStateChangePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStateChangePermissions) {
      cachedStateChangePermissions =
        new AlertStateTimeline().getCreatePermissions();
    }
    return cachedStateChangePermissions;
  };

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

  if (!ctx.props.userId) {
    throw new BadDataException(
      "No authenticated user in context; cannot change the alert.",
    );
  }

  // The alert as the person reads it, for the answer below.
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

  /*
   * The change is the alert state timeline row the dashboard's state panel
   * creates, created as the person who asked (WorkspaceMemberActions): held
   * to their permission to change the alert's state, their labels and
   * owners and the project's plan, and credited to them in the alert's
   * timeline and feed.
   */
  const event: WorkspaceEvent = {
    type: WorkspaceEventType.Alert,
    id: alertId,
  };

  if (verb === "acknowledge") {
    await WorkspaceMemberActions.acknowledge({
      event: event,
      props: ctx.props,
    });
  } else {
    await WorkspaceMemberActions.resolve({ event: event, props: ctx.props });
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
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
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
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
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
