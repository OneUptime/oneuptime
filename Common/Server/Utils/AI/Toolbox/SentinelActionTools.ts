import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import IncidentPublicNoteService from "../../../Services/IncidentPublicNoteService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import RunbookService from "../../../Services/RunbookService";
import RunbookRuleEngineService from "../../../Services/RunbookRuleEngineService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Sentinel "action belt" — Phase 0.
 *
 * Mutating tools that let the copilot OPERATE the platform (not just answer
 * questions), each a thin wrapper over an already-RBAC-tested service method.
 * They are gated twice: by the tool's requiredPermissions (RBAC) and by the
 * conversation's permission mode (approval / auto-run / hidden in read-only).
 * The acting user is always ctx.props.userId — never a tool argument.
 *
 * Permissions are resolved lazily (not at module load) because this module is
 * pulled in through the service import graph before the model classes are fully
 * wired up — calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool executes, every module is loaded.
 */

let cachedIncidentUpdatePermissions: Array<Permission> | null = null;
const resolveIncidentUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedIncidentUpdatePermissions) {
      cachedIncidentUpdatePermissions = new Incident().getUpdatePermissions();
    }
    return cachedIncidentUpdatePermissions;
  };

let cachedPublicNoteCreatePermissions: Array<Permission> | null = null;
const resolvePublicNoteCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedPublicNoteCreatePermissions) {
      cachedPublicNoteCreatePermissions =
        new IncidentPublicNote().getCreatePermissions();
    }
    return cachedPublicNoteCreatePermissions;
  };

let cachedRunbookUpdatePermissions: Array<Permission> | null = null;
const resolveRunbookUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedRunbookUpdatePermissions) {
      cachedRunbookUpdatePermissions = new Runbook().getUpdatePermissions();
    }
    return cachedRunbookUpdatePermissions;
  };

/*
 * ---------------------------------------------------------------------------
 * page_on_call_policy — escalate an incident to its responders.
 * ---------------------------------------------------------------------------
 */
