import {
  DataBiDatasetFacts,
  DataBiSource,
  DataDashboardDataset,
  MAX_DATA_DASHBOARD_DATASETS,
  MAX_DATA_DASHBOARD_SOURCES,
} from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import { isCollectorEngine } from "../DataObservabilityEngines";
import { BiTableRef, uniqueTables } from "./BiTables";
import { readPowerQueryDataset, PowerQueryRead } from "./PowerQuery";

/*
 * WHAT POWER BI'S WORKSPACE SCAN SAYS: EACH DATASET'S TABLES AND DATA
 * SOURCES, AND WHAT EACH REPORT AND DASHBOARD IS BUILT ON.
 *
 * The scan (admin/workspaces/getInfo with lineage, datasourceDetails,
 * datasetSchema and datasetExpressions) returns, per workspace, its
 * datasets, reports and dashboards, and, per scan, the data sources they
 * use:
 *
 *  - A dataset's tables, each with its Power Query source expressions, and
 *    the dataset's shared expressions (staging queries and parameters):
 *    the tables it reads (PowerQuery). Power BI returns them only while
 *    two tenant settings are on - Enhance admin APIs responses with
 *    detailed metadata, and with DAX and mashup expressions - and only for
 *    datasets refreshed or republished since; one it cannot describe says
 *    why in schemaRetrievalError.
 *  - A composite model's upstreamDatasets: the datasets it is built on, whose
 *    tables it charts too.
 *  - Its datasourceUsages, each a data source of the scan's
 *    datasourceInstances - a server and database, a file's path, a web
 *    address - and its upstreamDataflows. These need neither setting, so
 *    where a dataset is from is known even when its tables are not.
 *  - A report charts its dataset, and a dashboard its tiles' datasets.
 *
 * What is kept of a data source is where it is, never how to get in: a web
 * address without its query string, and no connection string.
 */

export interface PowerBiDataset {
  datasetId: string;
  name: string;
  workspaceId: string;
  // Its workspace's name.
  workspace: string | null;
  onCapacity: boolean;
  // The tables it reads, its upstream datasets' included.
  tables: Array<BiTableRef>;
  // Where its data comes from.
  sources: Array<DataBiSource>;
  // Whether the scan listed its tables, and the queries behind them.
  hasTables: boolean;
  hasQueries: boolean;
  schemaError: string | null;
  readsDataflows: boolean;
}

export interface PowerBiItem {
  externalId: string;
  name: string;
  url: string;
  folder: string | null;
  owner: string | null;
  changedAt: Date | null;
  // The datasets it charts, by id in lower case.
  datasetIds: Array<string>;
}

export interface PowerBiScanRead {
  // Every dataset scanned, by its id in lower case: a report's dataset can be in another workspace.
  datasets: Map<string, PowerBiDataset>;
  items: Array<PowerBiItem>;
}

const MAX_TEXT_LENGTH: number = 240;
const MAX_LOCATION_LENGTH: number = 400;
const MAX_ID_LENGTH: number = 100;
const MAX_EXPRESSION_LENGTH: number = 100_000;
// How many datasets deep a composite model's upstream datasets are followed.
const MAX_UPSTREAM_DEPTH: number = 5;

const URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;
// A connection string's key=value; pairs: never kept as a location.
const CONNECTION_STRING: RegExp = /[;=]/;
const EXCEL_FILE: RegExp = /\.(xlsx|xlsm|xlsb|xls)$/;
const CSV_FILE: RegExp = /\.csv$/;
const SHAREPOINT_ADDRESS: RegExp = /\.sharepoint\.com/i;

function readText(value: unknown, maxLength: number = MAX_TEXT_LENGTH): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().slice(0, maxLength)
    : "";
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function idOf(value: unknown): string {
  return readText(value, MAX_ID_LENGTH).toLowerCase();
}

// Scan fields are camelCase, a few PascalCase (ContentProviderType, UpstreamDataflows).
function field(object: JSONObject, name: string): unknown {
  return object[name] ?? object[name.charAt(0).toUpperCase() + name.slice(1)];
}

/*
 * Where a file or a web page is, without what could get anyone in: a URL
 * keeps its scheme, host and path, never its user, query string or hash.
 */
