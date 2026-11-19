import {
  DataBiDatasetFacts,
  DataBiSource,
  DataDashboardDataset,
  DataDashboardUpstream,
  MAX_DATA_DASHBOARD_DATASETS,
  MAX_DATA_DASHBOARD_SOURCES,
} from "../../../../Types/DataObservability/DataBiLineage";
import { JSONObject } from "../../../../Types/JSON";
import { getBiDatabaseSource, uniqueSources } from "./BiSources";
import { BiTableRef, uniqueTables } from "./BiTables";
import { hostOfUrl, readPowerQueryDataset, PowerQueryRead } from "./PowerQuery";

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
 * Each workspace is read on its own (readPowerBiWorkspaces) - what a read
 * keeps of it, so the next scans only the workspaces that changed
 * (PowerBiReadState, #9552) - and the tenant is put together after
 * (composePowerBiScan): a report's dataset, a composite model's upstream
 * dataset and a dataset's dataflow can each be in another workspace, read
 * by another scan or another read. A workspace Power BI says is deleted or
 * being removed holds nothing.
 *
 * What is kept of a data source is where it is, never how to get in: a web
 * address without its query string, and no connection string.
 */

// A dataset as its own workspace's scan read it: what a read keeps of it.
export interface PowerBiDatasetRead {
  datasetId: string;
  name: string;
  // The tables it reads itself: a composite model's upstream datasets' are added when the tenant is put together.
  tables: Array<BiTableRef>;
  // Its own data sources: its dataflows are added when the tenant is put together.
  sources: Array<DataBiSource>;
  hasTables: boolean;
  hasQueries: boolean;
  schemaError: string | null;
  // The datasets it is built on (a composite model), by id in lower case.
  upstreamDatasetIds: Array<string>;
  // The dataflows it reads, by id in lower case.
  dataflowIds: Array<string>;
}

// A dataflow, as its workspace's scan names it.
export interface PowerBiDataflowRead {
  // Its id, in lower case.
  id: string;
  name: string;
  // When it last changed, as Power BI says (ISO); null when it does not.
  modifiedAt: string | null;
  // Where its data comes from: its datasourceUsages, which need no tenant setting.
  sources: Array<DataBiSource>;
}

// One workspace, as its scan read it: what a read keeps of it.
export interface PowerBiWorkspaceRead {
  // Its id, in lower case.
  id: string;
  name: string | null;
  onCapacity: boolean;
  // Its reports, then its dashboards, as the scan lists them.
  items: Array<PowerBiItem>;
  datasets: Array<PowerBiDatasetRead>;
  dataflows: Array<PowerBiDataflowRead>;
}

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
// The most reports and dashboards kept of one workspace: no more than one read keeps of a tool.
const MAX_ITEMS_PER_WORKSPACE: number = 2_000;

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

// A database as a data source: OneUptime's engine only where it can watch it (BiSources).
const database: (
  engine: string,
  server: string | null,
  databaseName: string | null,
) => DataBiSource = getBiDatabaseSource;

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
  // Dataverse's connector (data source kind CommonDataService) and Common Data Service (Legacy)'s (Cds).
  commondataservice: "dataverse",
  dataverse: "dataverse",
  cds: "dataverse",
};

/*
 * A Dataverse environment by its host alone - contoso.crm.dynamics.com -
 * however the data source writes it: a URL (Cds.Entities'), or a host with
 * the SQL endpoint's port (CommonDataService.Database's "org...,5558").
 */
function dataverseHost(value: string | null): string | null {
  return hostOfUrl((value || "").split(",")[0] || null);
}

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

        if (engine === "dataverse") {
          return database(
            engine,
            dataverseHost(readText(host) || readText(details["url"], 2_000)),
            null,
          );
        }

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
    case "cds":
      return database(
        "dataverse",
        dataverseHost(server || readText(details["url"], 2_000)),
        null,
      );
    default:
      return elsewhere(type, url || path);
  }
}

// A workspace Power BI says is going holds nothing a person opens.
const GONE_WORKSPACE_STATES: ReadonlySet<string> = new Set([
  "deleted",
  "removing",
]);

/*
 * Each workspace of the scan's results, read on its own: its reports and
 * dashboards, its datasets with their own tables and data sources, and its
 * dataflows. A workspace Power BI says is deleted or being removed is left
 * out, as one it did not return is.
 */
