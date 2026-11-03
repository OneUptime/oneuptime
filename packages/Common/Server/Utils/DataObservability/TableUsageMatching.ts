import {
  DATABASE_ENGINE_STORE_KINDS,
  DataStoreKind,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  DataAssetAccessKind,
  getAccessKindOfOperation,
  normalizeOperation,
} from "../../../Types/DataObservability/DataAssetUsage";

/*
 * WHICH TABLE A DATABASE SPAN TOUCHED.
 *
 * Spans name a database and a table the way the application sees them:
 * db.system.name (postgresql, mysql, microsoft.sql_server...), db.namespace
 * (the database, "instance|database" for SQL Server), db.collection.name
 * ("orders", "public.orders", "[dbo].[orders]") and server.address. A
 * collection names the database it reads (TableHealthSnapshot.target), so a
 * span is tied to a table when:
 *
 *  - its system is the store's engine;
 *  - its database is the store's database - or, with no database on the
 *    span, the store is the project's only one of that engine;
 *  - when two stores share the database's name (production and staging
 *    both call theirs "orders"), its server address is one store's;
 *  - its table is one of the store's, by schema when the span names one,
 *    else by name alone, the engine's default schema winning a tie.
 *
 * Anything less certain is left out: a service missing from a table's page
 * is better than a staging service listed as writing production.
 */

// The span's view of one call, grouped: what discovery reads back from ClickHouse.
export interface SpanTableUsageRow {
  serviceId: string;
  dbSystem: string;
  dbNamespace: string;
  serverAddress: string;
  collection: string;
  operation: string;
  callCount: number;
  errorCount: number;
  lastSeenAt: Date;
}

// A store table health reads, with the database its collection named.
export interface UsageStore {
  dataStoreId: string;
  kind: DataStoreKind;
  databaseName: string | null;
  serverAddress: string | null;
}

export interface UsageAsset {
  dataAssetId: string;
  dataStoreId: string;
  schemaName: string;
  name: string;
}

export interface TableUsageMatch {
  asset: UsageAsset;
  accessKind: DataAssetAccessKind;
  operation: string;
}

export interface CollectionName {
  schema: string | null;
  table: string;
}

// The longest identifier part kept; a table name is never this long.
const MAX_IDENTIFIER_LENGTH: number = 240;

// Quoted parts of a name, which may hold anything.
const QUOTED_PARTS: RegExp = /"[^"]*"|`[^`]*`|\[[^\]]*\]/g;

// Outside quotes, a list, a call or an alias: not one plain name.
const NOT_A_NAME: RegExp = /[\s,()]/;

// Names the new semantic conventions use that the Database product's map does not.
const EXTRA_SYSTEM_KINDS: Readonly<Record<string, DataStoreKind>> = {
  "microsoft.sql_server": DataStoreKind.SqlServer,
  "azure.sql_server": DataStoreKind.SqlServer,
};

// The schema a table is in when a statement names it alone.
const DEFAULT_SCHEMAS: Readonly<Partial<Record<DataStoreKind, string>>> = {
  [DataStoreKind.PostgreSql]: "public",
  [DataStoreKind.SqlServer]: "dbo",
};

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export function getStoreKindOfDbSystem(value: unknown): DataStoreKind | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const system: string = normalizeName(value);

  return (
    EXTRA_SYSTEM_KINDS[system] || DATABASE_ENGINE_STORE_KINDS[system] || null
  );
}

// The database a span's namespace names: "orders", or "instance|orders" for SQL Server.
export function readNamespaceDatabase(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parts: Array<string> = value.split("|");
  const database: string = normalizeName(parts[parts.length - 1] || "");

  return database && database.length <= MAX_IDENTIFIER_LENGTH ? database : null;
}

// Splits on dots outside quotes: "a"."b.c" is two parts.
function splitIdentifier(value: string): Array<string> {
  const parts: Array<string> = [];
  let current: string = "";
  let quote: string | null = null;

  for (const character of value) {
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "[") {
      quote = "]";
      continue;
    }

    if (character === ".") {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);

  return parts;
}

/*
 * The table a collection names: "orders", "public.orders", "[dbo].[orders]",
 * or "orders_db.dbo.orders" (SQL Server's three parts, the database first).
 * Null for anything that is not a plain name - a subquery, a list, a
 * statement fragment.
 */
