import type { AxiosResponse } from "axios";
import apiClient from "./client";
import { isRefusedSelect } from "./refusedSelect";
import { toPlainText } from "../utils/text";
import type { ColorField, ListResponse } from "./types";
import type { FilterableList, RecordFilters } from "../filters/recordFilters";

/*
 * How a list's filters (filters/recordFilters.ts) are asked of the server,
 * and where the sheet's values come from. Each list's query names the
 * columns the Dashboard's tables filter on, so the app and the web agree on
 * what "Severity: Critical" or "Owner: Platform team" keeps.
 */

// The most ids one step of a filter carries, as the server's own limit.
export const MAX_FILTER_IDS: number = 1000;

interface IncludesValue {
  _type: "Includes";
  value: Array<string>;
}

function includes(ids: Array<string>): IncludesValue {
  return { _type: "Includes", value: [...ids] };
}

// The people and teams a record must be owned by (one of them, directly).
export interface OwnerScope {
  userIds: Array<string>;
  teamIds: Array<string>;
}

// A list's filters as a fetch is handed them: what is picked, and who owns.
export interface ListFilter {
  filters: RecordFilters;
  owners: OwnerScope | null;
}

interface OwnerTables {
  userPath: string;
  teamPath: string;
  // The owner row's column naming the record.
  recordIdColumn: string;
}

interface ListColumns {
  path: string;
  state: string;
  severity: string | null;
  // The column a record's monitors are matched on, and how.
  monitor: { column: string; manyToMany: boolean } | null;
  monitorType: string | null;
  owners: OwnerTables;
}

/*
 * Each list's columns: the foreign keys the Dashboard filters on (a
 * relation's own id column is matched with Includes, as the web's
 * many-to-one facets are), labels through their join table, and the owner
 * tables beside the record.
 */
export const LIST_COLUMNS: Record<FilterableList, ListColumns> = {
  incidents: {
    path: "/api/incident",
    state: "currentIncidentStateId",
    severity: "incidentSeverityId",
    monitor: { column: "monitors", manyToMany: true },
    monitorType: null,
    owners: {
      userPath: "/api/incident-owner-user",
      teamPath: "/api/incident-owner-team",
      recordIdColumn: "incidentId",
    },
  },
  alerts: {
    path: "/api/alert",
    state: "currentAlertStateId",
    severity: "alertSeverityId",
    monitor: { column: "monitorId", manyToMany: false },
    monitorType: null,
    owners: {
      userPath: "/api/alert-owner-user",
      teamPath: "/api/alert-owner-team",
      recordIdColumn: "alertId",
    },
  },
  incidentEpisodes: {
    path: "/api/incident-episode",
    state: "currentIncidentStateId",
    severity: "incidentSeverityId",
    monitor: null,
    monitorType: null,
    owners: {
      userPath: "/api/incident-episode-owner-user",
      teamPath: "/api/incident-episode-owner-team",
      recordIdColumn: "incidentEpisodeId",
    },
  },
  alertEpisodes: {
    path: "/api/alert-episode",
    state: "currentAlertStateId",
    severity: "alertSeverityId",
    monitor: null,
    monitorType: null,
    owners: {
      userPath: "/api/alert-episode-owner-user",
      teamPath: "/api/alert-episode-owner-team",
      recordIdColumn: "alertEpisodeId",
    },
  },
  monitors: {
    path: "/api/monitor",
    state: "currentMonitorStatusId",
    severity: null,
    monitor: null,
    monitorType: "monitorType",
    owners: {
      userPath: "/api/monitor-owner-user",
      teamPath: "/api/monitor-owner-team",
      recordIdColumn: "monitorId",
    },
  },
};

/*
 * The columns a list's filters match, in the server's own shape. Owners and
 * an incident's monitors are not here: each is a step of its own
 * (getOwnersQuery, fetchIdsOfIncidentsAboutMonitors).
 */
