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

  if (!store) {
    return null;
  }

  return findUsageAsset({
    store,
    collection: {
      schema: parsed.schema ? parsed.schema.toLowerCase() : null,
      table: parsed.table.toLowerCase(),
    },
    assets: data.assets,
  });
}
