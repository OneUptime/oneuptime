import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiPath,
  TopologyInfrastructureRequestJSON,
  TopologyServiceMapRequestJSON,
} from "Common/Types/Topology/TopologyApi";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import {
  InfrastructureCollection,
  InfrastructureData,
  InfrastructureTotals,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCount,
  TopologyRunsOnCounts,
  TopologyTruncation,
  TopologyTruncationKind,
} from "./TopologyData";

/*
 * The Dashboard's door to the Topology API (see
 * Common/Types/Topology/TopologyApi.ts and App/FeatureSet/BaseAPI/API/Topology).
 *
 * The maps used to download the whole inventory — every item and every
 * relationship, capped at 10,000 rows each — and build themselves in the
 * browser. The server now reduces the graph in Postgres and returns rows
 * shaped for each view; this module fetches them and decodes the wire JSON
 * into the browser shapes of TopologyData. It is React-free so the decoders
 * can be unit tested in the App suite.
 *
 * Decoding is strict about the envelope and tolerant about rows: a payload
 * from a server speaking another formatVersion is refused outright (the user
 * is told to reload), while a malformed individual row is skipped rather than
 * failing the whole map.
 */

export const TOPOLOGY_OUTDATED_MESSAGE: string =
  "Topology was updated. Reload the page.";

/*
 * The server and this bundle disagree about the Topology API: the payload
 * carries another formatVersion, or the endpoint does not exist (a 404 —
 * this bundle is newer than the server it is talking to). Re-reading the
 * payload cannot help; only loading the matching bundle can.
 */
export class TopologyOutdatedError extends Error {
  /* The formatVersion the server sent, or null when there was no payload. */
  public readonly serverFormatVersion: number | null;

  public constructor(serverFormatVersion: number | null = null) {
    super(TOPOLOGY_OUTDATED_MESSAGE);
    this.name = "TopologyOutdatedError";
    this.serverFormatVersion = serverFormatVersion;
  }
}

export const TOPOLOGY_BUSY_MESSAGE: string =
  "The topology service is busy. Try again in a moment.";

/*
 * The server limits how much topology work runs at once and answers 429
 * (TooManyRequestsException) when it is full. Unlike an outdated bundle,
 * this passes: the caller should offer "Try again". postTopologyApi rejects
 * with the HTTPErrorResponse itself, so this is how every caller — the page,
 * the drawer, the collection table — recognises it.
 */
export function isTopologyBusyError(error: unknown): boolean {
  return error instanceof HTTPErrorResponse && error.statusCode === 429;
}

export interface TopologyRequestOptions {
  /* Aborts the request when the page no longer wants its answer. */
  signal?: AbortSignal | undefined;
  /*
   * An explicit refresh by the user: the server rebuilds the map instead of
   * answering from its short-lived response cache. Sent only when true.
   */
  fresh?: boolean | undefined;
}

/*
 * POST one Topology API route and return its JSON body.
 *
 * API.post resolves (rather than rejects) with an HTTPErrorResponse on a 4xx
 * or 5xx, so that is turned into a throw here. A 404 is the one status that
 * means "wrong bundle" rather than "try again": every Topology route exists
 * on a server that speaks this contract, and a missing entity is answered
 * with `entity: null`, never a 404.
 */
export async function postTopologyApi(
  path: TopologyApiPath,
  body: JSONObject,
  options?: TopologyRequestOptions | undefined,
): Promise<JSONObject> {
  const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(path);

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: url,
      data: body,
      headers: { ...ModelAPI.getCommonHeaders() },
      options: { signal: options?.signal },
    });

  if (response instanceof HTTPErrorResponse) {
    if (response.statusCode === 404) {
      throw new TopologyOutdatedError();
    }
    throw response;
  }

  const data: unknown = response.data;
  return isJSONObject(data) ? data : {};
}

export async function fetchServiceMapData(
  rangeStart: Date,
  options?: TopologyRequestOptions | undefined,
): Promise<ServiceMapData> {
  const request: TopologyServiceMapRequestJSON = {
    rangeStart: rangeStart.toISOString(),
  };
  if (options?.fresh === true) {
    request.fresh = true;
  }
  return decodeServiceMapResponse(
    await postTopologyApi(TopologyApiPath.ServiceMap, { ...request }, options),
  );
}

export async function fetchInfrastructureData(
  rangeStart: Date,
  options?: TopologyRequestOptions | undefined,
): Promise<InfrastructureData> {
  const request: TopologyInfrastructureRequestJSON = {
    rangeStart: rangeStart.toISOString(),
  };
  if (options?.fresh === true) {
    request.fresh = true;
  }
  return decodeInfrastructureResponse(
    await postTopologyApi(
      TopologyApiPath.Infrastructure,
      { ...request },
      options,
    ),
  );
}

