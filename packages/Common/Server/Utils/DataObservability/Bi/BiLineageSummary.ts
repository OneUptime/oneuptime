import {
  DataBiDatasetFacts,
  DataBiLineageProblem,
  DataBiLineageSource,
  DataBiLineageSummary,
  DataBiSource,
  getDataBiSourceName,
  MAX_DATA_BI_LINEAGE_SOURCES,
  MAX_DATA_BI_UNWATCHED_TABLES,
} from "../../../../Types/DataObservability/DataBiLineage";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { getCollectorEngineOfKind } from "../DataObservabilityEngines";
import { buildConnectionExample } from "../DataSourceSuggestions";
import { UsageAsset, UsageStore } from "../TableUsageMatching";
import {
  BiCatalog,
  isSameBiHost,
  matchBiTable,
  readBiHost,
} from "./BiMatching";
import { BiSourceRead, collectBiSources } from "./BiSources";
import { BiTableRef, getBiTableKey, getBiTableName } from "./BiTables";

/*
 * WHY A BI TOOL'S DASHBOARDS ARE, OR ARE NOT, TIED TO WATCHED TABLES.
 *
 * "Tables Matched: 0" says nothing a person can act on. After each read
 * (DataBiSync) the tool keeps what the read found (DataBiLineageSummary):
 *
 *  - The tables its dashboards read, and how many matched a watched table.
 *  - Where the data comes from, most read first: each data source with
 *    the watched database it is, where it is one, and how many of its
 *    tables matched.
 *  - What keeps the rest off a table, the most to act on first: no
 *    database connected; Power BI describing its datasets without their
 *    tables (a tenant setting) or without the queries behind them (the
 *    other); databases OneUptime does not watch; tables a watched
 *    database does not watch; dataflows; datasets Power BI could not
 *    describe; files and web pages, which are no database's tables.
 *
 * A source is a watched database when one of the project's databases is
 * the same engine and, where both name one, the same database; a server
 * narrows between several, as a table's matching does (BiMatching).
 */

export interface BiDashboardTables {
  tables: Array<BiTableRef>;
}

function lower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isSameEngine(a: string, b: string): boolean {
  const alike: (engine: string) => string = (engine: string): string => {
    return engine === "redshift" ? "postgresql" : engine;
  };

  return alike(a) === alike(b);
}

// Each engine OneUptime watches, as the kind a database of it is connected as.
const KIND_OF_ENGINE: Readonly<Record<string, DataStoreKind>> = {
  sqlserver: DataStoreKind.SqlServer,
  postgresql: DataStoreKind.PostgreSql,
  mysql: DataStoreKind.MySql,
  redshift: DataStoreKind.AwsRedshiftCluster,
  snowflake: DataStoreKind.Snowflake,
  bigquery: DataStoreKind.GcpBigQueryDataset,
  clickhouse: DataStoreKind.ClickHouse,
  databricks: DataStoreKind.Databricks,
  athena: DataStoreKind.AwsAthena,
  oracle: DataStoreKind.Oracle,
  mongodb: DataStoreKind.MongoDb,
  dataverse: DataStoreKind.Dataverse,
};

const PORT: RegExp = /[:,](\d{2,5})(?:$|[/\\;])/;

/*
 * How to connect a database OneUptime does not watch yet: the kind it is,
 * and a connection string to start from, with its user and password
 * placeholders. Nothing for a source that is no database.
 */
export function getConnectHint(source: DataBiSource): {
  connectKind: string | null;
  connectionExample: string | null;
} {
  const kind: DataStoreKind | undefined = source.engine
    ? KIND_OF_ENGINE[source.engine]
    : undefined;

  if (!kind) {
    return { connectKind: null, connectionExample: null };
  }

  const host: string = readBiHost(source.server);
  const port: RegExpMatchArray | null = (source.server || "").match(PORT);

  return {
    connectKind: kind,
    connectionExample: buildConnectionExample({
      kind,
      host: host || null,
      port: port ? Number(port[1]) : null,
      databaseName: source.database,
    }),
  };
}

// The project's database a source is, where it is one OneUptime watches.
export function findBiSourceStore(
  source: DataBiSource,
  stores: Array<UsageStore>,
): UsageStore | null {
  if (!source.engine) {
    return null;
  }

  let candidates: Array<UsageStore> = stores.filter((store: UsageStore) => {
    const engine: string | null = getCollectorEngineOfKind(store.kind);

    return Boolean(engine) && isSameEngine(engine!, source.engine!);
  });

  if (source.database) {
    candidates = candidates.filter((store: UsageStore) => {
      return (
        !store.databaseName ||
        lower(store.databaseName) === lower(source.database)
      );
    });

    // A store named for the database is the one, over a store that names none.
    const named: Array<UsageStore> = candidates.filter((store: UsageStore) => {
      return lower(store.databaseName) === lower(source.database);
    });

    if (named.length > 0) {
      candidates = named;
    }
  }

  if (candidates.length > 1 && source.server) {
    const onServer: Array<UsageStore> = candidates.filter(
      (store: UsageStore) => {
        return isSameBiHost(store.serverAddress, source.server);
      },
    );

    if (onServer.length > 0) {
      candidates = onServer;
    }
  }

  return candidates.length === 1 ? candidates[0]! : null;
}

