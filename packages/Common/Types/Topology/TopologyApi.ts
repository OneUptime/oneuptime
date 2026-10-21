import { JSONObject } from "../JSON";

/*
 * Wire contract of the Topology API (POST /api/telemetry/topology/...).
 *
 * The Topology maps used to download the whole inventory — every item and
 * every relationship — and build the maps in the browser, which stopped at
 * 10,000 rows of each. These endpoints do the graph work in Postgres instead
 * and return only what each view draws, so counts, search and connections
 * cover the whole inventory however large it is.
 *
 * This is an internal contract between the server and the Dashboard bundle
 * that shipped with it, not a public API. `formatVersion` changes whenever a
 * response shape does, so an old bundle talking to a new server can tell the
 * user to reload instead of misreading the payload.
 *
 * Every request carries `rangeStart` (ISO 8601). The server floors it to the
 * minute, uses it for every "reported in range" decision, and echoes the value
 * it used; the client must compute activity against the echoed value so both
 * sides agree about which resources are active. Timestamps in responses are
 * epoch milliseconds.
 */

export const TOPOLOGY_API_FORMAT_VERSION: number = 1;

export enum TopologyApiPath {
  ServiceMap = "/telemetry/topology/service-map",
  Infrastructure = "/telemetry/topology/infrastructure",
  InfrastructureCollection = "/telemetry/topology/infrastructure/collection",
  InfrastructureCollectionSearch = "/telemetry/topology/infrastructure/collection-search",
  Entity = "/telemetry/topology/entity",
  EntityConnections = "/telemetry/topology/entity/connections",
  /*
   * The same sections over everything the inventory holds rather than over a
   * range (see TopologyEntityAllTimeRequestJSON): the inventory item page's
   * Connections card, which has no time range.
   */
  EntityAllTime = "/telemetry/topology/entity/all-time",
  EntityAllTimeConnections = "/telemetry/topology/entity/all-time/connections",
}

export const TopologyApiLimits: {
  /*
   * Safety valves. Discovery budgets keep real projects far below these; they
   * exist so a future budget override cannot turn one request into gigabytes.
   * Hitting one is reported (never silent) with exact totals.
   */
  MaxServiceMapEntities: number;
  MaxServiceMapDependencies: number;
  MaxInfrastructureNodes: number;
  /*
   * A flat infrastructure type (see isFlatInfrastructureType) with more
   * non-archived items than this is returned as a collection — exact counts,
   * rows paged from the server on demand — instead of row by row.
   */
  InlineFlatItemsPerType: number;
  CollectionPageSizeDefault: number;
  CollectionPageSizeMax: number;
  MaxSearchTerms: number;
  MaxSearchTermLength: number;
  MaxCollectionSearchTypes: number;
  /* Rows returned per drawer section before "Show more". */
  EntityDependencyRows: number;
  EntityOtherRows: number;
  EntityConnectionsPageSizeMax: number;
  /*
   * Most relationships the drawer reads for one entity. A cluster that has
   * seen hundreds of thousands of short-lived pods in the range stops here and
   * reports its totals as lower bounds ("100,000+") instead of timing out.
   */
  EntityConnectionScanLimit: number;
  /*
   * Oldest range start the two maps honour, in days before now; an older one
   * is clamped to it and the clamped value is echoed. Well past the longest
   * relative range the time picker offers (3 months) and past every retention
   * that matters (relationships are pruned after 30 days), and it bounds how
   * many distinct minutes — each a separate whole-inventory build and cache
   * entry — a caller can ask for.
   */
  MaxMapRangeStartAgeDays: number;
} = {
  MaxServiceMapEntities: 50_000,
  MaxServiceMapDependencies: 200_000,
  MaxInfrastructureNodes: 200_000,
  InlineFlatItemsPerType: 1_000,
  CollectionPageSizeDefault: 50,
  CollectionPageSizeMax: 200,
  MaxSearchTerms: 10,
  MaxSearchTermLength: 100,
  MaxCollectionSearchTypes: 100,
  EntityDependencyRows: 100,
  EntityOtherRows: 25,
  EntityConnectionsPageSizeMax: 200,
  EntityConnectionScanLimit: 100_000,
  MaxMapRangeStartAgeDays: 400,
};