export function readSafeLocation(value: unknown): string | null {
  const text: string = readText(value, 2_000);

  if (!text) {
    return null;
  }

  if (URL_SCHEME.test(text)) {
    try {
      const url: URL = new URL(text);

      return `${url.protocol}//${url.host}${url.pathname}`
        .replace(/\/+$/, "")
        .slice(0, MAX_LOCATION_LENGTH);
    } catch {
      return null;
    }
  }

  // A connection string is no location.
  return CONNECTION_STRING.test(text)
    ? null
    : text.slice(0, MAX_LOCATION_LENGTH);
}

// What an engine is called, as a data source's type.
const ENGINE_TYPES: Readonly<Record<string, string>> = {
  sqlserver: "SQL Server",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  oracle: "Oracle",
  redshift: "Amazon Redshift",
  snowflake: "Snowflake",
  bigquery: "Google BigQuery",
  databricks: "Databricks",
  athena: "Amazon Athena",
  dataverse: "Microsoft Dataverse",
  teradata: "Teradata",
  db2: "IBM Db2",
  sybase: "Sybase",
  saphana: "SAP HANA",
  informix: "Informix",
  vertica: "Vertica",
  impala: "Impala",
};

function database(
  engine: string,
  server: string | null,
  databaseName: string | null,
): DataBiSource {
  return {
    type: ENGINE_TYPES[engine] || engine,
    // Only an engine OneUptime can watch: a Teradata database is a source it cannot.
    engine: isCollectorEngine(engine) ? engine : null,
    server: server || null,
    database: databaseName || null,
    location: null,
  };
}

function elsewhere(type: string, location: string | null): DataBiSource {
  return { type, engine: null, server: null, database: null, location };
}

// An Extension data source's kind, as the engine it is.
const EXTENSION_ENGINES: Readonly<Record<string, string>> = {
  snowflake: "snowflake",
  googlebigquery: "bigquery",
  googlebigqueryaad: "bigquery",
  databricks: "databricks",
  azuredatabricks: "databricks",
  databricksmulticloud: "databricks",
  amazonredshift: "redshift",
  amazonathena: "athena",
  commondataservice: "dataverse",
  dataverse: "dataverse",
};

/*
 * A data source of the scan (datasourceInstances): a database by its
 * engine, server and database; anything else by its type and where it is.
 */
export function readPowerBiDatasource(value: unknown): DataBiSource | null {
  const datasource: JSONObject = readObject(value);
  const type: string = readText(datasource["datasourceType"]);
  const details: JSONObject = readObject(datasource["connectionDetails"]);
  const server: string = readText(details["server"]);
  const databaseName: string = readText(details["database"]);
  const url: string | null = readSafeLocation(details["url"]);
  const path: string | null = readSafeLocation(details["path"]);

  if (!type) {
    return null;
  }

  switch (type.toLowerCase()) {
    case "sql":
      return database("sqlserver", server, databaseName);
    case "postgresql":
      return database("postgresql", server, databaseName);
    case "mysql":
      return database("mysql", server, databaseName);
    case "oracle":
      return database("oracle", server, databaseName);
    case "teradata":
      return database("teradata", server, databaseName);
    case "db2":
      return database("db2", server, databaseName);
    case "saphana":
      return database("saphana", server, databaseName);
    case "sybase":
      return database("sybase", server, databaseName);
    case "analysisservices":
      return server.toLowerCase().startsWith("powerbi://")
        ? elsewhere(
            "Power BI semantic model",
            [readSafeLocation(server), databaseName]
              .filter(Boolean)
              .join(" / ") || null,
          )
        : elsewhere(
            "Analysis Services",
            [server, databaseName].filter(Boolean).join(" / ") || null,
          );
    case "extension": {
      const kind: string = readText(details["kind"]);
      const engine: string | undefined = EXTENSION_ENGINES[kind.toLowerCase()];
      // An extension's path is its own: "account.snowflakecomputing.com;WAREHOUSE".
      const rawPath: string = readText(details["path"], 2_000);

      if (engine) {
        const [host, second] = rawPath.split(";");

        return database(
          engine,
          // BigQuery's path is a billing project, not a server.
          engine === "bigquery" ? null : readText(host) || null,
          engine === "redshift" ? readText(second) || null : null,
        );
      }

      if (kind.toLowerCase().includes("dataflow")) {
        return elsewhere("Dataflow", null);
      }

      return elsewhere(kind || type, readSafeLocation(rawPath.split(";")[0]));
    }
    case "file": {
      const lower: string = (path || "").toLowerCase();

      return elsewhere(
        EXCEL_FILE.test(lower)
          ? "Excel file"
          : CSV_FILE.test(lower)
            ? "CSV file"
            : "File",
        path,
      );
    }
    case "folder":
      return elsewhere("Folder", path);
    case "sharepointlist":
    case "sharepoint":
      return elsewhere("SharePoint", url || path);
    case "web":
      return elsewhere(
        url && SHAREPOINT_ADDRESS.test(url) ? "SharePoint" : "Web",
        url,
      );
    case "odata":
      return elsewhere("OData feed", url);
    case "azureblobs":
      return elsewhere(
        "Azure Blob Storage",
        [readText(details["account"]), readText(details["domain"])]
          .filter(Boolean)
          .join(".") || null,
      );
    case "azuredatalakestorage":
      return elsewhere(
        "Azure Data Lake Storage",
        url || path || server || null,
      );
    case "commondataservice":
    case "dataverse":
      return database("dataverse", server || url, null);
    default:
      return elsewhere(type, url || path);
  }
}