export function readPowerBiWorkspaces(
  results: Array<JSONObject>,
): Array<PowerBiWorkspaceRead> {
  const workspaces: Array<PowerBiWorkspaceRead> = [];

  for (const result of results) {
    // A scan's data sources, which its own datasets and dataflows name.
    const instances: Map<string, DataBiSource> = new Map();

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

    for (const value of readArray(result["workspaces"])) {
      const workspace: JSONObject = readObject(value);
      const id: string = idOf(workspace["id"]);

      if (
        !id ||
        GONE_WORKSPACE_STATES.has(readText(workspace["state"]).toLowerCase())
      ) {
        continue;
      }

      workspaces.push({
        id,
        name: readText(workspace["name"]) || null,
        onCapacity: workspace["isOnDedicatedCapacity"] === true,
        items: readItems(workspace),
        datasets: readArray(workspace["datasets"])
          .map((dataset: unknown): PowerBiDatasetRead | null => {
            return readDataset(readObject(dataset), instances);
          })
          .filter(
            (
              dataset: PowerBiDatasetRead | null,
            ): dataset is PowerBiDatasetRead => {
              return dataset !== null;
            },
          ),
        dataflows: readArray(workspace["dataflows"])
          .map((dataflow: unknown): PowerBiDataflowRead | null => {
            return readDataflow(readObject(dataflow), instances);
          })
          .filter(
            (
              dataflow: PowerBiDataflowRead | null,
            ): dataflow is PowerBiDataflowRead => {
              return dataflow !== null;
            },
          ),
      });
    }
  }

  return workspaces;
}

// The data sources an item of the scan uses: its usages of the scan's instances, misconfigured ones too.
function readUsages(
  item: JSONObject,
  instances: Map<string, DataBiSource>,
): Array<DataBiSource> {
  return [
    ...readArray(field(item, "datasourceUsages")),
    ...readArray(field(item, "misconfiguredDatasourceUsages")),
  ]
    .map((usage: unknown): DataBiSource | undefined => {
      return instances.get(idOf(readObject(usage)["datasourceInstanceId"]));
    })
    .filter((source: DataBiSource | undefined): source is DataBiSource => {
      return source !== undefined;
    });
}

function readDataflow(
  dataflow: JSONObject,
  instances: Map<string, DataBiSource>,
): PowerBiDataflowRead | null {
  const id: string = idOf(dataflow["objectId"]);
  const modifiedAt: Date | null = readDate(dataflow["modifiedDateTime"]);

  return id
    ? {
        id,
        name: readText(dataflow["name"]) || id,
        modifiedAt: modifiedAt ? modifiedAt.toISOString() : null,
        sources: uniqueSources(readUsages(dataflow, instances)),
      }
    : null;
}

function readDataset(
  dataset: JSONObject,
  instances: Map<string, DataBiSource>,
): PowerBiDatasetRead | null {
  const datasetId: string = readText(dataset["id"], MAX_ID_LENGTH);

  if (!datasetId) {
    return null;
  }

  const tables: Array<JSONObject> = readArray(dataset["tables"]).map(
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
    expressions: readArray(dataset["expressions"]).map((value: unknown) => {
      const expression: JSONObject = readObject(value);

      return {
        name: readText(expression["name"]),
        expression: readText(expression["expression"], MAX_EXPRESSION_LENGTH),
      };
    }),
  });
  const usages: Array<DataBiSource> = readUsages(dataset, instances);

  return {
    datasetId,
    name: readText(dataset["name"]) || datasetId,
    tables: uniqueTables(powerQuery.tables),
    sources: uniqueSources([
      ...usages,
      // Where Power BI listed no data source, the databases its queries connect to.
      ...(usages.length === 0
        ? powerQuery.sources.map((found: PowerQueryRead["sources"][number]) => {
            return database(found.engine, found.host, found.database);
          })
        : []),
    ]),
    hasTables: tables.length > 0,
    hasQueries: tables.some((table: JSONObject): boolean => {
      return readArray(table["source"]).some((source: unknown): boolean => {
        return Boolean(readText(readObject(source)["expression"]));
      });
    }),
    schemaError: readText(dataset["schemaRetrievalError"], 300) || null,
    upstreamDatasetIds: Array.from(
      new Set(
        readArray(field(dataset, "upstreamDatasets"))
          .map((upstream: unknown): string => {
            return idOf(readObject(upstream)["targetDatasetId"]);
          })
          .filter(Boolean),
      ),
    ),
    dataflowIds: Array.from(
      new Set(
        readArray(field(dataset, "upstreamDataflows"))
          .map((upstream: unknown): string => {
            return idOf(readObject(upstream)["targetDataflowId"]);
          })
          .filter(Boolean),
      ),
    ),
  };
}

