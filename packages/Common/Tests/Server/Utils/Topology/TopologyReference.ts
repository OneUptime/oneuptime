import { JSONObject, JSONValue } from "../../../../Types/JSON";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TOPOLOGY_CONNECTION_SECTIONS,
  TopologyApiLimits,
  TopologyConnectionRowJSON,
  TopologyConnectionSection,
  TopologyConnectionSectionJSON,
  TopologyDependencyJSON,
  TopologyEntityDetailJSON,
  TopologyEntityResponseJSON,
  TopologyInfrastructureCollectionJSON,
  TopologyInfrastructureDependencyJSON,
  TopologyInfrastructureNodeJSON,
  TopologyInfrastructureResponseJSON,
  TopologyInfrastructureServiceJSON,
  TopologyRunsOnCountJSON,
  TopologyServiceMapEntityJSON,
  TopologyServiceMapResponseJSON,
} from "../../../../Types/Topology/TopologyApi";
import {
  CONTAINER_SPECIFICITY,
  NESTABLE_CHILD_TYPES,
  NESTING_RELATIONSHIP_PRIORITY,
  PLACEMENT_RELATIONSHIP_TYPES,
  SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS,
  isFlatInfrastructureType,
  isTopologyInfrastructureType,
} from "../../../../Types/Topology/TopologyTypeRules";

/*
 * A REFERENCE implementation of what the Topology API must return, written
 * from the semantics the build spec lists (activity, item identity,
 * relationships in range, nesting, placements, the Service Map payload and the
 * drawer's sections) in plain TypeScript over whole rows.
 *
 * It deliberately shares nothing with the server's SQL (TopologySql /
 * TopologyQueries): the differential tests compare the two, and the Dashboard
 * parity test feeds this output through the real decoders to prove that the
 * reduced payload rebuilds exactly the maps the old whole-inventory load gave.
 * The only shared inputs are the contract types and the type rules in
 * Common/Types/Topology, which are the specification both sides implement.
 *
 * Safety caps (TopologyApiLimits.Max*) are not modelled: the estates these
 * tests generate stay far below them, so truncation is always null.
 */

/* One InventoryItem row, every column the Topology API can read. */
export interface ReferenceItem {
  /* `_id`, a lowercase UUID. */
  id: string;
  projectId: string;
  key: string;
  type: string;
  name: string | null;
  /* The column is NOT NULL; "" is a valid (blank) value. */
  source: string;
  lastSeenAt: Date | null;
  firstSeenAt: Date | null;
  createdAt: Date;
  isArchived: boolean;
  deleted: boolean;
  /* Any JSON the jsonb column can hold (objects, arrays, scalars), or NULL. */
  descriptiveAttributes: JSONValue | null;
  identifyingAttributes: JSONValue | null;
  resourceType: string | null;
  resourceId: string | null;
}

/* One InventoryItemRelationship row. */
export interface ReferenceRelationship {
  id: string;
  projectId: string;
  from: string;
  to: string;
  type: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  deleted: boolean;
  callCount: number | null;
  errorCount: number | null;
  avgDurationMs: number | null;
}

export interface ReferenceEstate {
  items: Array<ReferenceItem>;
  relationships: Array<ReferenceRelationship>;
}

export interface ReferenceScope {
  projectId: string;
  /* Floored to the minute here, exactly as the server floors the request. */
  rangeStart: Date;
}

export type ReferenceServiceMapResponse = Omit<
  TopologyServiceMapResponseJSON,
  "generatedAt"
>;

export type ReferenceInfrastructureResponse = Omit<
  TopologyInfrastructureResponseJSON,
  "generatedAt"
>;

export type ReferenceEntityResponse = Omit<
  TopologyEntityResponseJSON,
  "generatedAt"
>;

export interface ReferenceInfrastructureOptions {
  /* Defaults to TopologyApiLimits.InlineFlatItemsPerType. */
  inlineFlatItemsPerType?: number | undefined;
}

