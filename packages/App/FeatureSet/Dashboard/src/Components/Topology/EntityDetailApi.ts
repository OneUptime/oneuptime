import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TOPOLOGY_CONNECTION_SECTIONS,
  TopologyApiLimits,
  TopologyApiPath,
  TopologyConnectionSection,
  TopologyEntityConnectionsRequestJSON,
  TopologyEntityRequestJSON,
} from "Common/Types/Topology/TopologyApi";
import {
  TOPOLOGY_BUSY_MESSAGE,
  TopologyOutdatedError,
  TopologyRequestOptions,
  isTopologyBusyError,
  postTopologyApi,
} from "./TopologyApi";
import { EntityDetailTarget, TopologyEntity } from "./TopologyData";

/*
 * Client for the topology detail drawer: one entity's full inventory row
 * and its in-range relationships, from POST /telemetry/topology/entity, and
 * further rows of one section from /entity/connections ("Show more").
 *
 * The drawer used to classify the relationships the map had downloaded,
 * which only ever covered the subset the map happened to load. The server
 * now classifies all of them and returns exact totals with the top rows of
 * each section, so the drawer's counts are true however large the entity's
 * neighbourhood is.
 *
 * React-free on purpose: App tests exercise the request shapes and the
 * decoders without a DOM.
 */

/** An entity's full inventory row, as the drawer holds it. */
export interface EntityDetail extends TopologyEntity {
  /** InventoryItem _id. */
  id: string;
  entityKey: string;
  entityType: string;
  firstSeenAt?: Date | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
}

/** One relationship of the entity, seen from the entity. */
export interface EntityConnection {
  relationshipType: string;
  /** "out" when the entity is the relationship's `from` (self-loops too). */
  direction: "out" | "in";
  otherKey: string;
  /** false when the other end is not in inventory ("Undiscovered resource"). */
  otherKnown: boolean;
  otherName?: string | undefined;
  otherType?: string | undefined;
  callCount?: number | undefined;
  errorCount?: number | undefined;
  avgDurationMs?: number | undefined;
  lastSeenAt?: Date | undefined;
}

export interface EntityConnectionSection {
  /** Exact, unless the entity's scan was limited (then a lower bound). */
  total: number;
  /** How many of `total` point at something no longer in inventory. */
  unknownTotal: number;
  rows: Array<EntityConnection>;
  /** Offset of the next page, or null when `rows` reached the end. */
  nextOffset: number | null;
}

export type EntityConnectionSections = Record<
  TopologyConnectionSection,
  EntityConnectionSection
>;

export interface EntityDetailData {
  /** The range start the server used, or null if it sent none we can read. */
  rangeStart: Date | null;
  /** null when no non-archived item has the key any more. */
  entity: EntityDetail | null;
  sections: EntityConnectionSections;
  /** The server stopped reading relationships early: totals are lower bounds. */
  isScanLimited: boolean;
}

export interface EntityConnectionsPage {
  rangeStart: Date | null;
  section: TopologyConnectionSection;
  connections: EntityConnectionSection;
  isScanLimited: boolean;
}

export type EntityDetailRequestOptions = TopologyRequestOptions;

/*
 * Rows the drawer asks for per "Show more", by section: the same page the
 * server returns first, so every click reveals as much as the first view.
 */
export function pageSizeForSection(section: TopologyConnectionSection): number {
  return section === "calls" || section === "calledBy"
    ? TopologyApiLimits.EntityDependencyRows
    : TopologyApiLimits.EntityOtherRows;
}

/*
 * Rows to ask for when a section is reloaded from its start ("Reload list"
 * after the list changed under the user): what it showed plus one more
 * page, within the endpoint's page cap.
 */
export function sectionReloadLimit(
  section: TopologyConnectionSection,
  shownRows: number,
): number {
  return Math.min(
    TopologyApiLimits.EntityConnectionsPageSizeMax,
    Math.max(0, Math.floor(shownRows)) + pageSizeForSection(section),
  );
}