export const PageOnCallPolicyTool: ObservabilityTool = {
  name: "page_on_call_policy",
  description:
    "Page (trigger) an on-call duty policy so its responders are notified about an incident. Provide the on-call policy id and the incident id it relates to. Use query tools to find the on-call policy id and incident id first. This notifies real people — only do it when clearly asked.",
  inputSchema: {
    type: "object",
    properties: {
      onCallDutyPolicyId: {
        type: "string",
        description: "The on-call duty policy's ID to trigger (required).",
      },
      incidentId: {
        type: "string",
        description:
          "The incident's ID this page relates to (required). Find it with query_incidents first.",
      },
    },
    required: ["onCallDutyPolicyId", "incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveIncidentUpdatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Page on-call policy ${ToolArgs.getString(args, "onCallDutyPolicyId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const policyId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "onCallDutyPolicyId",
    );
    if (!policyId) {
      throw new BadDataException(
        "onCallDutyPolicyId is required. Use query tools to find it first.",
      );
    }

    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    if (!incidentId) {
      throw new BadDataException(
        "incidentId is required. Use query_incidents to find it first.",
      );
    }

    // Visibility checks under the user's RBAC (execution runs as root inside the service).
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        select: { _id: true, name: true },
        props: ctx.props,
      });
    if (!policy) {
      throw new BadDataException(
        "On-call duty policy not found (or you do not have access to it).",
      );
    }

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: { _id: true, incidentNumber: true, title: true },
      props: ctx.props,
    });
    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
      );
    }

    await OnCallDutyPolicyService.executePolicy(policyId, {
      triggeredByIncidentId: incidentId,
      userNotificationEventType: UserNotificationEventType.IncidentCreated,
    });

    const incidentIdString: string = incidentId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        onCallPolicy: policy.name,
        incidentNumber: incident.incidentNumber,
        incidentTitle: incident.title,
      },
    ]);

    return {
      dataForLlm: `Paged on-call policy "${policy.name}" for incident #${incident.incidentNumber} ("${incident.title}"). Responders are being notified.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Paged "${policy.name}" for incident #${incident.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "On-call paged",
        resourceType: "OnCallDutyPolicy",
        heading: policy.name || "On-call policy",
        subheading: `Incident #${incident.incidentNumber}`,
        fields: [
          { label: "Policy", value: policy.name || "—" },
          { label: "Incident", value: `#${incident.incidentNumber ?? ""}` },
        ],
        link: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * run_runbook — start an automated runbook.
 * ---------------------------------------------------------------------------
 */
export const RunRunbookTool: ObservabilityTool = {
  name: "run_runbook",
  description:
    "Start (execute) a runbook by its id, optionally linked to an incident. Use this to run a predefined remediation or diagnostic automation. Find the runbook id with query tools first.",
  inputSchema: {
    type: "object",
    properties: {
      runbookId: {
        type: "string",
        description: "The runbook's ID to execute (required).",
      },
      incidentId: {
        type: "string",
        description:
          "Optional incident ID to link this runbook execution to. Find it with query_incidents first.",
      },
    },
    required: ["runbookId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveRunbookUpdatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Run runbook ${ToolArgs.getString(args, "runbookId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const runbookId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "runbookId",
    );
    if (!runbookId) {
      throw new BadDataException(
        "runbookId is required. Use query tools to find it first.",
      );
    }

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot run a runbook.",
      );
    }

    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );

    // Visibility check under the user's RBAC.
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: runbookId,
      select: { _id: true, name: true },
      props: ctx.props,
    });
    if (!runbook) {
      throw new BadDataException(
        "Runbook not found (or you do not have access to it).",
      );
    }

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: ctx.projectId,
        runbookId: runbookId,
        linkage: incidentId ? { incidentId: incidentId } : {},
        triggeredByUserId: userId,
      });

    if (!execution) {
      throw new BadDataException(
        `Runbook "${runbook.name}" could not be started. It may be disabled, empty, or not part of this project.`,
      );
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        runbook: runbook.name,
        executionId: execution.id?.toString(),
      },
    ]);

    const result: ToolExecutionResult = {
      dataForLlm: `Started runbook "${runbook.name}". Execution is scheduled.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Started runbook "${runbook.name}"`,
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Runbook started",
        resourceType: "Runbook",
        heading: runbook.name || "Runbook",
        subheading: "Execution scheduled",
        fields: [{ label: "Runbook", value: runbook.name || "—" }],
      }),
    };

    if (incidentId) {
      result.citationTarget = {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentId.toString() },
      };
    }

    return result;
  },
};

/*
 * ---------------------------------------------------------------------------
 * post_incident_status_update — customer-facing update on an incident.
 * ---------------------------------------------------------------------------
 */
