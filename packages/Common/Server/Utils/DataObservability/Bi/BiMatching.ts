import { BiTableRef, getBiTableKey } from "./BiTables";
import { getCollectorEngineOfKind } from "../DataObservabilityEngines";
import { ProjectCatalog } from "../OpenLineageIngest";
import { UsageAsset, UsageStore } from "../TableUsageMatching";

/*
 * WHICH WATCHED TABLE A BI TOOL'S TABLE IS.
 *
 * A tool names a table by its database, schema and name, and sometimes its
 * engine and host. A table is matched by its name, narrowed by its schema,
 * then by its database's name, then by its host, until one watched table
 * is left; a name that still fits several is left unmatched, so no
 * dashboard is tied to the wrong table. MySQL and ClickHouse keep a
 * table's database as its schema, so a database name can stand for the
 * schema there.
 *
 * Two things rule a watched table out whatever else fits:
 *
 *  - Its database is another engine: a Snowflake table is never a
 *    PostgreSQL one (PostgreSQL and Redshift are read alike).
 *  - Its database is another database, where the tool names the database
 *    exactly (Power BI's queries name it as its server does): a report on
 *    Sales.dbo.Orders is not tied to Archive.dbo.Orders just because only
 *    Archive is watched. A tool that names a database by its connection's
 *    label (Metabase, Superset) only narrows by it.
 *
 * A host is compared as a server names it, without its port, protocol or
 * instance, and a short name (sql01) is the same server as its full one
 * (sql01.corp.acme.com).
 *
 * A Dataverse table named by its entity set (accounts), as Power BI's OData
 * connectors name it, is the watched table whose collection keeps that
 * entity set name (account, #9696) - in the environment at the host the
 * connector named, never another's - whether OneUptime or a probe collects
 * it. With no such name kept, it matches nothing: an entity set's name is
 * not a table's. An environment whose tables keep no entity set name at
 * all - a probe older than these names collects it, or it has not been
 * collected since - is told apart (isEntitySetUnknown), so the tool says
 * why its tables do not match rather than that they are not watched.
 *
 * A project's catalog is indexed by table name once, and each table is
 * matched once per catalog, however many dashboards read it.
 */

export type BiCatalog = Pick<ProjectCatalog, "stores" | "assets">;

interface BiCatalogIndex {
  byName: Map<string, Array<UsageAsset>>;
  // Each Dataverse table by its entity set name, in lower case.
  byEntitySet: Map<string, Array<UsageAsset>>;
  // The stores whose tables keep an entity set name: those collected since names were kept.
  storesNamingEntitySets: Set<string>;
  storesById: Map<string, UsageStore>;
  matches: Map<string, UsageAsset | null>;
}

const INDEXES: WeakMap<BiCatalog, BiCatalogIndex> = new WeakMap();

// Engines whose databases a server names: what an exact database is compared with.
const DATABASE_NAMED_ENGINES: ReadonlySet<string> = new Set([
  "sqlserver",
  "postgresql",
  "mysql",
  "redshift",
  "snowflake",
  "bigquery",
  "databricks",
]);

// Each engine as tools name it, by its letters in lower case, to OneUptime's.
const ENGINE_NAMES: ReadonlyMap<string, string> = new Map([
  ["postgres", "postgresql"],
  ["postgresql", "postgresql"],
  ["postgis", "postgresql"],
  ["pgsql", "postgresql"],
  ["mysql", "mysql"],
  ["mariadb", "mysql"],
  ["sqlserver", "sqlserver"],
  ["mssql", "sqlserver"],
  ["azuresql", "sqlserver"],
  ["azuresqldb", "sqlserver"],
  ["azuresqldw", "sqlserver"],
  ["synapse", "sqlserver"],
  ["redshift", "redshift"],
  ["snowflake", "snowflake"],
  ["bigquery", "bigquery"],
  ["bigquerycloudsdk", "bigquery"],
  ["googlebigquery", "bigquery"],
  ["clickhouse", "clickhouse"],
  ["clickhouseconnect", "clickhouse"],
  ["databricks", "databricks"],
  ["databrickssql", "databricks"],
  ["athena", "athena"],
  ["awsathena", "athena"],
  ["oracle", "oracle"],
  ["mongo", "mongodb"],
  ["mongodb", "mongodb"],
  ["dataverse", "dataverse"],
]);

// Engines read alike: Redshift speaks PostgreSQL, and is read through its connector too.
const ALIKE_ENGINES: ReadonlyMap<string, string> = new Map([
  ["redshift", "postgresql"],
]);

