import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import PublicNoteSubscriberNotificationDefault from "../../../../Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { RUNBOOK_RUN_PERMISSIONS } from "../../../../Types/Runbook/RunbookRunPermissions";
import DatabaseRequestType from "../../../Types/BaseDatabase/DatabaseRequestType";
import IncidentService from "../../../Services/IncidentService";
import IncidentSeverityService from "../../../Services/IncidentSeverityService";
import IncidentPublicNoteService from "../../../Services/IncidentPublicNoteService";
import OnCallDutyPolicyService from "../../../Services/OnCallDutyPolicyService";
import RunbookService from "../../../Services/RunbookService";
import RunbookRuleEngineService from "../../../Services/RunbookRuleEngineService";
import { assertCanExecuteRunbooks } from "../../Runbook/RunbookExecutePermission";
import RunbookRunAccess from "../../Runbook/RunbookRunAccess";
import logger from "../../Logger";
import WorkspaceMemberActions, {
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
 * AI "action belt" — Phase 0.
 *
 * Mutating tools that let the copilot OPERATE the platform (not just answer
 * questions). They are gated twice: by the tool's requiredPermissions (RBAC)
 * and by the conversation's permission mode (approval / auto-run / hidden in
 * read-only). Each makes the change the dashboard makes for the same action,
 * held to the same checks, with the requesting user's props (ctx.props,
 * never a tool argument): what they may not do in the dashboard, they may
 * not do here.
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

/*
 * Paging an on-call policy is the creation of its execution log, as the
 * dashboard's Execute On-Call Policy creates it.
 */
let cachedExecutionLogCreatePermissions: Array<Permission> | null = null;
const resolveExecutionLogCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedExecutionLogCreatePermissions) {
      cachedExecutionLogCreatePermissions =
        new OnCallDutyPolicyExecutionLog().getCreatePermissions();
    }
    return cachedExecutionLogCreatePermissions;
  };

/*
 * ---------------------------------------------------------------------------
 * page_on_call_policy — escalate an incident to its responders.
 * ---------------------------------------------------------------------------
 */