export function buildEntityDetailRequest(
  target: EntityDetailTarget,
  rangeStart: Date,
): TopologyEntityRequestJSON {
  const request: TopologyEntityRequestJSON = {
    rangeStart: rangeStart.toISOString(),
    entityKey: target.entityKey,
  };
  if (target.entityType) {
    request.entityType = target.entityType;
  }
  return request;
}

export function buildEntityConnectionsRequest(
  target: EntityDetailTarget,
  rangeStart: Date,
  section: TopologyConnectionSection,
  offset: number,
  limit: number,
): TopologyEntityConnectionsRequestJSON {
  return {
    ...buildEntityDetailRequest(target, rangeStart),
    section: section,
    offset: Math.max(0, Math.floor(offset)),
    limit: Math.min(
      TopologyApiLimits.EntityConnectionsPageSizeMax,
      Math.max(1, Math.floor(limit)),
    ),
  };
}

// ---------------------------------------------------------------- decoding

function asObject(value: unknown): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/* A display string: blank means "none", so the drawer falls back to a label. */
function asName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asCount(value: unknown): number {
  const count: number | undefined = asNumber(value);
  return count === undefined || count < 0 ? 0 : Math.floor(count);
}

function asEpochDate(value: unknown): Date | undefined {
  const ms: number | undefined = asNumber(value);
  return ms === undefined ? undefined : new Date(ms);
}

function asIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertEnvelope(json: unknown): JSONObject {
  const envelope: JSONObject | null = asObject(json);
  if (!envelope) {
    throw new TopologyOutdatedError();
  }
  const formatVersion: unknown = envelope["formatVersion"];
  if (formatVersion !== TOPOLOGY_API_FORMAT_VERSION) {
    throw new TopologyOutdatedError(
      typeof formatVersion === "number" ? formatVersion : null,
    );
  }
  return envelope;
}

function isConnectionSection(
  value: unknown,
): value is TopologyConnectionSection {
  return TOPOLOGY_CONNECTION_SECTIONS.includes(
    value as TopologyConnectionSection,
  );
}

export function emptyConnectionSection(): EntityConnectionSection {
  return { total: 0, unknownTotal: 0, rows: [], nextOffset: null };
}

export function decodeEntityDetail(value: unknown): EntityDetail | null {
  const row: JSONObject | null = asObject(value);
  const entityKey: string | undefined = asString(row?.["key"]);
  if (!row || !entityKey) {
    return null;
  }
  const identifying: JSONObject | null = asObject(row["identifyingAttributes"]);
  const descriptive: JSONObject | null = asObject(row["descriptiveAttributes"]);
  return {
    id: asString(row["id"]) || "",
    entityKey: entityKey,
    entityType: asString(row["type"]) || "",
    displayName: asName(row["name"]),
    source: asName(row["source"]),
    lastSeenAt: asEpochDate(row["lastSeenAt"]),
    firstSeenAt: asEpochDate(row["firstSeenAt"]),
    resourceType: asName(row["resourceType"]),
    resourceId: asName(row["resourceId"]),
    identifyingAttributes: identifying || undefined,
    descriptiveAttributes: descriptive || undefined,
  };
}

export function decodeConnection(value: unknown): EntityConnection | null {
  const row: JSONObject | null = asObject(value);
  const otherKey: string | undefined = asString(row?.["otherKey"]);
  if (!row || otherKey === undefined) {
    return null;
  }
  return {
    relationshipType: asString(row["relationshipType"]) || "",
    direction: row["direction"] === "in" ? "in" : "out",
    otherKey: otherKey,
    otherKnown: row["otherKnown"] === true,
    otherName: asName(row["otherName"]),
    otherType: asName(row["otherType"]),
    callCount: asNumber(row["callCount"]),
    errorCount: asNumber(row["errorCount"]),
    avgDurationMs: asNumber(row["avgDurationMs"]),
    lastSeenAt: asEpochDate(row["lastSeenAt"]),
  };
}

