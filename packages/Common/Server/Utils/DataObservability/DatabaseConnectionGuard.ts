import dns from "dns/promises";
import { parse as parsePostgresConnectionString } from "pg-connection-string";
import DataSourceEgressGuard from "../DataSource/EgressGuard";
import {
  DatabaseConnection,
  parseSqlServerConnectionString,
} from "../DataSecurity/Content/DatabaseSampler";
import { readMongoUri } from "./MongoUri";
import { readOracleConnection } from "./OracleConnection";

/*
 * WHERE ONEUPTIME ITSELF MAY OPEN A DATABASE CONNECTION.
 *
 * A connection string is a tenant's input, and a database driver opens its
 * own socket to whatever it names: without this, on a multi-tenant install a
 * tenant could point OneUptime's workers at an internal address and learn
 * from the errors what lives there. So before a worker connects, every host
 * the string can reach is held to the same guard as every HTTP data source:
 * no loopback, link-local or metadata address anywhere, and no private
 * address on a multi-tenant install. The hosts are read the way each driver
 * reads them, query-string overrides and host lists included.
 *
 * A probe does not call this: it runs in the customer's own network, for the
 * databases only that network can reach. The HTTP engines need no call
 * either: DataSourceHttpFetch guards each of their requests. A driver gives
 * no way to pin the address it was checked against, so a name that changes
 * between the check and the connection is the guard's one remaining gap.
 */

const SOCKET_PATH_REFUSAL: string =
  "A database reached through a local socket cannot be connected from OneUptime's servers. Connect it through a probe.";

// Oracle's full descriptor names its hosts as (HOST=...), and Easy Connect as host1,host2:port/service.
const ORACLE_DESCRIPTOR_HOST: RegExp = /\(\s*HOST\s*=\s*([^)\s]+)\s*\)/gi;
const LEADING_EASY_CONNECT_SCHEME: RegExp = /^[a-z]+:\/\//i;

function readOracleHosts(connectString: string): Array<string> {
  const text: string = connectString.trim();

  if (text.includes("(")) {
    return Array.from(text.matchAll(ORACLE_DESCRIPTOR_HOST)).map(
      (match: RegExpMatchArray): string => {
        return match[1] || "";
      },
    );
  }

  return text
    .replace(LEADING_EASY_CONNECT_SCHEME, "")
    .split("/")[0]!
    .split(",")
    .map((host: string): string => {
      return host.trim().split(":")[0] || "";
    });
}

// Every host a connection string can reach, as its driver reads it; [] when an HTTP engine guards itself.
export function getDatabaseConnectionHosts(
  connection: DatabaseConnection,
): Array<string> {
  const value: string = connection.connectionString.trim();

  switch (connection.engine) {
    case "postgresql":
    case "redshift": {
      const host: string = parsePostgresConnectionString(value).host || "";

      if (host.startsWith("/")) {
        throw new Error(SOCKET_PATH_REFUSAL);
      }

      return host.split(",");
    }
    case "mysql": {
      const url: URL = new URL(value.replace(/^mariadb:/i, "mysql:"));

      // mysql2 reads every query parameter as a connection option.
      if (url.searchParams.has("socketPath")) {
        throw new Error(SOCKET_PATH_REFUSAL);
      }

      return [url.searchParams.get("host") || url.hostname];
    }
    case "sqlserver":
      return [String(parseSqlServerConnectionString(value).server || "")];
    case "oracle":
      return readOracleHosts(readOracleConnection(value).connectString);
    case "mongodb":
      return (readMongoUri(value)?.hosts || []).map(
        (host: { host: string }): string => {
          return host.host;
        },
      );
    default:
      return [];
  }
}

export async function assertDatabaseConnectionAllowed(
  connection: DatabaseConnection,
): Promise<void> {
  const hosts: Array<string> = getDatabaseConnectionHosts(connection);

  // An SRV name says where it points only when asked.
  if (
    connection.engine === "mongodb" &&
    readMongoUri(connection.connectionString)?.isSrv
  ) {
    for (const host of [...hosts]) {
      const records: Array<{ name: string }> = await dns.resolveSrv(
        `_mongodb._tcp.${host}`,
      );

      hosts.push(
        ...records.map((record: { name: string }): string => {
          return record.name;
        }),
      );
    }
  }

  for (const host of hosts) {
    await DataSourceEgressGuard.assertHostnameAllowed(host, {
      targetLabel: "Database",
    });
  }
}