export const PageOnCallPolicyTool: ObservabilityTool = {
  name: "page_on_call_policy",
  description:
    "Page (trigger) an on-call duty policy so its responders are notified about an incident. Provide the on-call policy id and the incident id it relates to. Find the policy id with query_on_call_policies and the incident id with query_incidents first. This notifies real people — only do it when clearly asked.",
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
    return resolveExecutionLogCreatePermissions();
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

    // The policy and the incident as the person reads them.
    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        select: { _id: true, name: true, isArchived: true },
        props: ctx.props,
      });
    if (!policy) {
      throw new BadDataException(
        "On-call duty policy not found (or you do not have access to it).",
      );
    }
    /*
     * Refused here rather than left to the execution log, which records an
     * archived policy's execution as skipped: this tool would then tell the
     * user "responders are being notified" when nobody is.
     */
    if (policy.isArchived) {
      throw new BadDataException(
        `On-call duty policy "${policy.name}" is archived, so it pages no one. Unarchive it first, or page a different policy.`,
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

    /*
     * Paging is the policy's execution log, triggered by the incident, as
     * the dashboard's Execute On-Call Policy creates it - created as the
     * person who asked (WorkspaceMemberActions), so it is held to their
     * permission to execute on-call policies, their read of the policy and
     * of the incident, and the project's plan.
     */
    await WorkspaceMemberActions.executeOnCallPolicy({
      event: { type: WorkspaceEventType.Incident, id: incidentId },
      onCallDutyPolicyId: policyId,
      props: ctx.props,
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
 * A runbook's name as the person reads it, for the answer, or undefined
 * when they may not read it - a granular permission to start runs reaches
 * runbooks it does not show - or it cannot be read: the name only labels
 * the answer, so it never stands in the way of a run.
 */
async function readableRunbookName(data: {
  runbookId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<string | undefined> {
  try {
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: data.runbookId,
      select: { _id: true, name: true },
      props: data.props,
    });

    return runbook?.name || undefined;
  } catch (error) {
    if (!(error instanceof NotAuthorizedException)) {
      logger.debug(
        `run_runbook: the runbook's name could not be read for the answer: ${error}`,
      );
    }

    return undefined;
  }
}

/*
 * ---------------------------------------------------------------------------
 * run_runbook — start an automated runbook.
 * ---------------------------------------------------------------------------
 */
export const RunRunbookTool: ObservabilityTool = {
  name: "run_runbook",
  description:
    "Start (execute) a runbook by its id, optionally linked to an incident. Use this to run a predefined remediation or diagnostic automation. Use the runbook id the user gives, or find it (and read its steps) with query_runbooks first.",
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
    // Who may start a run, as the dashboard's Run Runbook asks.
    return [...RUNBOOK_RUN_PERMISSIONS];
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

    /*
     * Asked as the dashboard's Run Runbook asks it
     * (App/FeatureSet/Runbook/API/Runbook): a permission to start runs,
     * which runbooks the person's grant reaches (their labels, owned scope
     * and blocks), and a read of the incident the run is linked to. The run
     * is then written by OneUptime, as that route writes it.
     */
    assertCanExecuteRunbooks(ctx.props, ctx.projectId);

    /*
     * The runbook is read as OneUptime and matched to the project, as that
     * route reads it, and RunbookRunAccess decides whether the person's
     * permission to start runs reaches it: a run role by its labels, owned
     * scope and blocks, a granular run permission (Create Runbook
     * Execution) every runbook of the project - whether or not it lets
     * them read runbooks. A runbook of another project is answered like
     * one that does not exist.
     */
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: runbookId,
      select: { _id: true, projectId: true },
      props: { isRoot: true },
    });
    if (
      !runbook ||
      runbook.projectId?.toString() !== ctx.projectId.toString()
    ) {
      throw new BadDataException("Runbook not found.");
    }

    await RunbookRunAccess.assertMayStart({
      databaseProps: ctx.props,
      projectId: ctx.projectId,
      runbookId: runbookId,
    });

    /*
     * Only link an incident the caller can actually read in this project.
     * Looking it up under the user's RBAC (not isRoot) rejects both a
     * cross-tenant id and one the user has no access to — so the tool cannot
     * be used to staple another project's incident onto an execution.
     */
    if (incidentId) {
      const linkedIncident: Incident | null = await IncidentService.findOneById(
        {
          id: incidentId,
          select: { _id: true },
          props: ctx.props,
        },
      );
      if (!linkedIncident) {
        throw new BadDataException(
          "Incident not found (or you do not have access to it).",
        );
      }
    }

    const execution: RunbookExecution | null =
      await RunbookRuleEngineService.startRunbookFor({
        projectId: ctx.projectId,
        runbookId: runbookId,
        linkage: incidentId ? { incidentId: incidentId } : {},
        triggeredByUserId: userId,
      });

    // The runbook's name, for the answer, only when the person may read it.
    const runbookName: string | undefined = await readableRunbookName({
      runbookId: runbookId,
      props: ctx.props,
    });
    const runbookLabel: string = runbookName
      ? `runbook "${runbookName}"`
      : `runbook ${runbookId.toString()}`;

    if (!execution) {
      throw new BadDataException(
        `Could not start ${runbookLabel}. It may be disabled or have no steps.`,
      );
    }

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        runbook: runbookName || "",
        runbookId: runbookId.toString(),
        executionId: execution.id?.toString(),
      },
    ]);

    const result: ToolExecutionResult = {
      dataForLlm: `Started ${runbookLabel}. Execution is scheduled.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Started ${runbookLabel}`,
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Runbook started",
        resourceType: "Runbook",
        heading: runbookName || "Runbook",
        subheading: "Execution scheduled",
        fields: [
          { label: "Runbook", value: runbookName || runbookId.toString() },
        ],
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
    "Post a customer-facing status update (public note) on an incident. It appears on the status page and, by default, notifies subscribers - unless subscribers were not notified when the incident was declared, in which case it stays quiet by default. Provide the incident id and the update text.",
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
          "Whether to notify status page subscribers. Defaults to true, or to false when subscribers were not notified when the incident was declared.",
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

    const incident: Incident | null = await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        incidentNumber: true,
        title: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
      props: ctx.props,
    });
    if (!incident) {
      throw new BadDataException(
        "Incident not found (or you do not have access to it).",
      );
    }

    // An incident declared quietly stays quiet unless the caller asks.
    const notifySubscribers: boolean =
      ToolArgs.getBoolean(args, "notifySubscribers") ??
      PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(incident);

    const publicNote: IncidentPublicNote = new IncidentPublicNote();
    publicNote.incidentId = incidentId;
    publicNote.projectId = ctx.projectId;
    /*
     * The model wrote this from what it read, telemetry included: it stays
     * Markdown, but nothing in it acts on its own where the update is shown -
     * the status page, subscribers' messages, the feed, Slack and Teams
     * (FeedMarkdown.aiWritten).
     */
    publicNote.note = FeedMarkdown.aiWritten(note).toString();
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

    /*
     * Changed as the person: an incident they may read but not change
     * (outside their labels or owners, say) changes nothing, and they are
     * told so rather than told it changed.
     */
    const updatedCount: number = await IncidentService.updateOneById({
      id: incidentId,
      data: {
        incidentSeverityId: severity.id!,
      },
      props: ctx.props,
    });

    if (updatedCount === 0) {
      throw await IncidentService.getUnwrittenByIdError({
        id: incidentId,
        props: ctx.props,
        type: DatabaseRequestType.Update,
      });
    }

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