function sourceKey(source: DataBiSource): string {
  return [
    source.type,
    source.engine,
    source.server,
    source.database,
    source.location,
  ]
    .map((part: string | null): string => {
      return (part || "").toLowerCase();
    })
    .join("\u0000");
}

// Each source once.
export function uniqueSources(
  sources: Array<DataBiSource>,
): Array<DataBiSource> {
  const seen: Set<string> = new Set();

  return sources.filter((source: DataBiSource): boolean => {
    const key: string = sourceKey(source);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

interface ScannedDataset {
  dataset: PowerBiDataset;
  upstreamIds: Array<string>;
}

// The scan's results read: every dataset with its tables and data sources, and every report and dashboard.
export function readPowerBiScan(
  results: Array<JSONObject>,
  maxItems: number,
): PowerBiScanRead {
  const instances: Map<string, DataBiSource> = new Map();
  const workspaces: Array<JSONObject> = [];

  for (const result of results) {
    for (const instance of [
      ...readArray(result["datasourceInstances"]),
      ...readArray(result["misconfiguredDatasourceInstances"]),
    ]) {
      const id: string = idOf(readObject(instance)["datasourceId"]);
      const source: DataBiSource | null = readPowerBiDatasource(instance);

      if (id && source) {
        instances.set(id, source);
      }
    }

    workspaces.push(...readArray(result["workspaces"]).map(readObject));
  }

  // Every dataflow, by its id, as the dataset reading it names it.
  const dataflows: Map<string, string> = new Map();

  for (const workspace of workspaces) {
    for (const value of readArray(workspace["dataflows"])) {
      const dataflow: JSONObject = readObject(value);
      const id: string = idOf(dataflow["objectId"]);

      if (id) {
        dataflows.set(id, readText(dataflow["name"]) || id);
      }
    }
  }

  const scanned: Map<string, ScannedDataset> = new Map();

  for (const workspace of workspaces) {
    const workspaceId: string = readText(workspace["id"], MAX_ID_LENGTH);

    for (const value of readArray(workspace["datasets"])) {
      const dataset: JSONObject = readObject(value);
      const datasetId: string = readText(dataset["id"], MAX_ID_LENGTH);

      if (!datasetId) {
        continue;
      }

      scanned.set(datasetId.toLowerCase(), {
        dataset: readDataset({
          dataset,
          datasetId,
          workspace,
          workspaceId,
          instances,
          dataflows,
        }),
        upstreamIds: readArray(field(dataset, "upstreamDatasets"))
          .map((upstream: unknown): string => {
            return idOf(readObject(upstream)["targetDatasetId"]);
          })
          .filter(Boolean),
      });
    }
  }

  // A composite model charts its upstream datasets' tables too.
  const datasets: Map<string, PowerBiDataset> = new Map();

  for (const [datasetId, entry] of scanned) {
    const tables: Array<BiTableRef> = [...entry.dataset.tables];
    const sources: Array<DataBiSource> = [...entry.dataset.sources];
    const visited: Set<string> = new Set([datasetId]);
    let frontier: Array<string> = entry.upstreamIds;

    for (
      let depth: number = 0;
      depth < MAX_UPSTREAM_DEPTH && frontier.length > 0;
      depth++
    ) {
      const next: Array<string> = [];

      for (const upstreamId of frontier) {
        const upstream: ScannedDataset | undefined = scanned.get(upstreamId);

        if (!upstream || visited.has(upstreamId)) {
          continue;
        }

        visited.add(upstreamId);
        tables.push(...upstream.dataset.tables);
        sources.push(...upstream.dataset.sources);
        next.push(...upstream.upstreamIds);
      }

      frontier = next;
    }

    datasets.set(datasetId, {
      ...entry.dataset,
      tables: uniqueTables(tables),
      sources: uniqueSources(sources),
    });
  }

  return { datasets, items: readItems(workspaces, maxItems) };
}

function readDataset(data: {
  dataset: JSONObject;
  datasetId: string;
  workspace: JSONObject;
  workspaceId: string;
  instances: Map<string, DataBiSource>;
  dataflows: Map<string, string>;
}): PowerBiDataset {
  const tables: Array<JSONObject> = readArray(data.dataset["tables"]).map(
    readObject,
  );
  const powerQuery: PowerQueryRead = readPowerQueryDataset({
    tables: tables.map((table: JSONObject) => {
      return {
        name: readText(table["name"]),
        sources: readArray(table["source"])
          .map((source: unknown): string => {
            return readText(
              readObject(source)["expression"],
              MAX_EXPRESSION_LENGTH,
            );
          })
          .filter(Boolean),
      };
    }),
    expressions: readArray(data.dataset["expressions"]).map(
      (value: unknown) => {
        const expression: JSONObject = readObject(value);

        return {
          name: readText(expression["name"]),
          expression: readText(expression["expression"], MAX_EXPRESSION_LENGTH),
        };
      },
    ),
  });
  const usages: Array<DataBiSource> = [
    ...readArray(field(data.dataset, "datasourceUsages")),
    ...readArray(field(data.dataset, "misconfiguredDatasourceUsages")),
  ]
    .map((usage: unknown): DataBiSource | undefined => {
      return data.instances.get(
        idOf(readObject(usage)["datasourceInstanceId"]),
      );
    })
    .filter((source: DataBiSource | undefined): source is DataBiSource => {
      return source !== undefined;
    });
  const dataflowNames: Array<string> = readArray(
    field(data.dataset, "upstreamDataflows"),
  )
    .map((upstream: unknown): string => {
      const id: string = idOf(readObject(upstream)["targetDataflowId"]);

      return id ? data.dataflows.get(id) || id : "";
    })
    .filter(Boolean);

  return {
    datasetId: data.datasetId,
    name: readText(data.dataset["name"]) || data.datasetId,
    workspaceId: data.workspaceId,
    workspace: readText(data.workspace["name"]) || null,
    onCapacity: data.workspace["isOnDedicatedCapacity"] === true,
    tables: uniqueTables(powerQuery.tables),
    sources: uniqueSources([
      ...usages,
      // Where Power BI listed no data source, the databases its queries connect to.
      ...(usages.length === 0
        ? powerQuery.sources.map((found: PowerQueryRead["sources"][number]) => {
            return database(found.engine, found.host, found.database);
          })
        : []),
      ...dataflowNames.map((name: string): DataBiSource => {
        return elsewhere("Dataflow", name);
      }),
    ]),
    hasTables: tables.length > 0,
    hasQueries: tables.some((table: JSONObject): boolean => {
      return readArray(table["source"]).some((source: unknown): boolean => {
        return Boolean(readText(readObject(source)["expression"]));
      });
    }),
    schemaError: readText(data.dataset["schemaRetrievalError"], 300) || null,
    readsDataflows: dataflowNames.length > 0,
  };
}

/*
 * A scan's reports and dashboards, each workspace's in turn: a report
 * charts its dataset, a dashboard its tiles' datasets. Each with the ids of
 * its datasets, in lower case.
 */
function readItems(
  workspaces: Array<JSONObject>,
  maxItems: number,
): Array<PowerBiItem> {
  const items: Array<PowerBiItem> = [];

  for (const workspace of workspaces) {
    const workspaceId: string = readText(workspace["id"], MAX_ID_LENGTH);
    const folder: string | null = readText(workspace["name"]) || null;

    for (const reportValue of readArray(workspace["reports"])) {
      const report: JSONObject = readObject(reportValue);
      const id: string = readText(report["id"], MAX_ID_LENGTH);
      const datasetId: string = idOf(report["datasetId"]);

      if (!id || items.length >= maxItems) {
        continue;
      }

      items.push({
        externalId: id,
        name: readText(report["name"]) || `Report ${id}`,
        url: `https://app.powerbi.com/groups/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(id)}`,
        folder,
        owner:
          readText(report["modifiedBy"]) ||
          readText(report["createdBy"]) ||
          null,
        changedAt: readDate(report["modifiedDateTime"]),
        datasetIds: datasetId ? [datasetId] : [],
      });
    }

    for (const dashboardValue of readArray(workspace["dashboards"])) {
      const dashboard: JSONObject = readObject(dashboardValue);
      const id: string = readText(dashboard["id"], MAX_ID_LENGTH);

      if (!id || items.length >= maxItems) {
        continue;
      }

      items.push({
        externalId: id,
        name: readText(dashboard["displayName"]) || `Dashboard ${id}`,
        url: `https://app.powerbi.com/groups/${encodeURIComponent(workspaceId)}/dashboards/${encodeURIComponent(id)}`,
        folder,
        owner: null,
        changedAt: null,
        datasetIds: Array.from(
          new Set(
            readArray(dashboard["tiles"])
              .map((tile: unknown): string => {
                return idOf(readObject(tile)["datasetId"]);
              })
              .filter(Boolean),
          ),
        ),
      });
    }
  }

  return items;
}

// The tables of several datasets, each once.
export function getPowerBiTables(
  datasets: Map<string, PowerBiDataset>,
  datasetIds: Array<string>,
): Array<BiTableRef> {
  return uniqueTables(
    datasetIds.flatMap((datasetId: string): Array<BiTableRef> => {
      return datasets.get(datasetId)?.tables || [];
    }),
  );
}

// What an item is built on: its datasets, and where their data comes from.
export function getPowerBiUpstream(
  datasets: Map<string, PowerBiDataset>,
  datasetIds: Array<string>,
): { datasets: Array<DataDashboardDataset>; sources: Array<DataBiSource> } {
  const found: Array<PowerBiDataset> = datasetIds
    .map((datasetId: string): PowerBiDataset | undefined => {
      return datasets.get(datasetId);
    })
    .filter(
      (dataset: PowerBiDataset | undefined): dataset is PowerBiDataset => {
        return dataset !== undefined;
      },
    );

  return {
    datasets: found
      .map((dataset: PowerBiDataset): DataDashboardDataset => {
        return { name: dataset.name, workspace: dataset.workspace };
      })
      .slice(0, MAX_DATA_DASHBOARD_DATASETS),
    sources: uniqueSources(
      found.flatMap((dataset: PowerBiDataset): Array<DataBiSource> => {
        return dataset.sources;
      }),
    ).slice(0, MAX_DATA_DASHBOARD_SOURCES),
  };
}

/*
 * What the scan said of the datasets behind the reports and dashboards
 * read: how many it listed the tables of, and the queries behind them, and
 * how many it could not describe.
 */
export function getPowerBiDatasetFacts(
  datasets: Array<PowerBiDataset>,
): DataBiDatasetFacts {
  return {
    count: datasets.length,
    withTables: datasets.filter((dataset: PowerBiDataset): boolean => {
      return dataset.hasTables;
    }).length,
    withQueries: datasets.filter((dataset: PowerBiDataset): boolean => {
      return dataset.hasQueries;
    }).length,
    withSchemaError: datasets.filter((dataset: PowerBiDataset): boolean => {
      return Boolean(dataset.schemaError);
    }).length,
    schemaError:
      datasets.find((dataset: PowerBiDataset): boolean => {
        return Boolean(dataset.schemaError);
      })?.schemaError || null,
    readingDataflows: datasets.filter((dataset: PowerBiDataset): boolean => {
      return dataset.readsDataflows;
    }).length,
  };
}
