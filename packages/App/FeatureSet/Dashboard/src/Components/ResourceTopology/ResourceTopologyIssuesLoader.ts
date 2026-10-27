import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AlertStateUtil from "../../Utils/AlertState";
import IncidentStateUtil from "../../Utils/IncidentState";
import { OpenIssueRecord } from "./ResourceTopologyIssues";

/*
 * Reads the open incidents and alerts of one resource, for its topology.
 *
 * Records are linked to the resource itself (`vmwareVCenters`,
 * `kubernetesClusters`, ...) - or, for a cloud account, to any of its
 * resources (`cloudResources`, the ids given); the newest
 * OPEN_ISSUES_READ_LIMIT of each kind
 * are read — open ones are few at any one time — with their series labels
 * and any links to the resource's own inventory rows, which say which part
 * they are about. Incidents and alerts are read apart: a role that may read
 * alerts but not incidents still sees its alerts on the map.
 */

export const OPEN_ISSUES_READ_LIMIT: number = 100;

/* An inventory relation the records carry, and the columns to read of it. */
export interface OpenIssueRelation {
  name: string;
  select: JSONObject;
}

export interface OpenIssuesResult {
  records: Array<OpenIssueRecord>;
  /* Null when that kind could not be read (a role without access). */
  incidentCount: number | null;
  alertCount: number | null;
  /* More were open than were read. */
  isPartial: boolean;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = new Date(value as Date);

  return Number.isFinite(date.getTime()) ? date : null;
}

function toColor(value: unknown): string | null {
  if (value instanceof Color) {
    return value.toString();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value && typeof value === "object") {
    const raw: unknown = (value as JSONObject)["value"];

    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }

  return null;
}

function formatNumber(
  withPrefix: string | undefined,
  number: number | undefined,
): string {
  if (withPrefix) {
    return withPrefix;
  }

  return number !== undefined && number !== null ? `#${number}` : "";
}

function readRelatedIds(
  record: Incident | Alert,
  relations: Array<OpenIssueRelation>,
): Record<string, Array<string>> {
  const result: Record<string, Array<string>> = {};

  for (const relation of relations) {
    const value: unknown = (record as unknown as Record<string, unknown>)[
      relation.name
    ];

    if (!Array.isArray(value)) {
      continue;
    }

    result[relation.name] = value
      .map((item: unknown): string => {
        const id: unknown =
          item && typeof item === "object"
            ? (item as Record<string, unknown>)["_id"] ||
              (item as Record<string, unknown>)["id"]
            : null;

        return id ? id.toString() : "";
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });
  }

  return result;
}

function relationSelect(
  relations: Array<OpenIssueRelation>,
): Record<string, JSONObject> {
  const select: Record<string, JSONObject> = {};

  for (const relation of relations) {
    select[relation.name] = relation.select;
  }

  return select;
}