/*
 * A workspace's reports and dashboards: a report charts its dataset, a
 * dashboard its tiles' datasets. Each with the ids of its datasets, in
 * lower case.
 */
function readItems(workspace: JSONObject): Array<PowerBiItem> {
  const items: Array<PowerBiItem> = [];
  const workspaceId: string = readText(workspace["id"], MAX_ID_LENGTH);
  const folder: string | null = readText(workspace["name"]) || null;

  for (const reportValue of readArray(workspace["reports"])) {
    const report: JSONObject = readObject(reportValue);
    const id: string = readText(report["id"], MAX_ID_LENGTH);
    const datasetId: string = idOf(report["datasetId"]);

    if (!id || items.length >= MAX_ITEMS_PER_WORKSPACE) {
      continue;
    }

    items.push({
      externalId: id,
      name: readText(report["name"]) || `Report ${id}`,
      url: `https://app.powerbi.com/groups/${encodeURIComponent(workspaceId)}/reports/${encodeURIComponent(id)}`,
      folder,
      owner:
        readText(report["modifiedBy"]) || readText(report["createdBy"]) || null,
      changedAt: readDate(report["modifiedDateTime"]),
      datasetIds: datasetId ? [datasetId] : [],
    });
  }

  for (const dashboardValue of readArray(workspace["dashboards"])) {
    const dashboard: JSONObject = readObject(dashboardValue);
    const id: string = readText(dashboard["id"], MAX_ID_LENGTH);

    if (!id || items.length >= MAX_ITEMS_PER_WORKSPACE) {
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

  return items;
}

interface ComposedDataset {
  dataset: PowerBiDataset;
  upstreamIds: Array<string>;
}

/*
 * The tenant put together from its workspaces, each read on its own: every
 * dataset with the dataflows it reads and, for a composite model, its
 * upstream datasets' tables and sources; and the reports and dashboards of
 * the workspaces in turn, at most `maxItems`.
 */
export function composePowerBiScan(
  workspaces: Array<PowerBiWorkspaceRead>,
  maxItems: number,
): PowerBiScanRead {
  // Every dataflow, by its id, as the dataset reading it names it.
  const dataflowNames: Map<string, string> = new Map();

  for (const workspace of workspaces) {
    for (const dataflow of workspace.dataflows) {
      dataflowNames.set(dataflow.id, dataflow.name);
    }
  }

  const composed: Map<string, ComposedDataset> = new Map();

  for (const workspace of workspaces) {
    for (const read of workspace.datasets) {
      composed.set(read.datasetId.toLowerCase(), {
        dataset: {
          datasetId: read.datasetId,
          name: read.name,
          workspaceId: workspace.id,
          workspace: workspace.name,
          onCapacity: workspace.onCapacity,
          tables: read.tables,
          sources: uniqueSources([
            ...read.sources,
            ...read.dataflowIds.map((id: string): DataBiSource => {
              return elsewhere("Dataflow", dataflowNames.get(id) || id);
            }),
          ]),
          hasTables: read.hasTables,
          hasQueries: read.hasQueries,
          schemaError: read.schemaError,
          readsDataflows: read.dataflowIds.length > 0,
        },
        upstreamIds: read.upstreamDatasetIds,
      });
    }
  }

  // A composite model charts its upstream datasets' tables too.
  const datasets: Map<string, PowerBiDataset> = new Map();

  for (const [datasetId, entry] of composed) {
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
        const upstream: ComposedDataset | undefined = composed.get(upstreamId);

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

  const items: Array<PowerBiItem> = [];

  for (const workspace of workspaces) {
    for (const item of workspace.items) {
      if (items.length >= maxItems) {
        break;
      }

      items.push(item);
    }
  }

  return { datasets, items };
}

// The scan's results read: every dataset with its tables and data sources, and every report and dashboard.
export function readPowerBiScan(
  results: Array<JSONObject>,
  maxItems: number,
): PowerBiScanRead {
  return composePowerBiScan(readPowerBiWorkspaces(results), maxItems);
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
): DataDashboardUpstream {
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
        return {
          id: dataset.datasetId.toLowerCase(),
          name: dataset.name,
          workspace: dataset.workspace,
          sources: dataset.sources.slice(0, MAX_DATA_DASHBOARD_SOURCES),
        };
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