export interface ReferenceEntityRequest extends ReferenceScope {
  entityKey: string;
  entityType: string | null;
}

export interface ReferenceEntityOptions {
  /*
   * How the database's default collation orders drawer labels. Labels are
   * the one place the server sorts by the database collation rather than by
   * code points, so a caller that talks to a real database passes that
   * database's order; the default is code-point order.
   */
  compareLabels?: ((left: string, right: string) => number) | undefined;
  /* Relationships read at most (defaults to EntityConnectionScanLimit + 1). */
  scanLimit?: number | undefined;
  dependencyRows?: number | undefined;
  otherRows?: number | undefined;
}

export const REFERENCE_UNNAMED_RESOURCE_LABEL: string = "Unnamed resource";
export const REFERENCE_UNDISCOVERED_RESOURCE_LABEL: string =
  "Undiscovered resource";

// ------------------------------------------------------------ primitives

const MINUTE_MS: number = 60 * 1000;

export function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

/*
 * COLLATE "C" on a UTF-8 database: byte order of the UTF-8 encoding, which is
 * code-point order. That equals JavaScript's code-unit order everywhere
 * except where a character outside the Basic Multilingual Plane (a surrogate
 * pair in UTF-16) meets one in U+E000..U+FFFF, so the comparison is done on
 * code points at the first difference.
 */
export function compareCollateC(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const length: number = Math.min(left.length, right.length);
  let index: number = 0;
  while (index < length && left.charCodeAt(index) === right.charCodeAt(index)) {
    index++;
  }
  if (index === length) {
    return left.length - right.length;
  }
  /* A difference in a low surrogate compares the whole pair. */
  let start: number = index;
  if (start > 0) {
    const previous: number = left.charCodeAt(start - 1);
    if (previous >= 0xd800 && previous <= 0xdbff) {
      start--;
    }
  }
  return left.codePointAt(start)! - right.codePointAt(start)!;
}

/* uuid columns compare as 16 raw bytes: the lowercase text's order. */
function compareIds(left: string, right: string): number {
  const a: string = left.toLowerCase();
  const b: string = right.toLowerCase();
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/* Semantics 1: the activity predicate. */
export function isReferenceActive(
  row: { source: string | null; lastSeenAt: Date | null },
  rangeStart: Date,
): boolean {
  if (
    row.source !== null &&
    row.source !== "" &&
    row.source !== EntitySource.Discovered
  ) {
    return true;
  }
  if (row.lastSeenAt === null) {
    return true;
  }
  return row.lastSeenAt.getTime() >= rangeStart.getTime();
}

/* Timestamps leave the server as floored epoch milliseconds. */
export function referenceEpochMs(date: Date | null): number | null {
  return date === null ? null : Math.floor(date.getTime());
}

function isPlainObject(value: JSONValue | null | undefined): boolean {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

// -------------------------------------------------------------- snapshot

/* What every endpoint reads: the project's live items and in-range rows. */
interface ReferenceSnapshot {
  rangeStart: Date;
  /* Semantics 2: non-archived, non-deleted rows of the project. */
  liveItems: Array<ReferenceItem>;
  /* The winning live row of every key. */
  winnerByKey: Map<string, ReferenceItem>;
  /* Semantics 3: in-range, non-deleted relationships of the project. */
  inRange: Array<ReferenceRelationship>;
}

/*
 * Semantics 2: among live rows sharing a key the winner is the first by
 * (createdAt ASC, _id DESC).
 */
function compareWinner(left: ReferenceItem, right: ReferenceItem): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    compareIds(right.id, left.id)
  );
}

