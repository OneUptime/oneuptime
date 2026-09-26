import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiLimits,
  TopologyApiPath,
  TopologyCollectionCursorJSON,
  TopologyCollectionRequestJSON,
  TopologyCollectionSearchRequestJSON,
} from "Common/Types/Topology/TopologyApi";
import {
  TOPOLOGY_BUSY_MESSAGE,
  TopologyOutdatedError,
  isTopologyBusyError,
  postTopologyApi,
} from "./TopologyApi";
import { TopologyEntity } from "./TopologyData";

/*
 * Client for the Infrastructure view's collections: flat types (IoT devices,
 * network devices, cloud resources, ...) with more items than the map ships
 * row by row. The map holds only their exact counts; opening one pages its
 * items from POST /telemetry/topology/infrastructure/collection, and search
 * asks /collection-search how many items of each collection match. Requests
 * go through the Topology API client (TopologyApi.ts), so a server that
 * speaks another format is reported the same way for every Topology screen.
 *
 * React-free on purpose: App tests exercise the request shapes and the
 * decoders without a DOM.
 */

export type CollectionCursor = TopologyCollectionCursorJSON;

export interface CollectionPageRequest {
  entityType: string;
  includeInactive: boolean;
  /* Lowercased terms that must all appear in the display name. */
  nameTerms?: Array<string> | undefined;
  /* Where the page starts: the previous page's `nextCursor`; null = first page. */
  cursor?: CollectionCursor | null | undefined;
  limit?: number | undefined;
}

export interface CollectionPage {
  /** The range start the server used, or null if it sent none we can read. */
  rangeStart: Date | null;
  entityType: string;
  /** Items matching the request's filters, across all pages. */
  total: number;
  items: Array<TopologyEntity>;
  /** Where the next page starts, or null on the last page. */
  nextCursor: CollectionCursor | null;
}

export interface CollectionSearchType {
  entityType: string;
  nameTerms: Array<string>;
}

export interface CollectionSearchRequest {
  includeInactive: boolean;
  types: Array<CollectionSearchType>;
}

export interface CollectionRequestOptions {
  signal?: AbortSignal | undefined;
}

/*
 * The server refuses a search it cannot run cheaply (too many terms, or a
 * term longer than any name it would scan for), so such a query is not
 * sent at all and simply finds nothing in the collections.
 */
export function isCollectionSearchable(terms: Array<string>): boolean {
  return (
    terms.length <= TopologyApiLimits.MaxSearchTerms &&
    terms.every((term: string): boolean => {
      return term.length <= TopologyApiLimits.MaxSearchTermLength;
    })
  );
}

function normalizeTerms(terms: Array<string> | undefined): Array<string> {
  return (terms || [])
    .map((term: string): string => {
      return term.trim().toLowerCase();
    })
    .filter((term: string): boolean => {
      return term.length > 0;
    });
}

export function buildCollectionPageRequest(
  rangeStart: Date,
  request: CollectionPageRequest,
): TopologyCollectionRequestJSON {
  const body: TopologyCollectionRequestJSON = {
    rangeStart: rangeStart.toISOString(),
    entityType: request.entityType,
    includeInactive: request.includeInactive,
    limit: Math.min(
      TopologyApiLimits.CollectionPageSizeMax,
      Math.max(
        1,
        Math.floor(
          request.limit || TopologyApiLimits.CollectionPageSizeDefault,
        ),
      ),
    ),
  };
  const nameTerms: Array<string> = normalizeTerms(request.nameTerms);
  if (nameTerms.length > 0) {
    body.nameTerms = nameTerms;
  }
  if (request.cursor) {
    body.cursor = { name: request.cursor.name, key: request.cursor.key };
  }
  return body;
}