export function decodeConnectionSection(
  value: unknown,
): EntityConnectionSection {
  const section: JSONObject | null = asObject(value);
  if (!section) {
    return emptyConnectionSection();
  }
  const rows: Array<EntityConnection> = [];
  for (const row of Array.isArray(section["rows"]) ? section["rows"] : []) {
    const decoded: EntityConnection | null = decodeConnection(row);
    if (decoded) {
      rows.push(decoded);
    }
  }
  const nextOffset: number | undefined = asNumber(section["nextOffset"]);
  const total: number = Math.max(asCount(section["total"]), rows.length);
  return {
    total: total,
    unknownTotal: Math.min(asCount(section["unknownTotal"]), total),
    rows: rows,
    nextOffset:
      nextOffset === undefined || nextOffset < 0
        ? null
        : Math.floor(nextOffset),
  };
}

export function decodeEntityDetailResponse(json: unknown): EntityDetailData {
  const envelope: JSONObject = assertEnvelope(json);
  const entity: EntityDetail | null = decodeEntityDetail(envelope["entity"]);
  const rawSections: JSONObject = asObject(envelope["sections"]) || {};
  const sections: EntityConnectionSections = {
    calls: emptyConnectionSection(),
    calledBy: emptyConnectionSection(),
    runsOn: emptyConnectionSection(),
    related: emptyConnectionSection(),
  };
  /*
   * A missing entity has no connections to show, whatever else came back:
   * the drawer says it is gone rather than listing orphaned rows.
   */
  if (entity) {
    for (const section of TOPOLOGY_CONNECTION_SECTIONS) {
      sections[section] = decodeConnectionSection(rawSections[section]);
    }
  }
  return {
    rangeStart: asIsoDate(envelope["rangeStart"]),
    entity: entity,
    sections: sections,
    isScanLimited: envelope["isScanLimited"] === true,
  };
}

export function decodeEntityConnectionsResponse(
  json: unknown,
  requestedSection: TopologyConnectionSection,
): EntityConnectionsPage {
  const envelope: JSONObject = assertEnvelope(json);
  const section: unknown = envelope["section"];
  if (section !== undefined && section !== requestedSection) {
    /* An answer about another section must never be appended to this one. */
    throw new Error(
      `Expected connections for "${requestedSection}", got "${String(section)}".`,
    );
  }
  return {
    rangeStart: asIsoDate(envelope["rangeStart"]),
    section: isConnectionSection(section) ? section : requestedSection,
    connections: decodeConnectionSection(envelope["connections"]),
    isScanLimited: envelope["isScanLimited"] === true,
  };
}

/* A stable identity for a connection row within one entity's drawer. */
export function connectionId(
  section: TopologyConnectionSection,
  row: EntityConnection,
): string {
  return JSON.stringify([
    section,
    row.direction,
    row.relationshipType,
    row.otherKey,
  ]);
}

export interface AppendedConnectionsPage {
  merged: EntityConnectionSection;
  /* The first row the page added (focus moves there), or null. */
  firstNewRowId: string | null;
  /*
   * The list changed on the server between two pages, so what the drawer
   * shows may have skipped rows: the page repeated rows already shown, or
   * the list ended with fewer rows than its total.
   */
  listChanged: boolean;
}

/*
 * Append a "Show more" page to what the drawer already shows. Rows it
 * already has are skipped, and the counts are the latest the server
 * reported.
 *
 * Paging is by offset over a ranking the server recomputes on every
 * request, and that ranking moves while the drawer is open (call counts
 * are rewritten, ends are pruned or renamed, new relationships arrive). A
 * row that moved across the offset between two requests is then never
 * returned: the page repeats a row instead, or the list ends short of its
 * total. Neither can be repaired by merging, so it is reported as
 * `listChanged` and the drawer offers to reload the list.
 */
