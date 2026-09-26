import { JSONObject } from "Common/Types/JSON";

/*
 * The data the Topology maps are drawn from, as the browser holds it.
 *
 * The maps no longer receive database models: the Topology API returns lean,
 * view-shaped rows (see Common/Types/Topology/TopologyApi.ts) and the page
 * decodes them into these shapes. `InventoryItem` and
 * `InventoryItemRelationship` still satisfy them, which keeps the view models
 * usable with full rows (tests, the Inventory pages).
 */

/** The fields of an inventory item the maps read. */
export interface TopologyEntity {
  entityKey?: string | undefined;
  entityType?: string | undefined;
  displayName?: string | undefined;
  source?: string | undefined;
  lastSeenAt?: Date | undefined;
  descriptiveAttributes?: JSONObject | undefined;
  identifyingAttributes?: JSONObject | undefined;
}

/** The fields of an inventory relationship the maps read. */
export interface TopologyRelationship {
  fromEntityKey?: string | undefined;
  toEntityKey?: string | undefined;
  relationshipType?: string | undefined;
  callCount?: number | undefined;
  errorCount?: number | undefined;
  avgDurationMs?: number | undefined;
}

/** How many resources of one type a service runs on. */
export interface TopologyRunsOnCount {
  entityType: string;
  /** Resources that reported in the selected range. */
  active: number;
  /** Every non-archived resource, reporting or not. */
  total: number;
}

/** Service entity key → what it runs on, by type. */
export type TopologyRunsOnCounts = Map<string, Array<TopologyRunsOnCount>>;

/*
 * What a safety cap limited: whole resources (the Service Map's services and
 * callees, Infrastructure's resources), or the connections between them (the
 * Service Map's dependencies).
 */
export type TopologyTruncationKind = "resources" | "connections";

/** A safety cap was hit: `shown` of `total` rows were returned. */
export interface TopologyTruncation {
  /* The decoders always set it; absent reads as "resources". */
  kind?: TopologyTruncationKind | undefined;
  shown: number;
  total: number;
}

export interface ServiceMapData {
  /** The range start the server used; activity is judged against it. */
  rangeStart: Date;
  loadedAt: Date;
  /** Every non-archived service, plus everything a service calls. */
  entities: Array<TopologyEntity>;
  /** In-range `depends-on` relationships whose caller is a service. */
  relationships: Array<TopologyRelationship>;
  runsOnCounts: TopologyRunsOnCounts;
  /*
   * Every safety cap the payload hit — the resource cap first, then the
   * connection cap; both can be hit at once. Empty when nothing was capped.
   */
  truncations: Array<TopologyTruncation>;
}

/*
 * A flat infrastructure type (network devices, IoT devices, cloud
 * resources, ...) with too many items to ship row by row. The map shows it as
 * one node with exact counts; its rows are paged from the server on demand.
 */
export interface InfrastructureCollection {
  entityType: string;
  /** Non-archived items of this type. */
  total: number;
  /** Of those, the ones that reported in the selected range. */
  active: number;
  lastSeenAt: Date | null;
  activeLastSeenAt: Date | null;
}

export interface InfrastructureTotals {
  /** Every non-archived infrastructure item, collections included. */
  resources: number;
  /** Of those, the ones that reported in the selected range. */
  activeResources: number;
}

export interface InfrastructureData {
  /** The range start the server used; activity is judged against it. */
  rangeStart: Date;
  loadedAt: Date;
  /** Infrastructure resources plus every non-archived service. */
  entities: Array<TopologyEntity>;
  /*
   * At most two containment relationships per resource (its best container
   * and, when that one is inactive, its best active container), where
   * services run, and the in-range calls (`depends-on`, with traffic)
   * between placed services. Enough to rebuild exactly the tree — and the
   * traffic — all relationships give.
   */
  relationships: Array<TopologyRelationship>;
  collections: Array<InfrastructureCollection>;
  totals: InfrastructureTotals;
  /* The resource cap, when it was hit (kind "resources"). */
  truncation: TopologyTruncation | null;
  /* The cap on calls between services, when it was hit (kind "connections"). */
  dependencyTruncation: TopologyTruncation | null;
}

/** What a caller knows about an entity before its details are fetched. */
export interface EntityDetailTarget {
  entityKey: string;
  entityType?: string | undefined;
  displayName?: string | undefined;
}