async function readOpenIncidents(data: {
  projectId: ObjectID;
  resourceRelation: string;
  resourceIds: Array<ObjectID>;
  relations: Array<OpenIssueRelation>;
}): Promise<{ records: Array<OpenIssueRecord>; total: number }> {
  const states: Array<IncidentState> =
    await IncidentStateUtil.getUnresolvedIncidentStates(data.projectId);

  if (states.length === 0) {
    return { records: [], total: 0 };
  }

  const result: ListResult<Incident> = await ModelAPI.getList<Incident>({
    modelType: Incident,
    query: {
      projectId: data.projectId,
      [data.resourceRelation]: new Includes(data.resourceIds),
      currentIncidentStateId: new Includes(
        states.map((state: IncidentState): ObjectID => {
          return state.id!;
        }),
      ),
    },
    select: {
      _id: true,
      title: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      declaredAt: true,
      createdAt: true,
      seriesLabels: true,
      incidentSeverity: {
        name: true,
        color: true,
      },
      currentIncidentState: {
        name: true,
      },
      ...relationSelect(data.relations),
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    limit: OPEN_ISSUES_READ_LIMIT,
    skip: 0,
  });

  const records: Array<OpenIssueRecord> = [];

  for (const incident of result.data) {
    if (!incident.id) {
      continue;
    }

    records.push({
      type: "incident",
      id: incident.id.toString(),
      title: incident.title || "",
      number: formatNumber(
        incident.incidentNumberWithPrefix,
        incident.incidentNumber,
      ),
      severityName: incident.incidentSeverity?.name || "",
      severityColor: toColor(incident.incidentSeverity?.color),
      stateName: incident.currentIncidentState?.name || "",
      createdAt: toDate(incident.declaredAt || incident.createdAt),
      seriesLabels: (incident.seriesLabels as JSONObject | undefined) || null,
      relatedIds: readRelatedIds(incident, data.relations),
    });
  }

  return { records: records, total: result.count ?? records.length };
}

async function readOpenAlerts(data: {
  projectId: ObjectID;
  resourceRelation: string;
  resourceIds: Array<ObjectID>;
  relations: Array<OpenIssueRelation>;
}): Promise<{ records: Array<OpenIssueRecord>; total: number }> {
  const states: Array<AlertState> =
    await AlertStateUtil.getUnresolvedAlertStates(data.projectId);

  if (states.length === 0) {
    return { records: [], total: 0 };
  }

  const result: ListResult<Alert> = await ModelAPI.getList<Alert>({
    modelType: Alert,
    query: {
      projectId: data.projectId,
      [data.resourceRelation]: new Includes(data.resourceIds),
      currentAlertStateId: new Includes(
        states.map((state: AlertState): ObjectID => {
          return state.id!;
        }),
      ),
    },
    select: {
      _id: true,
      title: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      createdAt: true,
      seriesLabels: true,
      alertSeverity: {
        name: true,
        color: true,
      },
      currentAlertState: {
        name: true,
      },
      ...relationSelect(data.relations),
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    limit: OPEN_ISSUES_READ_LIMIT,
    skip: 0,
  });

  const records: Array<OpenIssueRecord> = [];

  for (const alert of result.data) {
    if (!alert.id) {
      continue;
    }

    records.push({
      type: "alert",
      id: alert.id.toString(),
      title: alert.title || "",
      number: formatNumber(alert.alertNumberWithPrefix, alert.alertNumber),
      severityName: alert.alertSeverity?.name || "",
      severityColor: toColor(alert.alertSeverity?.color),
      stateName: alert.currentAlertState?.name || "",
      createdAt: toDate(alert.createdAt),
      seriesLabels: (alert.seriesLabels as JSONObject | undefined) || null,
      relatedIds: readRelatedIds(alert, data.relations),
    });
  }

  return { records: records, total: result.count ?? records.length };
}

/*
 * Whether open incidents or alerts could not be read (a role without
 * access, or a failed read): the map then says it may not show them all,
 * instead of looking as if nothing were open.
 */
export function areOpenIssuesUnreadable(
  result: OpenIssuesResult | null | undefined,
): boolean {
  return Boolean(
    result && (result.incidentCount === null || result.alertCount === null),
  );
}

export async function loadOpenIssues(data: {
  projectId: ObjectID;
  /* The relation that links a record to the resource: "vmwareVCenters". */
  resourceRelation: string;
  resourceId?: ObjectID | undefined;
  /* Or any of several resources: a cloud account's (`cloudResources`). */
  resourceIds?: Array<ObjectID> | undefined;
  /* Links to the resource's own inventory rows, read with each record. */
  relations?: Array<OpenIssueRelation> | undefined;
}): Promise<OpenIssuesResult> {
  const relations: Array<OpenIssueRelation> = data.relations || [];
  const resourceIds: Array<ObjectID> = [
    ...(data.resourceId ? [data.resourceId] : []),
    ...(data.resourceIds || []),
  ];

  // Linked to nothing: nothing to read, and nothing missed.
  if (resourceIds.length === 0) {
    return { records: [], incidentCount: 0, alertCount: 0, isPartial: false };
  }

  const request: {
    projectId: ObjectID;
    resourceRelation: string;
    resourceIds: Array<ObjectID>;
    relations: Array<OpenIssueRelation>;
  } = {
    projectId: data.projectId,
    resourceRelation: data.resourceRelation,
    resourceIds: resourceIds,
    relations: relations,
  };

  const [incidents, alerts]: [
    { records: Array<OpenIssueRecord>; total: number } | null,
    { records: Array<OpenIssueRecord>; total: number } | null,
  ] = await Promise.all([
    readOpenIncidents(request).catch(() => {
      return null;
    }),
    readOpenAlerts(request).catch(() => {
      return null;
    }),
  ]);

  return {
    records: [...(incidents?.records || []), ...(alerts?.records || [])],
    incidentCount: incidents ? incidents.total : null,
    alertCount: alerts ? alerts.total : null,
    isPartial:
      Boolean(incidents && incidents.total > incidents.records.length) ||
      Boolean(alerts && alerts.total > alerts.records.length),
  };
}
