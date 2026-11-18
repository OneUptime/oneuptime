/*
 * WHAT A BI TOOL'S DASHBOARDS ARE BUILT ON, AND WHY SOME ARE TIED TO NO
 * WATCHED TABLE.
 *
 * Read from the tool with its dashboards (DataBiSync):
 *
 *  - Each dashboard's upstream (DataDashboard.upstream), where the tool says
 *    (Power BI): the datasets it charts, and where their data comes from -
 *    a database, a file, a web page, a dataflow - as the tool describes it,
 *    whether or not OneUptime watches it.
 *  - Each tool's lineage summary (DataBiConnection.lineageSummary): how
 *    many of the tables behind its dashboards matched a watched table, the
 *    data sources they read with whether each is a database OneUptime
 *    watches, and what keeps the rest off a table, worst first - so
 *    "Tables Matched: 0" says why, and what to do about it.
 *
 * Both are kept as JSON and read back through the readers below, which take
 * anything and return what fits.
 */

// The most data sources kept with one dashboard, and with one tool's summary.
export const MAX_DATA_DASHBOARD_SOURCES: number = 10;
export const MAX_DATA_DASHBOARD_DATASETS: number = 10;
export const MAX_DATA_BI_LINEAGE_SOURCES: number = 25;
export const MAX_DATA_BI_UNWATCHED_TABLES: number = 10;

const MAX_TEXT_LENGTH: number = 500;

// Where a dashboard's data comes from, as its tool describes it.
export interface DataBiSource {
  // What it is, in words: SQL Server, Snowflake, SharePoint, Excel file, Web, Dataflow...
  type: string;
  // A database's engine as OneUptime names it (sqlserver, postgresql...); null for anything else.
  engine: string | null;
  server: string | null;
  database: string | null;
  // Where it is when it is no database: a file's path, a web address, a dataflow's name.
  location: string | null;
}

// A dataset a dashboard charts (a Power BI semantic model), and where its data comes from.
export interface DataDashboardDataset {
  // Its id in the tool, in lower case: one dataset is charted by many dashboards.
  id: string | null;
  name: string;
  workspace: string | null;
  sources: Array<DataBiSource>;
}

// What a dashboard is built on, as its tool says (DataDashboard.upstream).
export interface DataDashboardUpstream {
  datasets: Array<DataDashboardDataset>;
  // Every dataset's sources together, each once.
  sources: Array<DataBiSource>;
}

export enum DataBiLineageProblem {
  // No database is connected to OneUptime, so there is no table to match.
  NoDatabases = "NoDatabases",
  // Power BI described the datasets without their tables: its detailed metadata setting is off.
  NoTablesFromTool = "NoTablesFromTool",
  // Power BI named the tables but not the queries that load them: its DAX and mashup expressions setting is off.
  NoQueriesFromTool = "NoQueriesFromTool",
  // The tables are in databases OneUptime does not watch.
  DatabasesNotConnected = "DatabasesNotConnected",
  // The tables are in watched databases, but are not among their watched tables.
  TablesNotWatched = "TablesNotWatched",
  // The datasets read from Power BI dataflows, whose own sources are not read yet.
  Dataflows = "Dataflows",
  // Power BI could not describe some datasets (real-time, Analysis Services, Excel workbooks, over 1 GB).
  SchemaErrors = "SchemaErrors",
  // The data comes from files, web pages, SharePoint and the like: no database table.
  NotDatabases = "NotDatabases",
}

export const DATA_BI_LINEAGE_PROBLEMS: ReadonlyArray<DataBiLineageProblem> =
  Object.values(DataBiLineageProblem);

// A data source of a tool's summary: how much reads it, and whether OneUptime watches it.
export interface DataBiLineageSource extends DataBiSource {
  // What reads it: datasets, for a tool with datasets (DataBiLineageSummary.datasets); dashboards otherwise.
  readerCount: number;
  // Tables read from it, and how many of them matched a watched table.
  tableCount: number;
  matchedTableCount: number;
  /*
   * The watched database it is, when it is one: by its ID only. Its name is
   * Data Security's record, which not everyone who reads the tool may read.
   */
  dataStoreId: string | null;
  /*
   * A database OneUptime could watch and does not: the kind to connect it
   * as (a DataStoreKind), and a connection string to start from, its user
   * and password placeholders.
   */
  connectKind?: string | null | undefined;
  connectionExample?: string | null | undefined;
}

// What Power BI's scan said of the datasets behind the dashboards.
export interface DataBiDatasetFacts {
  count: number;
  // Datasets whose tables it listed.
  withTables: number;
  // Datasets whose tables' queries it listed.
  withQueries: number;
  // Datasets it could not describe, and one of its reasons.
  withSchemaError: number;
  schemaError: string | null;
  // Datasets that read from dataflows.
  readingDataflows: number;
}