export const PostIncidentStatusUpdateTool: ObservabilityTool = {
  name: "post_incident_status_update",
  description:
    "Post a customer-facing status update (public note) on an incident. It appears on the status page and, by default, notifies subscribers. Provide the incident id and the update text.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
      note: {
        type: "string",
        description: "The customer-facing update text in markdown (required).",
      },
      notifySubscribers: {
        type: "boolean",
        description:
          "Whether to notify status page subscribers. Defaults to true.",
      },
    },
    required: ["incidentId", "note"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolvePublicNoteCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Post public status update on incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    if (!incidentId) {
      throw new BadDataException(
        "incidentId is required. Use query_incidents to find it first.",
      );
    }

    const note: string | undefined = ToolArgs.getString(args, "note");
    if (!note) {
      throw new BadDataException("note is required (the update text).");
    }

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot post a status update.",
      );
    }

    const notifySubscribers: boolean =
      ToolArgs.getBoolean(args, "notifySubscribers") ?? true;

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: { _id: true, incidentNumber: true, title: true },
      props: ctx.props,
    });
    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
      );
    }

    const publicNote: IncidentPublicNote = new IncidentPublicNote();
    publicNote.incidentId = incidentId;
    publicNote.projectId = ctx.projectId;
    publicNote.note = note;
    publicNote.postedAt = OneUptimeDate.getCurrentDate();
    publicNote.createdByUserId = userId;
    publicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
      notifySubscribers;

    await IncidentPublicNoteService.create({
      data: publicNote,
      props: ctx.props,
    });

    const incidentIdString: string = incidentId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        incidentNumber: incident.incidentNumber,
        notifySubscribers: notifySubscribers,
      },
    ]);

    return {
      dataForLlm: `Posted a public status update on incident #${incident.incidentNumber}${
        notifySubscribers ? " and notified subscribers" : ""
      }.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Status update on incident #${incident.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Status update posted",
        resourceType: "Incident",
        heading: `#${incident.incidentNumber} · ${incident.title}`,
        subheading: notifySubscribers
          ? "Subscribers notified"
          : "Subscribers not notified",
        fields: [
          {
            label: "Update",
            value: note.length > 200 ? `${note.substring(0, 200)}…` : note,
          },
        ],
        link: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};

/*
 * ---------------------------------------------------------------------------
 * change_incident_severity — re-classify an incident.
 * ---------------------------------------------------------------------------
 */
export const ChangeIncidentSeverityTool: ObservabilityTool = {
  name: "change_incident_severity",
  description:
    "Change the severity of an existing incident. Provide the incident id and the new severity name (must match an existing incident severity in this project, e.g. 'SEV1', 'Critical').",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "The incident's ID (required).",
      },
      severityName: {
        type: "string",
        description: "Name of an existing incident severity (required).",
      },
    },
    required: ["incidentId", "severityName"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveIncidentUpdatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Change incident ${ToolArgs.getString(args, "incidentId") || ""} severity to ${ToolArgs.getString(args, "severityName") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );
    if (!incidentId) {
      throw new BadDataException(
        "incidentId is required. Use query_incidents to find it first.",
      );
    }

    const severityName: string | undefined = ToolArgs.getString(
      args,
      "severityName",
    );
    if (!severityName) {
      throw new BadDataException("severityName is required.");
    }

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: { _id: true, incidentNumber: true, title: true },
      props: ctx.props,
    });
    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
      );
    }

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {},
        select: { _id: true, name: true, order: true },
        sort: { order: SortOrder.Ascending },
        limit: 50,
        skip: 0,
        props: ctx.props,
      });

    const severity: IncidentSeverity | undefined = severities.find(
      (item: IncidentSeverity) => {
        return item.name?.toLowerCase() === severityName.toLowerCase();
      },
    );

    if (!severity) {
      const available: string = severities
        .map((s: IncidentSeverity) => {
          return s.name;
        })
        .filter(Boolean)
        .join(", ");
      throw new BadDataException(
        `No incident severity named "${severityName}". Available severities: ${available || "none configured"}.`,
      );
    }

    await IncidentService.updateOneById({
      id: incidentId,
      data: {
        incidentSeverityId: severity.id!,
      },
      props: ctx.props,
    });

    const incidentIdString: string = incidentId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        incidentNumber: incident.incidentNumber,
        newSeverity: severity.name,
      },
    ]);

    return {
      dataForLlm: `Changed incident #${incident.incidentNumber} severity to ${severity.name}.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Incident #${incident.incidentNumber} → ${severity.name}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Severity changed",
        resourceType: "Incident",
        heading: `#${incident.incidentNumber} · ${incident.title}`,
        subheading: `Severity: ${severity.name}`,
        fields: [
          { label: "Number", value: `#${incident.incidentNumber ?? ""}` },
          { label: "New severity", value: severity.name || "—" },
        ],
        link: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentIdString },
        },
      }),
    };
  },
};
