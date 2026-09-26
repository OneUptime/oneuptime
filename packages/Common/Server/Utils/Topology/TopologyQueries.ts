import { PostgresStatementTimeoutMs } from "../../EnvironmentConfig";
import InventoryItemService from "../../Services/InventoryItemService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TOPOLOGY_CONNECTION_SECTIONS,
  TopologyApiLimits,
  TopologyCollectionCursorJSON,
  TopologyCollectionResponseJSON,
  TopologyCollectionSearchResponseJSON,
  TopologyConnectionRowJSON,
  TopologyConnectionSection,
  TopologyConnectionSectionJSON,
  TopologyDependencyJSON,
  TopologyEntityAllTimeConnectionsResponseJSON,
  TopologyEntityAllTimeResponseJSON,
  TopologyEntityConnectionsResponseJSON,
  TopologyEntityDetailJSON,
  TopologyEntityJSON,
  TopologyEntityResponseJSON,
  TopologyInfrastructureDependencyJSON,
  TopologyInfrastructureNodeJSON,
  TopologyInfrastructureResponseJSON,
  TopologyInfrastructureServiceJSON,
  TopologyResponseEnvelopeJSON,
  TopologyRunsOnCountJSON,
  TopologyServiceMapEntityJSON,
  TopologyServiceMapResponseJSON,
} from "../../../Types/Topology/TopologyApi";
import {
  isFlatInfrastructureType,
  isTopologyInfrastructureType,
} from "../../../Types/Topology/TopologyTypeRules";
import {
  TopologyCollectionRequest,
  TopologyCollectionSearchRequest,
  TopologyConnectionsPage,
  TopologyEntityAllTimeConnectionsRequest,
  TopologyEntityAllTimeRequest,
  TopologyEntityConnectionsRequest,
  TopologyEntityRequest,
  TopologyEntityTarget,
  TopologyRangeRequest,
  rowsForSection,
} from "./TopologyRequest";
import {
  TopologyEntityScope,
  TopologyEntitySectionWindow,
  TopologySqlStatement,
  TopologyWinnerScope,
  collectionPageStatement,
  collectionSearchStatement,
  entitySectionsStatement,
  entityStatement,
  infrastructureNodesStatement,
  infrastructureTypeCountsStatement,
  itemsByKeysStatement,
  placementsStatement,
  duplicateKeysStatement,
  projectTypesStatement,
  serviceMapDependenciesStatement,
  serviceMapEntitiesStatement,
  servicesStatement,
} from "./TopologySql";
import { EntityManager } from "typeorm";

/*
 * The Topology API's reads: Postgres reduces the inventory graph and each
 * view receives only the rows it draws, computed over the whole inventory.
 * The SQL lives in TopologySql; this module runs it and shapes the contract
 * JSON (Common/Types/Topology/TopologyApi.ts).
 *
 * Every request reads one consistent snapshot on one connection: a READ ONLY
 * REPEATABLE READ transaction whose statements run one after another, so the
 * service list, the relationships and the counts a response is built from can
 * never disagree with each other. Parallel query is switched off for the
 * transaction: the docker-compose Postgres has a 64 MB /dev/shm, and parallel
 * hash joins over a large project fail there under concurrent load ("could not
 * resize shared memory segment"); the heaviest statement here is a single pass
 * over one project and does not need the workers. JIT is off too: it spends
 * 100-200 ms compiling each large statement and wins nothing back on reads of
 * this size.
 *
 * The statement timeout is set on the transaction as well, not left to the
 * connection's startup parameter: PgBouncer drops that parameter, and behind
 * it nothing but node-postgres's client-side query_timeout would remain — which
 * abandons a query without cancelling it, leaving one of the heaviest reads in
 * the app running on the server (holding its snapshot) after the user was
 * already told it failed. The configured value stays below that client
 * timeout, so Postgres cancels first.
 */

/*
 * `SET LOCAL statement_timeout = <ms>` for the configured statement timeout,
 * or null when none is configured (0, or not a number): then the connection's
 * own setting applies, as for every other query.
 */
export function statementTimeoutSql(timeoutMs: number): string | null {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    return null;
  }
  return `SET LOCAL statement_timeout = ${Math.floor(timeoutMs)}`;
}

export interface TopologyStatementRunner {
  query(statement: TopologySqlStatement): Promise<Array<JSONObject>>;
}

export interface TopologyProjectScope {
  /* Always the tenant the caller was authorized for, never a body value. */
  projectId: ObjectID;
}

// ---------------------------------------------------------------- decoding