export function getFilterColumnsQuery(
  list: FilterableList,
  filters: RecordFilters,
): Record<string, unknown> {
  const columns: ListColumns = LIST_COLUMNS[list];
  const query: Record<string, unknown> = {};
  if (filters.stateIds.length > 0) {
    query[columns.state] = includes(filters.stateIds);
  }
  if (columns.severity && filters.severityIds.length > 0) {
    query[columns.severity] = includes(filters.severityIds);
  }
  if (filters.labelIds.length > 0) {
    // Records with any of the labels, through the label join table.
    query["labels"] = includes(filters.labelIds);
  }
  if (
    columns.monitor &&
    !columns.monitor.manyToMany &&
    filters.monitorIds.length > 0
  ) {
    query[columns.monitor.column] = includes(filters.monitorIds);
  }
  if (columns.monitorType && filters.monitorTypes.length > 0) {
    query[columns.monitorType] = includes(filters.monitorTypes);
  }
  return query;
}

// Whether an owners filter names anybody: one that names nobody matches nothing.
export function namesAnyOwner(scope: OwnerScope): boolean {
  return scope.userIds.length > 0 || scope.teamIds.length > 0;
}

/*
 * The server's own owners filter (Common/Types/BaseDatabase/OwnedBy): the
 * records owned directly by any of the people or teams. A server older than
 * it refuses the query as a bad request; postFilteredList then asks the
 * owner tables itself.
 */
export function getOwnersQuery(scope: OwnerScope): Record<string, unknown> {
  return {
    owners: {
      _type: "OwnedBy",
      match: "AnyOf",
      userIds: [...scope.userIds].slice(0, MAX_FILTER_IDS),
      teamIds: [...scope.teamIds].slice(
        0,
        Math.max(0, MAX_FILTER_IDS - scope.userIds.length),
      ),
    },
  };
}

function readIds(rows: unknown, column: string): Array<string> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const ids: Set<string> = new Set();
  rows.forEach((row: unknown): void => {
    if (!row || typeof row !== "object") {
      return;
    }
    const id: string = toPlainText((row as Record<string, unknown>)[column]);
    if (id) {
      ids.add(id);
    }
  });
  return Array.from(ids);
}

/*
 * The ids of the records the people and teams own, read from the owner
 * tables as the Dashboard reads them: for a server that does not know the
 * owners filter. The newest thousand owner rows of each kind are read.
 */
export async function fetchOwnedRecordIds(
  projectId: string,
  list: FilterableList,
  scope: OwnerScope,
): Promise<Array<string>> {
  const tables: OwnerTables = LIST_COLUMNS[list].owners;
  const read: (
    path: string,
    ownerColumn: string,
    ownerIds: Array<string>,
  ) => Promise<Array<string>> = async (
    path: string,
    ownerColumn: string,
    ownerIds: Array<string>,
  ): Promise<Array<string>> => {
    if (ownerIds.length === 0) {
      return [];
    }
    const response: AxiosResponse = await apiClient.post(
      `${path}/get-list?skip=0&limit=${MAX_FILTER_IDS}`,
      {
        query: { [ownerColumn]: includes(ownerIds) },
        select: { _id: true, [tables.recordIdColumn]: true },
        sort: { createdAt: "DESC" },
      },
      { headers: { tenantid: projectId } },
    );
    return readIds(response.data?.data, tables.recordIdColumn);
  };
  const [byPeople, byTeams]: [Array<string>, Array<string>] = await Promise.all(
    [
      read(tables.userPath, "userId", scope.userIds),
      read(tables.teamPath, "teamId", scope.teamIds),
    ],
  );
  return Array.from(new Set([...byPeople, ...byTeams]));
}

/*
 * The ids of the newest incidents about any of the monitors. Matched in a
 * step of its own, so the rows that come back keep every monitor they are
 * about: an incident filtered through its monitors relation would carry
 * only the matched ones, and its row would say "1 monitor" of two.
 */
