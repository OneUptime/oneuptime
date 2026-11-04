import { JSONObject } from "../../../Types/JSON";
import {
  DatabaseConnection,
  parseSqlServerConnectionString,
} from "../DataSecurity/Content/DatabaseSampler";
import {
  getSnowflakeHost,
  readSnowflakeConnection,
  SnowflakeConnection,
} from "./SnowflakeSqlApi";
import { BigQueryConnection, readBigQueryConnection } from "./BigQueryApi";
import {
  ClickHouseConnection,
  readClickHouseConnection,
} from "./ClickHouseHttpApi";
import {
  DatabricksConnection,
  readDatabricksConnection,
} from "./DatabricksApi";

/*
 * WHICH DATABASE A COLLECTION READ: ITS NAME, HOST AND PORT.
 *
 * Read from the connection string where the collection runs - OneUptime's
 * workers, or the probe that holds the string in its environment - and sent
 * with the snapshot. Never the user, the password or any other part of the
 * string: only what a database span names too (db.namespace,
 * server.address, server.port), so the spans of the services that use the
 * database can be tied to its tables (TableUsageMatching).
 */
export interface TableHealthTarget {
  databaseName: string | null;
  host: string | null;
  port: number | null;
}

const MAX_NAME_LENGTH: number = 240;

// No name a span carries holds these: a path, a query, a credential.
const UNSAFE_NAME_CHARACTERS: RegExp = /[\s/?#@]/;

const URL_SCHEME: RegExp = /^[a-z][a-z0-9+.-]*:\/\//i;

function readName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name: string = value.trim();

  return name &&
    name.length <= MAX_NAME_LENGTH &&
    !UNSAFE_NAME_CHARACTERS.test(name)
    ? name
    : null;
}

function readPort(value: unknown): number | null {
  const port: number = Number(value);

  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

// "key=value key='value'": libpq's own form of a PostgreSQL connection string.
function readKeyValuePairs(value: string): Map<string, string> {
  const pairs: Map<string, string> = new Map();
  const pattern: RegExp = /(\w+)\s*=\s*('(?:[^'\\]|\\.)*'|\S+)/g;

  for (const match of value.matchAll(pattern)) {
    const key: string = (match[1] || "").toLowerCase();
    let raw: string = match[2] || "";

    if (raw.startsWith("'") && raw.endsWith("'")) {
      raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    }

    pairs.set(key, raw);
  }

  return pairs;
}

function fromUrl(value: string): TableHealthTarget | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const params: URLSearchParams = url.searchParams;
  const database: string = decodeURIComponent(
    url.pathname.replace(/^\/+/, "").split("/")[0] || "",
  );

  return {
    databaseName: readName(database || params.get("dbname") || ""),
    // A Unix socket ("?host=/var/run/postgresql") is no host a span names.
    host: readName(
      decodeURIComponent(url.hostname) || params.get("host") || "",
    ),
    port: readPort(url.port || params.get("port")),
  };
}

export function readConnectionTarget(
  connection: DatabaseConnection,
): TableHealthTarget | null {
  const value: string = (connection.connectionString || "").trim();

  if (!value) {
    return null;
  }

  // BigQuery's: the project, as OpenLineage and dbt name it first. Never the key.
  if (connection.engine === "bigquery") {
    try {
      const bigquery: BigQueryConnection = readBigQueryConnection(value);

      return {
        databaseName: readName(bigquery.projectId),
        host: null,
        port: null,
      };
    } catch {
      return null;
    }
  }

  // Snowflake's connection is its account and database: never its key.
  if (connection.engine === "snowflake") {
    try {
      const snowflake: SnowflakeConnection = readSnowflakeConnection(value);

      return {
        databaseName: readName(snowflake.database),
        host: readName(getSnowflakeHost(snowflake.account)),
        port: 443,
      };
    } catch {
      return null;
    }
  }

  // ClickHouse's: its host and port, and the database when the connection names one.
  if (connection.engine === "clickhouse") {
    try {
      const clickhouse: ClickHouseConnection = readClickHouseConnection(value);

      return {
        databaseName: readName(clickhouse.database),
        host: readName(clickhouse.host),
        port: readPort(clickhouse.port),
      };
    } catch {
      return null;
    }
  }

  // Databricks': the workspace and the catalog, as OpenLineage and dbt name them. Never the token.
  if (connection.engine === "databricks") {
    try {
      const databricks: DatabricksConnection = readDatabricksConnection(value);

      return {
        databaseName: readName(databricks.catalog),
        host: readName(databricks.host),
        port: 443,
      };
    } catch {
      return null;
    }
  }

  if (connection.engine === "sqlserver") {
    try {
      const parsed: { server?: unknown; port?: unknown; database?: unknown } =
        parseSqlServerConnectionString(value) as unknown as {
          server?: unknown;
          port?: unknown;
          database?: unknown;
        };

      return {
        databaseName: readName(parsed.database),
        host: readName(String(parsed.server || "").split("\\")[0]),
        port: readPort(parsed.port),
      };
    } catch {
      return null;
    }
  }

  if (URL_SCHEME.test(value)) {
    return fromUrl(value);
  }

  if (connection.engine === "postgresql") {
    const pairs: Map<string, string> = readKeyValuePairs(value);

    return {
      databaseName: readName(pairs.get("dbname")),
      host: readName(pairs.get("host")),
      port: readPort(pairs.get("port")),
    };
  }

  return null;
}

// The target as a snapshot or a store carries it, checked: a probe's report is not trusted as sent.
export function readTableHealthTarget(
  value: unknown,
): TableHealthTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const target: TableHealthTarget = {
    databaseName: readName(item["databaseName"]),
    host: readName(item["host"]),
    port: readPort(item["port"]),
  };

  return target.databaseName || target.host ? target : null;
}
