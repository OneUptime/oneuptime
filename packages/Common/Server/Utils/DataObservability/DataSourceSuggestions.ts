import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  DataObservabilitySourceOrigin,
  DataObservabilitySourceSuggestion,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { isObjectStoreKind } from "../../../Types/DataObservability/StoragePaths";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DataStoreService from "../../Services/DataStoreService";
import { DATA_OBSERVABILITY_KINDS } from "./DataObservabilityEngines";

/*
 * THE DATABASES A PROJECT ALREADY KNOWS OF, AND NOBODY HAS CONNECTED.
 *
 * Nobody should have to remember every database they have. Data Security's
 * daily discovery already writes down what the project's traces talk to, what
 * its cloud accounts hold and what Database Monitoring watches, each as a
 * store. A store with no way in is a suggestion here: connecting it starts
 * from its name, its engine and, where we know them, its host and database.
 *
 * Nothing here reads a database or a span, so asking costs nothing.
 */

// The most stores read, and the most suggested at once.
const MAX_STORES_READ: number = 1000;
export const MAX_SUGGESTIONS: number = 50;

const ORIGIN_OF_DISCOVERY: Readonly<
  Record<string, DataObservabilitySourceOrigin>
> = {
  "Service map": DataObservabilitySourceOrigin.Traces,
  "Database product": DataObservabilitySourceOrigin.DatabaseMonitoring,
  "Cloud inventory": DataObservabilitySourceOrigin.CloudAccount,
  "Cloud read": DataObservabilitySourceOrigin.CloudAccount,
};

/*
 * A cloud account's databases, by the engine a connection to them speaks. An RDS
 * instance or a Cloud SQL instance can be any of several, so it asks.
 */
const ENGINE_OF_CLOUD_KIND: Readonly<
  Partial<Record<DataStoreKind, DataStoreKind | null>>
> = {
  [DataStoreKind.AwsRdsInstance]: null,
  [DataStoreKind.AwsRdsCluster]: null,
  [DataStoreKind.GcpCloudSqlInstance]: null,
  [DataStoreKind.AwsDocumentDbCluster]: DataStoreKind.MongoDb,
  [DataStoreKind.AzureSqlDatabase]: DataStoreKind.SqlServer,
  [DataStoreKind.AzurePostgreSqlServer]: DataStoreKind.PostgreSql,
  [DataStoreKind.AzureMySqlServer]: DataStoreKind.MySql,
};

interface ConnectionFormat {
  scheme: string;
  port: number;
  suffix?: string | undefined;
}

const CONNECTION_FORMATS: Readonly<
  Partial<Record<DataStoreKind, ConnectionFormat>>
> = {
  [DataStoreKind.PostgreSql]: {
    scheme: "postgres",
    port: 5432,
    suffix: "?sslmode=require",
  },
  [DataStoreKind.AwsRedshiftCluster]: {
    scheme: "postgres",
    port: 5439,
    suffix: "?sslmode=require",
  },
  [DataStoreKind.MySql]: { scheme: "mysql", port: 3306 },
  [DataStoreKind.SqlServer]: { scheme: "mssql", port: 1433 },
  [DataStoreKind.Oracle]: { scheme: "oracle", port: 1521 },
  [DataStoreKind.MongoDb]: { scheme: "mongodb", port: 27017 },
  [DataStoreKind.ClickHouse]: { scheme: "clickhouse", port: 8443 },
};

/*
 * Whether a store has any way in. BigQuery needs none but the cloud connection
 * that found it, and so does a bucket someone named paths of.
 */
export function isStoreConnected(store: {
  kind?: string | null | undefined;
  connectionString?: string | null | undefined;
  scanProbeId?: ObjectID | null | undefined;
  cloudConnectionId?: ObjectID | null | undefined;
  watchedPaths?: string | null | undefined;
}): boolean {
  return Boolean(
    store.connectionString ||
      store.scanProbeId ||
      (store.kind === DataStoreKind.GcpBigQueryDataset &&
        store.cloudConnectionId) ||
      (isObjectStoreKind(store.kind) &&
        store.cloudConnectionId &&
        store.watchedPaths),
  );
}

// The engine to preselect: undefined when Data Observability cannot read this kind at all.
export function getSuggestedEngine(
  kind: string | null | undefined,
): DataStoreKind | null | undefined {
  if (DATA_OBSERVABILITY_KINDS.includes(kind as DataStoreKind)) {
    return kind as DataStoreKind;
  }

  return ENGINE_OF_CLOUD_KIND[kind as DataStoreKind];
}