export interface TopologyEnvelope {
  /* The range start the server used (floored to the minute). */
  rangeStart: Date;
  /* When the server built the payload — earlier than now on a cache hit. */
  generatedAt: Date;
}

/*
 * Checks the formatVersion and reads the fields every response carries.
 * Throws TopologyOutdatedError on a version mismatch, and a plain Error when
 * the echoed range start is missing: activity is judged against that value,
 * so a map drawn without it would silently disagree with the server.
 */
export function decodeTopologyEnvelope(json: unknown): TopologyEnvelope {
  if (!isJSONObject(json)) {
    throw new Error("The topology response was empty.");
  }

  const formatVersion: JSONValue | undefined = json["formatVersion"];
  if (formatVersion !== TOPOLOGY_API_FORMAT_VERSION) {
    throw new TopologyOutdatedError(
      typeof formatVersion === "number" ? formatVersion : null,
    );
  }

  const rangeStart: Date | null = readIsoDate(json["rangeStart"]);
  if (!rangeStart) {
    throw new Error("The topology response did not include its time range.");
  }

  return {
    rangeStart: rangeStart,
    generatedAt: readIsoDate(json["generatedAt"]) || new Date(),
  };
}

export function decodeServiceMapResponse(json: unknown): ServiceMapData {
  const envelope: TopologyEnvelope = decodeTopologyEnvelope(json);
  const body: JSONObject = json as JSONObject;

  const entities: Array<TopologyEntity> = [];
  for (const row of readObjectArray(body, "entities")) {
    const entity: TopologyEntity | null = decodeEntity(row);
    if (!entity) {
      continue;
    }
    const descriptive: JSONObject | null = readStringBag(
      row["descriptiveAttributes"],
    );
    if (descriptive) {
      entity.descriptiveAttributes = descriptive;
    }
    const identifying: JSONObject | null = readStringBag(
      row["identifyingAttributes"],
    );
    if (identifying) {
      entity.identifyingAttributes = identifying;
    }
    entities.push(entity);
  }

  /*
   * The server orders dependencies the way the old list API returned them,
   * and the Service Map averages parallel edges in arrival order — so the
   * order is kept exactly, or the floating-point sums would drift.
   */
  const relationships: Array<TopologyRelationship> = [];
  for (const row of readObjectArray(body, "dependencies")) {
    const from: string = readString(row["from"]);
    const to: string = readString(row["to"]);
    if (!from || !to) {
      continue;
    }
    relationships.push(
      withTraffic(
        {
          fromEntityKey: from,
          toEntityKey: to,
          relationshipType: EntityRelationshipType.DependsOn,
        },
        row,
      ),
    );
  }

  const runsOnCounts: TopologyRunsOnCounts = new Map<
    string,
    Array<TopologyRunsOnCount>
  >();
  for (const row of readObjectArray(body, "runsOn")) {
    const service: string = readString(row["service"]);
    const entityType: string = readString(row["type"]);
    if (!service || !entityType) {
      continue;
    }
    let counts: Array<TopologyRunsOnCount> | undefined =
      runsOnCounts.get(service);
    if (!counts) {
      counts = [];
      runsOnCounts.set(service, counts);
    }
    counts.push({
      entityType: entityType,
      active: readCount(row["active"]),
      total: readCount(row["total"]),
    });
  }

  /*
   * The two caps limit different things — whole services and callees, or
   * the dependency rows between them — and both can be hit at once, so each
   * is kept with its kind and the banner words each one for what it is.
   */
  const truncations: Array<TopologyTruncation> = [];
  const entityTruncation: TopologyTruncation | null = readTruncation(
    body["entityTruncation"],
    "resources",
  );
  if (entityTruncation) {
    truncations.push(entityTruncation);
  }
  const dependencyTruncation: TopologyTruncation | null = readTruncation(
    body["dependencyTruncation"],
    "connections",
  );
  if (dependencyTruncation) {
    truncations.push(dependencyTruncation);
  }

  return {
    rangeStart: envelope.rangeStart,
    loadedAt: envelope.generatedAt,
    entities: entities,
    relationships: relationships,
    runsOnCounts: runsOnCounts,
    truncations: truncations,
  };
}

