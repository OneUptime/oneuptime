import Incident from "../../../../Models/DatabaseModels/Incident";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import IncidentService from "../../../Services/IncidentService";
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
    "Query incidents in this project. Returns the most recent incidents with their current state and severity. Pass incidentId to get full details of one incident — including its affected monitors, labels, root cause, remediation and postmortem notes, and the incident window (telemetryWindowStart) to pivot into logs/traces/metrics for the affected services.",
  inputSchema: {
    type: "object",
    properties: {
      incidentId: {
        type: "string",
        description: "Get one incident by its ID (includes description).",
      },
      createdWithinHours: {
        type: "number",
        description:
          "Only incidents created within this many hours (default 168 = 7 days, max 720).",
      },
      limit: {
        type: "number",
        description: "Maximum incidents to return (default 10, max 25).",
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

    const endTime: Date = OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * createdWithinHours,
    );

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        createdAt: QueryHelper.inBetween(startTime, endTime),
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
      };
    });

    const serialized: SerializedResult =
      ToolResultSerializer.serializeRows(rows);

    return {
      dataForLlm: serialized.text,
      rowCount: serialized.rowCount,
      citationLabel: `Incidents, last ${createdWithinHours}h (${serialized.rowCount} found)`,
      citationTarget: {
        type: AIChatCitationTargetType.Incidents,
      },
      redactionCount: serialized.redactionCount,
      isTruncated: serialized.isTruncated,
      widget:
        rows.length > 0
          ? WidgetBuilder.incidentList({
              title: `Incidents (${rows.length})`,
              description: `Created in the last ${createdWithinHours}h`,
              items: rows,
              link: { type: AIChatCitationTargetType.Incidents },
            })
          : undefined,
    };
  },
};