function readString(row: JSONObject, key: string): string {
  const value: unknown = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function readNullableString(row: JSONObject, key: string): string | null {
  const value: unknown = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : String(value);
}

function readNullableNumber(row: JSONObject, key: string): number | null {
  const value: unknown = row[key];
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNumber(row: JSONObject, key: string): number {
  return readNullableNumber(row, key) ?? 0;
}

function readBoolean(row: JSONObject, key: string): boolean {
  const value: unknown = row[key];
  return value === true || value === "t" || value === "true";
}

function readJsonObject(row: JSONObject, key: string): JSONObject | null {
  const value: unknown = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JSONObject;
}

/* A bag of string attributes, or undefined when it holds none. */
function readStringBag(
  row: JSONObject,
  key: string,
): Record<string, string> | undefined {
  const bag: JSONObject | null = readJsonObject(row, key);
  if (!bag) {
    return undefined;
  }
  const strings: Record<string, string> = {};
  let count: number = 0;
  for (const attribute of Object.keys(bag).sort()) {
    const value: unknown = bag[attribute];
    if (typeof value === "string") {
      strings[attribute] = value;
      count++;
    }
  }
  return count > 0 ? strings : undefined;
}

function toLeanEntity(row: JSONObject): TopologyEntityJSON {
  return {
    key: readString(row, "key"),
    type: readString(row, "type"),
    name: readNullableString(row, "name"),
    /* The column is NOT NULL; "" reads as "no source" on both sides. */
    source: readNullableString(row, "source") ?? "",
    lastSeenAt: readNullableNumber(row, "lastSeenAt"),
  };
}

function toServiceMapEntity(row: JSONObject): TopologyServiceMapEntityJSON {
  const entity: TopologyServiceMapEntityJSON = toLeanEntity(row);
  const descriptive: Record<string, string> | undefined = readStringBag(
    row,
    "descriptiveAttributes",
  );
  const identifying: Record<string, string> | undefined = readStringBag(
    row,
    "identifyingAttributes",
  );
  if (descriptive) {
    entity.descriptiveAttributes = descriptive;
  }
  if (identifying) {
    entity.identifyingAttributes = identifying;
  }
  return entity;
}

function toConnectionRow(value: unknown): TopologyConnectionRowJSON {
  const row: JSONObject = (value || {}) as JSONObject;
  const connection: TopologyConnectionRowJSON = {
    relationshipType: readString(row, "relationshipType"),
    direction: row["direction"] === "in" ? "in" : "out",
    otherKey: readString(row, "otherKey"),
    otherKnown: readBoolean(row, "otherKnown"),
    otherName: readNullableString(row, "otherName"),
    otherType: readNullableString(row, "otherType"),
    callCount: readNullableNumber(row, "callCount"),
    errorCount: readNullableNumber(row, "errorCount"),
    avgDurationMs: readNullableNumber(row, "avgDurationMs"),
    lastSeenAt: readNullableNumber(row, "lastSeenAt"),
  };
  // Only the all-time statement selects it; the drawer's rows stay as they were.
  if ("otherId" in row) {
    connection.otherId = readNullableString(row, "otherId");
  }
  return connection;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function emptySections(): Record<
  TopologyConnectionSection,
  TopologyConnectionSectionJSON
> {
  return {
    calls: { total: 0, unknownTotal: 0, rows: [], nextOffset: null },
    calledBy: { total: 0, unknownTotal: 0, rows: [], nextOffset: null },
    runsOn: { total: 0, unknownTotal: 0, rows: [], nextOffset: null },
    related: { total: 0, unknownTotal: 0, rows: [], nextOffset: null },
  };
}

function isSection(value: unknown): value is TopologyConnectionSection {
  return TOPOLOGY_CONNECTION_SECTIONS.some(
    (section: TopologyConnectionSection): boolean => {
      return section === value;
    },
  );
}

interface DecodedSections {
  sections: Record<TopologyConnectionSection, TopologyConnectionSectionJSON>;
  isScanLimited: boolean;
}

/*
 * Decodes entitySectionsStatement's single row. `offset` is where the rows of
 * each section start (0 for the drawer's first view).
 */
function decodeSections(
  rows: Array<JSONObject>,
  offset: number,
): DecodedSections {
  const sections: Record<
    TopologyConnectionSection,
    TopologyConnectionSectionJSON
  > = emptySections();
  const row: JSONObject = rows[0] || {};

  const totals: unknown = row["sections"];
  for (const total of Array.isArray(totals) ? totals : []) {
    const entry: JSONObject = (total || {}) as JSONObject;
    const section: unknown = entry["section"];
    if (isSection(section)) {
      sections[section].total = readNumber(entry, "total");
      sections[section].unknownTotal = readNumber(entry, "unknownTotal");
    }
  }

  const connectionRows: unknown = row["rows"];
  for (const connection of Array.isArray(connectionRows)
    ? connectionRows
    : []) {
    const section: unknown = ((connection || {}) as JSONObject)["section"];
    if (isSection(section)) {
      sections[section].rows.push(toConnectionRow(connection));
    }
  }

  for (const section of TOPOLOGY_CONNECTION_SECTIONS) {
    const reached: number = offset + sections[section].rows.length;
    sections[section].nextOffset =
      sections[section].rows.length > 0 && reached < sections[section].total
        ? reached
        : null;
  }

  return {
    sections,
    isScanLimited:
      readNumber(row, "scanned") > TopologyApiLimits.EntityConnectionScanLimit,
  };
}

// ------------------------------------------------------------------ queries

export default class TopologyQueries {
  /*
   * Runs `work` on one pooled connection inside a READ ONLY REPEATABLE READ
   * transaction with a server-side statement timeout. TypeORM commits on
   * success, rolls back on failure and always releases the connection.
   */
  public static async inReadOnlySnapshot<T>(
    work: (runner: TopologyStatementRunner) => Promise<T>,
  ): Promise<T> {
    const manager: EntityManager = InventoryItemService.getRepository().manager;
    return await manager.transaction(
      "REPEATABLE READ",
      async (transaction: EntityManager): Promise<T> => {
        await transaction.query("SET TRANSACTION READ ONLY");
        const statementTimeout: string | null = statementTimeoutSql(
          PostgresStatementTimeoutMs,
        );
        if (statementTimeout) {
          await transaction.query(statementTimeout);
        }
        await transaction.query(
          "SET LOCAL max_parallel_workers_per_gather = 0",
        );
        await transaction.query("SET LOCAL jit = off");
        return await work({
          query: async (
            statement: TopologySqlStatement,
          ): Promise<Array<JSONObject>> => {
            return (await transaction.query(
              statement.sql,
              statement.params,
            )) as Array<JSONObject>;
          },
        });
      },
    );
  }

  public static envelope(rangeStart: Date): TopologyResponseEnvelopeJSON {
    return {
      formatVersion: TOPOLOGY_API_FORMAT_VERSION,
      rangeStart: rangeStart.toISOString(),
      generatedAt: new Date().toISOString(),
    };
  }

  /* The all-time responses have no range start to echo. */
  public static allTimeEnvelope(): Omit<
    TopologyResponseEnvelopeJSON,
    "rangeStart"
  > {
    return {
      formatVersion: TOPOLOGY_API_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
    };
  }

  /* The project's distinct entity types (see projectTypesStatement). */
  public static async readProjectTypes(
    runner: TopologyStatementRunner,
    projectId: string,
  ): Promise<Array<string>> {
    const rows: Array<JSONObject> = await runner.query(
      projectTypesStatement({ projectId }),
    );
    return rows
      .map((row: JSONObject): string => {
        return readString(row, "entityType");
      })
      .filter((type: string): boolean => {
        return type.length > 0;
      });
  }

  /*
   * The project's types plus the keys more than one live row carries, read
   * once per request so the statements that list items apply the winner rule
   * only where it can matter (see winnerSql).
   */
  public static async readWinnerScope(
    runner: TopologyStatementRunner,
    projectId: string,
    projectTypes: Array<string>,
  ): Promise<TopologyWinnerScope> {
    const rows: Array<JSONObject> = await runner.query(
      duplicateKeysStatement({ projectId }),
    );
    return {
      projectTypes,
      duplicateKeys: rows
        .map((row: JSONObject): string => {
          return readString(row, "key");
        })
        .sort(compareCodeUnits),
    };
  }

  /*
   * Rows up to `cap`, or — when there are more — the first `cap` and the
   * exact total from `count`. The row statement asks for cap + 1 so the
   * common case (under the cap) costs no count at all.
   */
  private static async readCapped(
    runner: TopologyStatementRunner,
    rows: (limit: number) => TopologySqlStatement,
    count: () => TopologySqlStatement,
    cap: number,
  ): Promise<{ rows: Array<JSONObject>; total: number; count: JSONObject }> {
    const found: Array<JSONObject> = await runner.query(rows(cap + 1));
    if (found.length <= cap) {
      return { rows: found, total: found.length, count: {} };
    }
    const counted: Array<JSONObject> = await runner.query(count());
    const countRow: JSONObject = counted[0] || {};
    return {
      rows: found.slice(0, cap),
      total: Math.max(readNumber(countRow, "total"), cap),
      count: countRow,
    };
  }

  /*
   * Per (service, target type): the distinct resources each service runs on
   * (in-range runs-on / hosted-on onto live items of any type), and how many
   * of those reported in range. Placements and targets are read separately so
   * the target lookup is by an array of keys the planner can size.
   */
  private static async readRunsOnCounts(
    runner: TopologyStatementRunner,
    data: {
      projectId: string;
      rangeStart: string;
      winner: TopologyWinnerScope;
      serviceKeys: Array<string>;
    },
  ): Promise<Array<TopologyRunsOnCountJSON>> {
    const placementRows: Array<JSONObject> = await runner.query(
      placementsStatement({
        projectId: data.projectId,
        rangeStart: data.rangeStart,
        serviceKeys: data.serviceKeys,
      }),
    );
    if (placementRows.length === 0) {
      return [];
    }

    const targetKeys: Array<string> = Array.from(
      new Set<string>(
        placementRows.map((row: JSONObject): string => {
          return readString(row, "target");
        }),
      ),
    ).sort(compareCodeUnits);
    const targetRows: Array<JSONObject> = await runner.query(
      itemsByKeysStatement({
        projectId: data.projectId,
        rangeStart: data.rangeStart,
        winner: data.winner,
        keys: targetKeys,
      }),
    );
    const targetByKey: Map<string, { type: string; active: boolean }> = new Map<
      string,
      { type: string; active: boolean }
    >();
    for (const row of targetRows) {
      targetByKey.set(readString(row, "key"), {
        type: readString(row, "type"),
        active: readBoolean(row, "active"),
      });
    }

    const counts: Map<string, TopologyRunsOnCountJSON> = new Map<
      string,
      TopologyRunsOnCountJSON
    >();
    for (const row of placementRows) {
      const service: string = readString(row, "service");
      const target: { type: string; active: boolean } | undefined =
        targetByKey.get(readString(row, "target"));
      if (!target) {
        continue;
      }
      const countKey: string = `${service}\u0000${target.type}`;
      let count: TopologyRunsOnCountJSON | undefined = counts.get(countKey);
      if (!count) {
        count = { service, type: target.type, active: 0, total: 0 };
        counts.set(countKey, count);
      }
      /* Placements are distinct (service, target) pairs: one per target. */
      count.total++;
      if (target.active) {
        count.active++;
      }
    }

    return Array.from(counts.values()).sort(
      (
        left: TopologyRunsOnCountJSON,
        right: TopologyRunsOnCountJSON,
      ): number => {
        return (
          compareCodeUnits(left.service, right.service) ||
          compareCodeUnits(left.type, right.type)
        );
      },
    );
  }

  /*
   * Service Map: every live service, everything services call, the in-range
   * calls between them, and per (service, target type) what the services run
   * on. No pods or other infrastructure rows.
   */
  @CaptureSpan()
  public static async getServiceMap(
    request: TopologyRangeRequest & TopologyProjectScope,
  ): Promise<TopologyServiceMapResponseJSON> {
    const projectId: string = request.projectId.toString();
    const rangeStart: string = request.rangeStart.toISOString();
    const entityCap: number = TopologyApiLimits.MaxServiceMapEntities;
    const dependencyCap: number = TopologyApiLimits.MaxServiceMapDependencies;

    return await TopologyQueries.inReadOnlySnapshot(
      async (
        runner: TopologyStatementRunner,
      ): Promise<TopologyServiceMapResponseJSON> => {
        const response: TopologyServiceMapResponseJSON = {
          ...TopologyQueries.envelope(request.rangeStart),
          entities: [],
          dependencies: [],
          runsOn: [],
          entityTruncation: null,
          dependencyTruncation: null,
        };

        const projectTypes: Array<string> =
          await TopologyQueries.readProjectTypes(runner, projectId);
        if (!projectTypes.includes(EntityType.Service)) {
          return response;
        }
        const winner: TopologyWinnerScope =
          await TopologyQueries.readWinnerScope(
            runner,
            projectId,
            projectTypes,
          );

        const services: {
          rows: Array<JSONObject>;
          total: number;
        } = await TopologyQueries.readCapped(
          runner,
          (limit: number): TopologySqlStatement => {
            return serviceMapEntitiesStatement({
              projectId,
              winner,
              mode: "rows",
              limit,
            });
          },
          (): TopologySqlStatement => {
            return serviceMapEntitiesStatement({
              projectId,
              winner,
              mode: "count",
              limit: 0,
            });
          },
          entityCap,
        );
        const serviceKeys: Array<string> = services.rows.map(
          (row: JSONObject): string => {
            return readString(row, "key");
          },
        );
        if (serviceKeys.length === 0) {
          return response;
        }

        const dependencies: {
          rows: Array<JSONObject>;
          total: number;
        } = await TopologyQueries.readCapped(
          runner,
          (limit: number): TopologySqlStatement => {
            return serviceMapDependenciesStatement({
              projectId,
              rangeStart,
              serviceKeys,
              mode: "rows",
              limit,
            });
          },
          (): TopologySqlStatement => {
            return serviceMapDependenciesStatement({
              projectId,
              rangeStart,
              serviceKeys,
              mode: "count",
              limit: 0,
            });
          },
          dependencyCap,
        );
        response.dependencies = dependencies.rows.map(
          (row: JSONObject): TopologyDependencyJSON => {
            return {
              from: readString(row, "from"),
              to: readString(row, "to"),
              callCount: readNullableNumber(row, "callCount"),
              errorCount: readNullableNumber(row, "errorCount"),
              avgDurationMs: readNullableNumber(row, "avgDurationMs"),
            };
          },
        );
        if (dependencies.total > dependencies.rows.length) {
          response.dependencyTruncation = {
            shown: dependencies.rows.length,
            total: dependencies.total,
          };
        }

        /*
         * Callees: the non-service items the shipped calls point at (a callee
         * that is a service is already in the list above).
         */
        const serviceKeySet: Set<string> = new Set<string>(serviceKeys);
        const calleeKeys: Array<string> = Array.from(
          new Set<string>(
            response.dependencies.map(
              (dependency: TopologyDependencyJSON): string => {
                return dependency.to;
              },
            ),
          ),
        )
          .filter((key: string): boolean => {
            return !serviceKeySet.has(key);
          })
          .sort(compareCodeUnits);

        let callees: { rows: Array<JSONObject>; total: number } = {
          rows: [],
          total: 0,
        };
        if (calleeKeys.length > 0) {
          callees = await TopologyQueries.readCapped(
            runner,
            (limit: number): TopologySqlStatement => {
              return serviceMapEntitiesStatement({
                projectId,
                winner,
                keys: calleeKeys,
                mode: "rows",
                limit,
              });
            },
            (): TopologySqlStatement => {
              return serviceMapEntitiesStatement({
                projectId,
                winner,
                keys: calleeKeys,
                mode: "count",
                limit: 0,
              });
            },
            entityCap - services.rows.length,
          );
        }

        response.entities = [...services.rows, ...callees.rows].map(
          toServiceMapEntity,
        );
        const entityTotal: number = services.total + callees.total;
        if (entityTotal > response.entities.length) {
          response.entityTruncation = {
            shown: response.entities.length,
            total: entityTotal,
          };
        }

        response.runsOn = await TopologyQueries.readRunsOnCounts(runner, {
          projectId,
          rangeStart,
          winner,
          serviceKeys,
        });

        return response;
      },
    );
  }

  /*
   * Infrastructure's traffic: the in-range calls between services that both
   * run on a shipped node, so the map can draw them between the resources
   * those services run on. A service placed nowhere could never be drawn, so
   * calls to or from one are not read at all. Capped like the Service Map's
   * dependencies (the first rows in its order, with the exact total), then
   * ordered by (from, to) — each pair is at most one row (the unique index).
   */
  private static async readInfrastructureDependencies(
    runner: TopologyStatementRunner,
    data: {
      projectId: string;
      rangeStart: string;
      response: TopologyInfrastructureResponseJSON;
      serviceIndexByKey: Map<string, number>;
    },
  ): Promise<void> {
    const placedServiceIndexes: Array<number> = Array.from(
      new Set<number>(
        data.response.placements.map((placement: [number, number]): number => {
          return placement[0];
        }),
      ),
    ).sort((left: number, right: number): number => {
      return left - right;
    });
    /* A call needs two different services at its ends. */
    if (placedServiceIndexes.length < 2) {
      return;
    }
    const placedServiceKeys: Array<string> = placedServiceIndexes.map(
      (index: number): string => {
        return data.response.services[index]!.key;
      },
    );

    const dependencies: { rows: Array<JSONObject>; total: number } =
      await TopologyQueries.readCapped(
        runner,
        (limit: number): TopologySqlStatement => {
          return serviceMapDependenciesStatement({
            projectId: data.projectId,
            rangeStart: data.rangeStart,
            serviceKeys: placedServiceKeys,
            calleeKeys: placedServiceKeys,
            mode: "rows",
            limit,
          });
        },
        (): TopologySqlStatement => {
          return serviceMapDependenciesStatement({
            projectId: data.projectId,
            rangeStart: data.rangeStart,
            serviceKeys: placedServiceKeys,
            calleeKeys: placedServiceKeys,
            mode: "count",
            limit: 0,
          });
        },
        TopologyApiLimits.MaxServiceMapDependencies,
      );

    const shipped: Array<TopologyInfrastructureDependencyJSON> = [];
    for (const row of dependencies.rows) {
      const from: number | undefined = data.serviceIndexByKey.get(
        readString(row, "from"),
      );
      const to: number | undefined = data.serviceIndexByKey.get(
        readString(row, "to"),
      );
      if (from === undefined || to === undefined || from === to) {
        continue;
      }
      shipped.push({
        from,
        to,
        callCount: readNullableNumber(row, "callCount"),
        errorCount: readNullableNumber(row, "errorCount"),
        avgDurationMs: readNullableNumber(row, "avgDurationMs"),
      });
    }
    shipped.sort(
      (
        left: TopologyInfrastructureDependencyJSON,
        right: TopologyInfrastructureDependencyJSON,
      ): number => {
        return left.from - right.from || left.to - right.to;
      },
    );
    data.response.dependencies = shipped;
    if (dependencies.total > dependencies.rows.length) {
      data.response.dependencyTruncation = {
        shown: dependencies.rows.length,
        total: dependencies.total,
      };
    }
  }

  /*
   * Infrastructure: one lean row per resource with its container chosen in
   * SQL, every live service, where services run, the calls between placed
   * services, and flat types too large to ship row by row as collections
   * with exact counts.
   */
  @CaptureSpan()
  public static async getInfrastructure(
    request: TopologyRangeRequest & TopologyProjectScope,
  ): Promise<TopologyInfrastructureResponseJSON> {
    const projectId: string = request.projectId.toString();
    const rangeStart: string = request.rangeStart.toISOString();
    const nodeCap: number = TopologyApiLimits.MaxInfrastructureNodes;

    return await TopologyQueries.inReadOnlySnapshot(
      async (
        runner: TopologyStatementRunner,
      ): Promise<TopologyInfrastructureResponseJSON> => {
        const response: TopologyInfrastructureResponseJSON = {
          ...TopologyQueries.envelope(request.rangeStart),
          nodes: [],
          services: [],
          placements: [],
          dependencies: [],
          dependencyTruncation: null,
          collections: [],
          totals: { resources: 0, activeResources: 0 },
          truncation: null,
        };

        const projectTypes: Array<string> =
          await TopologyQueries.readProjectTypes(runner, projectId);
        const infrastructureTypes: Array<string> = projectTypes.filter(
          (type: string): boolean => {
            return isTopologyInfrastructureType(type);
          },
        );

        /*
         * Collections: a flat type (nothing nests in it, it nests in nothing,
         * nothing groups it) with more items than the inline budget. Its
         * volume is not bounded by any discovery budget, so the browser gets
         * exact counts and pages the rows on demand. Its counts are over its
         * rows; keys are unique per type.
         */
        const typeCounts: Array<JSONObject> =
          infrastructureTypes.length > 0
            ? await runner.query(
                infrastructureTypeCountsStatement({
                  projectId,
                  rangeStart,
                  infrastructureTypes,
                }),
              )
            : [];
        const collectedTypes: Set<string> = new Set<string>();
        for (const row of typeCounts) {
          const type: string = readString(row, "type");
          const total: number = readNumber(row, "total");
          if (
            isFlatInfrastructureType(type) &&
            total > TopologyApiLimits.InlineFlatItemsPerType
          ) {
            collectedTypes.add(type);
            response.collections.push({
              type,
              total,
              active: readNumber(row, "active"),
              lastSeenAt: readNullableNumber(row, "lastSeenAt"),
              activeLastSeenAt: readNullableNumber(row, "activeLastSeenAt"),
            });
          }
        }

        const nodeTypes: Array<string> = infrastructureTypes.filter(
          (type: string): boolean => {
            return !collectedTypes.has(type);
          },
        );
        const hasServices: boolean = projectTypes.includes(EntityType.Service);
        const winner: TopologyWinnerScope =
          nodeTypes.length > 0 || hasServices
            ? await TopologyQueries.readWinnerScope(
                runner,
                projectId,
                projectTypes,
              )
            : { projectTypes, duplicateKeys: [] };

        let nodes: {
          rows: Array<JSONObject>;
          total: number;
          count: JSONObject;
        } = { rows: [], total: 0, count: {} };
        if (nodeTypes.length > 0) {
          nodes = await TopologyQueries.readCapped(
            runner,
            (limit: number): TopologySqlStatement => {
              return infrastructureNodesStatement({
                projectId,
                rangeStart,
                winner,
                nodeTypes,
                mode: "rows",
                limit,
              });
            },
            (): TopologySqlStatement => {
              return infrastructureNodesStatement({
                projectId,
                rangeStart,
                winner,
                nodeTypes,
                mode: "count",
                limit: 0,
              });
            },
            nodeCap,
          );
        }

        const nodeIndexByKey: Map<string, number> = new Map<string, number>();
        nodes.rows.forEach((row: JSONObject, index: number): void => {
          nodeIndexByKey.set(readString(row, "key"), index);
        });

        response.nodes = nodes.rows.map(
          (row: JSONObject): TopologyInfrastructureNodeJSON => {
            const node: TopologyInfrastructureNodeJSON = toLeanEntity(row);
            const parentKey: string | null = readNullableString(row, "parent");
            /* A container outside the shipped set (a truncated list) is dropped. */
            const parent: number | undefined =
              parentKey === null ? undefined : nodeIndexByKey.get(parentKey);
            if (parent === undefined) {
              return node;
            }
            node.parent = parent;
            node.parentVia = readString(row, "parentVia");
            if (readBoolean(row, "parentInactive")) {
              const activeParentKey: string | null = readNullableString(
                row,
                "activeParent",
              );
              const activeParent: number | undefined =
                activeParentKey === null
                  ? undefined
                  : nodeIndexByKey.get(activeParentKey);
              if (activeParent === undefined) {
                node.activeParent = -1;
              } else {
                node.activeParent = activeParent;
                node.activeParentVia = readString(row, "activeParentVia");
              }
            }
            return node;
          },
        );

        let activeNodes: number = 0;
        if (nodes.total > nodes.rows.length) {
          activeNodes = readNumber(nodes.count, "active");
          response.truncation = {
            shown: nodes.rows.length,
            total: nodes.total,
          };
        } else {
          for (const row of nodes.rows) {
            if (readBoolean(row, "active")) {
              activeNodes++;
            }
          }
        }

        response.totals = {
          resources: nodes.total,
          activeResources: activeNodes,
        };
        for (const collection of response.collections) {
          response.totals.resources += collection.total;
          response.totals.activeResources += collection.active;
        }

        if (hasServices) {
          const serviceRows: Array<JSONObject> = await runner.query(
            servicesStatement({ projectId, winner }),
          );
          response.services = serviceRows.map(
            (row: JSONObject): TopologyInfrastructureServiceJSON => {
              return {
                key: readString(row, "key"),
                name: readNullableString(row, "name"),
              };
            },
          );
        }

        if (response.services.length > 0 && response.nodes.length > 0) {
          const serviceIndexByKey: Map<string, number> = new Map<
            string,
            number
          >();
          response.services.forEach(
            (
              service: TopologyInfrastructureServiceJSON,
              index: number,
            ): void => {
              serviceIndexByKey.set(service.key, index);
            },
          );
          const placementRows: Array<JSONObject> = await runner.query(
            placementsStatement({
              projectId,
              rangeStart,
              serviceKeys: response.services.map(
                (service: TopologyInfrastructureServiceJSON): string => {
                  return service.key;
                },
              ),
            }),
          );
          const placements: Array<[number, number]> = [];
          for (const row of placementRows) {
            const service: number | undefined = serviceIndexByKey.get(
              readString(row, "service"),
            );
            const node: number | undefined = nodeIndexByKey.get(
              readString(row, "target"),
            );
            if (service !== undefined && node !== undefined) {
              placements.push([service, node]);
            }
          }
          placements.sort(
            (left: [number, number], right: [number, number]): number => {
              return left[0] - right[0] || left[1] - right[1];
            },
          );
          response.placements = placements;

          await TopologyQueries.readInfrastructureDependencies(runner, {
            projectId,
            rangeStart,
            response,
            serviceIndexByKey,
          });
        }

        return response;
      },
    );
  }

  /* One keyset page of a collection, with the total matching the filters. */
  @CaptureSpan()
  public static async getCollectionPage(
    request: TopologyCollectionRequest & TopologyProjectScope,
  ): Promise<TopologyCollectionResponseJSON> {
    const projectId: string = request.projectId.toString();
    const rangeStart: string = request.rangeStart.toISOString();

    return await TopologyQueries.inReadOnlySnapshot(
      async (
        runner: TopologyStatementRunner,
      ): Promise<TopologyCollectionResponseJSON> => {
        const filters: {
          projectId: string;
          rangeStart: string;
          entityType: string;
          includeInactive: boolean;
          nameTerms: Array<string>;
          cursor: TopologyCollectionCursorJSON | null;
        } = {
          projectId,
          rangeStart,
          entityType: request.entityType,
          includeInactive: request.includeInactive,
          nameTerms: request.nameTerms,
          cursor: request.cursor,
        };
        const countRows: Array<JSONObject> = await runner.query(
          collectionPageStatement({ ...filters, mode: "count", limit: 0 }),
        );
        const rows: Array<JSONObject> = await runner.query(
          collectionPageStatement({
            ...filters,
            mode: "rows",
            limit: request.limit + 1,
          }),
        );
        const items: Array<TopologyEntityJSON> = rows
          .slice(0, request.limit)
          .map(toLeanEntity);
        const last: TopologyEntityJSON | undefined = items[items.length - 1];

        return {
          ...TopologyQueries.envelope(request.rangeStart),
          entityType: request.entityType,
          total: readNumber(countRows[0] || {}, "total"),
          items,
          nextCursor:
            rows.length > request.limit && last
              ? { name: last.name ?? "", key: last.key }
              : null,
        };
      },
    );
  }

  /* How many items of each requested collection match its terms. */
  @CaptureSpan()
  public static async getCollectionSearch(
    request: TopologyCollectionSearchRequest & TopologyProjectScope,
  ): Promise<TopologyCollectionSearchResponseJSON> {
    const response: TopologyCollectionSearchResponseJSON = {
      ...TopologyQueries.envelope(request.rangeStart),
      matches: [],
    };
    if (request.types.length === 0) {
      return response;
    }

    const rows: Array<JSONObject> = await TopologyQueries.inReadOnlySnapshot(
      async (runner: TopologyStatementRunner): Promise<Array<JSONObject>> => {
        return await runner.query(
          collectionSearchStatement({
            projectId: request.projectId.toString(),
            rangeStart: request.rangeStart.toISOString(),
            includeInactive: request.includeInactive,
            types: request.types,
          }),
        );
      },
    );

    const countByType: Map<string, number> = new Map<string, number>();
    for (const row of rows) {
      countByType.set(readString(row, "entityType"), readNumber(row, "count"));
    }
    for (const type of request.types) {
      const count: number = countByType.get(type.entityType) || 0;
      if (count > 0) {
        response.matches.push({ entityType: type.entityType, count });
      }
    }
    return response;
  }

  /*
   * The drawer: the entity's full row and its in-range relationships in four
   * sections with exact totals (lower bounds when the scan stopped) and the
   * top rows of each.
   */
  @CaptureSpan()
  public static async getEntity(
    request: TopologyEntityRequest & TopologyProjectScope,
  ): Promise<TopologyEntityResponseJSON> {
    const result: {
      entity: TopologyEntityDetailJSON | null;
      decoded: DecodedSections;
    } = await TopologyQueries.readEntityAndSections(
      request,
      { kind: "range", rangeStart: request.rangeStart.toISOString() },
      TopologyQueries.firstView(),
    );

    return {
      ...TopologyQueries.envelope(request.rangeStart),
      entity: result.entity,
      sections: result.decoded.sections,
      isScanLimited: result.decoded.isScanLimited,
    };
  }

  /* "Show more": the next page of one drawer section. */
  @CaptureSpan()
  public static async getEntityConnections(
    request: TopologyEntityConnectionsRequest & TopologyProjectScope,
  ): Promise<TopologyEntityConnectionsResponseJSON> {
    const result: {
      entity: TopologyEntityDetailJSON | null;
      decoded: DecodedSections;
    } = await TopologyQueries.readEntityAndSections(
      request,
      { kind: "range", rangeStart: request.rangeStart.toISOString() },
      TopologyQueries.pageWindow(request),
    );

    return {
      ...TopologyQueries.envelope(request.rangeStart),
      section: request.section,
      connections: result.decoded.sections[request.section],
      isScanLimited: result.decoded.isScanLimited,
    };
  }

  /*
   * The inventory item page: the drawer's sections over everything the
   * inventory holds — every relationship however long ago it was seen, for
   * an item archived or not, with archived other ends named and linkable.
   */
  @CaptureSpan()
  public static async getEntityAllTime(
    request: TopologyEntityAllTimeRequest & TopologyProjectScope,
  ): Promise<TopologyEntityAllTimeResponseJSON> {
    const result: {
      entity: TopologyEntityDetailJSON | null;
      decoded: DecodedSections;
    } = await TopologyQueries.readEntityAndSections(
      request,
      { kind: "allTime" },
      TopologyQueries.firstView(),
    );

    return {
      ...TopologyQueries.allTimeEnvelope(),
      entity: result.entity,
      sections: result.decoded.sections,
      isScanLimited: result.decoded.isScanLimited,
    };
  }

  /* "Show more" on the inventory item page: one all-time section's page. */
  @CaptureSpan()
  public static async getEntityAllTimeConnections(
    request: TopologyEntityAllTimeConnectionsRequest & TopologyProjectScope,
  ): Promise<TopologyEntityAllTimeConnectionsResponseJSON> {
    const result: {
      entity: TopologyEntityDetailJSON | null;
      decoded: DecodedSections;
    } = await TopologyQueries.readEntityAndSections(
      request,
      { kind: "allTime" },
      TopologyQueries.pageWindow(request),
    );

    return {
      ...TopologyQueries.allTimeEnvelope(),
      section: request.section,
      connections: result.decoded.sections[request.section],
      isScanLimited: result.decoded.isScanLimited,
    };
  }

  /* The first view: the top rows of every section. */
  private static firstView(): TopologyEntitySectionWindow {
    return {
      kind: "top",
      dependencyRows: TopologyApiLimits.EntityDependencyRows,
      otherRows: TopologyApiLimits.EntityOtherRows,
    };
  }

  private static pageWindow(
    request: TopologyConnectionsPage,
  ): TopologyEntitySectionWindow {
    return {
      kind: "page",
      section: request.section,
      offset: request.offset,
      limit: request.limit || rowsForSection(request.section),
    };
  }

  private static async readEntityAndSections(
    request: TopologyEntityTarget & TopologyProjectScope,
    scope: TopologyEntityScope,
    window: TopologyEntitySectionWindow,
  ): Promise<{
    entity: TopologyEntityDetailJSON | null;
    decoded: DecodedSections;
  }> {
    const projectId: string = request.projectId.toString();
    const allTime: boolean = scope.kind === "allTime";

    return await TopologyQueries.inReadOnlySnapshot(
      async (
        runner: TopologyStatementRunner,
      ): Promise<{
        entity: TopologyEntityDetailJSON | null;
        decoded: DecodedSections;
      }> => {
        const nothing: DecodedSections = {
          sections: emptySections(),
          isScanLimited: false,
        };

        const projectTypes: Array<string> =
          await TopologyQueries.readProjectTypes(runner, projectId);
        if (projectTypes.length === 0) {
          return { entity: null, decoded: nothing };
        }

        const entityRows: Array<JSONObject> = await runner.query(
          entityStatement({
            projectId,
            projectTypes,
            entityKey: request.entityKey,
            entityType: request.entityType,
            includeArchived: allTime,
          }),
        );
        const entityRow: JSONObject | undefined = entityRows[0];
        if (!entityRow) {
          return { entity: null, decoded: nothing };
        }

        const entity: TopologyEntityDetailJSON = {
          ...toLeanEntity(entityRow),
          id: readString(entityRow, "id"),
          firstSeenAt: readNullableNumber(entityRow, "firstSeenAt"),
          resourceType: readNullableString(entityRow, "resourceType"),
          resourceId: readNullableString(entityRow, "resourceId"),
          identifyingAttributes: readJsonObject(
            entityRow,
            "identifyingAttributes",
          ),
          descriptiveAttributes: readJsonObject(
            entityRow,
            "descriptiveAttributes",
          ),
        };

        const sectionRows: Array<JSONObject> = await runner.query(
          entitySectionsStatement({
            projectId,
            scope,
            projectTypes,
            entityKey: entity.key,
            isService: entity.type === EntityType.Service,
            scanLimit: TopologyApiLimits.EntityConnectionScanLimit + 1,
            window,
          }),
        );

        return {
          entity,
          decoded: decodeSections(
            sectionRows,
            window.kind === "page" ? window.offset : 0,
          ),
        };
      },
    );
  }
}