export function decodeInfrastructureResponse(
  json: unknown,
): InfrastructureData {
  const envelope: TopologyEnvelope = decodeTopologyEnvelope(json);
  const body: JSONObject = json as JSONObject;

  /*
   * Index positions matter: `parent`, `activeParent` and `placements` point
   * into the arrays as the server sent them. A malformed row keeps its slot
   * (as null) so every later index still lands on the right resource.
   */
  const nodeRows: Array<JSONValue> = readArray(body, "nodes");
  const nodes: Array<TopologyEntity | null> = nodeRows.map(
    (row: JSONValue): TopologyEntity | null => {
      return isJSONObject(row) ? decodeEntity(row) : null;
    },
  );

  const nodeKeyAt: (index: JSONValue | undefined) => string | null = (
    index: JSONValue | undefined,
  ): string | null => {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      return null;
    }
    return nodes[index]?.entityKey || null;
  };

  /*
   * Re-synthesize the containment the server chose: the best container over
   * all resources, and — when that one did not report in range — the best
   * active one. The client model ranks candidates exactly as the server did,
   * and the global winner is among these rows, so it rebuilds the same tree
   * all relationships would give, with inactive resources shown or hidden.
   */
  const relationships: Array<TopologyRelationship> = [];
  nodeRows.forEach((row: JSONValue, index: number): void => {
    const child: TopologyEntity | null = nodes[index] || null;
    if (!child || !isJSONObject(row)) {
      return;
    }
    const containers: Array<[JSONValue | undefined, JSONValue | undefined]> = [
      [row["parent"], row["parentVia"]],
      [row["activeParent"], row["activeParentVia"]],
    ];
    let previous: string | null = null;
    for (const [parentIndex, via] of containers) {
      const parentKey: string | null = nodeKeyAt(parentIndex);
      const relationshipType: string = readString(via);
      /*
       * A container without its relationship type cannot be ranked by the
       * client model, so it is dropped rather than guessed. An active
       * container repeating the best one would draw the same edge twice.
       */
      if (
        !parentKey ||
        parentKey === child.entityKey ||
        parentIndex === index ||
        !relationshipType ||
        previous === `${relationshipType}>${parentKey}`
      ) {
        continue;
      }
      previous = `${relationshipType}>${parentKey}`;
      relationships.push({
        fromEntityKey: child.entityKey,
        toEntityKey: parentKey,
        relationshipType: relationshipType,
      });
    }
  });

  const services: Array<TopologyEntity | null> = readArray(
    body,
    "services",
  ).map((row: JSONValue): TopologyEntity | null => {
    if (!isJSONObject(row)) {
      return null;
    }
    const key: string = readString(row["key"]);
    if (!key) {
      return null;
    }
    const service: TopologyEntity = {
      entityKey: key,
      entityType: EntityType.Service,
    };
    const name: string | null = readNullableString(row["name"]);
    if (name !== null) {
      service.displayName = name;
    }
    return service;
  });

  for (const placement of readArray(body, "placements")) {
    if (!Array.isArray(placement)) {
      continue;
    }
    const [serviceIndex, nodeIndex]: JSONArray = placement as JSONArray;
    const serviceKey: string | null =
      typeof serviceIndex === "number" && Number.isInteger(serviceIndex)
        ? services[serviceIndex]?.entityKey || null
        : null;
    const nodeKey: string | null = nodeKeyAt(nodeIndex);
    if (!serviceKey || !nodeKey) {
      continue;
    }
    relationships.push({
      fromEntityKey: serviceKey,
      toEntityKey: nodeKey,
      relationshipType: EntityRelationshipType.RunsOn,
    });
  }

  /*
   * Calls between placed services, which the map draws as traffic between
   * the resources they run on. A server that predates them sends none, and
   * the map simply draws no traffic.
   */
  const serviceKeyAt: (index: JSONValue | undefined) => string | null = (
    index: JSONValue | undefined,
  ): string | null => {
    if (typeof index !== "number" || !Number.isInteger(index)) {
      return null;
    }
    return services[index]?.entityKey || null;
  };
  for (const row of readObjectArray(body, "dependencies")) {
    const from: string | null = serviceKeyAt(row["from"]);
    const to: string | null = serviceKeyAt(row["to"]);
    if (!from || !to || from === to) {
      continue;
    }
    relationships.push(
      withTraffic(
        {
          fromEntityKey: from,
          toEntityKey: to,
          relationshipType: EntityRelationshipType.DependsOn,
        },
        row,
      ),
    );
  }

  const entities: Array<TopologyEntity> = [];
  for (const entity of [...nodes, ...services]) {
    if (entity) {
      entities.push(entity);
    }
  }

  const collections: Array<InfrastructureCollection> = [];
  for (const row of readObjectArray(body, "collections")) {
    const entityType: string = readString(row["type"]);
    if (!entityType) {
      continue;
    }
    collections.push({
      entityType: entityType,
      total: readCount(row["total"]),
      active: readCount(row["active"]),
      lastSeenAt: readEpochDate(row["lastSeenAt"]) || null,
      activeLastSeenAt: readEpochDate(row["activeLastSeenAt"]) || null,
    });
  }

  const totalsJSON: JSONValue | undefined = body["totals"];
  const totals: InfrastructureTotals = isJSONObject(totalsJSON)
    ? {
        resources: readCount(totalsJSON["resources"]),
        activeResources: readCount(totalsJSON["activeResources"]),
      }
    : { resources: 0, activeResources: 0 };

  return {
    rangeStart: envelope.rangeStart,
    loadedAt: envelope.generatedAt,
    entities: entities,
    relationships: relationships,
    collections: collections,
    totals: totals,
    truncation: readTruncation(body["truncation"], "resources"),
    dependencyTruncation: readTruncation(
      body["dependencyTruncation"],
      "connections",
    ),
  };
}

