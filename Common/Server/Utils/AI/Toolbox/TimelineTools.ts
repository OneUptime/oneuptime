import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import User from "../../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  AIChatCitationTargetType,
  AIChatWidgetColumn,
} from "../../../../Types/AI/AIChatTypes";
import AlertFeedService from "../../../Services/AlertFeedService";
import AlertInternalNoteService from "../../../Services/AlertInternalNoteService";
import AlertService from "../../../Services/AlertService";
import AlertStateTimelineService from "../../../Services/AlertStateTimelineService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../Services/IncidentPublicNoteService";
import IncidentService from "../../../Services/IncidentService";
import IncidentStateTimelineService from "../../../Services/IncidentStateTimelineService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import ToolResultSerializer, { SerializedResult } from "./Serializer";
import WidgetBuilder from "./WidgetBuilder";
import {
  ObservabilityTool,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * Merged activity timelines for incidents and alerts. Each tool stitches the
 * entity's state changes, notes and feed events into one chronological view so
 * the model can answer "what's the latest on this incident?" from the actual
 * response thread instead of only the incident's static fields.
 */

// Hard cap on merged timeline entries (also the per-source fetch limit).
const MAX_TIMELINE_ENTRIES: number = 50;

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the model classes are fully wired up, so
 * calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 *
 * The gate uses the parent entity's (Incident/Alert) read ACL: the timeline is
 * incident/alert data, and each per-source query below still enforces its own
 * model ACL through ctx.props.
 */
let cachedIncidentReadPermissions: Array<Permission> | null = null;
const resolveIncidentReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedIncidentReadPermissions) {
      cachedIncidentReadPermissions = new Incident().getReadPermissions();
    }
    return cachedIncidentReadPermissions;
  };

let cachedAlertReadPermissions: Array<Permission> | null = null;
const resolveAlertReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedAlertReadPermissions) {
      cachedAlertReadPermissions = new Alert().getReadPermissions();
    }
    return cachedAlertReadPermissions;
  };

// Display name for a timeline author; email is a fallback (redacted for the LLM).
const formatAuthor: (user: User | undefined) => string | undefined = (
  user: User | undefined,
): string | undefined => {
  if (!user) {
    return undefined;
  }
  return user.name?.toString() || user.email?.toString() || undefined;
};

const entryTime: (row: JSONObject) => number = (row: JSONObject): number => {
  const at: unknown = row["at"];
  if (at instanceof Date) {
    return at.getTime();
  }
  return 0;
};

/*
 * Sort newest-first, keep the newest `limit`, then flip to chronological
 * order. Because every source is fetched newest-first with the same limit,
 * any row a source dropped is older than all rows it returned — so the merged
 * newest-`limit` slice is exact.
 */
const keepNewestChronological: (
  rows: Array<JSONObject>,
  limit: number,
) => Array<JSONObject> = (
  rows: Array<JSONObject>,
  limit: number,
): Array<JSONObject> => {
  const newestFirst: Array<JSONObject> = [...rows].sort(
    (a: JSONObject, b: JSONObject) => {
      return entryTime(b) - entryTime(a);
    },
  );
  return newestFirst.slice(0, limit).reverse();
};

const timelineWidgetColumns: Array<AIChatWidgetColumn> = [
  { key: "at", title: "When", type: "date" },
  { key: "type", title: "Type" },
  { key: "author", title: "By" },
  { key: "entry", title: "Entry" },
];