// A connection string to start from. It holds nothing secret: its user and password are placeholders.
export function buildConnectionExample(data: {
  kind: DataStoreKind | null;
  host: string | null;
  port: number | null;
  databaseName: string | null;
}): string | null {
  const format: ConnectionFormat | undefined = data.kind
    ? CONNECTION_FORMATS[data.kind]
    : undefined;

  if (!format || !data.host) {
    return null;
  }

  const database: string = data.databaseName ? `/${data.databaseName}` : "";

  return `${format.scheme}://USER:PASSWORD@${data.host}:${data.port || format.port}${database}${format.suffix || ""}`;
}

// What a store seen only in traces says of itself, in the key discovery gave it.
export function readTracedTarget(storeKey: string | null | undefined): {
  host: string | null;
  databaseName: string | null;
} {
  const parts: Array<string> = (storeKey || "").split(":");

  return parts[0] === "traced" && parts.length >= 3
    ? { host: parts[2] || null, databaseName: parts[3] || null }
    : { host: null, databaseName: null };
}

export default class DataSourceSuggestions {
  public static async read(
    projectId: ObjectID,
  ): Promise<Array<DataObservabilitySourceSuggestion>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        isArchived: false,
        discoveredFrom: new Includes(Object.keys(ORIGIN_OF_DISCOVERY)),
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        storeKey: true,
        discoveredFrom: true,
        connectionString: true,
        scanProbeId: true,
        cloudConnectionId: true,
        databaseServerId: true,
      },
      skip: 0,
      limit: MAX_STORES_READ,
      props: { isRoot: true },
    });
    const notConnected: Array<DataStore> = stores.filter(
      (store: DataStore): boolean => {
        return (
          Boolean(store.id) &&
          !isStoreConnected(store) &&
          getSuggestedEngine(store.kind) !== undefined
        );
      },
    );
    const servers: Map<string, DatabaseServer> = await this.readServers(
      projectId,
      notConnected,
    );

    return notConnected
      .map((store: DataStore): DataObservabilitySourceSuggestion => {
        return this.toSuggestion(
          store,
          store.databaseServerId
            ? servers.get(store.databaseServerId.toString())
            : undefined,
        );
      })
      .sort(
        (
          a: DataObservabilitySourceSuggestion,
          b: DataObservabilitySourceSuggestion,
        ): number => {
          return a.name.localeCompare(b.name);
        },
      )
      .slice(0, MAX_SUGGESTIONS);
  }

  private static toSuggestion(
    store: DataStore,
    server: DatabaseServer | undefined,
  ): DataObservabilitySourceSuggestion {
    const engine: DataStoreKind | null = getSuggestedEngine(store.kind) ?? null;
    const traced: { host: string | null; databaseName: string | null } =
      readTracedTarget(store.storeKey);
    const isCollectable: boolean = DATA_OBSERVABILITY_KINDS.includes(
      store.kind as DataStoreKind,
    );

    return {
      id: store.id!.toString(),
      // A kind we read as it is takes the connection; an RDS instance gets a store of its engine.
      dataStoreId: isCollectable ? store.id!.toString() : null,
      name: store.name || "",
      kind: engine,
      origin:
        ORIGIN_OF_DISCOVERY[store.discoveredFrom || ""] ||
        DataObservabilitySourceOrigin.CloudAccount,
      connectionExample: buildConnectionExample({
        kind: engine,
        host: server?.serverAddress || traced.host,
        port: server?.serverPort || null,
        databaseName: server?.databaseIdentifier || traced.databaseName,
      }),
    };
  }

  private static async readServers(
    projectId: ObjectID,
    stores: Array<DataStore>,
  ): Promise<Map<string, DatabaseServer>> {
    const ids: Array<ObjectID> = stores
      .map((store: DataStore): ObjectID | undefined => {
        return store.databaseServerId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    if (ids.length === 0) {
      return new Map();
    }

    const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
      query: { projectId, _id: new Includes(ids) },
      select: {
        _id: true,
        serverAddress: true,
        serverPort: true,
        databaseIdentifier: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    return new Map(
      servers.map((server: DatabaseServer): [string, DatabaseServer] => {
        return [server.id!.toString(), server];
      }),
    );
  }
}