export async function fetchIdsOfIncidentsAboutMonitors(
  projectId: string,
  monitorIds: Array<string>,
): Promise<Array<string>> {
  const response: AxiosResponse = await apiClient.post(
    `/api/incident/get-list?skip=0&limit=${MAX_FILTER_IDS}`,
    {
      query: { monitors: includes(monitorIds) },
      select: { _id: true },
      sort: { createdAt: "DESC" },
    },
    { headers: { tenantid: projectId } },
  );
  return readIds(response.data?.data, "_id");
}

function intersect(
  current: Array<string> | null,
  next: Array<string>,
): Array<string> {
  if (current === null) {
    return next;
  }
  const keep: Set<string> = new Set(next);
  return current.filter((id: string): boolean => {
    return keep.has(id);
  });
}

export interface FilteredListRequest {
  projectId: string;
  list: FilterableList;
  filters: RecordFilters;
  /*
   * Who "You" and the picked people and teams are, resolved
   * (filters/ownerScope.ts); null for no owners filter. A scope that names
   * nobody matches nothing.
   */
  owners: OwnerScope | null;
  // The list's own query, before any filter (archived monitors left out...).
  baseQuery: Record<string, unknown>;
  // Asks the server for a page of the list with the query given.
  post: (query: Record<string, unknown>) => Promise<AxiosResponse>;
  limit: number;
}

function emptyResponse<T>(limit: number): AxiosResponse<ListResponse<T>> {
  return {
    data: { data: [], count: 0, skip: 0, limit: limit },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as AxiosResponse["config"],
  };
}

/*
 * A page of a list with its filters applied on the server, so they reach
 * every record of the project and not only the newest hundred. The owners
 * filter is asked as one query where the server knows it; otherwise the
 * owner tables are read for the ids first. Nothing that can match is an
 * empty page, never a request that would match everything.
 */
export async function postFilteredList<T>(
  request: FilteredListRequest,
): Promise<AxiosResponse<ListResponse<T>>> {
  const columns: ListColumns = LIST_COLUMNS[request.list];
  let query: Record<string, unknown> = {
    ...request.baseQuery,
    ...getFilterColumnsQuery(request.list, request.filters),
  };

  let narrowedIds: Array<string> | null = null;
  if (columns.monitor?.manyToMany && request.filters.monitorIds.length > 0) {
    narrowedIds = await fetchIdsOfIncidentsAboutMonitors(
      request.projectId,
      request.filters.monitorIds,
    );
    if (narrowedIds.length === 0) {
      return emptyResponse<T>(request.limit);
    }
  }

  const withIds: (
    base: Record<string, unknown>,
    ids: Array<string> | null,
  ) => Record<string, unknown> = (
    base: Record<string, unknown>,
    ids: Array<string> | null,
  ): Record<string, unknown> => {
    return ids === null ? base : { ...base, _id: includes(ids) };
  };

  const owners: OwnerScope | null = request.owners;
  if (owners === null) {
    return await request.post(withIds(query, narrowedIds));
  }
  if (!namesAnyOwner(owners)) {
    return emptyResponse<T>(request.limit);
  }

  try {
    return await request.post({
      ...withIds(query, narrowedIds),
      ...getOwnersQuery(owners),
    });
  } catch (error: unknown) {
    if (!isRefusedSelect(error)) {
      throw error;
    }
  }

  // A server older than the owners filter: the owner tables, read first.
  const ownedIds: Array<string> = await fetchOwnedRecordIds(
    request.projectId,
    request.list,
    owners,
  );
  narrowedIds = intersect(narrowedIds, ownedIds);
  if (narrowedIds.length === 0) {
    return emptyResponse<T>(request.limit);
  }
  query = withIds(query, narrowedIds);
  return await request.post(query);
}

/*
 * The values the filter sheet offers.
 */

export interface SeverityOptionItem {
  _id: string;
  name: string;
  color?: ColorField | string | null;
  order?: number;
}