/*
 * The lean item every map row is built from. `name: null` becomes an absent
 * display name (the maps fall back to the key), and `lastSeenAt` becomes a
 * Date so isEntityActive can judge the row exactly as it judges a model.
 */
export function decodeEntity(row: JSONObject): TopologyEntity | null {
  const key: string = readString(row["key"]);
  if (!key) {
    return null;
  }
  const entity: TopologyEntity = {
    entityKey: key,
    entityType: readString(row["type"]),
  };
  const name: string | null = readNullableString(row["name"]);
  if (name !== null) {
    entity.displayName = name;
  }
  if (typeof row["source"] === "string") {
    entity.source = row["source"];
  }
  const lastSeenAt: Date | undefined = readEpochDate(row["lastSeenAt"]);
  if (lastSeenAt) {
    entity.lastSeenAt = lastSeenAt;
  }
  return entity;
}

/*
 * A dependency's traffic, copied onto its relationship. A metric the server
 * sent as null (or garbage) stays absent, as it was on the old list rows.
 */
function withTraffic(
  relationship: TopologyRelationship,
  row: JSONObject,
): TopologyRelationship {
  const callCount: number | undefined = readOptionalNumber(row["callCount"]);
  if (callCount !== undefined) {
    relationship.callCount = callCount;
  }
  const errorCount: number | undefined = readOptionalNumber(row["errorCount"]);
  if (errorCount !== undefined) {
    relationship.errorCount = errorCount;
  }
  const avgDurationMs: number | undefined = readOptionalNumber(
    row["avgDurationMs"],
  );
  if (avgDurationMs !== undefined) {
    relationship.avgDurationMs = avgDurationMs;
  }
  return relationship;
}

function isJSONObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readArray(json: JSONObject, key: string): Array<JSONValue> {
  const value: JSONValue | undefined = json[key];
  return Array.isArray(value) ? (value as Array<JSONValue>) : [];
}

function readObjectArray(json: JSONObject, key: string): Array<JSONObject> {
  return readArray(json, key).filter(
    (entry: JSONValue): entry is JSONObject => {
      return isJSONObject(entry);
    },
  );
}

function readString(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: JSONValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/*
 * A finite number, or undefined for null / missing values. Tolerates a
 * numeric string: Postgres hands bigint and numeric columns to node as
 * strings, and a number that slipped through unparsed would render fine and
 * then add up wrongly.
 */
function readOptionalNumber(value: JSONValue | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/* A count: a non-negative integer, 0 when missing or malformed. */
function readCount(value: JSONValue | undefined): number {
  const parsed: number | undefined = readOptionalNumber(value);
  if (parsed === undefined || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

/* Epoch milliseconds → Date; undefined for null, missing or garbage. */
function readEpochDate(value: JSONValue | undefined): Date | undefined {
  const epochMs: number | undefined = readOptionalNumber(value);
  if (epochMs === undefined) {
    return undefined;
  }
  const date: Date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readIsoDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * An attribute bag of string values. The server only sends strings; a
 * non-string value is dropped here too, so the Service Map's reader (which
 * wants a non-blank string) never sees anything else.
 */
function readStringBag(value: JSONValue | undefined): JSONObject | null {
  if (!isJSONObject(value)) {
    return null;
  }
  const bag: JSONObject = {};
  let hasValue: boolean = false;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      bag[key] = entry;
      hasValue = true;
    }
  }
  return hasValue ? bag : null;
}

function readTruncation(
  value: JSONValue | undefined,
  kind: TopologyTruncationKind,
): TopologyTruncation | null {
  if (!isJSONObject(value)) {
    return null;
  }
  return {
    kind: kind,
    shown: readCount(value["shown"]),
    total: readCount(value["total"]),
  };
}
