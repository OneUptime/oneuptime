import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  CONTAINER_SPECIFICITY,
  NESTABLE_CHILD_TYPES,
  NESTING_RELATIONSHIP_PRIORITY,
  PLACEMENT_RELATIONSHIP_TYPES,
  SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS,
} from "../../../Types/Topology/TopologyTypeRules";
import {
  TopologyCollectionCursorJSON,
  TopologyConnectionSection,
} from "../../../Types/Topology/TopologyApi";

/*
 * The SQL behind the Topology API (see Common/Types/Topology/TopologyApi.ts),
 * as pure statement builders so the text and its parameters can be checked
 * without a database.
 *
 * Rules every statement here follows:
 *
 *   - Everything a caller or the database supplied is a bound parameter.
 *     The only text interpolated into SQL is table aliases and constants from
 *     this module and Common (entity types, relationship types, section
 *     names), never a request value.
 *   - The project is always bound and every table reference carries
 *     `"deletedAt" IS NULL`. Items are additionally `"isArchived" = false`
 *     (except in the project-types probe, which only widens a filter).
 *   - Lookups by entity key also constrain `"entityType" = ANY(<the project's
 *     types>)`, so the unique (projectId, entityType, entityKey) index serves
 *     them on installs where the (projectId, entityKey) index has not been
 *     built yet (Helm runs migrations asynchronously). Many keys travel as
 *     one array parameter, never as a sub-select over a CTE, so the planner
 *     knows how many there are (see itemsByKeysStatement).
 *   - Relationship end keys and tie-breaks compare with COLLATE "C": byte
 *     order of the UTF-8 encoding, which is code-POINT order — far cheaper
 *     to sort than the database collation, and what the Dashboard's
 *     code-point comparator (TopologyTypeRules.compareCodePoints) matches.
 *     Note it is not JavaScript's `<` (UTF-16 code-unit order), which
 *     disagrees where a character outside the Basic Multilingual Plane meets
 *     one in U+E000..U+FFFF.
 *   - Counts are cast to int (node-postgres returns bigint as a string) and
 *     timestamps leave the database as epoch milliseconds (float8), so hot
 *     result sets never allocate a Date per row.
 */

export interface TopologySqlStatement {
  sql: string;
  params: Array<unknown>;
}

/* Collects bound parameters and hands out their placeholders in order. */
export class TopologySqlParams {
  private values: Array<unknown> = [];

  public add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  public list(): Array<unknown> {
    return this.values;
  }
}

/*
 * A parameter bound the first time a statement's text needs it. Postgres
 * refuses a parameter the text never references ("could not determine data
 * type"), and several are only needed on some paths — the range start when
 * inactive items are filtered out, the project's types when a duplicated key
 * has to be resolved.
 */
export class TopologyLazyParam {
  private placeholder: string | null = null;

  public constructor(
    private params: TopologySqlParams,
    private value: unknown,
  ) {}

  public get(): string {
    if (!this.placeholder) {
      this.placeholder = this.params.add(this.value);
    }
    return this.placeholder;
  }
}

/*
 * What the winner rule (winnerSql) needs: the project's types, so the
 * duplicate probe can use the unique (projectId, entityType, entityKey)
 * index, and the keys more than one live row carries (duplicateKeysStatement).
 */
export interface TopologyWinnerScope {
  projectTypes: Array<string>;
  duplicateKeys: Array<string>;
}

/*
 * Ranking tables for the nesting choice, bound as parallel arrays so the SQL
 * can never disagree with the Dashboard's own copy of the rules (both read
 * TopologyTypeRules).
 */
export interface TopologyRankTable {
  keys: Array<string>;
  ranks: Array<number>;
}

function toRankTable(
  table: Partial<Record<string, number | undefined>>,
): TopologyRankTable {
  const keys: Array<string> = [];
  const ranks: Array<number> = [];
  for (const key of Object.keys(table).sort()) {
    const rank: number | undefined = table[key];
    if (typeof rank === "number") {
      keys.push(key);
      ranks.push(rank);
    }
  }
  return { keys, ranks };
}

export const NESTING_RELATIONSHIP_RANKS: TopologyRankTable = toRankTable(
  NESTING_RELATIONSHIP_PRIORITY,
);

export const CONTAINER_SPECIFICITY_RANKS: TopologyRankTable = toRankTable(
  CONTAINER_SPECIFICITY,
);

export const NESTABLE_CHILD_TYPE_LIST: Array<string> =
  Array.from(NESTABLE_CHILD_TYPES).sort();

export const PLACEMENT_RELATIONSHIP_TYPE_LIST: Array<string> = Array.from(
  PLACEMENT_RELATIONSHIP_TYPES,
).sort();

export const SERVICE_MAP_ATTRIBUTE_KEY_LIST: Array<string> = [
  ...SERVICE_MAP_DETAIL_ATTRIBUTE_KEYS,
];

/* Labels the drawer orders its rows by; the browser translates its own. */
export const UNNAMED_RESOURCE_LABEL: string = "Unnamed resource";
export const UNDISCOVERED_RESOURCE_LABEL: string = "Undiscovered resource";

