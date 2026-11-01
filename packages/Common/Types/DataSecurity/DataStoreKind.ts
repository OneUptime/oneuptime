import IconProp from "../Icon/IconProp";

/*
 * EVERY KIND OF PLACE DATA SECURITY TREATS AS A DATA STORE.
 *
 * Cloud buckets, databases and warehouses; databases teams run themselves;
 * and the telemetry a project sends OneUptime, which holds whatever its
 * code writes into logs, spans and prompts. Each kind says where it lives
 * (its provider), what family it belongs to (so checks and pages can speak
 * of "buckets" or "databases"), the cloud inventory type it is discovered
 * from, and whether Data Security can read its content - configuration
 * checks apply to every kind, content scans only where a reader exists.
 */
export enum DataStoreKind {
  AwsS3Bucket = "AWS S3 Bucket",
  AwsRdsInstance = "AWS RDS Instance",
  AwsRdsCluster = "AWS Aurora Cluster",
  AwsRdsSnapshot = "AWS RDS Snapshot",
  AwsDynamoDbTable = "AWS DynamoDB Table",
  AwsRedshiftCluster = "AWS Redshift Cluster",
  AwsDocumentDbCluster = "AWS DocumentDB Cluster",
  AwsOpenSearchDomain = "AWS OpenSearch Domain",
  AwsElastiCacheCluster = "AWS ElastiCache Cluster",
  AwsEfsFileSystem = "AWS EFS File System",
  AzureStorageAccount = "Azure Storage Account",
  AzureSqlDatabase = "Azure SQL Database",
  AzureCosmosDbAccount = "Azure Cosmos DB Account",
  AzurePostgreSqlServer = "Azure PostgreSQL Server",
  AzureMySqlServer = "Azure MySQL Server",
  GcpStorageBucket = "Google Cloud Storage Bucket",
  GcpCloudSqlInstance = "Google Cloud SQL Instance",
  GcpBigQueryDataset = "Google BigQuery Dataset",
  GcpFirestoreDatabase = "Google Firestore Database",
  GcpSpannerInstance = "Google Spanner Instance",
  GcpBigtableInstance = "Google Bigtable Instance",
  PostgreSql = "PostgreSQL",
  MySql = "MySQL",
  MongoDb = "MongoDB",
  SqlServer = "SQL Server",
  Oracle = "Oracle",
  Redis = "Redis",
  Elasticsearch = "Elasticsearch",
  TelemetryLogs = "Logs",
  TelemetryTraces = "Traces",
  TelemetryExceptions = "Exceptions",
  TelemetrySessionReplays = "Session Replays",
  TelemetryAiConversations = "AI Conversations",
}

export enum DataStoreProvider {
  Aws = "aws",
  Azure = "azure",
  Gcp = "gcp",
  SelfManaged = "self-managed",
  OneUptime = "oneuptime",
}

export enum DataStoreFamily {
  ObjectStorage = "Object storage",
  Database = "Database",
  Warehouse = "Warehouse",
  Search = "Search",
  Cache = "Cache",
  FileSystem = "File system",
  Snapshot = "Snapshot",
  Telemetry = "Telemetry",
}

export interface DataStoreKindInfo {
  kind: DataStoreKind;
  provider: DataStoreProvider;
  family: DataStoreFamily;
  // The cloud inventory type a store of this kind is discovered from.
  cloudResourceType?: string | undefined;
  // Whether Data Security can read samples of its content.
  contentScannable: boolean;
  icon: IconProp;
}

function kind(
  value: DataStoreKind,
  provider: DataStoreProvider,
  family: DataStoreFamily,
  options: {
    cloudResourceType?: string;
    contentScannable?: boolean;
    icon?: IconProp;
  } = {},
): DataStoreKindInfo {
  return {
    kind: value,
    provider,
    family,
    cloudResourceType: options.cloudResourceType,
    contentScannable: Boolean(options.contentScannable),
    icon:
      options.icon ||
      (family === DataStoreFamily.ObjectStorage
        ? IconProp.Folder
        : family === DataStoreFamily.Telemetry
          ? IconProp.Logs
          : IconProp.Database),
  };
}

const P: typeof DataStoreProvider = DataStoreProvider;
const F: typeof DataStoreFamily = DataStoreFamily;
const K: typeof DataStoreKind = DataStoreKind;