// ---------------------------------------------------------------- requests

export interface TopologyRangeRequestJSON {
  /** ISO 8601; floored to the minute by the server. */
  rangeStart: string;
}

/** The Service Map and Infrastructure maps. */
export interface TopologyMapRequestJSON extends TopologyRangeRequestJSON {
  /*
   * An explicit refresh by the user ("Refresh topology"). The maps are served
   * from a short-lived per-process cache (up to a minute old); a fresh
   * request skips that cached copy and rebuilds — still sharing a build of
   * the same map that is already running — and the new result replaces the
   * cached one. Omit (or false) for every other load.
   */
  fresh?: boolean | undefined;
}

export type TopologyServiceMapRequestJSON = TopologyMapRequestJSON;

export type TopologyInfrastructureRequestJSON = TopologyMapRequestJSON;

export interface TopologyCollectionCursorJSON {
  /** Display name of the last row of the previous page ("" when it had none). */
  name: string;
  key: string;
}

/** One page of a collection, ordered by display name then entity key. */
export interface TopologyCollectionRequestJSON
  extends TopologyRangeRequestJSON {
  entityType: string;
  includeInactive: boolean;
  /*
   * Case-insensitive substrings that must ALL appear in the display name.
   * Search terms the client already matched against the type's label are
   * left out, mirroring how the in-browser search matches name OR type label.
   */
  nameTerms?: Array<string> | undefined;
  cursor?: TopologyCollectionCursorJSON | null | undefined;
  limit?: number | undefined;
}

/** How many items of each collection match a search. */
export interface TopologyCollectionSearchRequestJSON
  extends TopologyRangeRequestJSON {
  includeInactive: boolean;
  types: Array<{ entityType: string; nameTerms: Array<string> }>;
}

/* Which entity a drawer or inventory read is about. */
export interface TopologyEntityTargetJSON {
  entityKey: string;
  /* Narrows the lookup when the caller knows it; the key alone is enough. */
  entityType?: string | null | undefined;
}

export interface TopologyEntityRequestJSON
  extends TopologyRangeRequestJSON,
    TopologyEntityTargetJSON {}

export type TopologyConnectionSection =
  | "calls"
  | "calledBy"
  | "runsOn"
  | "related";

export const TOPOLOGY_CONNECTION_SECTIONS: ReadonlyArray<TopologyConnectionSection> =
  ["calls", "calledBy", "runsOn", "related"];

/** Where one page of one section starts, and how many rows it holds. */
export interface TopologyConnectionsPageRequestJSON {
  section: TopologyConnectionSection;
  offset: number;
  limit?: number | undefined;
}

/** "Show more" for one drawer section. */
export interface TopologyEntityConnectionsRequestJSON
  extends TopologyEntityRequestJSON,
    TopologyConnectionsPageRequestJSON {}

/*
 * The all-time variant, for the inventory item page. It has no range start:
 * every relationship the inventory holds counts however long ago it was last
 * seen (edges drawn by hand are never re-bumped and never pruned, so a range
 * would hide them), and archived items count as items — both the entity
 * asked about, which the inventory page still shows, and the other ends.
 */
export type TopologyEntityAllTimeRequestJSON = TopologyEntityTargetJSON;

export interface TopologyEntityAllTimeConnectionsRequestJSON
  extends TopologyEntityTargetJSON,
    TopologyConnectionsPageRequestJSON {}

// --------------------------------------------------------------- responses

export interface TopologyResponseEnvelopeJSON {
  formatVersion: number;
  /** The range start the server used (ISO 8601, floored to the minute). */
  rangeStart: string;
  /** ISO 8601. */
  generatedAt: string;
}