// Why a tool's dashboards are, or are not, tied to watched tables (DataBiConnection.lineageSummary).
export interface DataBiLineageSummary {
  dashboardCount: number;
  // Dashboards built on at least one watched table.
  dashboardsOnWatchedTables: number;
  // Distinct tables the dashboards read, and how many matched a watched table.
  tableCount: number;
  matchedTableCount: number;
  // Power BI's datasets; null for a tool with none.
  datasets: DataBiDatasetFacts | null;
  // Where the data comes from, most read first.
  sources: Array<DataBiLineageSource>;
  // Sources past those kept.
  moreSourceCount: number;
  // A few tables read from watched databases that are not watched, as database.schema.table.
  unwatchedTables: Array<string>;
  // What keeps dashboards off their tables, the most to act on first.
  problems: Array<DataBiLineageProblem>;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, MAX_TEXT_LENGTH)
    : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export function readDataBiSource(value: unknown): DataBiSource | null {
  const source: Record<string, unknown> | null = readObject(value);
  const type: string | null = readText(source?.["type"]);

  if (!source || !type) {
    return null;
  }

  return {
    type,
    engine: readText(source["engine"]),
    server: readText(source["server"]),
    database: readText(source["database"]),
    location: readText(source["location"]),
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export function readDataDashboardUpstream(
  value: unknown,
): DataDashboardUpstream | null {
  const upstream: Record<string, unknown> | null = readObject(value);

  if (!upstream) {
    return null;
  }

  return {
    datasets: readArray(upstream["datasets"])
      .map((item: unknown): DataDashboardDataset | null => {
        const dataset: Record<string, unknown> | null = readObject(item);
        const name: string | null = readText(dataset?.["name"]);

        return name
          ? {
              id: readText(dataset?.["id"])?.toLowerCase() || null,
              name,
              workspace: readText(dataset?.["workspace"]),
              sources: readArray(dataset?.["sources"])
                .map(readDataBiSource)
                .filter(isPresent)
                .slice(0, MAX_DATA_DASHBOARD_SOURCES),
            }
          : null;
      })
      .filter(isPresent)
      .slice(0, MAX_DATA_DASHBOARD_DATASETS),
    sources: readArray(upstream["sources"])
      .map(readDataBiSource)
      .filter(isPresent)
      .slice(0, MAX_DATA_DASHBOARD_SOURCES),
  };
}

function readDatasetFacts(value: unknown): DataBiDatasetFacts | null {
  const facts: Record<string, unknown> | null = readObject(value);

  if (!facts) {
    return null;
  }

  return {
    count: readCount(facts["count"]),
    withTables: readCount(facts["withTables"]),
    withQueries: readCount(facts["withQueries"]),
    withSchemaError: readCount(facts["withSchemaError"]),
    schemaError: readText(facts["schemaError"]),
    readingDataflows: readCount(facts["readingDataflows"]),
  };
}

export function readDataBiLineageSummary(
  value: unknown,
): DataBiLineageSummary | null {
  const summary: Record<string, unknown> | null = readObject(value);

  if (!summary) {
    return null;
  }

  return {
    dashboardCount: readCount(summary["dashboardCount"]),
    dashboardsOnWatchedTables: readCount(summary["dashboardsOnWatchedTables"]),
    tableCount: readCount(summary["tableCount"]),
    matchedTableCount: readCount(summary["matchedTableCount"]),
    datasets: readDatasetFacts(summary["datasets"]),
    sources: readArray(summary["sources"])
      .map((item: unknown): DataBiLineageSource | null => {
        const source: DataBiSource | null = readDataBiSource(item);
        const fields: Record<string, unknown> | null = readObject(item);

        return source && fields
          ? {
              ...source,
              readerCount: readCount(fields["readerCount"]),
              tableCount: readCount(fields["tableCount"]),
              matchedTableCount: readCount(fields["matchedTableCount"]),
              dataStoreId: readText(fields["dataStoreId"]),
              connectKind: readText(fields["connectKind"]),
              connectionExample: readText(fields["connectionExample"]),
            }
          : null;
      })
      .filter(isPresent)
      .slice(0, MAX_DATA_BI_LINEAGE_SOURCES),
    moreSourceCount: readCount(summary["moreSourceCount"]),
    unwatchedTables: readArray(summary["unwatchedTables"])
      .map(readText)
      .filter(isPresent)
      .slice(0, MAX_DATA_BI_UNWATCHED_TABLES),
    problems: readArray(summary["problems"]).filter(
      (problem: unknown): problem is DataBiLineageProblem => {
        return (DATA_BI_LINEAGE_PROBLEMS as ReadonlyArray<unknown>).includes(
          problem,
        );
      },
    ),
  };
}

/*
 * A source in a few words: a database as server / database, anything else
 * by where it is. "sql01.acme.com / Sales", "https://acme.sharepoint.com/
 * sites/ops", "Sales Dataflow".
 */
export function getDataBiSourceName(source: DataBiSource): string {
  const database: string = [source.server, source.database]
    .filter(Boolean)
    .join(" / ");

  return database || source.location || source.type;
}

// Whether a source is a database OneUptime could watch: one it names an engine of.
export function isDataBiDatabaseSource(source: DataBiSource): boolean {
  return Boolean(source.engine);
}

/*
 * Whether a tool's dashboards were read but are on no watched table, for a
 * reason its summary names: what the Lineage Map tells of when it cannot
 * draw them on tables.
 */
export function isDataBiToolOffTables(data: {
  dashboardCount?: number | null | undefined;
  matchedTableCount?: number | null | undefined;
  summary: DataBiLineageSummary | null;
}): boolean {
  return (
    (data.dashboardCount || 0) > 0 &&
    (data.matchedTableCount || 0) === 0 &&
    Boolean(data.summary && data.summary.problems.length > 0)
  );
}