export function buildCollectionSearchRequest(
  rangeStart: Date,
  request: CollectionSearchRequest,
): TopologyCollectionSearchRequestJSON {
  return {
    rangeStart: rangeStart.toISOString(),
    includeInactive: request.includeInactive,
    types: request.types.map(
      (type: CollectionSearchType): CollectionSearchType => {
        return {
          entityType: type.entityType,
          nameTerms: normalizeTerms(type.nameTerms),
        };
      },
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

/* A display string: blank means "none", so the table falls back to a label. */
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

function asIsoDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date: Date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function assertEnvelope(json: unknown): JSONObject {
  const envelope: JSONObject | null = asObject(json);
  if (!envelope || envelope["formatVersion"] !== TOPOLOGY_API_FORMAT_VERSION) {
    throw new TopologyOutdatedError(
      asNumber(envelope?.["formatVersion"]) ?? null,
    );
  }
  return envelope;
}

/* One lean item row (TopologyEntityJSON) as the maps hold it. */
export function decodeCollectionItem(value: unknown): TopologyEntity | null {
  const row: JSONObject | null = asObject(value);
  const entityKey: string | undefined = asString(row?.["key"]);
  if (!row || !entityKey) {
    return null;
  }
  const lastSeenAt: number | undefined = asNumber(row["lastSeenAt"]);
  return {
    entityKey: entityKey,
    entityType: asString(row["type"]) || undefined,
    displayName: asName(row["name"]),
    source: asName(row["source"]),
    lastSeenAt: lastSeenAt === undefined ? undefined : new Date(lastSeenAt),
  };
}

function decodeCursor(value: unknown): CollectionCursor | null {
  const cursor: JSONObject | null = asObject(value);
  const key: string | undefined = asString(cursor?.["key"]);
  if (!cursor || key === undefined) {
    return null;
  }
  return { name: asString(cursor["name"]) || "", key: key };
}

export function decodeCollectionPageResponse(
  json: unknown,
  requestedType: string,
): CollectionPage {
  const envelope: JSONObject = assertEnvelope(json);
  const entityType: unknown = envelope["entityType"];
  if (entityType !== undefined && entityType !== requestedType) {
    /* A page of another collection must never be shown as this one. */
    throw new Error(
      `Expected a page of "${requestedType}", got "${String(entityType)}".`,
    );
  }
  const items: Array<TopologyEntity> = [];
  for (const row of Array.isArray(envelope["items"]) ? envelope["items"] : []) {
    const item: TopologyEntity | null = decodeCollectionItem(row);
    if (item) {
      items.push(item);
    }
  }
  return {
    rangeStart: asIsoDate(envelope["rangeStart"]),
    entityType: requestedType,
    total: Math.max(asCount(envelope["total"]), items.length),
    items: items,
    nextCursor: decodeCursor(envelope["nextCursor"]),
  };
}

/** Collection type → items matching the search (only types with a match). */
export function decodeCollectionSearchResponse(
  json: unknown,
): Map<string, number> {
  const envelope: JSONObject = assertEnvelope(json);
  const counts: Map<string, number> = new Map<string, number>();
  for (const value of Array.isArray(envelope["matches"])
    ? envelope["matches"]
    : []) {
    const match: JSONObject | null = asObject(value);
    const entityType: string | undefined = asString(match?.["entityType"]);
    const count: number = asCount(match?.["count"]);
    if (entityType && count > 0) {
      counts.set(entityType, count);
    }
  }
  return counts;
}

// ---------------------------------------------------------------- requests

export async function fetchCollectionPage(
  rangeStart: Date,
  request: CollectionPageRequest,
  options: CollectionRequestOptions = {},
): Promise<CollectionPage> {
  const json: JSONObject = await postTopologyApi(
    TopologyApiPath.InfrastructureCollection,
    /* The request types are plain JSON; they only lack an index signature. */
    buildCollectionPageRequest(rangeStart, request) as unknown as JSONObject,
    options,
  );
  return decodeCollectionPageResponse(json, request.entityType);
}

/*
 * How many items of each collection match a search. The server takes a
 * bounded number of types per request, so a larger set is asked in batches.
 */
export async function fetchCollectionSearchCounts(
  rangeStart: Date,
  request: CollectionSearchRequest,
  options: CollectionRequestOptions = {},
): Promise<Map<string, number>> {
  const batches: Array<Array<CollectionSearchType>> = [];
  for (
    let index: number = 0;
    index < request.types.length;
    index += TopologyApiLimits.MaxCollectionSearchTypes
  ) {
    batches.push(
      request.types.slice(
        index,
        index + TopologyApiLimits.MaxCollectionSearchTypes,
      ),
    );
  }
  const answers: Array<Map<string, number>> = await Promise.all(
    batches.map(
      async (
        types: Array<CollectionSearchType>,
      ): Promise<Map<string, number>> => {
        const json: JSONObject = await postTopologyApi(
          TopologyApiPath.InfrastructureCollectionSearch,
          buildCollectionSearchRequest(rangeStart, {
            includeInactive: request.includeInactive,
            types: types,
          }) as unknown as JSONObject,
          options,
        );
        return decodeCollectionSearchResponse(json);
      },
    ),
  );
  const counts: Map<string, number> = new Map<string, number>();
  for (const answer of answers) {
    for (const [entityType, count] of answer) {
      counts.set(entityType, count);
    }
  }
  return counts;
}

/* The busy copy lives with the transport; re-exported for this module's callers. */
export { TOPOLOGY_BUSY_MESSAGE };

export interface CollectionErrorDescription {
  /* The server speaks another format: only reloading the page can help. */
  isOutdated: boolean;
  /*
   * The server is running as many Topology requests as it allows and turned
   * this one away (429): trying again in a moment will work.
   */
  isBusy: boolean;
  detail: string;
}

/*
 * What the page tells the user when a collection request fails. The page
 * shows fixed (translated) copy for a format mismatch and for a busy server;
 * anything else carries the server's own explanation when it gave one.
 */
export function describeCollectionError(
  error: unknown,
): CollectionErrorDescription {
  if (error instanceof TopologyOutdatedError) {
    return { isOutdated: true, isBusy: false, detail: error.message };
  }
  if (error instanceof HTTPErrorResponse) {
    if (isTopologyBusyError(error)) {
      return {
        isOutdated: false,
        isBusy: true,
        detail: error.message || TOPOLOGY_BUSY_MESSAGE,
      };
    }
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