export const GetIncidentTimelineTool: ObservabilityTool = {
  name: "get_incident_timeline",
  description:
    "Get one merged, chronological activity timeline for an incident: state changes, internal (private) notes, public status-page notes, and feed events — each entry tagged with its type, timestamp and author where available. Use this for 'what's the latest on this incident?', 'who did what and when?', or to reconstruct the response thread. Pass incidentId from query_incidents or search_incidents. Returns at most the 50 newest entries, oldest first.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description:
          "The incident's ID (from query_incidents or search_incidents).",
      },
      limit: {
        type: "number",
        description: "Maximum timeline entries to return (default 50, max 50).",
      },
    },
    required: ["incidentId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveIncidentReadPermissions();
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
      return {
        dataForLlm:
          "Error: incidentId is required. Pass the incident's ID (from query_incidents or search_incidents).",
        rowCount: 0,
        citationLabel: "Incident timeline (no incident id)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: MAX_TIMELINE_ENTRIES,
      min: 1,
      max: MAX_TIMELINE_ENTRIES,
    });

    /*
     * Resolve the incident under the requesting user's props first: a
     * missing or foreign-tenant incident yields an honest empty result
     * instead of four pointless timeline queries.
     */
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
      return {
        dataForLlm: `Incident ${incidentId.toString()} was not found in this project.`,
        rowCount: 0,
        citationLabel: "Incident timeline (not found)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    /*
     * projectId is pinned to the tenant from ctx on every source query
     * because incidentId is an untrusted model argument.
     */
    const [stateTimeline, internalNotes, publicNotes, feedItems]: [
      Array<IncidentStateTimeline>,
      Array<IncidentInternalNote>,
      Array<IncidentPublicNote>,
      Array<IncidentFeed>,
    ] = await Promise.all([
      IncidentStateTimelineService.findBy({
        query: {
          incidentId: incidentId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          rootCause: true,
          incidentState: {
            name: true,
          },
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
      IncidentInternalNoteService.findBy({
        query: {
          incidentId: incidentId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          note: true,
          createdAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
      IncidentPublicNoteService.findBy({
        query: {
          incidentId: incidentId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          note: true,
          createdAt: true,
          postedAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
      IncidentFeedService.findBy({
        query: {
          incidentId: incidentId,
          projectId: ctx.projectId,
          /*
           * The feed mirrors state changes and notes (the services write a
           * feed item alongside each) — exclude those event types here so the
           * merged timeline doesn't list every state change and note twice,
           * halving the real coverage of the newest-N cap.
           */
          incidentFeedEventType: QueryHelper.notIn([
            IncidentFeedEventType.IncidentStateChanged,
            IncidentFeedEventType.PublicNote,
            IncidentFeedEventType.PrivateNote,
          ]),
        },
        select: {
          _id: true,
          feedInfoInMarkdown: true,
          incidentFeedEventType: true,
          createdAt: true,
          postedAt: true,
          user: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
    ]);

    const merged: Array<JSONObject> = [
      ...stateTimeline.map((item: IncidentStateTimeline): JSONObject => {
        let entry: string = `State changed to ${item.incidentState?.name || "(unknown)"}`;
        if (item.rootCause) {
          entry = `${entry}. Root cause: ${item.rootCause}`;
        }
        return {
          at: item.startsAt || item.createdAt,
          type: "state-change",
          author: formatAuthor(item.createdByUser),
          entry: entry,
        };
      }),
      ...internalNotes.map((item: IncidentInternalNote): JSONObject => {
        return {
          at: item.createdAt,
          type: "internal-note",
          author: formatAuthor(item.createdByUser),
          entry: item.note,
        };
      }),
      ...publicNotes.map((item: IncidentPublicNote): JSONObject => {
        return {
          at: item.postedAt || item.createdAt,
          type: "public-note",
          author: formatAuthor(item.createdByUser),
          entry: item.note,
        };
      }),
      ...feedItems.map((item: IncidentFeed): JSONObject => {
        return {
          at: item.postedAt || item.createdAt,
          type: "feed",
          author: formatAuthor(item.user),
          entry: item.feedInfoInMarkdown,
          eventType: item.incidentFeedEventType,
        };
      }),
    ];

    const rows: Array<JSONObject> = keepNewestChronological(merged, limit);

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (merged.length > rows.length) {
      dataForLlm = `Showing the newest ${rows.length} of ${merged.length} fetched timeline entries (each source capped at ${limit}), oldest first.\n${dataForLlm}`;
    }

    const incidentLabel: string = incident.incidentNumber
      ? `#${incident.incidentNumber}`
      : incidentId.toString();

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: `Incident ${incidentLabel} timeline (${serialized.rowCount} entries)`,
      citationTarget: {
        type: AIChatCitationTargetType.IncidentView,
        params: { incidentId: incidentId.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Incident ${incidentLabel} timeline`,
              description: incident.title,
              columns: timelineWidgetColumns,
              rows: rows,
              link: {
                type: AIChatCitationTargetType.IncidentView,
                params: { incidentId: incidentId.toString() },
              },
            })
          : undefined,
    };
  },
};

export const GetAlertTimelineTool: ObservabilityTool = {
  name: "get_alert_timeline",
  description:
    "Get one merged, chronological activity timeline for an alert: state changes, internal notes, and feed events — each entry tagged with its type, timestamp and author where available. Use this for 'what's the latest on this alert?' or to see who acknowledged/resolved it and when. Pass alertId from query_alerts. Returns at most the 50 newest entries, oldest first.",
  inputSchema: {
    type: "object",
    properties: {
      alertId: {
        type: "string",
        description: "The alert's ID (from query_alerts).",
      },
      limit: {
        type: "number",
        description: "Maximum timeline entries to return (default 50, max 50).",
      },
    },
    required: ["alertId"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveAlertReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const alertId: ObjectID | undefined = ToolArgs.getObjectID(args, "alertId");

    if (!alertId) {
      return {
        dataForLlm:
          "Error: alertId is required. Pass the alert's ID (from query_alerts).",
        rowCount: 0,
        citationLabel: "Alert timeline (no alert id)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: MAX_TIMELINE_ENTRIES,
      min: 1,
      max: MAX_TIMELINE_ENTRIES,
    });

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
      return {
        dataForLlm: `Alert ${alertId.toString()} was not found in this project.`,
        rowCount: 0,
        citationLabel: "Alert timeline (not found)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    // projectId pinned to the tenant from ctx; alertId is untrusted.
    const [stateTimeline, internalNotes, feedItems]: [
      Array<AlertStateTimeline>,
      Array<AlertInternalNote>,
      Array<AlertFeed>,
    ] = await Promise.all([
      AlertStateTimelineService.findBy({
        query: {
          alertId: alertId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          rootCause: true,
          alertState: {
            name: true,
          },
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
      AlertInternalNoteService.findBy({
        query: {
          alertId: alertId,
          projectId: ctx.projectId,
        },
        select: {
          _id: true,
          note: true,
          createdAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
      AlertFeedService.findBy({
        query: {
          alertId: alertId,
          projectId: ctx.projectId,
          /*
           * Same dedup as the incident feed: these are mirrored by the
           * dedicated state-timeline and note sources fetched above.
           */
          alertFeedEventType: QueryHelper.notIn([
            AlertFeedEventType.AlertStateChanged,
            AlertFeedEventType.PrivateNote,
          ]),
        },
        select: {
          _id: true,
          feedInfoInMarkdown: true,
          alertFeedEventType: true,
          createdAt: true,
          postedAt: true,
          user: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: limit,
        skip: 0,
        props: ctx.props,
      }),
    ]);

    const merged: Array<JSONObject> = [
      ...stateTimeline.map((item: AlertStateTimeline): JSONObject => {
        let entry: string = `State changed to ${item.alertState?.name || "(unknown)"}`;
        if (item.rootCause) {
          entry = `${entry}. Root cause: ${item.rootCause}`;
        }
        return {
          at: item.startsAt || item.createdAt,
          type: "state-change",
          author: formatAuthor(item.createdByUser),
          entry: entry,
        };
      }),
      ...internalNotes.map((item: AlertInternalNote): JSONObject => {
        return {
          at: item.createdAt,
          type: "internal-note",
          author: formatAuthor(item.createdByUser),
          entry: item.note,
        };
      }),
      ...feedItems.map((item: AlertFeed): JSONObject => {
        return {
          at: item.postedAt || item.createdAt,
          type: "feed",
          author: formatAuthor(item.user),
          entry: item.feedInfoInMarkdown,
          eventType: item.alertFeedEventType,
        };
      }),
    ];

    const rows: Array<JSONObject> = keepNewestChronological(merged, limit);

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    let dataForLlm: string = serialized.text;
    if (merged.length > rows.length) {
      dataForLlm = `Showing the newest ${rows.length} of ${merged.length} fetched timeline entries (each source capped at ${limit}), oldest first.\n${dataForLlm}`;
    }

    const alertLabel: string = alert.alertNumber
      ? `#${alert.alertNumber}`
      : alertId.toString();

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: `Alert ${alertLabel} timeline (${serialized.rowCount} entries)`,
      citationTarget: {
        type: AIChatCitationTargetType.AlertView,
        params: { alertId: alertId.toString() },
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.table({
              title: `Alert ${alertLabel} timeline`,
              description: alert.title,
              columns: timelineWidgetColumns,
              rows: rows,
              link: {
                type: AIChatCitationTargetType.AlertView,
                params: { alertId: alertId.toString() },
              },
            })
          : undefined,
    };
  },
};