function takeSnapshot(
  estate: ReferenceEstate,
  scope: ReferenceScope,
): ReferenceSnapshot {
  const rangeStart: Date = floorToMinute(scope.rangeStart);
  const liveItems: Array<ReferenceItem> = estate.items.filter(
    (item: ReferenceItem): boolean => {
      return (
        item.projectId === scope.projectId && !item.isArchived && !item.deleted
      );
    },
  );
  const winnerByKey: Map<string, ReferenceItem> = new Map<
    string,
    ReferenceItem
  >();
  for (const item of liveItems) {
    const current: ReferenceItem | undefined = winnerByKey.get(item.key);
    if (!current || compareWinner(item, current) < 0) {
      winnerByKey.set(item.key, item);
    }
  }
  const inRange: Array<ReferenceRelationship> = estate.relationships.filter(
    (relationship: ReferenceRelationship): boolean => {
      return (
        relationship.projectId === scope.projectId &&
        !relationship.deleted &&
        relationship.lastSeenAt !== null &&
        relationship.lastSeenAt.getTime() >= rangeStart.getTime()
      );
    },
  );
  return { rangeStart, liveItems, winnerByKey, inRange };
}

function winners(snapshot: ReferenceSnapshot): Array<ReferenceItem> {
  return Array.from(snapshot.winnerByKey.values());
}

function byKeyC(left: ReferenceItem, right: ReferenceItem): number {
  return compareCollateC(left.key, right.key);
}

function envelope(snapshot: ReferenceSnapshot): {
  formatVersion: number;
  rangeStart: string;
} {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: snapshot.rangeStart.toISOString(),
  };
}

// ----------------------------------------------------------- service map

/*
 * Semantics 6: only the detail keys whose value is a JSON string, per bag;
 * a bag with none of them is absent.
 */
function detailBag(bag: JSONValue | null): Record<string, string> | undefined {
  if (!isPlainObject(bag)) {
    return undefined;
  }
  const object: JSONObject = bag as JSONObject;
  const strings: Record<string, string> = {};
  let count: number = 0;
  for (const key of SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS) {
    const value: JSONValue | undefined = object[key];
    if (typeof value === "string") {
      strings[key] = value;
      count++;
    }
  }
  return count > 0 ? strings : undefined;
}

function toServiceMapEntity(item: ReferenceItem): TopologyServiceMapEntityJSON {
  const entity: TopologyServiceMapEntityJSON = {
    key: item.key,
    type: item.type,
    name: item.name,
    source: item.source,
    lastSeenAt: referenceEpochMs(item.lastSeenAt),
  };
  const descriptive: Record<string, string> | undefined = detailBag(
    item.descriptiveAttributes,
  );
  const identifying: Record<string, string> | undefined = detailBag(
    item.identifyingAttributes,
  );
  if (descriptive) {
    entity.descriptiveAttributes = descriptive;
  }
  if (identifying) {
    entity.identifyingAttributes = identifying;
  }
  return entity;
}

/* The old list API's order: createdAt DESC, _id ASC. */
function compareListOrder(
  left: ReferenceRelationship,
  right: ReferenceRelationship,
): number {
  return (
    right.createdAt.getTime() - left.createdAt.getTime() ||
    compareIds(left.id, right.id)
  );
}

/*
 * Semantics 5 / 6: distinct (service, target) pairs over in-range runs-on /
 * hosted-on rows whose `from` is one of the given services.
 */