// ------------------------------------------------------------- fragments

/*
 * "Did this resource report in the range?", the SQL twin of the Dashboard's
 * TopologyActivity.isEntityActive. Only discovered rows have a heartbeat:
 * manual and inventory-mirrored rows (any other non-blank source) are always
 * active, and so is a row that has never reported. Change the two together.
 */
export function activeSql(alias: string, rangeStart: string): string {
  return (
    `CASE WHEN ${alias}."source" IS NOT NULL AND ${alias}."source" <> '' ` +
    `AND ${alias}."source" <> '${EntitySource.Discovered}' THEN TRUE ` +
    `WHEN ${alias}."lastSeenAt" IS NULL THEN TRUE ` +
    `ELSE ${alias}."lastSeenAt" >= ${rangeStart} END`
  );
}

/* Epoch milliseconds, floored, as float8 (a JavaScript number). */
export function epochMsSql(expression: string): string {
  return `floor(extract(epoch from ${expression}) * 1000)::float8`;
}

/* A non-archived, non-deleted item of the project. */
export function liveItemSql(alias: string, projectId: string): string {
  return (
    `${alias}."projectId" = ${projectId} AND ${alias}."isArchived" = false ` +
    `AND ${alias}."deletedAt" IS NULL`
  );
}

/*
 * A non-deleted row of the project, for the all-time reads: an item archived
 * or not, or a relationship however long ago it was seen.
 */
export function storedRowSql(alias: string, projectId: string): string {
  return `${alias}."projectId" = ${projectId} AND ${alias}."deletedAt" IS NULL`;
}

/* A non-deleted relationship of the project that was seen in the range. */
export function inRangeRelationshipSql(
  alias: string,
  projectId: string,
  rangeStart: string,
): string {
  return (
    `${alias}."projectId" = ${projectId} AND ${alias}."deletedAt" IS NULL ` +
    `AND ${alias}."lastSeenAt" >= ${rangeStart}`
  );
}

/*
 * The row that represents its entity key. Keys are unique per type (the
 * unique index) and hash the type into their preimage, so two live rows share
 * a key only if something wrote one by hand — but when it happens every
 * endpoint must pick the same row: the first by (createdAt ASC, _id DESC),
 * which is the row the old client-side list kept (it iterated createdAt DESC,
 * _id ASC and let the last write win).
 *
 * The duplicated keys are found once per request (duplicateKeysStatement) and
 * the rule is applied to them alone. For every other key the row is its own
 * winner, so the common case adds no predicate at all — an anti-join against
 * the whole project would cost a full pass over it in every statement that
 * lists items.
 */
export function winnerSql(
  alias: string,
  projectId: string,
  projectTypes: string,
  duplicateKeys: string,
): string {
  return (
    `(NOT (${alias}."entityKey" = ANY(${duplicateKeys}::text[])) ` +
    `OR NOT EXISTS (SELECT 1 FROM "InventoryItem" dup ` +
    `WHERE dup."projectId" = ${projectId} ` +
    `AND dup."entityType" = ANY(${projectTypes}::text[]) ` +
    `AND dup."entityKey" = ${alias}."entityKey" ` +
    `AND dup."isArchived" = false AND dup."deletedAt" IS NULL ` +
    `AND dup."_id" <> ${alias}."_id" ` +
    `AND (dup."createdAt" < ${alias}."createdAt" ` +
    `OR (dup."createdAt" = ${alias}."createdAt" AND dup."_id" > ${alias}."_id"))))`
  );
}

/* The winner predicate for `alias`, or nothing when no key is duplicated. */
function winnerPredicates(data: {
  params: TopologySqlParams;
  alias: string;
  projectId: string;
  projectTypes: TopologyLazyParam;
  winner: TopologyWinnerScope;
}): Array<string> {
  if (data.winner.duplicateKeys.length === 0) {
    return [];
  }
  return [
    winnerSql(
      data.alias,
      data.projectId,
      data.projectTypes.get(),
      data.params.add(data.winner.duplicateKeys),
    ),
  ];
}

/* Escapes LIKE metacharacters so a search term only ever matches literally. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (character: string): string => {
    return `\\${character}`;
  });
}

/* Every term must appear in the display name (case-insensitively). */
function nameTermsSql(
  alias: string,
  params: TopologySqlParams,
  nameTerms: Array<string>,
): Array<string> {
  return nameTerms.map((term: string): string => {
    return `${alias}."displayName" ILIKE '%' || ${params.add(escapeLikeTerm(term))} || '%' ESCAPE '\\'`;
  });
}

/* The lean entity columns every map row is built from. */
function leanEntityColumnsSql(alias: string): string {
  return (
    `${alias}."entityKey" AS "key", ${alias}."entityType" AS "type", ` +
    `${alias}."displayName" AS "name", ${alias}."source" AS "source", ` +
    `${epochMsSql(`${alias}."lastSeenAt"`)} AS "lastSeenAt"`
  );
}

