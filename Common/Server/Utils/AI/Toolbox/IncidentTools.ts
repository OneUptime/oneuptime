import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../Models/DatabaseModels/IncidentOwnerUser";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import Query from "../../../../Types/BaseDatabase/Query";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import IncidentService from "../../../Services/IncidentService";
import IncidentOwnerTeamService from "../../../Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Services/IncidentOwnerUserService";
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

// Allowed values for query_incidents' `state` filter.
type IncidentStateFilter = "active" | "resolved" | "any";

const INCIDENT_STATE_FILTERS: Array<IncidentStateFilter> = [
  "active",
  "resolved",
  "any",
];

/*
 * Derived from the model ACL so the tool gate can never drift from RBAC.
 * Resolved lazily rather than at module load: this module is pulled in through
 * the service import graph before the Incident model class is fully wired up,
 * so calling a model method at import time throws a circular-dependency
 * TypeError. By the time a tool actually executes, every module is loaded.
 */
let cachedReadPermissions: Array<Permission> | null = null;
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    if (!cachedReadPermissions) {
      cachedReadPermissions = new Incident().getReadPermissions();
    }
    return cachedReadPermissions;
  };

export const QueryIncidentsTool: ObservabilityTool = {
  name: "query_incidents",
  description:
    'Query incidents in this project. Returns the most recent incidents with their current state and severity. Pass state="active" to list currently unresolved incidents regardless of when they were created (use this for \'what incidents are active/open right now?\'), or state="resolved" for closed ones. Pass incidentId to get full details of one incident — including its owner teams and owner users, affected monitors, labels, root cause, remediation and postmortem notes, and the incident window (telemetryWindowStart) to pivot into logs/traces/metrics for the affected services. For the incident\'s activity thread — state changes, notes and the latest updates — use get_incident_timeline.',
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "Get one incident by its ID (includes description).",
      },
      state: {
        type: "string",
        enum: ["active", "resolved", "any"],
        description:
          "Filter by current state: 'active' = not yet resolved (ignores the time window unless createdWithinHours is passed explicitly, so long-running open incidents are included), 'resolved' = resolved only, 'any' = no state filter (default).",
      },
      createdWithinHours: {
        type: "number",
        description:
          "Only incidents created within this many hours (default 168 = 7 days, max 720). Ignored when state is 'active' unless passed explicitly.",
      },
      limit: {
        type: "number",
        description: "Maximum incidents to return (default 10, max 25).",
      },
      skip: {
        type: "number",
        description:
          "Number of incidents to skip for pagination (default 0, max 500).",
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
    const incidentId: ObjectID | undefined = ToolArgs.getObjectID(
      args,
      "incidentId",
    );

    if (incidentId) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          _id: true,
          title: true,
          description: true,
          incidentNumber: true,
          createdAt: true,
          currentIncidentState: {
            name: true,
          },
          incidentSeverity: {
            name: true,
          },
          monitors: {
            _id: true,
            name: true,
          },
          labels: {
            name: true,
          },
          rootCause: true,
          remediationNotes: true,
          postmortemNote: true,
        },
        props: ctx.props,
      });

      /*
       * Ownership lives in join tables (IncidentOwnerTeam/IncidentOwnerUser),
       * not as relations on the Incident model itself, so "who owns this
       * incident?" needs two extra scoped queries. projectId is pinned to the
       * tenant from ctx because incidentId is an untrusted model argument.
       */
      let ownerTeamNames: string = "";
      let ownerUserNames: string = "";

      if (incident) {
        const [ownerTeams, ownerUsers]: [
          Array<IncidentOwnerTeam>,
          Array<IncidentOwnerUser>,
        ] = await Promise.all([
          IncidentOwnerTeamService.findBy({
            query: {
              incidentId: incidentId,
              projectId: ctx.projectId,
            },
            select: {
              _id: true,
              team: {
                name: true,
              },
            },
            limit: 25,
            skip: 0,
            props: ctx.props,
          }),
          IncidentOwnerUserService.findBy({
            query: {
              incidentId: incidentId,
              projectId: ctx.projectId,
            },
            select: {
              _id: true,
              user: {
                name: true,
                email: true,
              },
            },
            limit: 25,
            skip: 0,
            props: ctx.props,
          }),
        ]);

        ownerTeamNames = ownerTeams
          .map((ownerTeam: IncidentOwnerTeam) => {
            return ownerTeam.team?.name || "";
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");

        ownerUserNames = ownerUsers
          .map((ownerUser: IncidentOwnerUser) => {
            return (
              ownerUser.user?.name?.toString() ||
              ownerUser.user?.email?.toString() ||
              ""
            );
          })
          .filter((value: string) => {
            return value.length > 0;
          })
          .join(", ");
      }

      /*
       * Surface the incident's blast radius (affected monitors + labels) and
       * its own window so the model can pivot from an incident into the
       * logs/traces/metrics of the affected services over the right time
       * range, instead of guessing which service or hour to look at.
       */
      const affectedMonitors: string = (incident?.monitors || [])
        .map((monitor: { name?: string }) => {
          return monitor.name || "";
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .join(", ");

      const incidentLabels: string = (incident?.labels || [])
        .map((label: { name?: string }) => {
          return label.name || "";
        })
        .filter((value: string) => {
          return value.length > 0;
        })
        .join(", ");

      const rows: Array<JSONObject> = incident
        ? [
            {
              id: incident.id?.toString(),
              incidentNumber: incident.incidentNumber,
              title: incident.title,
              description: incident.description,
              state: incident.currentIncidentState?.name,
              severity: incident.incidentSeverity?.name,
              createdAt: incident.createdAt,
              ownerTeams: ownerTeamNames || undefined,
              ownerUsers: ownerUserNames || undefined,
              affectedMonitors: affectedMonitors || undefined,
              labels: incidentLabels || undefined,
              rootCause: incident.rootCause,
              remediationNotes: incident.remediationNotes,
              postmortemNote: incident.postmortemNote,
              telemetryWindowStart: incident.createdAt,
            },
          ]
        : [];

      const serialized: SerializedResult =
        ToolResultSerializer.serializeRows(rows);

      return {
        dataForLlm: serialized.text,
        rowCount: serialized.rowCount,
        citationLabel: `Incident ${incident?.incidentNumber ? `#${incident.incidentNumber}` : incidentId.toString()}`,
        citationTarget: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: incidentId.toString() },
        },
        redactionCount: serialized.redactionCount,
        isTruncated: serialized.isTruncated,
        widget:
          rows.length > 0
            ? WidgetBuilder.incidentList({
                title: `Incident #${incident?.incidentNumber ?? ""}`.trim(),
                items: rows,
                link: {
                  type: AIChatCitationTargetType.IncidentView,
                  params: { incidentId: incidentId.toString() },
                },
              })
            : undefined,
      };
    }

    const stateFilterString: string =
      ToolArgs.getString(args, "state") || "any";

    if (
      !INCIDENT_STATE_FILTERS.includes(stateFilterString as IncidentStateFilter)
    ) {
      throw new BadDataException(
        `Invalid state: ${stateFilterString}. Use one of: active, resolved, any.`,
      );
    }

    const stateFilter: IncidentStateFilter =
      stateFilterString as IncidentStateFilter;

    const createdWithinHours: number = ToolArgs.getNumber(
      args,
      "createdWithinHours",
      { defaultValue: 168, min: 1, max: 720 },
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 10,
      min: 1,
      max: 25,
    });
    const skip: number = ToolArgs.getNumber(args, "skip", {
      defaultValue: 0,
      min: 0,
      max: 500,
    });

    /*
     * Mirrors ToolArgs.getNumber parsing: the window was "provided" only when
     * the raw argument is a usable number. Needed because an active incident
     * opened months ago must still show up for "what's active right now?" —
     * so state=active drops the createdAt filter unless the model explicitly
     * asked for a window.
     */
    const rawWindow: unknown = args["createdWithinHours"];
    const windowProvided: boolean =
      (typeof rawWindow === "number" && Number.isFinite(rawWindow)) ||
      (typeof rawWindow === "string" &&
        rawWindow.trim().length > 0 &&
        Number.isFinite(Number(rawWindow)));

    const applyTimeFilter: boolean = stateFilter !== "active" || windowProvided;

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * createdWithinHours,
    );

    const query: Query<Incident> = {};

    if (applyTimeFilter) {
      query.createdAt = QueryHelper.inBetween(startTime, endTime);
    }

    /*
     * currentIncidentState is resolved through the state's flags rather than
     * by name, because state names are user-configurable per project while
     * isResolvedState is the canonical "closed" marker.
     */
    if (stateFilter === "active") {
      query.currentIncidentState = {
        isResolvedState: false,
      };
    } else if (stateFilter === "resolved") {
      query.currentIncidentState = {
        isResolvedState: true,
      };
    }

    const totalCount: PositiveNumber = await IncidentService.countBy({
      query: query,
      props: ctx.props,
    });

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: query,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        createdAt: true,
        currentIncidentState: {
          name: true,
        },
        incidentSeverity: {
          name: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: skip,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = incidents.map((incident: Incident) => {
      return {
        id: incident.id?.toString(),
        incidentNumber: incident.incidentNumber,
        title: incident.title,
        state: incident.currentIncidentState?.name,
        severity: incident.incidentSeverity?.name,
        createdAt: incident.createdAt,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    const total: number = totalCount.toNumber();

    let dataForLlm: string = serialized.text;
    if (total > rows.length && rows.length > 0) {
      dataForLlm = `Showing rows ${skip + 1}–${skip + rows.length} of ${total} total. Pass skip to page further.\n${dataForLlm}`;
    } else if (total > 0 && rows.length === 0 && skip > 0) {
      // Paged past the end: keep the model oriented instead of a bare empty.
      dataForLlm = `No rows at skip=${skip}; there are ${total} total. Lower skip to page back.\n${dataForLlm}`;
    }

    const windowLabel: string = applyTimeFilter
      ? `, last ${createdWithinHours}h`
      : "";

    let stateLabel: string = "Incidents";
    if (stateFilter === "active") {
      stateLabel = "Active incidents";
    } else if (stateFilter === "resolved") {
      stateLabel = "Resolved incidents";
    }

    return {
      dataForLlm: dataForLlm,
      rowCount: serialized.rowCount,
      citationLabel: `${stateLabel}${windowLabel} (${total} total)`,
      citationTarget: {
        type: AIChatCitationTargetType.Incidents,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.incidentList({
              title: `${stateLabel} (${total})`,
              description: applyTimeFilter
                ? `Created in the last ${createdWithinHours}h`
                : "Regardless of when they were created",
              items: rows,
              link: { type: AIChatCitationTargetType.Incidents },
            })
          : undefined,
    };
  },
};

export const SearchIncidentsTool: ObservabilityTool = {
  name: "search_incidents",
  description:
    "Search PAST incidents by free text across their title, description, root cause, remediation notes and postmortem. Use this to ground root-cause analysis in history — e.g. 'have we seen this error before, and how was it resolved?'. Returns matching incidents (most recent first) with their root cause and postmortem so you can reuse prior resolutions.",
  inputSchema: {
    type: "object",
    properties: {
      searchText: {
        type: "string",
        description:
          "Text to match (case-insensitive substring) across incident title, description, root cause, remediation notes and postmortem.",
      },
      createdWithinHours: {
        type: "number",
        description:
          "Only incidents created within this many hours (default 2160 = 90 days, max 8760 = 1 year).",
      },
      limit: {
        type: "number",
        description: "Maximum incidents to return (default 5, max 15).",
      },
    },
    required: ["searchText"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const searchText: string | undefined = ToolArgs.getString(
      args,
      "searchText",
    );

    if (!searchText) {
      return {
        dataForLlm:
          "Error: searchText is required. Provide the text to search past incidents for.",
        rowCount: 0,
        citationLabel: "Incident search (no query)",
        redactionCount: 0,
        isTruncated: false,
      };
    }

    const createdWithinHours: number = ToolArgs.getNumber(
      args,
      "createdWithinHours",
      { defaultValue: 2160, min: 1, max: 8760 },
    );
    const limit: number = ToolArgs.getNumber(args, "limit", {
      defaultValue: 5,
      min: 1,
      max: 15,
    });

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * createdWithinHours,
    );

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        createdAt: QueryHelper.inBetween(startTime, endTime),
        /*
         * The OR-joined ILIKE Raw references the listed columns, not the
         * attached property — this is the established multiSearch attachment
         * pattern (see QueryUtil).
         */
        title: QueryHelper.multiSearch(
          [
            "title",
            "description",
            "rootCause",
            "remediationNotes",
            "postmortemNote",
          ],
          searchText,
        ),
      },
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        createdAt: true,
        currentIncidentState: {
          name: true,
        },
        incidentSeverity: {
          name: true,
        },
        rootCause: true,
        postmortemNote: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: limit,
      skip: 0,
      props: ctx.props,
    });

    const rows: Array<JSONObject> = incidents.map((incident: Incident) => {
      return {
        id: incident.id?.toString(),
        incidentNumber: incident.incidentNumber,
        title: incident.title,
        state: incident.currentIncidentState?.name,
        severity: incident.incidentSeverity?.name,
        createdAt: incident.createdAt,
        rootCause: incident.rootCause,
        postmortemNote: incident.postmortemNote,
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Incident search "${searchText}" (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Incidents,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.incidentList({
              title: `Incidents matching "${searchText}" (${rows.length})`,
              items: rows,
              link: { type: AIChatCitationTargetType.Incidents },
            })
          : undefined,
    };
  },
};