function placementPairs(
  snapshot: ReferenceSnapshot,
  serviceKeys: Set<string>,
): Array<[string, string]> {
  const seen: Set<string> = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const relationship of snapshot.inRange) {
    if (
      !PLACEMENT_RELATIONSHIP_TYPES.has(relationship.type) ||
      !serviceKeys.has(relationship.from)
    ) {
      continue;
    }
    const id: string = `${relationship.from}\u0000${relationship.to}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    pairs.push([relationship.from, relationship.to]);
  }
  return pairs;
}

export function referenceServiceMap(
  estate: ReferenceEstate,
  scope: ReferenceScope,
): ReferenceServiceMapResponse {
  const snapshot: ReferenceSnapshot = takeSnapshot(estate, scope);

  /* Every live service, active or not. */
  const services: Array<ReferenceItem> = winners(snapshot)
    .filter((item: ReferenceItem): boolean => {
      return item.type === EntityType.Service;
    })
    .sort(byKeyC);
  const serviceKeys: Set<string> = new Set<string>(
    services.map((item: ReferenceItem): string => {
      return item.key;
    }),
  );

  const dependencies: Array<TopologyDependencyJSON> = snapshot.inRange
    .filter((relationship: ReferenceRelationship): boolean => {
      return (
        relationship.type === EntityRelationshipType.DependsOn &&
        serviceKeys.has(relationship.from) &&
        relationship.from !== relationship.to
      );
    })
    .sort(compareListOrder)
    .map((relationship: ReferenceRelationship): TopologyDependencyJSON => {
      return {
        from: relationship.from,
        to: relationship.to,
        callCount: relationship.callCount,
        errorCount: relationship.errorCount,
        avgDurationMs: relationship.avgDurationMs,
      };
    });

  /*
   * Callees: live items a dependency points at. A callee that is a service is
   * already listed with the services.
   */
  const calleeKeys: Set<string> = new Set<string>(
    dependencies.map((dependency: TopologyDependencyJSON): string => {
      return dependency.to;
    }),
  );
  const callees: Array<ReferenceItem> = winners(snapshot)
    .filter((item: ReferenceItem): boolean => {
      return calleeKeys.has(item.key) && !serviceKeys.has(item.key);
    })
    .sort(byKeyC);

  /* Per (service, target type): distinct targets, and the active ones. */
  const counts: Map<string, TopologyRunsOnCountJSON> = new Map<
    string,
    TopologyRunsOnCountJSON
  >();
  for (const [service, targetKey] of placementPairs(snapshot, serviceKeys)) {
    const target: ReferenceItem | undefined =
      snapshot.winnerByKey.get(targetKey);
    if (!target) {
      continue;
    }
    const id: string = `${service}\u0000${target.type}`;
    let count: TopologyRunsOnCountJSON | undefined = counts.get(id);
    if (!count) {
      count = { service, type: target.type, active: 0, total: 0 };
      counts.set(id, count);
    }
    count.total++;
    if (isReferenceActive(target, snapshot.rangeStart)) {
      count.active++;
    }
  }
  const runsOn: Array<TopologyRunsOnCountJSON> = Array.from(
    counts.values(),
  ).sort(
    (left: TopologyRunsOnCountJSON, right: TopologyRunsOnCountJSON): number => {
      return (
        compareCollateC(left.service, right.service) ||
        compareCollateC(left.type, right.type)
      );
    },
  );

  if (services.length === 0) {
    return {
      ...envelope(snapshot),
      entities: [],
      dependencies: [],
      runsOn: [],
      entityTruncation: null,
      dependencyTruncation: null,
    };
  }

  return {
    ...envelope(snapshot),
    entities: [...services, ...callees].map(toServiceMapEntity),
    dependencies,
    runsOn,
    entityTruncation: null,
    dependencyTruncation: null,
  };
}

// -------------------------------------------------------- infrastructure

interface NestingCandidate {
  parent: ReferenceItem;
  via: string;
  priority: number;
  specificity: number;
}

/* Semantics 4: priority DESC, specificity DESC, parent key (C) ASC. */
function compareCandidates(
  left: NestingCandidate,
  right: NestingCandidate,
): number {
  return (
    right.priority - left.priority ||
    right.specificity - left.specificity ||
    compareCollateC(left.parent.key, right.parent.key)
  );
}

function best(
  candidates: Array<NestingCandidate>,
): NestingCandidate | undefined {
  let winner: NestingCandidate | undefined = undefined;
  for (const candidate of candidates) {
    if (!winner || compareCandidates(candidate, winner) < 0) {
      winner = candidate;
    }
  }
  return winner;
}

function maxDate(dates: Array<Date | null>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }
  return latest;
}

export function referenceInfrastructure(
  estate: ReferenceEstate,
  scope: ReferenceScope,
  options: ReferenceInfrastructureOptions = {},
): ReferenceInfrastructureResponse {
  const snapshot: ReferenceSnapshot = takeSnapshot(estate, scope);
  const inlineBudget: number =
    options.inlineFlatItemsPerType ?? TopologyApiLimits.InlineFlatItemsPerType;
  const rangeStart: Date = snapshot.rangeStart;

  /*
   * Collections: a flat type with more live ROWS than the inline budget.
   * Counted over rows (the collection's pages list rows of the type), with
   * the latest report over all of them and over the active ones.
   */
  const rowsByType: Map<string, Array<ReferenceItem>> = new Map<
    string,
    Array<ReferenceItem>
  >();
  for (const item of snapshot.liveItems) {
    if (!isTopologyInfrastructureType(item.type)) {
      continue;
    }
    const rows: Array<ReferenceItem> = rowsByType.get(item.type) || [];
    rows.push(item);
    rowsByType.set(item.type, rows);
  }
  const collections: Array<TopologyInfrastructureCollectionJSON> = [];
  const collectedTypes: Set<string> = new Set<string>();
  for (const type of Array.from(rowsByType.keys()).sort(compareCollateC)) {
    const rows: Array<ReferenceItem> = rowsByType.get(type)!;
    if (!isFlatInfrastructureType(type) || rows.length <= inlineBudget) {
      continue;
    }
    const active: Array<ReferenceItem> = rows.filter(
      (item: ReferenceItem): boolean => {
        return isReferenceActive(item, rangeStart);
      },
    );
    collectedTypes.add(type);
    collections.push({
      type,
      total: rows.length,
      active: active.length,
      lastSeenAt: referenceEpochMs(
        maxDate(
          rows.map((item: ReferenceItem): Date | null => {
            return item.lastSeenAt;
          }),
        ),
      ),
      activeLastSeenAt: referenceEpochMs(
        maxDate(
          active.map((item: ReferenceItem): Date | null => {
            return item.lastSeenAt;
          }),
        ),
      ),
    });
  }

  /* Semantics 4: the node set, ordered by (type, key) in code points. */
  const nodes: Array<ReferenceItem> = winners(snapshot)
    .filter((item: ReferenceItem): boolean => {
      return (
        isTopologyInfrastructureType(item.type) &&
        !collectedTypes.has(item.type)
      );
    })
    .sort((left: ReferenceItem, right: ReferenceItem): number => {
      return compareCollateC(left.type, right.type) || byKeyC(left, right);
    });
  const nodeIndexByKey: Map<string, number> = new Map<string, number>();
  nodes.forEach((node: ReferenceItem, index: number): void => {
    nodeIndexByKey.set(node.key, index);
  });

  const candidatesByChild: Map<string, Array<NestingCandidate>> = new Map<
    string,
    Array<NestingCandidate>
  >();
  for (const relationship of snapshot.inRange) {
    const priority: number | undefined =
      NESTING_RELATIONSHIP_PRIORITY[
        relationship.type as EntityRelationshipType
      ];
    if (priority === undefined || relationship.from === relationship.to) {
      continue;
    }
    const childIndex: number | undefined = nodeIndexByKey.get(
      relationship.from,
    );
    const parentIndex: number | undefined = nodeIndexByKey.get(relationship.to);
    if (childIndex === undefined || parentIndex === undefined) {
      continue;
    }
    const child: ReferenceItem = nodes[childIndex]!;
    const parent: ReferenceItem = nodes[parentIndex]!;
    const specificity: number | undefined =
      CONTAINER_SPECIFICITY[parent.type as EntityType];
    if (
      !NESTABLE_CHILD_TYPES.has(child.type as EntityType) ||
      specificity === undefined
    ) {
      continue;
    }
    const candidates: Array<NestingCandidate> =
      candidatesByChild.get(child.key) || [];
    candidates.push({
      parent,
      via: relationship.type,
      priority,
      specificity,
    });
    candidatesByChild.set(child.key, candidates);
  }

  let activeResources: number = 0;
  const nodeRows: Array<TopologyInfrastructureNodeJSON> = nodes.map(
    (node: ReferenceItem): TopologyInfrastructureNodeJSON => {
      if (isReferenceActive(node, rangeStart)) {
        activeResources++;
      }
      const row: TopologyInfrastructureNodeJSON = {
        key: node.key,
        type: node.type,
        name: node.name,
        source: node.source,
        lastSeenAt: referenceEpochMs(node.lastSeenAt),
      };
      const candidates: Array<NestingCandidate> =
        candidatesByChild.get(node.key) || [];
      const parent: NestingCandidate | undefined = best(candidates);
      if (!parent) {
        return row;
      }
      row.parent = nodeIndexByKey.get(parent.parent.key)!;
      row.parentVia = parent.via;
      if (!isReferenceActive(parent.parent, rangeStart)) {
        const activeParent: NestingCandidate | undefined = best(
          candidates.filter((candidate: NestingCandidate): boolean => {
            return isReferenceActive(candidate.parent, rangeStart);
          }),
        );
        if (activeParent) {
          row.activeParent = nodeIndexByKey.get(activeParent.parent.key)!;
          row.activeParentVia = activeParent.via;
        } else {
          row.activeParent = -1;
        }
      }
      return row;
    },
  );

  const services: Array<ReferenceItem> = winners(snapshot)
    .filter((item: ReferenceItem): boolean => {
      return item.type === EntityType.Service;
    })
    .sort(byKeyC);
  const serviceIndexByKey: Map<string, number> = new Map<string, number>();
  services.forEach((service: ReferenceItem, index: number): void => {
    serviceIndexByKey.set(service.key, index);
  });

  const placements: Array<[number, number]> = [];
  for (const [service, target] of placementPairs(
    snapshot,
    new Set<string>(serviceIndexByKey.keys()),
  )) {
    const nodeIndex: number | undefined = nodeIndexByKey.get(target);
    if (nodeIndex !== undefined) {
      placements.push([serviceIndexByKey.get(service)!, nodeIndex]);
    }
  }
  placements.sort((left: [number, number], right: [number, number]): number => {
    return left[0] - right[0] || left[1] - right[1];
  });

  /*
   * Infrastructure traffic: in-range calls between two different services that each
   * have a placement onto a shipped node, by service index, ordered by
   * (from, to). A pair is at most one row (the relationship natural key).
   */
  const placedServiceKeys: Set<string> = new Set<string>(
    placements.map((placement: [number, number]): string => {
      return services[placement[0]]!.key;
    }),
  );
  const dependencies: Array<TopologyInfrastructureDependencyJSON> =
    snapshot.inRange
      .filter((relationship: ReferenceRelationship): boolean => {
        return (
          relationship.type === EntityRelationshipType.DependsOn &&
          relationship.from !== relationship.to &&
          placedServiceKeys.has(relationship.from) &&
          placedServiceKeys.has(relationship.to)
        );
      })
      .map(
        (
          relationship: ReferenceRelationship,
        ): TopologyInfrastructureDependencyJSON => {
          return {
            from: serviceIndexByKey.get(relationship.from)!,
            to: serviceIndexByKey.get(relationship.to)!,
            callCount: relationship.callCount,
            errorCount: relationship.errorCount,
            avgDurationMs: relationship.avgDurationMs,
          };
        },
      )
      .sort(
        (
          left: TopologyInfrastructureDependencyJSON,
          right: TopologyInfrastructureDependencyJSON,
        ): number => {
          return left.from - right.from || left.to - right.to;
        },
      );

  let resources: number = nodes.length;
  for (const collection of collections) {
    resources += collection.total;
    activeResources += collection.active;
  }

  return {
    ...envelope(snapshot),
    nodes: nodeRows,
    services: services.map(
      (service: ReferenceItem): TopologyInfrastructureServiceJSON => {
        return { key: service.key, name: service.name };
      },
    ),
    placements,
    dependencies,
    dependencyTruncation: null,
    collections,
    totals: { resources, activeResources },
    truncation: null,
  };
}

// ---------------------------------------------------------------- drawer

interface ClassifiedConnection {
  section: TopologyConnectionSection;
  label: string;
  row: TopologyConnectionRowJSON;
}

function compareScanOrder(
  left: ReferenceRelationship,
  right: ReferenceRelationship,
): number {
  return (
    right.lastSeenAt!.getTime() - left.lastSeenAt!.getTime() ||
    compareIds(left.id, right.id)
  );
}

function emptySection(): TopologyConnectionSectionJSON {
  return { total: 0, unknownTotal: 0, rows: [], nextOffset: null };
}

function emptySections(): Record<
  TopologyConnectionSection,
  TopologyConnectionSectionJSON
> {
  return {
    calls: emptySection(),
    calledBy: emptySection(),
    runsOn: emptySection(),
    related: emptySection(),
  };
}

function detailObject(value: JSONValue | null): JSONObject | null {
  return isPlainObject(value) ? (value as JSONObject) : null;
}

/*
 * The drawer (semantics 8): the entity's full row and its in-range
 * relationships in four sections with exact totals and the top rows.
 */
export function referenceEntity(
  estate: ReferenceEstate,
  request: ReferenceEntityRequest,
  options: ReferenceEntityOptions = {},
): ReferenceEntityResponse {
  const snapshot: ReferenceSnapshot = takeSnapshot(estate, request);
  const compareLabels: (left: string, right: string) => number =
    options.compareLabels || compareCollateC;
  const scanLimit: number =
    options.scanLimit ?? TopologyApiLimits.EntityConnectionScanLimit + 1;
  const dependencyRows: number =
    options.dependencyRows ?? TopologyApiLimits.EntityDependencyRows;
  const otherRows: number =
    options.otherRows ?? TopologyApiLimits.EntityOtherRows;

  /*
   * The key's live rows; a known type narrows the choice, then the winner
   * rule decides.
   */
  const rows: Array<ReferenceItem> = snapshot.liveItems
    .filter((item: ReferenceItem): boolean => {
      return item.key === request.entityKey;
    })
    .sort((left: ReferenceItem, right: ReferenceItem): number => {
      const leftRank: number =
        request.entityType !== null && left.type === request.entityType ? 0 : 1;
      const rightRank: number =
        request.entityType !== null && right.type === request.entityType
          ? 0
          : 1;
      return leftRank - rightRank || compareWinner(left, right);
    });
  const item: ReferenceItem | undefined = rows[0];
  if (!item) {
    return {
      ...envelope(snapshot),
      entity: null,
      sections: emptySections(),
      isScanLimited: false,
    };
  }

  const entity: TopologyEntityDetailJSON = {
    key: item.key,
    type: item.type,
    name: item.name,
    source: item.source,
    lastSeenAt: referenceEpochMs(item.lastSeenAt),
    id: item.id,
    firstSeenAt: referenceEpochMs(item.firstSeenAt),
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    identifyingAttributes: detailObject(item.identifyingAttributes),
    descriptiveAttributes: detailObject(item.descriptiveAttributes),
  };

  /* Outbound first, then inbound (self-loops once, as outbound). */
  const outbound: Array<ReferenceRelationship> = snapshot.inRange
    .filter((relationship: ReferenceRelationship): boolean => {
      return relationship.from === item.key;
    })
    .sort(compareScanOrder)
    .slice(0, scanLimit);
  const inbound: Array<ReferenceRelationship> = snapshot.inRange
    .filter((relationship: ReferenceRelationship): boolean => {
      return relationship.to === item.key && relationship.from !== item.key;
    })
    .sort(compareScanOrder)
    .slice(0, Math.max(0, scanLimit - outbound.length));

  const isService: boolean = item.type === EntityType.Service;
  const classified: Array<ClassifiedConnection> = [];
  const scanned: Array<[ReferenceRelationship, "out" | "in"]> = [
    ...outbound.map(
      (
        relationship: ReferenceRelationship,
      ): [ReferenceRelationship, "out" | "in"] => {
        return [relationship, "out"];
      },
    ),
    ...inbound.map(
      (
        relationship: ReferenceRelationship,
      ): [ReferenceRelationship, "out" | "in"] => {
        return [relationship, "in"];
      },
    ),
  ];
  for (const [relationship, direction] of scanned) {
    const otherKey: string =
      direction === "out" ? relationship.to : relationship.from;
    const other: ReferenceItem | undefined = snapshot.winnerByKey.get(otherKey);
    let section: TopologyConnectionSection = "related";
    if (relationship.type === EntityRelationshipType.DependsOn) {
      section = direction === "out" ? "calls" : "calledBy";
    } else if (
      direction === "out" &&
      isService &&
      PLACEMENT_RELATIONSHIP_TYPES.has(relationship.type)
    ) {
      section = "runsOn";
    }
    const label: string =
      other && other.name
        ? other.name
        : other
          ? REFERENCE_UNNAMED_RESOURCE_LABEL
          : REFERENCE_UNDISCOVERED_RESOURCE_LABEL;
    classified.push({
      section,
      label,
      row: {
        relationshipType: relationship.type,
        direction,
        otherKey,
        otherKnown: Boolean(other),
        otherName: other ? other.name : null,
        otherType: other ? other.type : null,
        callCount: relationship.callCount,
        errorCount: relationship.errorCount,
        avgDurationMs: relationship.avgDurationMs,
        lastSeenAt: referenceEpochMs(relationship.lastSeenAt),
      },
    });
  }

  /*
   * calls / calledBy: callCount DESC NULLS LAST; runsOn / related: known
   * first. Then label, other key (C), and — for rows that still tie (one
   * other end reached by several relationship types or both directions) —
   * relationship type (C) and direction.
   */
  const compareRows: (
    left: ClassifiedConnection,
    right: ClassifiedConnection,
  ) => number = (
    left: ClassifiedConnection,
    right: ClassifiedConnection,
  ): number => {
    let primary: number = 0;
    if (left.section === "calls" || left.section === "calledBy") {
      const a: number | null = left.row.callCount;
      const b: number | null = right.row.callCount;
      if (a === null || b === null) {
        primary = (a === null ? 1 : 0) - (b === null ? 1 : 0);
      } else {
        primary = b - a;
      }
    } else {
      primary = Number(right.row.otherKnown) - Number(left.row.otherKnown);
    }
    return (
      primary ||
      compareLabels(left.label, right.label) ||
      compareCollateC(left.row.otherKey, right.row.otherKey) ||
      compareCollateC(left.row.relationshipType, right.row.relationshipType) ||
      compareCollateC(left.row.direction, right.row.direction)
    );
  };

  const sections: Record<
    TopologyConnectionSection,
    TopologyConnectionSectionJSON
  > = emptySections();
  for (const section of TOPOLOGY_CONNECTION_SECTIONS) {
    const members: Array<ClassifiedConnection> = classified
      .filter((connection: ClassifiedConnection): boolean => {
        return connection.section === section;
      })
      .sort(compareRows);
    const budget: number =
      section === "calls" || section === "calledBy"
        ? dependencyRows
        : otherRows;
    const shown: Array<TopologyConnectionRowJSON> = members
      .slice(0, budget)
      .map((connection: ClassifiedConnection): TopologyConnectionRowJSON => {
        return connection.row;
      });
    sections[section] = {
      total: members.length,
      unknownTotal: members.filter(
        (connection: ClassifiedConnection): boolean => {
          return !connection.row.otherKnown;
        },
      ).length,
      rows: shown,
      nextOffset:
        shown.length > 0 && shown.length < members.length ? shown.length : null,
    };
  }

  return {
    ...envelope(snapshot),
    entity,
    sections,
    isScanLimited:
      outbound.length + inbound.length >
      TopologyApiLimits.EntityConnectionScanLimit,
  };
}