/*
 * Only string-valued detail attributes, per bag: the Service Map's reader
 * needs a non-blank string and falls through to the next key otherwise, so
 * anything else would change which label it shows.
 */
function detailAttributesSql(
  alias: string,
  column: string,
  keys: string,
): string {
  return (
    `(SELECT jsonb_object_agg(k.key, ${alias}."${column}" -> k.key) ` +
    `FROM unnest(${keys}::text[]) AS k(key) ` +
    `WHERE jsonb_typeof(${alias}."${column}" -> k.key) = 'string')`
  );
}

// ----------------------------------------------------------- statements

/*
 * The project's distinct entity types, read by skipping through the
 * (projectId, entityType) index one type at a time (a "loose index scan"), so
 * it costs one index probe per type however many items there are.
 */
export function projectTypesStatement(data: {
  projectId: string;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  return {
    sql:
      `WITH RECURSIVE project_types AS (` +
      `(SELECT i."entityType" FROM "InventoryItem" i ` +
      `WHERE i."projectId" = ${projectId} AND i."deletedAt" IS NULL ` +
      `ORDER BY i."entityType" LIMIT 1) ` +
      `UNION ALL ` +
      `SELECT (SELECT i."entityType" FROM "InventoryItem" i ` +
      `WHERE i."projectId" = ${projectId} AND i."deletedAt" IS NULL ` +
      `AND i."entityType" > t."entityType" ORDER BY i."entityType" LIMIT 1) ` +
      `FROM project_types t WHERE t."entityType" IS NOT NULL) ` +
      `SELECT pt."entityType" AS "entityType" FROM project_types pt ` +
      `WHERE pt."entityType" IS NOT NULL`,
    params: params.list(),
  };
}

/*
 * Keys that more than one live row of the project carries (normally none).
 * One pass over the project; with the (projectId, entityKey) index it streams
 * in key order without holding the keys in memory.
 */
export function duplicateKeysStatement(data: {
  projectId: string;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  return {
    sql:
      `SELECT i."entityKey" AS "key" FROM "InventoryItem" i ` +
      `WHERE ${liveItemSql("i", projectId)} ` +
      `GROUP BY i."entityKey" HAVING COUNT(*) > 1`,
    params: params.list(),
  };
}

export type TopologyStatementMode = "rows" | "count";

/*
 * Service Map entities of one kind: every non-archived service
 * (`serviceKeys` absent), or the non-service items with the given keys (the
 * things services call). Ordered by key so a truncated list is stable.
 */
export function serviceMapEntitiesStatement(data: {
  projectId: string;
  winner: TopologyWinnerScope;
  /* Absent: the services. Present: these keys, services excluded. */
  keys?: Array<string> | undefined;
  mode: TopologyStatementMode;
  limit: number;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const projectTypes: TopologyLazyParam = new TopologyLazyParam(
    params,
    data.winner.projectTypes,
  );

  const where: Array<string> = [liveItemSql("i", projectId)];
  if (data.keys) {
    where.push(`i."entityType" = ANY(${projectTypes.get()}::text[])`);
    where.push(`i."entityKey" = ANY(${params.add(data.keys)}::text[])`);
    where.push(`i."entityType" <> ${params.add(EntityType.Service)}`);
  } else {
    where.push(`i."entityType" = ${params.add(EntityType.Service)}`);
  }
  where.push(
    ...winnerPredicates({
      params,
      alias: "i",
      projectId,
      projectTypes,
      winner: data.winner,
    }),
  );

  if (data.mode === "count") {
    return {
      sql: `SELECT COUNT(*)::int AS "total" FROM "InventoryItem" i WHERE ${where.join(" AND ")}`,
      params: params.list(),
    };
  }

  const attributeKeys: string = params.add(SERVICE_MAP_ATTRIBUTE_KEY_LIST);
  return {
    sql:
      `SELECT ${leanEntityColumnsSql("i")}, ` +
      `${detailAttributesSql("i", "descriptiveAttributes", attributeKeys)} AS "descriptiveAttributes", ` +
      `${detailAttributesSql("i", "identifyingAttributes", attributeKeys)} AS "identifyingAttributes" ` +
      `FROM "InventoryItem" i WHERE ${where.join(" AND ")} ` +
      `ORDER BY i."entityKey" COLLATE "C" ASC ` +
      `LIMIT ${params.add(data.limit)}`,
    params: params.list(),
  };
}

/*
 * In-range `depends-on` relationships whose caller is one of the services, in
 * the order the old list API returned them (createdAt DESC, _id ASC) so the
 * browser sums traffic in the same order and averages come out bit-identical.
 * `calleeKeys` narrows them to calls into those keys (Infrastructure asks
 * only for calls between services it can place).
 */
export function serviceMapDependenciesStatement(data: {
  projectId: string;
  rangeStart: string;
  serviceKeys: Array<string>;
  calleeKeys?: Array<string> | undefined;
  mode: TopologyStatementMode;
  limit: number;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: string = params.add(data.rangeStart);
  const where: string =
    `${inRangeRelationshipSql("r", projectId, rangeStart)} ` +
    `AND r."relationshipType" = ${params.add(EntityRelationshipType.DependsOn)} ` +
    `AND r."fromEntityKey" <> r."toEntityKey" ` +
    `AND r."fromEntityKey" = ANY(${params.add(data.serviceKeys)}::text[])` +
    (data.calleeKeys
      ? ` AND r."toEntityKey" = ANY(${params.add(data.calleeKeys)}::text[])`
      : "");

  if (data.mode === "count") {
    return {
      sql: `SELECT COUNT(*)::int AS "total" FROM "InventoryItemRelationship" r WHERE ${where}`,
      params: params.list(),
    };
  }

  return {
    sql:
      `SELECT r."fromEntityKey" AS "from", r."toEntityKey" AS "to", ` +
      `r."callCount" AS "callCount", r."errorCount" AS "errorCount", ` +
      `r."avgDurationMs" AS "avgDurationMs" ` +
      `FROM "InventoryItemRelationship" r WHERE ${where} ` +
      `ORDER BY r."createdAt" DESC, r."_id" ASC ` +
      `LIMIT ${params.add(data.limit)}`,
    params: params.list(),
  };
}

/*
 * Where services run: distinct (service, resource) over in-range runs-on /
 * hosted-on from the given services. The Service Map counts these per target
 * type; Infrastructure keeps the ones that land on a shipped node.
 */
export function placementsStatement(data: {
  projectId: string;
  rangeStart: string;
  serviceKeys: Array<string>;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: string = params.add(data.rangeStart);
  return {
    sql:
      `SELECT DISTINCT r."fromEntityKey" AS "service", r."toEntityKey" AS "target" ` +
      `FROM "InventoryItemRelationship" r ` +
      `WHERE ${inRangeRelationshipSql("r", projectId, rangeStart)} ` +
      `AND r."relationshipType" = ANY(${params.add(PLACEMENT_RELATIONSHIP_TYPE_LIST)}::text[]) ` +
      `AND r."fromEntityKey" = ANY(${params.add(data.serviceKeys)}::text[])`,
    params: params.list(),
  };
}

/*
 * The live items (winning rows) with the given keys: their type and whether
 * they reported in range. The keys are an array rather than a sub-select so
 * the planner knows how many there are — a handful become index probes, tens
 * of thousands one pass over the project (a sub-select over a CTE is
 * estimated at a couple of hundred rows and gets probed key by key, once per
 * project type, which is seconds on a large estate).
 */
export function itemsByKeysStatement(data: {
  projectId: string;
  rangeStart: string;
  winner: TopologyWinnerScope;
  keys: Array<string>;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: string = params.add(data.rangeStart);
  const projectTypes: TopologyLazyParam = new TopologyLazyParam(
    params,
    data.winner.projectTypes,
  );
  const where: Array<string> = [
    liveItemSql("i", projectId),
    `i."entityType" = ANY(${projectTypes.get()}::text[])`,
    `i."entityKey" = ANY(${params.add(data.keys)}::text[])`,
    ...winnerPredicates({
      params,
      alias: "i",
      projectId,
      projectTypes,
      winner: data.winner,
    }),
  ];
  return {
    sql:
      `SELECT i."entityKey" AS "key", i."entityType" AS "type", ` +
      `${activeSql("i", rangeStart)} AS "active" ` +
      `FROM "InventoryItem" i WHERE ${where.join(" AND ")}`,
    params: params.list(),
  };
}

/*
 * Every live service's key and name (Infrastructure resolves placements and
 * service labels from these).
 */
export function servicesStatement(data: {
  projectId: string;
  winner: TopologyWinnerScope;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const projectTypes: TopologyLazyParam = new TopologyLazyParam(
    params,
    data.winner.projectTypes,
  );
  const where: Array<string> = [
    liveItemSql("i", projectId),
    `i."entityType" = ${params.add(EntityType.Service)}`,
    ...winnerPredicates({
      params,
      alias: "i",
      projectId,
      projectTypes,
      winner: data.winner,
    }),
  ];
  return {
    sql:
      `SELECT i."entityKey" AS "key", i."displayName" AS "name" ` +
      `FROM "InventoryItem" i WHERE ${where.join(" AND ")} ` +
      `ORDER BY i."entityKey" COLLATE "C" ASC`,
    params: params.list(),
  };
}

/*
 * Exact item counts per infrastructure type, in one pass: how many there
 * are, how many reported in range, and the latest report over each. Decides
 * which flat types become collections and feeds the totals.
 */
export function infrastructureTypeCountsStatement(data: {
  projectId: string;
  rangeStart: string;
  infrastructureTypes: Array<string>;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: string = params.add(data.rangeStart);
  const active: string = activeSql("i", rangeStart);
  return {
    sql:
      `SELECT i."entityType" AS "type", COUNT(*)::int AS "total", ` +
      `COUNT(*) FILTER (WHERE ${active})::int AS "active", ` +
      `${epochMsSql(`MAX(i."lastSeenAt")`)} AS "lastSeenAt", ` +
      `${epochMsSql(`MAX(i."lastSeenAt") FILTER (WHERE ${active})`)} AS "activeLastSeenAt" ` +
      `FROM "InventoryItem" i ` +
      `WHERE ${liveItemSql("i", projectId)} ` +
      `AND i."entityType" = ANY(${params.add(data.infrastructureTypes)}::text[]) ` +
      `GROUP BY i."entityType" ` +
      `ORDER BY i."entityType" COLLATE "C" ASC`,
    params: params.list(),
  };
}

/* The Infrastructure node set: live winners of the given (node) types. */
function infrastructureNodesCteSql(data: {
  params: TopologySqlParams;
  projectId: string;
  rangeStart: string;
  winner: TopologyWinnerScope;
  nodeTypes: string;
}): string {
  const where: Array<string> = [
    liveItemSql("i", data.projectId),
    `i."entityType" = ANY(${data.nodeTypes}::text[])`,
    ...winnerPredicates({
      params: data.params,
      alias: "i",
      projectId: data.projectId,
      projectTypes: new TopologyLazyParam(
        data.params,
        data.winner.projectTypes,
      ),
      winner: data.winner,
    }),
  ];
  return (
    `nodes AS MATERIALIZED (` +
    `SELECT i."entityKey" AS "key", i."entityType" AS "type", ` +
    `i."displayName" AS "name", i."source" AS "source", ` +
    `i."lastSeenAt" AS "lastSeenAt", ` +
    `${activeSql("i", data.rangeStart)} AS "active" ` +
    `FROM "InventoryItem" i WHERE ${where.join(" AND ")})`
  );
}

/*
 * One row per infrastructure resource with its container chosen here, using
 * the Dashboard's nesting rules over EVERY in-range relationship:
 *
 *   candidates: C -> P where C's type nests, the relationship type ranks,
 *               P is another node and P's type is a container.
 *   rank:       relationship priority DESC, container specificity DESC,
 *               P's key (code-point order, COLLATE "C") ASC.
 *
 * `parent` is the best candidate over all nodes; `activeParent` the best
 * over active nodes, which the browser falls back to when inactive resources
 * are hidden and `parent` did not report in range. Taking the argmax over a
 * subset that contains the global argmax gives the global argmax, so the
 * browser builds exactly the tree all relationships would give it.
 */
export function infrastructureNodesStatement(data: {
  projectId: string;
  rangeStart: string;
  winner: TopologyWinnerScope;
  nodeTypes: Array<string>;
  mode: TopologyStatementMode;
  limit: number;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: string = params.add(data.rangeStart);
  const nodeTypes: string = params.add(data.nodeTypes);
  const nodesCte: string = infrastructureNodesCteSql({
    params,
    projectId,
    rangeStart,
    winner: data.winner,
    nodeTypes,
  });

  if (data.mode === "count") {
    return {
      sql:
        `WITH ${nodesCte} ` +
        `SELECT COUNT(*)::int AS "total", ` +
        `COUNT(*) FILTER (WHERE n."active")::int AS "active" FROM nodes n`,
      params: params.list(),
    };
  }

  const relationshipTypes: string = params.add(NESTING_RELATIONSHIP_RANKS.keys);
  const relationshipPriorities: string = params.add(
    NESTING_RELATIONSHIP_RANKS.ranks,
  );
  const containerTypes: string = params.add(CONTAINER_SPECIFICITY_RANKS.keys);
  const containerSpecificities: string = params.add(
    CONTAINER_SPECIFICITY_RANKS.ranks,
  );
  const nestableTypes: string = params.add(NESTABLE_CHILD_TYPE_LIST);
  /*
   * Keys sort with COLLATE "C" (code-point order) here for two reasons: the
   * Dashboard breaks the same tie with a code-point comparator, and a byte
   * comparison is an order of magnitude cheaper than the database collation
   * over a few hundred thousand candidates.
   */
  const ranking: string =
    `ORDER BY c."child" COLLATE "C", c."priority" DESC, c."specificity" DESC, ` +
    `c."parent" COLLATE "C" ASC`;

  return {
    sql:
      `WITH ${nodesCte}, ` +
      `candidates AS MATERIALIZED (` +
      `SELECT r."fromEntityKey" AS "child", r."toEntityKey" AS "parent", ` +
      `r."relationshipType" AS "via", ` +
      `(${relationshipPriorities}::int[])[array_position(${relationshipTypes}::text[], r."relationshipType"::text)] AS "priority", ` +
      `(${containerSpecificities}::int[])[array_position(${containerTypes}::text[], p."type"::text)] AS "specificity", ` +
      `p."active" AS "parentActive" ` +
      `FROM "InventoryItemRelationship" r ` +
      `JOIN nodes child ON child."key" = r."fromEntityKey" ` +
      `JOIN nodes p ON p."key" = r."toEntityKey" ` +
      `WHERE ${inRangeRelationshipSql("r", projectId, rangeStart)} ` +
      `AND r."relationshipType" = ANY(${relationshipTypes}::text[]) ` +
      `AND r."fromEntityKey" <> r."toEntityKey" ` +
      `AND child."type" = ANY(${nestableTypes}::text[]) ` +
      `AND p."type" = ANY(${containerTypes}::text[])), ` +
      `best AS (SELECT DISTINCT ON (c."child" COLLATE "C") c."child", c."parent", c."via", c."parentActive" ` +
      `FROM candidates c ${ranking}), ` +
      `best_active AS (SELECT DISTINCT ON (c."child" COLLATE "C") c."child", c."parent", c."via" ` +
      `FROM candidates c WHERE c."parentActive" ${ranking}) ` +
      `SELECT n."key" AS "key", n."type" AS "type", n."name" AS "name", ` +
      `n."source" AS "source", ${epochMsSql(`n."lastSeenAt"`)} AS "lastSeenAt", ` +
      `n."active" AS "active", ` +
      `b."parent" AS "parent", b."via" AS "parentVia", ` +
      `(b."parent" IS NOT NULL AND NOT b."parentActive") AS "parentInactive", ` +
      `ba."parent" AS "activeParent", ba."via" AS "activeParentVia" ` +
      `FROM nodes n ` +
      `LEFT JOIN best b ON b."child" = n."key" ` +
      `LEFT JOIN best_active ba ON ba."child" = n."key" ` +
      `ORDER BY n."type" COLLATE "C" ASC, n."key" COLLATE "C" ASC ` +
      `LIMIT ${params.add(data.limit)}`,
    params: params.list(),
  };
}

/* Filters shared by a collection's page, its total and its search count. */
function collectionWhereSql(data: {
  params: TopologySqlParams;
  projectId: string;
  rangeStart: TopologyLazyParam;
  entityType: string;
  includeInactive: boolean;
  nameTerms: Array<string>;
}): Array<string> {
  const where: Array<string> = [
    liveItemSql("i", data.projectId),
    `i."entityType" = ${data.params.add(data.entityType)}`,
  ];
  if (!data.includeInactive) {
    where.push(`(${activeSql("i", data.rangeStart.get())})`);
  }
  where.push(...nameTermsSql("i", data.params, data.nameTerms));
  return where;
}

/*
 * One page of a collection, keyset-paged on (display name, key). The name
 * sorts in the database's collation (what a person expects), the key with
 * COLLATE "C" (code points); both orders are total, so a cursor never skips
 * or repeats a row.
 */
export function collectionPageStatement(data: {
  projectId: string;
  rangeStart: string;
  entityType: string;
  includeInactive: boolean;
  nameTerms: Array<string>;
  cursor: TopologyCollectionCursorJSON | null;
  mode: TopologyStatementMode;
  limit: number;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: TopologyLazyParam = new TopologyLazyParam(
    params,
    data.rangeStart,
  );
  const where: Array<string> = collectionWhereSql({
    params,
    projectId,
    rangeStart,
    entityType: data.entityType,
    includeInactive: data.includeInactive,
    nameTerms: data.nameTerms,
  });

  if (data.mode === "count") {
    return {
      sql: `SELECT COUNT(*)::int AS "total" FROM "InventoryItem" i WHERE ${where.join(" AND ")}`,
      params: params.list(),
    };
  }

  if (data.cursor) {
    const name: string = params.add(data.cursor.name);
    const key: string = params.add(data.cursor.key);
    where.push(
      `(COALESCE(i."displayName", '') > ${name} ` +
        `OR (COALESCE(i."displayName", '') = ${name} ` +
        `AND i."entityKey" COLLATE "C" > ${key}))`,
    );
  }

  return {
    sql:
      `SELECT ${leanEntityColumnsSql("i")} ` +
      `FROM "InventoryItem" i WHERE ${where.join(" AND ")} ` +
      `ORDER BY COALESCE(i."displayName", '') ASC, i."entityKey" COLLATE "C" ASC ` +
      `LIMIT ${params.add(data.limit)}`,
    params: params.list(),
  };
}

/* How many items of each requested collection match its search terms. */
export function collectionSearchStatement(data: {
  projectId: string;
  rangeStart: string;
  includeInactive: boolean;
  types: Array<{ entityType: string; nameTerms: Array<string> }>;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const rangeStart: TopologyLazyParam = new TopologyLazyParam(
    params,
    data.rangeStart,
  );
  const branches: Array<string> = data.types.map(
    (type: { entityType: string; nameTerms: Array<string> }): string => {
      const where: Array<string> = collectionWhereSql({
        params,
        projectId,
        rangeStart,
        entityType: type.entityType,
        includeInactive: data.includeInactive,
        nameTerms: type.nameTerms,
      });
      return (
        `(SELECT ${params.add(type.entityType)}::text AS "entityType", ` +
        `COUNT(*)::int AS "count" FROM "InventoryItem" i ` +
        `WHERE ${where.join(" AND ")})`
      );
    },
  );
  return {
    sql: branches.join(" UNION ALL "),
    params: params.list(),
  };
}

/*
 * The item behind a drawer or an inventory read. The key alone identifies it
 * (the winning row); a known type narrows the choice when two rows share the
 * key.
 */
export function entityStatement(data: {
  projectId: string;
  projectTypes: Array<string>;
  entityKey: string;
  entityType: string | null;
  /*
   * The all-time reads find archived items too; a live row still wins over
   * an archived one that shares its key.
   */
  includeArchived?: boolean | undefined;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const projectTypes: string = params.add(data.projectTypes);
  return {
    sql:
      `SELECT i."_id"::text AS "id", ${leanEntityColumnsSql("i")}, ` +
      `${epochMsSql(`i."firstSeenAt"`)} AS "firstSeenAt", ` +
      `i."resourceType" AS "resourceType", i."resourceId"::text AS "resourceId", ` +
      `i."identifyingAttributes" AS "identifyingAttributes", ` +
      `i."descriptiveAttributes" AS "descriptiveAttributes" ` +
      `FROM "InventoryItem" i ` +
      `WHERE ${data.includeArchived ? storedRowSql("i", projectId) : liveItemSql("i", projectId)} ` +
      `AND i."entityType" = ANY(${projectTypes}::text[]) ` +
      `AND i."entityKey" = ${params.add(data.entityKey)} ` +
      `ORDER BY (i."entityType" = ${params.add(data.entityType)}::text) DESC NULLS LAST, ` +
      `${data.includeArchived ? `i."isArchived" ASC, ` : ""}` +
      `i."createdAt" ASC, i."_id" DESC ` +
      `LIMIT 1`,
    params: params.list(),
  };
}

/*
 * Which relationships and items an entity's sections cover: the drawer's
 * range over live items, or — for the inventory item page, which has no
 * range — everything the inventory holds: every non-deleted relationship
 * however long ago it was seen, with archived items as known other ends.
 */
export type TopologyEntityScope =
  | { kind: "range"; rangeStart: string }
  | { kind: "allTime" };

export type TopologyEntitySectionWindow =
  | {
      /* The drawer's first view: the top rows of every section. */
      kind: "top";
      dependencyRows: number;
      otherRows: number;
    }
  | {
      /* "Show more": one page of one section. */
      kind: "page";
      section: TopologyConnectionSection;
      offset: number;
      limit: number;
    };

/*
 * An entity's relationships in `scope`, classified into the drawer's four
 * sections, with exact per-section totals and the requested rows.
 *
 * At most `scanLimit` relationships are read — outbound first, then inbound,
 * each newest first — so a cluster with hundreds of thousands of pods in
 * range answers with lower bounds instead of timing out. A self-loop is read
 * once, as outbound. The other end is looked up among live items (the key's
 * winning row); a relationship to anything else stays in its section as an
 * unknown row, and is counted in `unknownTotal`.
 *
 * All time, the other end is looked up among archived items too (a live row
 * still wins a shared key) and each row carries its `otherId`. A relationship
 * that never reported a lastSeenAt sorts first under DESC, so the scan limit
 * drops the oldest discovered edges before it drops one of those.
 *
 * Returns one row: `scanned` (relationships read), `sections` (JSON array of
 * {section, total, unknownTotal}) and `rows` (JSON array, section then rank).
 */
export function entitySectionsStatement(data: {
  projectId: string;
  scope: TopologyEntityScope;
  projectTypes: Array<string>;
  entityKey: string;
  isService: boolean;
  scanLimit: number;
  window: TopologyEntitySectionWindow;
}): TopologySqlStatement {
  const params: TopologySqlParams = new TopologySqlParams();
  const projectId: string = params.add(data.projectId);
  const allTime: boolean = data.scope.kind === "allTime";
  const relationshipScope: string =
    data.scope.kind === "range"
      ? inRangeRelationshipSql(
          "r",
          projectId,
          params.add(data.scope.rangeStart),
        )
      : storedRowSql("r", projectId);
  const projectTypes: string = params.add(data.projectTypes);
  const entityKey: string = params.add(data.entityKey);
  const scanLimit: string = params.add(data.scanLimit);
  const dependsOn: string = params.add(EntityRelationshipType.DependsOn);
  const isService: string = params.add(data.isService);
  const placementTypes: string = params.add(PLACEMENT_RELATIONSHIP_TYPE_LIST);

  const scanColumns: (direction: "out" | "in", other: string) => string = (
    direction: "out" | "in",
    other: string,
  ): string => {
    return (
      `r."relationshipType" AS "relationshipType", '${direction}'::text AS "direction", ` +
      `r.${other} AS "otherKey", r."callCount" AS "callCount", ` +
      `r."errorCount" AS "errorCount", r."avgDurationMs" AS "avgDurationMs", ` +
      `r."lastSeenAt" AS "lastSeenAt"`
    );
  };

  let rowWindow: string;
  if (data.window.kind === "top") {
    rowWindow =
      `r."rank" <= CASE WHEN r."section" IN ('calls', 'calledBy') ` +
      `THEN ${params.add(data.window.dependencyRows)}::int ` +
      `ELSE ${params.add(data.window.otherRows)}::int END`;
  } else {
    const offset: string = params.add(data.window.offset);
    rowWindow =
      `r."section" = ${params.add(data.window.section)}::text ` +
      `AND r."rank" > ${offset}::int ` +
      `AND r."rank" <= ${offset}::int + ${params.add(data.window.limit)}::int`;
  }

  return {
    sql:
      `WITH scan_out AS MATERIALIZED (` +
      `SELECT ${scanColumns("out", `"toEntityKey"`)} ` +
      `FROM "InventoryItemRelationship" r ` +
      `WHERE ${relationshipScope} ` +
      `AND r."fromEntityKey" = ${entityKey} ` +
      `ORDER BY r."lastSeenAt" DESC, r."_id" ASC LIMIT ${scanLimit}::int), ` +
      `scan_in AS MATERIALIZED (` +
      `SELECT ${scanColumns("in", `"fromEntityKey"`)} ` +
      `FROM "InventoryItemRelationship" r ` +
      `WHERE ${relationshipScope} ` +
      `AND r."toEntityKey" = ${entityKey} AND r."fromEntityKey" <> ${entityKey} ` +
      `ORDER BY r."lastSeenAt" DESC, r."_id" ASC ` +
      `LIMIT GREATEST(0, ${scanLimit}::int - (SELECT COUNT(*)::int FROM scan_out))), ` +
      `scan AS (SELECT * FROM scan_out UNION ALL SELECT * FROM scan_in), ` +
      `others AS MATERIALIZED (` +
      `SELECT DISTINCT ON (i."entityKey") i."entityKey" AS "key", ` +
      `${allTime ? `i."_id"::text AS "id", ` : ""}` +
      `i."entityType" AS "type", i."displayName" AS "name" ` +
      `FROM "InventoryItem" i ` +
      `WHERE ${allTime ? storedRowSql("i", projectId) : liveItemSql("i", projectId)} ` +
      `AND i."entityType" = ANY(${projectTypes}::text[]) ` +
      `AND i."entityKey" IN (SELECT s."otherKey" FROM scan s) ` +
      `ORDER BY i."entityKey", ${allTime ? `i."isArchived" ASC, ` : ""}` +
      `i."createdAt" ASC, i."_id" DESC), ` +
      `classified AS MATERIALIZED (` +
      `SELECT s.*, (o."key" IS NOT NULL) AS "otherKnown", ` +
      `${allTime ? `o."id" AS "otherId", ` : ""}` +
      `o."type" AS "otherType", o."name" AS "otherName", ` +
      `CASE WHEN s."relationshipType" = ${dependsOn} AND s."direction" = 'out' THEN 'calls' ` +
      `WHEN s."relationshipType" = ${dependsOn} THEN 'calledBy' ` +
      `WHEN s."direction" = 'out' AND ${isService}::boolean ` +
      `AND s."relationshipType" = ANY(${placementTypes}::text[]) THEN 'runsOn' ` +
      `ELSE 'related' END AS "section", ` +
      `COALESCE(NULLIF(o."name", ''), CASE WHEN o."key" IS NOT NULL ` +
      `THEN '${UNNAMED_RESOURCE_LABEL}' ELSE '${UNDISCOVERED_RESOURCE_LABEL}' END) AS "label" ` +
      `FROM scan s LEFT JOIN others o ON o."key" = s."otherKey"), ` +
      `ranked AS (` +
      `SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c."section" ORDER BY ` +
      `CASE WHEN c."section" IN ('calls', 'calledBy') THEN c."callCount" END DESC NULLS LAST, ` +
      `CASE WHEN c."section" IN ('runsOn', 'related') THEN c."otherKnown" END DESC NULLS LAST, ` +
      `c."label" ASC, c."otherKey" COLLATE "C" ASC, ` +
      `c."relationshipType" COLLATE "C" ASC, c."direction" ASC) AS "rank" ` +
      `FROM classified c) ` +
      `SELECT (SELECT COUNT(*)::int FROM scan) AS "scanned", ` +
      `(SELECT COALESCE(json_agg(json_build_object(` +
      `'section', t."section", 'total', t."total", 'unknownTotal', t."unknownTotal")), '[]'::json) ` +
      `FROM (SELECT c."section" AS "section", COUNT(*)::int AS "total", ` +
      `COUNT(*) FILTER (WHERE NOT c."otherKnown")::int AS "unknownTotal" ` +
      `FROM classified c GROUP BY c."section") t) AS "sections", ` +
      `(SELECT COALESCE(json_agg(json_build_object(` +
      `'section', r."section", 'relationshipType', r."relationshipType", ` +
      `'direction', r."direction", 'otherKey', r."otherKey", ` +
      `'otherKnown', r."otherKnown", ` +
      `${allTime ? `'otherId', r."otherId", ` : ""}` +
      `'otherName', r."otherName", ` +
      `'otherType', r."otherType", 'callCount', r."callCount", ` +
      `'errorCount', r."errorCount", 'avgDurationMs', r."avgDurationMs", ` +
      `'lastSeenAt', ${epochMsSql(`r."lastSeenAt"`)}) ` +
      `ORDER BY r."section", r."rank"), '[]'::json) ` +
      `FROM ranked r WHERE ${rowWindow}) AS "rows"`,
    params: params.list(),
  };
}