export interface TopologyTruncationJSON {
  shown: number;
  total: number;
}

/** The lean inventory item every map row is built from. */
export interface TopologyEntityJSON {
  key: string;
  type: string;
  name: string | null;
  source: string;
  /** Epoch ms. */
  lastSeenAt: number | null;
}

export interface TopologyServiceMapEntityJSON extends TopologyEntityJSON {
  /*
   * Only SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS whose value is a string, per bag.
   * The bags stay separate because the reader prefers descriptive values.
   */
  descriptiveAttributes?: Record<string, string> | undefined;
  identifyingAttributes?: Record<string, string> | undefined;
}

/** An in-range `depends-on` relationship whose caller is a service. */
export interface TopologyDependencyJSON {
  from: string;
  to: string;
  callCount: number | null;
  errorCount: number | null;
  avgDurationMs: number | null;
}

/** Distinct resources of one type a service runs on (runs-on / hosted-on). */
export interface TopologyRunsOnCountJSON {
  service: string;
  type: string;
  /** Targets that reported in range. */
  active: number;
  /** All non-archived targets. */
  total: number;
}

export interface TopologyServiceMapResponseJSON
  extends TopologyResponseEnvelopeJSON {
  /*
   * Every non-archived service (active or not, so inactive services can be
   * counted), plus every non-archived item a service calls.
   */
  entities: Array<TopologyServiceMapEntityJSON>;
  /* In the order the old list API returned them: createdAt DESC, _id ASC. */
  dependencies: Array<TopologyDependencyJSON>;
  runsOn: Array<TopologyRunsOnCountJSON>;
  entityTruncation: TopologyTruncationJSON | null;
  dependencyTruncation: TopologyTruncationJSON | null;
}

/*
 * One infrastructure resource and where it nests. The server chooses each
 * resource's container in SQL with the Dashboard's own nesting rules, so the
 * browser never needs the relationships themselves.
 */
export interface TopologyInfrastructureNodeJSON extends TopologyEntityJSON {
  /*
   * Index into `nodes` of the best container among ALL nodes, and the type
   * of the relationship that won. Absent when nothing contains it.
   */
  parent?: number | undefined;
  parentVia?: string | undefined;
  /*
   * The best container among ACTIVE nodes, sent only when it differs from
   * `parent` (i.e. `parent` did not report in range). -1 means no active node
   * contains it. With inactive resources hidden the browser falls back to it.
   */
  activeParent?: number | undefined;
  activeParentVia?: string | undefined;
}

export interface TopologyInfrastructureServiceJSON {
  key: string;
  name: string | null;
}

/** A flat infrastructure type too large to ship row by row. */
export interface TopologyInfrastructureCollectionJSON {
  type: string;
  /** Non-archived items of this type. */
  total: number;
  /** Of those, the ones that reported in range. */
  active: number;
  /** Epoch ms: latest lastSeenAt over all items, and over active ones. */
  lastSeenAt: number | null;
  activeLastSeenAt: number | null;
}

/*
 * An in-range `depends-on` relationship between two placed services (see
 * `placements`), by index into `services`. The map draws it as traffic
 * between the resources those services run on.
 */
export interface TopologyInfrastructureDependencyJSON {
  from: number;
  to: number;
  callCount: number | null;
  errorCount: number | null;
  avgDurationMs: number | null;
}

export interface TopologyInfrastructureResponseJSON
  extends TopologyResponseEnvelopeJSON {
  /* Ordered by (type, key). */
  nodes: Array<TopologyInfrastructureNodeJSON>;
  /* Every non-archived service, so placements and labels resolve. */
  services: Array<TopologyInfrastructureServiceJSON>;
  /* Distinct [index into services, index into nodes] from in-range runs-on / hosted-on. */
  placements: Array<[number, number]>;
  /*
   * In-range calls between services that both run on a shipped node,
   * ordered by (from, to). The browser reads a payload without them as "no
   * traffic known", so the field needs no format version of its own.
   */
  dependencies: Array<TopologyInfrastructureDependencyJSON>;
  /* The dependency cap (MaxServiceMapDependencies), when it was hit. */
  dependencyTruncation: TopologyTruncationJSON | null;
  collections: Array<TopologyInfrastructureCollectionJSON>;
  /* Every non-archived infrastructure item, collections included. */
  totals: { resources: number; activeResources: number };
  truncation: TopologyTruncationJSON | null;
}