export function appendConnectionsPage(
  section: TopologyConnectionSection,
  current: EntityConnectionSection,
  page: EntityConnectionSection,
): AppendedConnectionsPage {
  const seen: Set<string> = new Set<string>(
    current.rows.map((row: EntityConnection): string => {
      return connectionId(section, row);
    }),
  );
  const rows: Array<EntityConnection> = current.rows.slice();
  let firstNewRowId: string | null = null;
  let repeatedRows: number = 0;
  for (const row of page.rows) {
    const id: string = connectionId(section, row);
    if (seen.has(id)) {
      repeatedRows++;
      continue;
    }
    seen.add(id);
    rows.push(row);
    if (firstNewRowId === null) {
      firstNewRowId = id;
    }
  }
  const total: number = Math.max(page.total, rows.length);
  /*
   * Offsets are re-ranked on every request, so a change under the user can
   * hide a row. An insertion above the offset repeats a row we already show
   * (repeatedRows); a deletion above it skips the row that moved into its
   * place and leaves nothing repeated — only the section shrinking gives it
   * away. A list that ends with a different number of rows than the server
   * counts is stale either way.
   */
  const shrank: boolean = page.total < current.total;
  const endedOffCount: boolean =
    page.nextOffset === null && rows.length !== page.total;
  return {
    merged: {
      total: total,
      unknownTotal: Math.min(page.unknownTotal, total),
      rows: rows,
      nextOffset: page.nextOffset,
    },
    firstNewRowId: firstNewRowId,
    listChanged: repeatedRows > 0 || shrank || endedOffCount,
  };
}

// ---------------------------------------------------------------- requests

/*
 * postTopologyApi turns a 404 (a server without the drawer's routes) into a
 * TopologyOutdatedError and any other failure into a throw of the server's
 * error response; the decoders refuse a payload in another format.
 */
function postEntityRequest(
  path: TopologyApiPath,
  body: TopologyEntityRequestJSON | TopologyEntityConnectionsRequestJSON,
  options: EntityDetailRequestOptions,
): Promise<JSONObject> {
  /* The request types are plain JSON; they only lack an index signature. */
  return postTopologyApi(path, body as unknown as JSONObject, options);
}

export async function fetchEntityDetail(
  target: EntityDetailTarget,
  rangeStart: Date,
  options: EntityDetailRequestOptions = {},
): Promise<EntityDetailData> {
  const json: JSONObject = await postEntityRequest(
    TopologyApiPath.Entity,
    buildEntityDetailRequest(target, rangeStart),
    options,
  );
  return decodeEntityDetailResponse(json);
}

export async function fetchEntityConnections(
  target: EntityDetailTarget,
  rangeStart: Date,
  section: TopologyConnectionSection,
  offset: number,
  limit: number,
  options: EntityDetailRequestOptions = {},
): Promise<EntityConnectionsPage> {
  const json: JSONObject = await postEntityRequest(
    TopologyApiPath.EntityConnections,
    buildEntityConnectionsRequest(target, rangeStart, section, offset, limit),
    options,
  );
  return decodeEntityConnectionsResponse(json, section);
}

export interface EntityDetailErrorDescription {
  /*
   * The server speaks another Topology format (or lacks the route): only
   * loading the matching bundle helps, so the drawer offers a page reload
   * instead of a retry that would fail the same way.
   */
  isOutdated: boolean;
  /* The server turned the request away while busy (429): retry shortly. */
  isBusy: boolean;
  /* Fixed copy the caller translates when isOutdated or isBusy. */
  detail: string;
}

/*
 * What the drawer tells the user when a request fails. The copy for a
 * format mismatch and for a busy server is fixed (and translated by the
 * caller); anything else carries the server's own explanation when it gave
 * one.
 */
export function describeEntityDetailError(
  error: unknown,
): EntityDetailErrorDescription {
  if (error instanceof TopologyOutdatedError) {
    return { isOutdated: true, isBusy: false, detail: error.message };
  }
  /* The server was at its limit on topology work (429); that passes. */
  if (isTopologyBusyError(error)) {
    return { isOutdated: false, isBusy: true, detail: TOPOLOGY_BUSY_MESSAGE };
  }
  if (error instanceof HTTPErrorResponse) {
    if (error.statusCode === 502 || error.statusCode === 504) {
      return {
        isOutdated: false,
        isBusy: false,
        detail: "Error connecting to server. Please try again in few minutes.",
      };
    }
    return { isOutdated: false, isBusy: false, detail: error.message || "" };
  }
  if (error instanceof Error) {
    return { isOutdated: false, isBusy: false, detail: error.message || "" };
  }
  return { isOutdated: false, isBusy: false, detail: "" };
}
