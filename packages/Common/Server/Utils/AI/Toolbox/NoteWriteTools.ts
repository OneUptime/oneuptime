import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AlertService from "../../../Services/AlertService";
import AlertInternalNoteService from "../../../Services/AlertInternalNoteService";
import IncidentService from "../../../Services/IncidentService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Private (internal) note tools — the team-only counterpart of
 * post_incident_status_update. Internal notes live in the dashboard's private
 * note feed: they never render on a status page and never notify status page
 * subscribers, so the copilot can file investigation findings without any
 * customer-visible side effect.
 *
 * The acting user is always ctx.props.userId — never a tool argument.
 *
 * Permissions are resolved lazily (not at module load) because this module is
 * pulled in through the service import graph before the model classes are
 * fully wired up — calling a model method at import time throws a
 * circular-dependency TypeError. By the time a tool executes, every module is
 * loaded.
 */

let cachedIncidentNoteCreatePermissions: Array<Permission> | null = null;
const resolveIncidentNoteCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedIncidentNoteCreatePermissions) {
      cachedIncidentNoteCreatePermissions =
        new IncidentInternalNote().getCreatePermissions();
    }
    return cachedIncidentNoteCreatePermissions;
  };

let cachedAlertNoteCreatePermissions: Array<Permission> | null = null;
const resolveAlertNoteCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAlertNoteCreatePermissions) {
      cachedAlertNoteCreatePermissions =
        new AlertInternalNote().getCreatePermissions();
    }
    return cachedAlertNoteCreatePermissions;
  };

// Widgets preview the note; long notes are cut so the card stays a card.
function previewOf(note: string): string {
  return note.length > 200 ? `${note.substring(0, 200)}…` : note;
}

/*
 * ---------------------------------------------------------------------------
 * create_incident_note — private internal note on an incident.
 * ---------------------------------------------------------------------------
 */
export const CreateIncidentNoteTool: ObservabilityTool = {
  name: "create_incident_note",
  description:
    "Add a PRIVATE internal note to an incident. Internal notes are visible only to team members in the dashboard — they NEVER appear on any status page and notify NO status page subscribers. Use this for investigation findings, working notes and responder handoffs. For a customer-facing update that goes on the status page, use post_incident_status_update instead. Find the incidentId with query_incidents first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description:
          "The incident's ID (required). Find it with query_incidents first.",
      },
      note: {
        type: "string",
        description:
          "The internal note text in markdown (required). Visible to team members only.",
      },
    },
    required: ["incidentId", "note"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveIncidentNoteCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Add private internal note to incident ${ToolArgs.getString(args, "incidentId") || ""}`.trim();
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
      throw new BadDataException("note is required (the internal note text).");
    }

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot post an internal note.",
      );
    }

    // Visibility check under the user's RBAC before writing anything.
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

    const internalNote: IncidentInternalNote = new IncidentInternalNote();
    internalNote.incidentId = incidentId;
    internalNote.projectId = ctx.projectId;
    internalNote.note = note;
    internalNote.createdByUserId = userId;

    const createdNote: IncidentInternalNote =
      await IncidentInternalNoteService.create({
        data: internalNote,
        props: ctx.props,
      });

    const noteIdString: string = createdNote.id?.toString() || "";
    const incidentIdString: string = incidentId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        noteId: noteIdString,
        incidentNumber: incident.incidentNumber,
        visibility: "internal (team members only)",
      },
    ]);

    return {
      dataForLlm: `Added a private internal note to incident #${incident.incidentNumber} ("${incident.title}"). It is visible to team members only — it does not appear on any status page and no subscribers were notified.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Internal note on incident #${incident.incidentNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Internal note added",
        resourceType: "Incident",
        heading: `#${incident.incidentNumber} · ${incident.title}`,
        subheading: "Private — team members only",
        fields: [{ label: "Note", value: previewOf(note) }],
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
 * create_alert_note — private internal note on an alert.
 * ---------------------------------------------------------------------------
 */
export const CreateAlertNoteTool: ObservabilityTool = {
  name: "create_alert_note",
  description:
    "Add a PRIVATE internal note to an alert. Internal notes are visible only to team members in the dashboard — they NEVER appear on any status page and notify NO status page subscribers. Use this for triage findings, working notes and responder handoffs on an alert. Find the alertId with query_alerts first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description:
          "The alert's ID (required). Find it with query_alerts first.",
      },
      note: {
        type: "string",
        description:
          "The internal note text in markdown (required). Visible to team members only.",
      },
    },
    required: ["alertId", "note"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAlertNoteCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): string => {
    return `Add private internal note to alert ${ToolArgs.getString(args, "alertId") || ""}`.trim();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");
    if (!alertId) {
      throw new BadDataException(
        "alertId is required. Use query_alerts to find it first.",
      );
    }

    const note: string | undefined = ToolArgs.getString(args, "note");
    if (!note) {
      throw new BadDataException("note is required (the internal note text).");
    }

    const userId: ObjectID | undefined = ctx.props.userId;
    if (!userId) {
      throw new BadDataException(
        "No authenticated user in context; cannot post an internal note.",
      );
    }

    // Visibility check under the user's RBAC before writing anything.
    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: { _id: true, alertNumber: true, title: true },
      props: ctx.props,
    });
    if (!alert) {
      throw new BadDataException(
        "Alert not found (or you do not have access to it).",
      );
    }

    const internalNote: AlertInternalNote = new AlertInternalNote();
    internalNote.alertId = alertId;
    internalNote.projectId = ctx.projectId;
    internalNote.note = note;
    internalNote.createdByUserId = userId;

    const createdNote: AlertInternalNote =
      await AlertInternalNoteService.create({
        data: internalNote,
        props: ctx.props,
      });

    const noteIdString: string = createdNote.id?.toString() || "";
    const alertIdString: string = alertId.toString();

    const serialized: SerializedResult = ToolResultSerializer.serializeRows([
      {
        noteId: noteIdString,
        alertNumber: alert.alertNumber,
        visibility: "internal (team members only)",
      },
    ]);

    return {
      dataForLlm: `Added a private internal note to alert #${alert.alertNumber} ("${alert.title}"). It is visible to team members only — it does not appear on any status page and no subscribers were notified.\n${serialized.text}`,
      rowCount: 1,
      citationLabel: `Internal note on alert #${alert.alertNumber}`,
      citationTarget: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertIdString },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: false,
      widget: WidgetBuilder.resourceCard({
        title: "Internal note added",
        resourceType: "Alert",
        heading: `#${alert.alertNumber} · ${alert.title}`,
        subheading: "Private — team members only",
        fields: [{ label: "Note", value: previewOf(note) }],
        link: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: alertIdString },
        },
      }),
    };
  },
};