export const DATA_STORE_KINDS: ReadonlyArray<DataStoreKindInfo> = [
  kind(K.AwsS3Bucket, P.Aws, F.ObjectStorage, {
    cloudResourceType: "AWS::S3::Bucket",
    contentScannable: true,
  }),
  kind(K.AwsRdsInstance, P.Aws, F.Database, {
    cloudResourceType: "AWS::RDS::DBInstance",
  }),
  kind(K.AwsRdsCluster, P.Aws, F.Database, {
    cloudResourceType: "AWS::RDS::DBCluster",
  }),
  kind(K.AwsRdsSnapshot, P.Aws, F.Snapshot, {
    cloudResourceType: "AWS::RDS::DBSnapshot",
  }),
  kind(K.AwsDynamoDbTable, P.Aws, F.Database, {
    cloudResourceType: "AWS::DynamoDB::Table",
  }),
  kind(K.AwsRedshiftCluster, P.Aws, F.Warehouse, {
    cloudResourceType: "AWS::Redshift::Cluster",
  }),
  kind(K.AwsDocumentDbCluster, P.Aws, F.Database, {
    cloudResourceType: "AWS::DocDB::DBCluster",
  }),
  kind(K.AwsOpenSearchDomain, P.Aws, F.Search, {
    cloudResourceType: "AWS::OpenSearchService::Domain",
  }),
  kind(K.AwsElastiCacheCluster, P.Aws, F.Cache, {
    cloudResourceType: "AWS::ElastiCache::ReplicationGroup",
  }),
  kind(K.AwsEfsFileSystem, P.Aws, F.FileSystem, {
    cloudResourceType: "AWS::EFS::FileSystem",
  }),
  kind(K.AzureStorageAccount, P.Azure, F.ObjectStorage, {
    cloudResourceType: "Microsoft.Storage/storageAccounts",
    contentScannable: true,
  }),
  kind(K.AzureSqlDatabase, P.Azure, F.Database, {
    cloudResourceType: "Microsoft.Sql/servers/databases",
  }),
  kind(K.AzureCosmosDbAccount, P.Azure, F.Database, {
    cloudResourceType: "Microsoft.DocumentDB/databaseAccounts",
  }),
  kind(K.AzurePostgreSqlServer, P.Azure, F.Database, {
    cloudResourceType: "Microsoft.DBforPostgreSQL/flexibleServers",
  }),
  kind(K.AzureMySqlServer, P.Azure, F.Database, {
    cloudResourceType: "Microsoft.DBforMySQL/flexibleServers",
  }),
  kind(K.GcpStorageBucket, P.Gcp, F.ObjectStorage, {
    cloudResourceType: "gcs_bucket",
    contentScannable: true,
  }),
  kind(K.GcpCloudSqlInstance, P.Gcp, F.Database, {
    cloudResourceType: "cloudsql_database",
  }),
  kind(K.GcpBigQueryDataset, P.Gcp, F.Warehouse, {
    cloudResourceType: "bigquery_dataset",
    contentScannable: true,
  }),
  kind(K.GcpFirestoreDatabase, P.Gcp, F.Database, {
    cloudResourceType: "firestore_instance",
  }),
  kind(K.GcpSpannerInstance, P.Gcp, F.Database, {
    cloudResourceType: "spanner_instance",
  }),
  kind(K.GcpBigtableInstance, P.Gcp, F.Database, {
    cloudResourceType: "bigtable_table",
  }),
  kind(K.PostgreSql, P.SelfManaged, F.Database, { contentScannable: true }),
  kind(K.MySql, P.SelfManaged, F.Database, { contentScannable: true }),
  kind(K.MongoDb, P.SelfManaged, F.Database),
  kind(K.SqlServer, P.SelfManaged, F.Database),
  kind(K.Oracle, P.SelfManaged, F.Database),
  kind(K.Redis, P.SelfManaged, F.Cache),
  kind(K.Elasticsearch, P.SelfManaged, F.Search),
  kind(K.TelemetryLogs, P.OneUptime, F.Telemetry, {
    contentScannable: true,
    icon: IconProp.Logs,
  }),
  kind(K.TelemetryTraces, P.OneUptime, F.Telemetry, {
    contentScannable: true,
    icon: IconProp.Waterfall,
  }),
  kind(K.TelemetryExceptions, P.OneUptime, F.Telemetry, {
    contentScannable: true,
    icon: IconProp.Bug,
  }),
  kind(K.TelemetrySessionReplays, P.OneUptime, F.Telemetry, {
    contentScannable: true,
    icon: IconProp.Play,
  }),
  kind(K.TelemetryAiConversations, P.OneUptime, F.Telemetry, {
    contentScannable: true,
    icon: IconProp.Bolt,
  }),
];

const KINDS_BY_VALUE: ReadonlyMap<string, DataStoreKindInfo> = new Map(
  DATA_STORE_KINDS.map((info: DataStoreKindInfo) => {
    return [info.kind, info];
  }),
);

export function getDataStoreKindInfo(
  value: string | undefined | null,
): DataStoreKindInfo | undefined {
  return value ? KINDS_BY_VALUE.get(value) : undefined;
}

export function isDataStoreKind(value: unknown): value is DataStoreKind {
  return typeof value === "string" && KINDS_BY_VALUE.has(value);
}

// The kind a cloud inventory row of this type becomes, if any.
export function getDataStoreKindForCloudResourceType(
  cloudResourceType: string,
): DataStoreKind | undefined {
  return DATA_STORE_KINDS.find((info: DataStoreKindInfo) => {
    return info.cloudResourceType === cloudResourceType;
  })?.kind;
}

export const TELEMETRY_DATA_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.TelemetryLogs,
  DataStoreKind.TelemetryTraces,
  DataStoreKind.TelemetryExceptions,
  DataStoreKind.TelemetrySessionReplays,
  DataStoreKind.TelemetryAiConversations,
];

/*
 * The database engines OneUptime's Database product monitors, mapped to the
 * kind of store each one is (the Database Agent's receiver names).
 */
export const DATABASE_ENGINE_STORE_KINDS: Readonly<
  Record<string, DataStoreKind>
> = {
  postgresql: DataStoreKind.PostgreSql,
  postgres: DataStoreKind.PostgreSql,
  mysql: DataStoreKind.MySql,
  mariadb: DataStoreKind.MySql,
  mongodb: DataStoreKind.MongoDb,
  sqlserver: DataStoreKind.SqlServer,
  mssql: DataStoreKind.SqlServer,
  oracledb: DataStoreKind.Oracle,
  oracle: DataStoreKind.Oracle,
  redis: DataStoreKind.Redis,
  elasticsearch: DataStoreKind.Elasticsearch,
};