export function parseCollectionName(value: unknown): CollectionName | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!trimmed || NOT_A_NAME.test(trimmed.replace(QUOTED_PARTS, "x"))) {
    return null;
  }

  const parts: Array<string> = splitIdentifier(trimmed).map(normalizeName);

  if (
    parts.length === 0 ||
    parts.length > 3 ||
    parts.some((part: string) => {
      return !part || part.length > MAX_IDENTIFIER_LENGTH;
    })
  ) {
    return null;
  }

  return {
    schema: parts.length >= 2 ? parts[parts.length - 2]! : null,
    table: parts[parts.length - 1]!,
  };
}

function normalizeHost(value: string | null): string {
  return (value || "").trim().toLowerCase().replace(/:\d+$/, "");
}

// The one store a span's call went to, or null when that cannot be said for sure.
export function findUsageStore(data: {
  row: SpanTableUsageRow;
  stores: ReadonlyArray<UsageStore>;
}): UsageStore | null {
  const kind: DataStoreKind | null = getStoreKindOfDbSystem(data.row.dbSystem);

  if (!kind) {
    return null;
  }

  const ofKind: Array<UsageStore> = data.stores.filter((store: UsageStore) => {
    return store.kind === kind;
  });
  const database: string | null = readNamespaceDatabase(data.row.dbNamespace);

  if (!database) {
    return ofKind.length === 1 ? ofKind[0]! : null;
  }

  const named: Array<UsageStore> = ofKind.filter((store: UsageStore) => {
    return (
      store.databaseName !== null &&
      normalizeName(store.databaseName) === database
    );
  });

  if (named.length <= 1) {
    return named[0] || null;
  }

  const host: string = normalizeHost(data.row.serverAddress);

  if (!host) {
    return null;
  }

  const onHost: Array<UsageStore> = named.filter((store: UsageStore) => {
    return normalizeHost(store.serverAddress) === host;
  });

  return onHost.length === 1 ? onHost[0]! : null;
}

// The table of a store a collection names, or null when it is not one, or could be several.
export function findUsageAsset(data: {
  store: UsageStore;
  collection: CollectionName;
  assets: ReadonlyArray<UsageAsset>;
}): UsageAsset | null {
  const sameName: Array<UsageAsset> = data.assets.filter(
    (asset: UsageAsset) => {
      return (
        asset.dataStoreId === data.store.dataStoreId &&
        normalizeName(asset.name) === data.collection.table
      );
    },
  );

  if (data.collection.schema) {
    return (
      sameName.find((asset: UsageAsset) => {
        return normalizeName(asset.schemaName) === data.collection.schema;
      }) || null
    );
  }

  if (sameName.length <= 1) {
    return sameName[0] || null;
  }

  // MySQL's schema is its database: the store's own.
  const defaultSchema: string | undefined =
    DEFAULT_SCHEMAS[data.store.kind] ||
    (data.store.databaseName
      ? normalizeName(data.store.databaseName)
      : undefined);

  return (
    sameName.find((asset: UsageAsset) => {
      return (
        defaultSchema !== undefined &&
        normalizeName(asset.schemaName) === defaultSchema
      );
    }) || null
  );
}

// What one grouped span row says about which table a service read or wrote.
export function matchSpanTableUsage(data: {
  row: SpanTableUsageRow;
  stores: ReadonlyArray<UsageStore>;
  assets: ReadonlyArray<UsageAsset>;
}): TableUsageMatch | null {
  const operation: string | null = normalizeOperation(data.row.operation);
  const accessKind: DataAssetAccessKind | null =
    getAccessKindOfOperation(operation);
  const collection: CollectionName | null = parseCollectionName(
    data.row.collection,
  );

  if (!operation || !accessKind || !collection) {
    return null;
  }

  const store: UsageStore | null = findUsageStore({
    row: data.row,
    stores: data.stores,
  });

  if (!store) {
    return null;
  }

  const asset: UsageAsset | null = findUsageAsset({
    store,
    collection,
    assets: data.assets,
  });

  return asset ? { asset, accessKind, operation } : null;
}