export interface TopologyCollectionResponseJSON
  extends TopologyResponseEnvelopeJSON {
  entityType: string;
  /** Items matching the request's filters, across all pages. */
  total: number;
  items: Array<TopologyEntityJSON>;
  nextCursor: TopologyCollectionCursorJSON | null;
}

export interface TopologyCollectionSearchResponseJSON
  extends TopologyResponseEnvelopeJSON {
  /* Only types with at least one match. */
  matches: Array<{ entityType: string; count: number }>;
}

export interface TopologyEntityDetailJSON extends TopologyEntityJSON {
  /** InventoryItem _id. */
  id: string;
  firstSeenAt: number | null;
  resourceType: string | null;
  resourceId: string | null;
  identifyingAttributes: JSONObject | null;
  descriptiveAttributes: JSONObject | null;
}

export interface TopologyConnectionRowJSON {
  relationshipType: string;
  /* "out" when the entity is the relationship's `from` (self-loops too). */
  direction: "out" | "in";
  otherKey: string;
  /*
   * false when the other end is not a non-archived item ("Undiscovered
   * resource"); for the all-time endpoints, when it is not an item at all.
   */
  otherKnown: boolean;
  /*
   * InventoryItem _id of the other end, so the inventory page can link to it.
   * Sent by the all-time endpoints only; null when otherKnown is false.
   */
  otherId?: string | null | undefined;
  otherName: string | null;
  otherType: string | null;
  callCount: number | null;
  errorCount: number | null;
  avgDurationMs: number | null;
  lastSeenAt: number | null;
}

export interface TopologyConnectionSectionJSON {
  /* Exact unless the response says it is scan limited. */
  total: number;
  /* How many of `total` point at something no longer in inventory. */
  unknownTotal: number;
  rows: Array<TopologyConnectionRowJSON>;
  /* Offset for the next page, or null when `rows` reached the end. */
  nextOffset: number | null;
}

/*
 * Sections classify an entity's in-range relationships the way the drawer
 * always has: depends-on out = calls, depends-on in = calledBy, outbound
 * runs-on / hosted-on from a service = runsOn, everything else = related.
 * calls / calledBy are ordered by callCount desc, then label; runsOn /
 * related put known resources first, then order by label.
 */
export interface TopologyEntityResponseJSON
  extends TopologyResponseEnvelopeJSON {
  /* null when no non-archived item has this key (sections are then empty). */
  entity: TopologyEntityDetailJSON | null;
  sections: Record<TopologyConnectionSection, TopologyConnectionSectionJSON>;
  /* The scan stopped at EntityConnectionScanLimit: totals are lower bounds. */
  isScanLimited: boolean;
}

export interface TopologyEntityConnectionsResponseJSON
  extends TopologyResponseEnvelopeJSON {
  section: TopologyConnectionSection;
  connections: TopologyConnectionSectionJSON;
  isScanLimited: boolean;
}

/*
 * The all-time responses (TopologyEntityAllTimeRequestJSON) are shaped like
 * the drawer's, without a range start to echo: `entity` is found among
 * archived items too, and every row carries `otherId`.
 */
export type TopologyEntityAllTimeResponseJSON = Omit<
  TopologyEntityResponseJSON,
  "rangeStart"
>;

export type TopologyEntityAllTimeConnectionsResponseJSON = Omit<
  TopologyEntityConnectionsResponseJSON,
  "rangeStart"
>;
