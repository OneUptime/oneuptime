import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
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

import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Incident model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedCreatePermissions: Array<Permission> | null = null;
const resolveCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedCreatePermissions) {
      cachedCreatePermissions = new Incident().getCreatePermissions();
    }
    return cachedCreatePermissions;
  };
/*
 * Acknowledging or resolving an incident changes its state: the permission
 * to create its state timeline row, as the dashboard's state panel asks.
 */
let cachedStateChangePermissions: Array<Permission> | null = null;
const resolveStateChangePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedStateChangePermissions) {
      cachedStateChangePermissions =
        new IncidentStateTimeline().getCreatePermissions();
    }
    return cachedStateChangePermissions;
  };

/*
 * Write tools mutate the project. They are gated twice: once by the tool's
 * requiredPermissions (RBAC) and once by the conversation's permission mode
 * (approval / auto-run / hidden in read-only). Each write is the one the
 * dashboard makes for the same change, made with the requesting user's
 * props (ctx.props, never a tool argument), so it is held to what that
 * person may do and is credited to them.
 */

export const CreateIncidentTool: ObservabilityTool = {
  name: "create_incident",
  description:
    "Declare (create) a new incident in this project. Provide a clear title and a description of the problem. Optionally set the severity by name (must match an existing incident severity); otherwise the project's first-defined severity is used. Use this when the user asks you to open, declare or create an incident.",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short, specific incident title (required).",
      },
      description: {
        type: "string",
        description:
          "Markdown description of what is happening, impact and any known cause.",
      },
      severityName: {
        type: "string",
        description:
          "Name of an existing incident severity (e.g. 'SEV1', 'Critical'). Defaults to the project's first-defined severity.",
      },
    },
    required: ["title"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Create incident: ${ToolArgs.getString(args, "title") || "Untitled"}`;
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const title: string | undefined = ToolArgs.getString(args, "title");
    if (!title) {
      throw new BadDataException("title is required to create an incident.");
    }

    const description: string = ToolArgs.getString(args, "description") || "";

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot create an incident.",
      );
    }

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {},
        select: {
          _id: true,
          name: true,
          order: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: 50,
        skip: 0,
        props: ctx.props,
      });

    if (severities.length === 0) {
      throw new BadDataException(
        "No incident severities are configured for this project. Add one in Project Settings > Incidents > Severities first.",
      );
    }

    let severity: IncidentSeverity = severities[0]!;
    const severityName: string | undefined = ToolArgs.getString(
      args,
      "severityName",
    );
    if (severityName) {
      const match: IncidentSeverity | undefined = severities.find(
        (item: IncidentSeverity) => {
          return item.name?.toLowerCase() === severityName.toLowerCase();
        },
      );
      if (match) {
        severity = match;
      }
    }

    const incident: Incident = new Incident();
    incident.projectId = ctx.projectId;
    incident.title = title;
    /*
     * The model wrote the description from what it read, telemetry included:
     * it stays Markdown, but nothing in it acts on its own in the incident's
     * feed, Slack and Teams (FeedMarkdown.aiWritten).
     */
    incident.description = FeedMarkdown.aiWritten(description).toString();
    incident.incidentSeverityId = severity.id!;
    incident.createdByUserId = userId;
    incident.rootCause = "Incident created via the OneUptime AI copilot.";

    // Created under the user's props so the model-layer RBAC applies too.
    const created: Incident = await IncidentService.create({
      data: incident,
      props: ctx.props,
    });

    const incidentIdString: string = created.id!.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        id: incidentIdString,
        incidentNumber: created.incidentNumber,
        title: title,
        severity: severity.name,
      },
    ]);

    return {
      dataForLlm: `Successfully created incident #${created.incidentNumber} ("${title}", severity ${severity.name}).\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Created incident #${created.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Incident created",
        resourceType: "Incident",
        heading: `#${created.incidentNumber} · ${title}`,
        subheading: severity.name ? `Severity: ${severity.name}` : undefined,
        fields: [
          { label: "Number", value: `#${created.incidentNumber ?? ""}` },
          { label: "Severity", value: severity.name || "—" },
          ...(description
            ? [
                {
                  label: "Description",
                  value:
                    description.length > 200
                      ? `${description.substring(0, 200)}…`
                      : description,
                },
              ]
            : []),
        ],
        link: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};

async function changeIncidentStateTool(data: {
  args: JSONObject;
  ctx: ToolContext;
  verb: "acknowledge" | "resolve";
}): Promise<ToolExecutionResult> {
  const { args, ctx, verb } = data;

  const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
    args,
    "incidentId",
  );
  if (!incidentId) {
    throw new BadDataException(
      "incidentId is required. Use query_incidents to find it first.",
    );
  }

  if (!ctx.props.userId) {
    throw new BadDataException(
      "No authenticated user in context; cannot change the incident.",
    );
  }

  // The incident as the person reads it, for the answer below.
  const incident: Incident | null = await IncidentService.findOneById({
    id: incidentId,
    select: {
      _id: true,
      incidentNumber: true,
      title: true,
    },
    props: ctx.props,
  });

  if (!incident) {
    throw new BadDataException(
      "Incident not found (or you do not have access to it).",
    );
  }

  /*
   * The change is the incident state timeline row the dashboard's state
   * panel creates, created as the person who asked
   * (WorkspaceMemberActions): held to their permission to change the
   * incident's state, their labels and owners and the project's plan, and
   * credited to them in the incident's timeline and feed.
   */
  const event: WorkspaceEvent = {
    type: WorkspaceEventType.Incident,
    id: incidentId,
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

  const incidentIdString: string = incidentId.toString();

  const serialized: SerializedResult = ToolResultSerializer.serializeRows([
    {
      id: incidentIdString,
      incidentNumber: incident.incidentNumber,
      title: incident.title,
      newState: newStateName,
    },
  ]);

  return {
    dataForLlm: `Incident #${incident.incidentNumber} ("${incident.title}") is now ${newStateName}.\n${serialized.text}`,
    rowCount: 1,
    citationLabel: `${newStateName} incident #${incident.incidentNumber}`,
    citationTarget: {
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: incidentIdString },
    },
    redactionCount: serialized.redactionCount,
    isTruncated: false,
    widget: WidgetBuilder.resourceCard({
      title: `Incident ${newStateName.toLowerCase()}`,
      resourceType: "Incident",
      heading: `#${incident.incidentNumber} · ${incident.title}`,
      subheading: `Now ${newStateName}`,
      fields: [
        { label: "Number", value: `#${incident.incidentNumber ?? ""}` },
        { label: "State", value: newStateName },
      ],
      link: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
    }),
  };
}

export const AcknowledgeIncidentTool: ObservabilityTool = {
  name: "acknowledge_incident",
  description:
    "Acknowledge an incident (move it to the acknowledged state) by its incidentId. Find the incidentId with query_incidents first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
    },
    required: ["incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Acknowledge incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeIncidentStateTool({ args, ctx, verb: "acknowledge" });
  },
};

export const ResolveIncidentTool: ObservabilityTool = {
  name: "resolve_incident",
  description:
    "Resolve an incident (move it to the resolved state) by its incidentId. Find the incidentId with query_incidents first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
    },
    required: ["incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveStateChangePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Resolve incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    return changeIncidentStateTool({ args, ctx, verb: "resolve" });
  },
};
