import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  OpenLineageDataset,
  parseDatasetName,
  ParsedDatasetName,
} from "./OpenLineageEvent";
import {
  findUsageAsset,
  findUsageStore,
  UsageAsset,
  UsageStore,
} from "./TableUsageMatching";

/*
 * WHICH WATCHED TABLE AN OPENLINEAGE DATASET IS.
 *
 * The same rules as a database span's (TableUsageMatching), from the
 * dataset's namespace and name instead of span attributes: the engine and
 * host from the namespace (postgres://orders-db:5432), the database, schema
 * and table from the name (orders.public.orders). A dataset that is not a
 * table of a store Data Observability reads - a file, a topic, a warehouse
 * it does not read yet - matches nothing.
 */

const KIND_SYSTEMS: Readonly<Partial<Record<DataStoreKind, string>>> = {
  [DataStoreKind.PostgreSql]: "postgresql",
  [DataStoreKind.MySql]: "mysql",
  [DataStoreKind.SqlServer]: "mssql",
  [DataStoreKind.AwsRedshiftCluster]: "redshift",
  [DataStoreKind.Snowflake]: "snowflake",
  [DataStoreKind.GcpBigQueryDataset]: "bigquery",
  [DataStoreKind.ClickHouse]: "clickhouse",
  [DataStoreKind.Databricks]: "databricks",
  [DataStoreKind.AwsAthena]: "athena",
  [DataStoreKind.Oracle]: "oracle",
  [DataStoreKind.MongoDb]: "mongodb",
};

export function matchDataset(data: {
  dataset: OpenLineageDataset;
  stores: ReadonlyArray<UsageStore>;
  assets: ReadonlyArray<UsageAsset>;
}): UsageAsset | null {
  const parsed: ParsedDatasetName | null = parseDatasetName(data.dataset);

  if (!parsed?.kind) {
    return null;
  }

  const store: UsageStore | null = findUsageStore({
    row: {
      serviceId: "",
      dbSystem: KIND_SYSTEMS[parsed.kind] || "",
      dbNamespace: parsed.database || "",
      serverAddress: parsed.host || "",
      collection: "",
      operation: "",
      callCount: 0,
      errorCount: 0,
      lastSeenAt: new Date(0),
    },
    stores: data.stores,
  });

  const collection: { schema: string | null; table: string } = {
    schema: parsed.schema ? parsed.schema.toLowerCase() : null,
    table: parsed.table.toLowerCase(),
  };

  if (store) {
    return findUsageAsset({ store, collection, assets: data.assets });
  }

  /*
   * Several stores of the engine hold that database - BigQuery's datasets
   * of one project, each a store - and the dataset names no host to choose
   * by: the table decides, when exactly one of them holds it.
   */
  const database: string = (parsed.database || "").toLowerCase();
  const candidates: Array<UsageStore> = database
    ? data.stores.filter((candidate: UsageStore) => {
        return (
          candidate.kind === parsed.kind &&
          (candidate.databaseName || "").toLowerCase() === database
        );
      })
    : [];
  const found: Array<UsageAsset> = candidates
    .map((candidate: UsageStore): UsageAsset | null => {
      return findUsageAsset({
        store: candidate,
        collection,
        assets: data.assets,
      });
    })
    .filter((asset: UsageAsset | null): asset is UsageAsset => {
      return asset !== null;
    });

  return found.length === 1 ? found[0]! : null;
}