// Where a table is looked for when the tool names no schema: the engine's default one.
const DEFAULT_SCHEMAS: Readonly<Record<string, string>> = {
  sqlserver: "dbo",
  postgresql: "public",
  redshift: "public",
};

const IP_ADDRESS: RegExp = /^\d+\.\d+\.\d+\.\d+$/;

function lower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

// An engine as OneUptime names it, when it is one it knows; null otherwise.
export function readBiEngine(value: string | null | undefined): string | null {
  return ENGINE_NAMES.get(lower(value).replace(/[^a-z0-9]/g, "")) || null;
}

function isSameEngine(a: string, b: string): boolean {
  return (ALIKE_ENGINES.get(a) || a) === (ALIKE_ENGINES.get(b) || b);
}

/*
 * A server as one name: no scheme, protocol (tcp:), path, instance
 * (\SQLEXPRESS) or port (:5432, ,1433), in lower case.
 */
export function readBiHost(value: string | null | undefined): string {
  return lower(value)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^(?:tcp|np|lpc|admin):/, "")
    .split("/")[0]!
    .split("\\")[0]!
    .split(";")[0]!
    .replace(/,\d+$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
}

// Whether two names are one server: the same name, or a short name and its full one.
export function isSameBiHost(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const first: string = readBiHost(a);
  const second: string = readBiHost(b);

  if (!first || !second) {
    return false;
  }

  if (first === second) {
    return true;
  }

  const isIp: (host: string) => boolean = (host: string): boolean => {
    return IP_ADDRESS.test(host);
  };

  return (
    !isIp(first) &&
    !isIp(second) &&
    (!first.includes(".") || !second.includes(".")) &&
    first.split(".")[0] === second.split(".")[0]
  );
}

function indexOf(catalog: BiCatalog): BiCatalogIndex {
  const known: BiCatalogIndex | undefined = INDEXES.get(catalog);

  if (known) {
    return known;
  }

  const byName: Map<string, Array<UsageAsset>> = new Map();
  const byEntitySet: Map<string, Array<UsageAsset>> = new Map();
  const storesNamingEntitySets: Set<string> = new Set();

  for (const asset of catalog.assets) {
    const name: string = lower(asset.name);
    const list: Array<UsageAsset> = byName.get(name) || [];

    list.push(asset);
    byName.set(name, list);

    const entitySet: string = lower(asset.entitySetName);

    if (entitySet) {
      byEntitySet.set(entitySet, [
        ...(byEntitySet.get(entitySet) || []),
        asset,
      ]);
      storesNamingEntitySets.add(asset.dataStoreId);
    }
  }

  const index: BiCatalogIndex = {
    byName,
    byEntitySet,
    storesNamingEntitySets,
    storesById: new Map(
      catalog.stores.map((store: UsageStore): [string, UsageStore] => {
        return [store.dataStoreId, store];
      }),
    ),
    matches: new Map(),
  };

  INDEXES.set(catalog, index);

  return index;
}

// Keeps the candidates that pass, where any do; otherwise all of them.
function narrow(
  candidates: Array<UsageAsset>,
  keep: (asset: UsageAsset) => boolean,
): Array<UsageAsset> {
  const kept: Array<UsageAsset> = candidates.filter(keep);

  return kept.length > 0 ? kept : candidates;
}

// The watched Dataverse environments at the host a connector named.
function entitySetStoresOf(
  ref: BiTableRef,
  index: BiCatalogIndex,
): Array<UsageStore> {
  return Array.from(index.storesById.values()).filter(
    (store: UsageStore): boolean => {
      return (
        getCollectorEngineOfKind(store.kind) === "dataverse" &&
        isSameBiHost(store.serverAddress, ref.host)
      );
    },
  );
}

/*
 * A Dataverse entity set's table: in each watched environment at the host
 * the connector named, the table whose collection keeps that entity set
 * name - one in all, or none.
 */
function findEntitySetMatch(
  ref: BiTableRef,
  index: BiCatalogIndex,
): UsageAsset | null {
  const entitySet: string = lower(ref.table);

  if (!entitySet || !ref.host) {
    return null;
  }

  const stores: Set<string> = new Set(
    entitySetStoresOf(ref, index).map((store: UsageStore): string => {
      return store.dataStoreId;
    }),
  );
  const found: Array<UsageAsset> = (
    index.byEntitySet.get(entitySet) || []
  ).filter((asset: UsageAsset): boolean => {
    return stores.has(asset.dataStoreId);
  });

  return found.length === 1 ? found[0]! : null;
}