// What keeps dashboards off their tables, the most to act on first.
export function getBiLineageProblems(data: {
  dashboardCount: number;
  storeCount: number;
  datasets: DataBiDatasetFacts | null;
  sources: Array<DataBiLineageSource>;
  unwatchedTableCount: number;
}): Array<DataBiLineageProblem> {
  const problems: Array<DataBiLineageProblem> = [];
  const datasets: DataBiDatasetFacts | null = data.datasets;

  if (data.dashboardCount === 0) {
    return problems;
  }

  if (data.storeCount === 0) {
    problems.push(DataBiLineageProblem.NoDatabases);
  }

  if (
    datasets &&
    datasets.count > 0 &&
    datasets.withTables === 0 &&
    datasets.withSchemaError < datasets.count
  ) {
    problems.push(DataBiLineageProblem.NoTablesFromTool);
  } else if (
    datasets &&
    datasets.withTables > 0 &&
    datasets.withQueries === 0
  ) {
    problems.push(DataBiLineageProblem.NoQueriesFromTool);
  }

  if (
    data.storeCount > 0 &&
    data.sources.some((source: DataBiLineageSource): boolean => {
      return Boolean(source.engine) && !source.dataStoreId;
    })
  ) {
    problems.push(DataBiLineageProblem.DatabasesNotConnected);
  }

  if (data.unwatchedTableCount > 0) {
    problems.push(DataBiLineageProblem.TablesNotWatched);
  }

  if (datasets && datasets.readingDataflows > 0) {
    problems.push(DataBiLineageProblem.Dataflows);
  }

  if (datasets && datasets.withSchemaError > 0) {
    problems.push(DataBiLineageProblem.SchemaErrors);
  }

  if (
    data.sources.some((source: DataBiLineageSource): boolean => {
      return !source.engine && source.type !== "Dataflow";
    })
  ) {
    problems.push(DataBiLineageProblem.NotDatabases);
  }

  return problems;
}

export function summarizeBiLineage(data: {
  dashboards: Array<BiDashboardTables>;
  // The watched tables and databases, never their names: a database is named by its ID only.
  catalog: BiCatalog;
  /*
   * Where the data comes from, as the tool says (Power BI's datasets);
   * left out, each dashboard's tables' databases are its sources.
   */
  sources?: Array<BiSourceRead> | undefined;
  datasets?: DataBiDatasetFacts | null | undefined;
}): DataBiLineageSummary {
  const matches: Map<string, UsageAsset | null> = new Map();
  const matchOf: (ref: BiTableRef) => UsageAsset | null = (
    ref: BiTableRef,
  ): UsageAsset | null => {
    const key: string = getBiTableKey(ref);

    if (!matches.has(key)) {
      matches.set(key, matchBiTable(ref, data.catalog));
    }

    return matches.get(key) || null;
  };
  const matchedAssets: Set<string> = new Set();
  let dashboardsOnWatchedTables: number = 0;

  for (const dashboard of data.dashboards) {
    let isOnWatchedTable: boolean = false;

    for (const ref of dashboard.tables) {
      const asset: UsageAsset | null = matchOf(ref);

      if (asset) {
        matchedAssets.add(asset.dataAssetId);
        isOnWatchedTable = true;
      }
    }

    if (isOnWatchedTable) {
      dashboardsOnWatchedTables++;
    }
  }

  const reads: Array<BiSourceRead> =
    data.sources ||
    collectBiSources(
      data.dashboards.map((dashboard: BiDashboardTables) => {
        return { sources: [], tables: dashboard.tables };
      }),
    );
  const unwatched: Array<string> = [];
  const sources: Array<DataBiLineageSource> = reads
    .map((read: BiSourceRead): DataBiLineageSource => {
      const store: UsageStore | null = findBiSourceStore(
        read.source,
        data.catalog.stores,
      );
      const matched: Set<string> = new Set();

      for (const ref of read.tables) {
        const asset: UsageAsset | null = matchOf(ref);

        if (asset) {
          matched.add(asset.dataAssetId);
        } else if (store) {
          unwatched.push(getBiTableName(ref));
        }
      }

      return {
        ...read.source,
        readerCount: read.readerCount,
        tableCount: read.tables.length,
        matchedTableCount: matched.size,
        dataStoreId: store?.dataStoreId || null,
        // Watched already: nothing to connect.
        ...(store
          ? { connectKind: null, connectionExample: null }
          : getConnectHint(read.source)),
      };
    })
    .sort((a: DataBiLineageSource, b: DataBiLineageSource): number => {
      return (
        b.readerCount - a.readerCount ||
        b.tableCount - a.tableCount ||
        getDataBiSourceName(a).localeCompare(getDataBiSourceName(b))
      );
    });
  const datasets: DataBiDatasetFacts | null = data.datasets || null;

  return {
    dashboardCount: data.dashboards.length,
    dashboardsOnWatchedTables,
    tableCount: matches.size,
    matchedTableCount: matchedAssets.size,
    datasets,
    sources: sources.slice(0, MAX_DATA_BI_LINEAGE_SOURCES),
    moreSourceCount: Math.max(0, sources.length - MAX_DATA_BI_LINEAGE_SOURCES),
    unwatchedTables: Array.from(new Set(unwatched)).slice(
      0,
      MAX_DATA_BI_UNWATCHED_TABLES,
    ),
    problems: getBiLineageProblems({
      dashboardCount: data.dashboards.length,
      storeCount: data.catalog.stores.length,
      datasets,
      sources,
      unwatchedTableCount: unwatched.length,
    }),
  };
}
