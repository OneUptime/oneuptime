import { BiTableRef } from "./BiConnectors";
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
 */

function lower(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function hostOf(value: string | null | undefined): string {
  return lower(value).replace(/:\d+$/, "");
}

export function matchBiTable(
  ref: BiTableRef,
  catalog: Pick<ProjectCatalog, "stores" | "assets">,
): UsageAsset | null {
  const table: string = lower(ref.table);

  if (!table) {
    return null;
  }

  const storesById: Map<string, UsageStore> = new Map(
    catalog.stores.map((store: UsageStore): [string, UsageStore] => {
      return [store.dataStoreId, store];
    }),
  );
  let candidates: Array<UsageAsset> = catalog.assets.filter(
    (asset: UsageAsset) => {
      return lower(asset.name) === table;
    },
  );

  const schema: string = lower(ref.schema);
  const database: string = lower(ref.database);

  if (schema) {
    candidates = candidates.filter((asset: UsageAsset) => {
      return lower(asset.schemaName) === schema;
    });
  } else if (database) {
    // A MySQL or ClickHouse table's schema is its database.
    const asSchema: Array<UsageAsset> = candidates.filter(
      (asset: UsageAsset) => {
        return lower(asset.schemaName) === database;
      },
    );

    if (asSchema.length > 0) {
      candidates = asSchema;
    }
  }

  if (candidates.length > 1 && database) {
    const named: Array<UsageAsset> = candidates.filter((asset: UsageAsset) => {
      return (
        lower(storesById.get(asset.dataStoreId)?.databaseName) === database
      );
    });

    if (named.length > 0) {
      candidates = named;
    }
  }

  if (candidates.length > 1 && ref.host) {
    const onHost: Array<UsageAsset> = candidates.filter((asset: UsageAsset) => {
      return (
        hostOf(storesById.get(asset.dataStoreId)?.serverAddress) ===
        hostOf(ref.host)
      );
    });

    if (onHost.length > 0) {
      candidates = onHost;
    }
  }

  return candidates.length === 1 ? candidates[0]! : null;
}

// The watched tables behind a dashboard, each once.
export function matchBiTables(
  refs: Array<BiTableRef>,
  catalog: Pick<ProjectCatalog, "stores" | "assets">,
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