/*
 * Whether a table named by its Dataverse entity set cannot be matched yet
 * because the environment at its host keeps no entity set name at all: a
 * probe older than these names collects it, or it has not been collected
 * since (#9696). False for an environment that keeps them - a table it
 * does not name is one it does not watch - and where none is watched.
 */
export function isEntitySetUnknown(
  ref: BiTableRef,
  catalog: BiCatalog,
): boolean {
  if (!ref.isEntitySet || !ref.host || !ref.table) {
    return false;
  }

  const index: BiCatalogIndex = indexOf(catalog);
  const stores: Array<UsageStore> = entitySetStoresOf(ref, index);

  return (
    stores.length > 0 &&
    stores.every((store: UsageStore): boolean => {
      return !index.storesNamingEntitySets.has(store.dataStoreId);
    })
  );
}

function findMatch(ref: BiTableRef, index: BiCatalogIndex): UsageAsset | null {
  const table: string = lower(ref.table);

  if (!table) {
    return null;
  }

  if (ref.isEntitySet) {
    return findEntitySetMatch(ref, index);
  }

  const storeOf: (asset: UsageAsset) => UsageStore | undefined = (
    asset: UsageAsset,
  ): UsageStore | undefined => {
    return index.storesById.get(asset.dataStoreId);
  };
  let candidates: Array<UsageAsset> = index.byName.get(table) || [];
  const schema: string = lower(ref.schema);
  const database: string = lower(ref.database);
  const engine: string | null = readBiEngine(ref.engine);

  if (schema) {
    candidates = candidates.filter((asset: UsageAsset) => {
      return lower(asset.schemaName) === schema;
    });
  } else if (database) {
    // A MySQL or ClickHouse table's schema is its database.
    candidates = narrow(candidates, (asset: UsageAsset) => {
      return lower(asset.schemaName) === database;
    });
  }

  // Another engine's table is never this one.
  if (engine) {
    candidates = candidates.filter((asset: UsageAsset) => {
      const storeEngine: string | null = getCollectorEngineOfKind(
        storeOf(asset)?.kind,
      );

      return !storeEngine || isSameEngine(storeEngine, engine);
    });
  }

  // Nor is another database's, where the tool names the database exactly.
  if (
    database &&
    ref.isDatabaseExact &&
    engine &&
    DATABASE_NAMED_ENGINES.has(engine)
  ) {
    candidates = candidates.filter((asset: UsageAsset) => {
      const storeDatabase: string = lower(storeOf(asset)?.databaseName);

      return !storeDatabase || storeDatabase === database;
    });
  }

  if (candidates.length > 1 && database) {
    candidates = narrow(candidates, (asset: UsageAsset) => {
      return lower(storeOf(asset)?.databaseName) === database;
    });
  }

  if (candidates.length > 1 && ref.host) {
    candidates = narrow(candidates, (asset: UsageAsset) => {
      return isSameBiHost(storeOf(asset)?.serverAddress, ref.host);
    });
  }

  // No schema named: the engine's default schema, as the database itself would read it.
  if (candidates.length > 1 && !schema && engine && DEFAULT_SCHEMAS[engine]) {
    candidates = narrow(candidates, (asset: UsageAsset) => {
      return lower(asset.schemaName) === DEFAULT_SCHEMAS[engine];
    });
  }

  return candidates.length === 1 ? candidates[0]! : null;
}

export function matchBiTable(
  ref: BiTableRef,
  catalog: BiCatalog,
): UsageAsset | null {
  const index: BiCatalogIndex = indexOf(catalog);
  const key: string = [
    getBiTableKey(ref),
    lower(ref.engine),
    lower(ref.host),
    ref.isDatabaseExact ? "exact" : "",
  ].join("\u0001");

  if (!index.matches.has(key)) {
    index.matches.set(key, findMatch(ref, index));
  }

  return index.matches.get(key) || null;
}

// The watched tables behind a dashboard, each once.
export function matchBiTables(
  refs: Array<BiTableRef>,
  catalog: BiCatalog,
): Array<UsageAsset> {
  const matched: Map<string, UsageAsset> = new Map();

  for (const ref of refs) {
    const asset: UsageAsset | null = matchBiTable(ref, catalog);

    if (asset) {
      matched.set(asset.dataAssetId, asset);
    }
  }

  return Array.from(matched.values());
}