// A project's severities, most severe first, as every picker of them lists them.
export async function fetchSeverities(
  projectId: string,
  kind: "incident" | "alert",
): Promise<Array<SeverityOptionItem>> {
  const response: AxiosResponse = await apiClient.post(
    `/api/${kind}-severity/get-list?skip=0&limit=50`,
    {
      query: {},
      select: { _id: true, name: true, color: true, order: true },
      sort: { order: "ASC" },
    },
    { headers: { tenantid: projectId } },
  );
  return readNamedRows(response.data?.data).map(
    (row: NamedRow): SeverityOptionItem => {
      return {
        _id: row._id,
        name: row.name,
        color: row.raw["color"] as SeverityOptionItem["color"],
        order:
          typeof row.raw["order"] === "number"
            ? (row.raw["order"] as number)
            : undefined,
      };
    },
  );
}

export interface LabelOptionItem {
  _id: string;
  name: string;
  color?: ColorField | string | null;
}

export async function fetchLabels(
  projectId: string,
): Promise<Array<LabelOptionItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/label/get-list?skip=0&limit=500",
    {
      query: {},
      select: { _id: true, name: true, color: true },
      sort: { name: "ASC" },
    },
    { headers: { tenantid: projectId } },
  );
  return readNamedRows(response.data?.data).map(
    (row: NamedRow): LabelOptionItem => {
      return {
        _id: row._id,
        name: row.name,
        color: row.raw["color"] as LabelOptionItem["color"],
      };
    },
  );
}

export interface TeamOptionItem {
  _id: string;
  name: string;
}

export async function fetchTeams(
  projectId: string,
): Promise<Array<TeamOptionItem>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/team/get-list?skip=0&limit=500",
    {
      query: {},
      select: { _id: true, name: true },
      sort: { name: "ASC" },
    },
    { headers: { tenantid: projectId } },
  );
  return readNamedRows(response.data?.data).map(
    (row: NamedRow): TeamOptionItem => {
      return { _id: row._id, name: row.name };
    },
  );
}

/*
 * The teams the reader is on in the project, for "You": what they own
 * includes what their teams own. Invitations not yet accepted are no
 * membership.
 */
export async function fetchMyTeamIds(
  projectId: string,
  userId: string,
): Promise<Array<string>> {
  const response: AxiosResponse = await apiClient.post(
    "/api/team-member/get-list?skip=0&limit=500",
    {
      query: { userId: userId, hasAcceptedInvitation: true },
      select: { _id: true, teamId: true },
      sort: {},
    },
    { headers: { tenantid: projectId } },
  );
  return readIds(response.data?.data, "teamId");
}

export interface MonitorOptionItem {
  _id: string;
  name: string;
  monitorType?: string;
}

/*
 * The project's monitors by name, for the Monitors and Type sections: a
 * light read of every monitor (up to a thousand), not the hundred newest
 * the Monitors list holds.
 */
export async function fetchMonitorOptions(
  projectId: string,
): Promise<Array<MonitorOptionItem>> {
  const response: AxiosResponse = await apiClient.post(
    `/api/monitor/get-list?skip=0&limit=${MAX_FILTER_IDS}`,
    {
      query: { isArchived: false },
      select: { _id: true, name: true, monitorType: true },
      sort: { name: "ASC" },
    },
    { headers: { tenantid: projectId } },
  );
  return readNamedRows(response.data?.data).map(
    (row: NamedRow): MonitorOptionItem => {
      const monitorType: string = toPlainText(row.raw["monitorType"]);
      return {
        _id: row._id,
        name: row.name,
        monitorType: monitorType || undefined,
      };
    },
  );
}

interface NamedRow {
  _id: string;
  name: string;
  raw: Record<string, unknown>;
}

// Rows with an id and a name, whatever envelope the server put them in.
function readNamedRows(rows: unknown): Array<NamedRow> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: Array<NamedRow> = [];
  rows.forEach((row: unknown): void => {
    if (!row || typeof row !== "object") {
      return;
    }
    const raw: Record<string, unknown> = row as Record<string, unknown>;
    const id: string = toPlainText(raw["_id"]);
    const name: string = toPlainText(raw["name"]).trim();
    if (id && name) {
      result.push({ _id: id, name: name, raw: raw });
    }
  });
  return result;
}
