import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityScan from "../../../Models/DatabaseModels/DataSecurityScan";
import DataSecuritySetting from "../../../Models/DatabaseModels/DataSecuritySetting";
import CloudConnectionService from "../../Services/CloudConnectionService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import DataSecurityCustomDataTypeService from "../../Services/DataSecurityCustomDataTypeService";
import DataSecurityScanService from "../../Services/DataSecurityScanService";
import DataSecuritySettingService from "../../Services/DataSecuritySettingService";
import ChangeEventService from "../../Services/ChangeEventService";
import { EncryptionSecret } from "../../EnvironmentConfig";
import { CloudConnectionSettings } from "../CloudConnection/CloudConnectorTypes";
import {
  readAwsDataSecurity,
  createAwsObjectStoreReader,
} from "./Cloud/Aws/AwsDataSecurityReader";
import {
  createAzureBlobObjectStoreReader,
  listAzureBlobContainers,
  readAzureDataSecurity,
} from "./Cloud/Azure/AzureDataSecurityReader";
import {
  createGcsObjectStoreReader,
  readBigQuerySample,
  readGcpDataSecurity,
} from "./Cloud/Gcp/GcpDataSecurityReader";
import {
  CloudDataSecurityReadResult,
  ObjectStoreReader,
} from "./Cloud/DataSecurityCloudTypes";
import { sampleObjectStore } from "./Content/ObjectStoreSampler";
import { sampleDatabase } from "./Content/DatabaseSampler";
import DataSecurityDiscovery from "./DataSecurityDiscovery";
import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
  DataSecurityScanKind,
  DataSecurityScanStatus,
} from "./DataSecurityFindingWriter";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
} from "./DataSecurityScanTypes";
import { buildFingerprint, deriveFingerprintKey } from "./Fingerprint";
import { scanProjectTelemetry } from "./Telemetry/TelemetryDataScanner";
import {
  getScrubCoverage,
  isFindingScrubbed,
  ScrubCoverage,
} from "./Telemetry/TelemetryScrubCoverage";
import logger from "../Logger";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import { Results } from "../../Services/AnalyticsDatabaseService";
import QueryHelper from "../../Types/Database/QueryHelper";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionDataSecurityLevel,
  DATA_SECURITY_FIELD_KEY,
  getCloudConnectionDataSecurityLevel,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
  getDataStoreKindInfo,
} from "../../../Types/DataSecurity/DataStoreKind";
import {
  compileCustomDataType,
  customDataTypeId,
  CustomDataTypeValidator,
} from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import FieldCollector, {
  CollectedField,
} from "../../../Utils/DataSecurity/FieldCollector";
import {
  classifyField,
  FieldClassification,
} from "../../../Utils/DataSecurity/FieldClassifier";
import { BUILT_IN_DETECTORS } from "../../../Utils/DataSecurity/Detectors/Index";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";
import { ResponseJSON } from "@clickhouse/client";

/*
 * THE WORK THE DATA SECURITY JOBS DO, ONE PROJECT, CONNECTION OR STORE AT A
 * TIME.
 *
 * The Workers' jobs (Jobs/DataSecurity/*) are thin: they decide what is
 * due and call these. Each turn reads within the project's limits
 * (DataSecuritySetting), writes what it found through the discovery and
 * finding writers, and queues the project's evaluation; nothing here
 * decides an issue.
 *
 * What may be read is the cloud connection's own decision: its
 * `dataSecurity` setting says whether the role was granted the
 * configuration reads, and the content reads on top. Without the content
 * grant a bucket is checked, never sampled.
 */

// How long a content or configuration turn may run.
export const DATA_SECURITY_TURN_TIME_LIMIT_IN_MS: number = 8 * 60 * 1000;

// How often a connection's configuration is read when nothing changed.
export const CONFIGURATION_READ_INTERVAL_IN_HOURS: number = 24;

// The most containers of one Azure storage account one scan samples.
const MAX_CONTAINERS_PER_ACCOUNT: number = 10;

/*
 * Cloud audit operations that change a store's exposure, encryption or
 * sharing: one of them makes the connection's next read due at once.
 */
export const POSTURE_CHANGING_OPERATIONS: ReadonlyArray<string> = [
  "s3:PutBucketPolicy",
  "s3:DeleteBucketPolicy",
  "s3:PutBucketAcl",
  "s3:PutObjectAcl",
  "s3:PutPublicAccessBlock",
  "s3:DeletePublicAccessBlock",
  "s3:PutAccountPublicAccessBlock",
  "s3:DeleteAccountPublicAccessBlock",
  "s3:PutBucketEncryption",
  "s3:DeleteBucketEncryption",
  "s3:PutBucketVersioning",
  "s3:PutBucketLogging",
  "s3:PutBucketReplication",
  "s3:CreateBucket",
  "s3:DeleteBucket",
  "rds:ModifyDBInstance",
  "rds:ModifyDBCluster",
  "rds:ModifyDBSnapshotAttribute",
  "rds:ModifyDBClusterSnapshotAttribute",
  "rds:CreateDBInstance",
  "rds:CopyDBSnapshot",
  "rds:StartExportTask",
  "dynamodb:UpdateContinuousBackups",
  "dynamodb:UpdateTable",
  "redshift:ModifyCluster",
  "es:UpdateDomainConfig",
];

// What the connection's setup granted Data Security: off until someone opts in.
export function getConnectionDataSecurityLevel(
  config: JSONObject | undefined,
): CloudConnectionDataSecurityLevel {
  return getCloudConnectionDataSecurityLevel(
    config ? config[DATA_SECURITY_FIELD_KEY] : undefined,
  );
}

/*
 * The project's own key for fingerprints: two projects' never compare. The
 * one derivation every scan uses - a worker's here, and a probe's, which is
 * handed it with its work (ProbeIngest/DataSecurity) - so a store a probe
 * scanned and one a worker scanned compare like any two stores.
 */
export function getFingerprintKey(projectId: ObjectID): string {
  return deriveFingerprintKey(
    EncryptionSecret.toString(),
    projectId.toString(),
  );
}

interface ScanSetup {
  setting: DataSecuritySetting;
  options: ContentScanOptions;
  customTypes: Map<string, CustomDataTypeSummary>;
}

export default class DataSecurityRunner {
  // Every project with something Data Security may watch.
  public static async listProjectIds(): Promise<Array<ObjectID>> {
    const rows: Array<{ projectId: string }> =
      await DataStoreService.getRepository().manager.query(
        `SELECT DISTINCT "projectId" FROM "DataStore" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "CloudConnection" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "DatabaseServer" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "Service" WHERE "deletedAt" IS NULL AND "lastSeenAt" > now() - interval '1 day'
         LIMIT 20000`,
      );

    return rows
      .filter((row: { projectId: string }) => {
        return ObjectID.isValidUUID(row.projectId);
      })
      .map((row: { projectId: string }) => {
        return new ObjectID(row.projectId);
      });
  }

  public static async getScanSetup(
    projectId: ObjectID,
    store?: DataStore | undefined,
  ): Promise<ScanSetup> {
    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(projectId);
    const rows: Array<DataSecurityCustomDataType> =
      await DataSecurityCustomDataTypeService.findBy({
        query: { projectId, isEnabled: true },
        select: {
          _id: true,
          name: true,
          category: true,
          sensitivity: true,
          pattern: true,
          ignoreCase: true,
          keywords: true,
          requiresKeyword: true,
          nameHints: true,
          validator: true,
        },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });
    const customDetectors: Array<ScanDetector> = [];
    const extraHints: Array<{ dataTypeId: string; hints: Array<string> }> = [];
    const customTypes: Map<string, CustomDataTypeSummary> = new Map();

    for (const row of rows) {
      if (!row.id) {
        continue;
      }

      const dataTypeId: string = customDataTypeId(row.id.toString());
      const detector: ScanDetector | null = compileCustomDataType({
        dataTypeId,
        pattern: row.pattern,
        ignoreCase: row.ignoreCase,
        keywords: row.keywords,
        requiresKeyword: row.requiresKeyword,
        nameHints: row.nameHints,
        validator: row.validator as CustomDataTypeValidator | undefined,
      });

      if (detector) {
        customDetectors.push(detector);
      }

      if ((row.nameHints || []).length > 0) {
        extraHints.push({ dataTypeId, hints: row.nameHints || [] });
      }

      if (row.category && row.sensitivity) {
        customTypes.set(dataTypeId, {
          name: row.name || "Custom data type",
          category: row.category,
          sensitivity: row.sensitivity,
        });
      }
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    return {
      setting,
      customTypes,
      options: {
        limits: {
          maxObjects: setting.maxObjectsPerScan || 2000,
          maxBytesPerObject: setting.maxBytesPerObject || 65536,
          maxBytesTotal: setting.maxBytesPerScan || 52428800,
          maxRowsPerTable: setting.maxRowsPerTable || 1000,
          maxTables: setting.maxTablesPerScan || 200,
          deadline: new Date(
            now.getTime() + DATA_SECURITY_TURN_TIME_LIMIT_IN_MS,
          ),
        },
        customDetectors,
        extraHints,
        disabledDataTypeIds: new Set(setting.disabledDataTypeIds || []),
        allowedValues: new Set(
          (setting.allowedValues || []).map((value: string) => {
            return value.trim().toLowerCase();
          }),
        ),
        exclusions: store?.scanExclusions || [],
        previousState:
          (store?.contentScanState as JSONObject | undefined) || undefined,
        fingerprintKey: getFingerprintKey(projectId),
      },
    };
  }

  /*
   * Connections whose data-security read is due: on for configuration or
   * content, enabled, and not read for a day - or changed since, by a
   * cloud audit event that touches a store's exposure.
   */
  public static async dueConnections(): Promise<
    Array<{ projectId: ObjectID; cloudConnectionId: ObjectID }>
  > {
    const connections: Array<CloudConnection> =
      await CloudConnectionService.findBy({
        query: { isEnabled: true },
        select: { _id: true, projectId: true, config: true },
        skip: 0,
        limit: 5000,
        props: { isRoot: true },
      });
    const due: Array<{ projectId: ObjectID; cloudConnectionId: ObjectID }> = [];
    const since: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -CONFIGURATION_READ_INTERVAL_IN_HOURS,
    );
    const changedProjects: Set<string> = await this.projectsWithPostureChanges(
      OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1),
    );

    // The connections read in the last day, in one query.
    const recentReads: Array<DataSecurityScan> =
      await DataSecurityScanService.findBy({
        query: {
          kind: DataSecurityScanKind.Configuration,
          startedAt: QueryHelper.greaterThanEqualTo(since),
        },
        select: { cloudConnectionId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const readRecently: Set<string> = new Set();

    for (const read of recentReads) {
      if (read.cloudConnectionId) {
        readRecently.add(read.cloudConnectionId.toString());
      }
    }

    for (const connection of connections) {
      if (
        !connection.id ||
        !connection.projectId ||
        getConnectionDataSecurityLevel(connection.config) === "off"
      ) {
        continue;
      }

      if (
        !readRecently.has(connection.id.toString()) ||
        changedProjects.has(connection.projectId.toString())
      ) {
        due.push({
          projectId: connection.projectId,
          cloudConnectionId: connection.id,
        });
      }
    }

    return due;
  }

  private static async projectsWithPostureChanges(
    since: Date,
  ): Promise<Set<string>> {
    try {
      const statement: Statement = SQL`SELECT DISTINCT projectId FROM `;
      statement.append(
        `${getClickhouseDatabaseName()}.${AnalyticsTableName.ChangeEvent}`,
      );
      statement.append(
        SQL` WHERE time >= ${{
          type: TableColumnType.Date,
          value: since,
        }} AND attributes['oneuptime.change.source'] = 'cloud' AND attributes['oneuptime.cloud.operation'] IN (${{
          type: TableColumnType.Text,
          value: new Includes([...POSTURE_CHANGING_OPERATIONS]),
        }}) AND retentionDate >= now() LIMIT 10000`,
      );
      statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

      const result: Results = await ChangeEventService.executeQuery(statement);
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();

      return new Set(
        ((response.data || []) as Array<JSONObject>).map((row: JSONObject) => {
          return String(row["projectId"] || "");
        }),
      );
    } catch (error) {
      logger.error("DataSecurity: could not read cloud changes:");
      logger.error(error);
      return new Set();
    }
  }

  // Reads one connection's stores' configuration and access, and records it.
  public static async readConnection(
    projectId: ObjectID,
    cloudConnectionId: ObjectID,
  ): Promise<void> {
    const startedAt: Date = OneUptimeDate.getCurrentDate();
    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: { _id: cloudConnectionId, projectId },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
        },
        props: { isRoot: true },
      });

    if (
      !connection ||
      !connection.isEnabled ||
      getConnectionDataSecurityLevel(connection.config) === "off"
    ) {
      return;
    }

    try {
      const settings: CloudConnectionSettings =
        await CloudConnectionService.getConnectorSettings(connection);
      const accounts: Array<string> = await this.connectedAccounts(
        projectId,
        connection.provider,
      );
      let result: CloudDataSecurityReadResult;
      let provider: DataStoreProvider;

      if (connection.provider === CloudProvider.AWS) {
        provider = DataStoreProvider.Aws;
        result = await readAwsDataSecurity(settings, {
          projectId,
          connectionId: cloudConnectionId,
          connectedAccountIds: accounts,
        });
      } else if (connection.provider === CloudProvider.Azure) {
        provider = DataStoreProvider.Azure;
        result = await readAzureDataSecurity(settings, {
          projectId: projectId.toString(),
          connectionId: cloudConnectionId.toString(),
          connectedSubscriptionIds: accounts,
        });
      } else {
        provider = DataStoreProvider.Gcp;
        result = await readGcpDataSecurity(settings, {
          projectId: projectId.toString(),
          connectionId: cloudConnectionId.toString(),
          connectedProjectIds: accounts,
        });
      }

      const recorded: number = await DataSecurityDiscovery.recordCloudReads({
        projectId,
        cloudConnectionId,
        provider,
        result,
      });

      const scan: DataSecurityScan = new DataSecurityScan();
      scan.projectId = projectId;
      scan.cloudConnectionId = cloudConnectionId;
      scan.kind = DataSecurityScanKind.Configuration;
      scan.status = result.complete
        ? DataSecurityScanStatus.Succeeded
        : DataSecurityScanStatus.PartlySucceeded;
      scan.startedAt = startedAt;
      scan.finishedAt = OneUptimeDate.getCurrentDate();
      scan.durationInMs = scan.finishedAt.getTime() - startedAt.getTime();
      scan.storesRead = recorded;
      scan.findingsFound = 0;
      scan.readLog = result.stores
        .slice(0, 200)
        .map((store: { identity: { name: string } }) => {
          return store.identity.name.slice(0, 300);
        });
      scan.warnings = result.warnings.slice(0, 50).map((warning: string) => {
        return warning.slice(0, 500);
      });

      await DataSecurityScanService.create({
        data: scan,
        props: { isRoot: true },
      });
    } catch (error) {
      await DataSecurityFindingWriter.recordFailedScan({
        projectId,
        cloudConnectionId,
        kind: DataSecurityScanKind.Configuration,
        startedAt,
        errorMessage:
          error instanceof Error ? error.message : "The read failed.",
      });
    }
  }

  // The account ids the project has connected for a cloud, for "external".
  public static async connectedAccounts(
    projectId: ObjectID,
    provider: CloudProvider | undefined,
  ): Promise<Array<string>> {
    const rows: Array<{ accountId: string }> =
      await DataStoreService.getRepository().manager.query(
        `SELECT DISTINCT "accountId" FROM "CloudAccount" WHERE "projectId" = $1 AND "provider" = $2 AND "deletedAt" IS NULL LIMIT 5000`,
        [projectId.toString(), provider || ""],
      );

    return rows
      .map((row: { accountId: string }) => {
        return row.accountId;
      })
      .filter((accountId: string) => {
        return Boolean(accountId);
      });
  }

  /*
   * Stores whose content is due, claimed: their next scan time moves
   * forward before the work is queued, so two workers never take one.
   * Stores scanned from a probe are the probe's to claim.
   */
  public static async claimDueStores(
    limit: number,
  ): Promise<Array<{ projectId: ObjectID; dataStoreId: ObjectID }>> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const scannableKinds: Array<string> = [
      DataStoreKind.AwsS3Bucket,
      DataStoreKind.AzureStorageAccount,
      DataStoreKind.GcpStorageBucket,
      DataStoreKind.GcpBigQueryDataset,
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
    ];
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        isArchived: false,
        isContentScanEnabled: true,
        kind: new Includes(scannableKinds),
        nextContentScanAt: QueryHelper.lessThanEqualToOrNull(now),
        scanProbeId: QueryHelper.isNull(),
      },
      select: { _id: true, projectId: true },
      skip: 0,
      limit,
      props: { isRoot: true },
    });
    const claimed: Array<{ projectId: ObjectID; dataStoreId: ObjectID }> = [];

    for (const store of stores) {
      if (!store.id || !store.projectId) {
        continue;
      }

      // An hour's hold: the scan sets the real next time when it ends.
      await DataStoreService.updateColumnsByIdWithoutHooks({
        id: store.id,
        data: { nextContentScanAt: OneUptimeDate.addRemoveHours(now, 1) },
      });

      claimed.push({ projectId: store.projectId, dataStoreId: store.id });
    }

    return claimed;
  }

  public static async scanStore(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<void> {
    const startedAt: Date = OneUptimeDate.getCurrentDate();
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: dataStoreId, projectId },
      select: {
        _id: true,
        kind: true,
        name: true,
        region: true,
        cloudAccountNumber: true,
        cloudConnectionId: true,
        providerResourceId: true,
        connectionString: true,
        scanExclusions: true,
        contentScanState: true,
        isContentScanEnabled: true,
        scanProbeId: true,
      },
      props: { isRoot: true },
    });

    if (!store?.id || !store.isContentScanEnabled || store.scanProbeId) {
      return;
    }

    const setup: ScanSetup = await this.getScanSetup(projectId, store);

    if (setup.setting.isContentScanEnabled === false) {
      return;
    }

    try {
      const result: ContentScanResult | null = await this.sampleStore(
        projectId,
        store,
        setup.options,
      );

      if (!result) {
        await DataSecurityFindingWriter.recordFailedScan({
          projectId,
          dataStoreId,
          kind: DataSecurityScanKind.Content,
          startedAt,
          status: DataSecurityScanStatus.Skipped,
          errorMessage:
            "Content scanning needs the connection's content permission, or a connection string for a database.",
        });
        return;
      }

      await DataSecurityFindingWriter.recordContentScan({
        projectId,
        dataStoreId,
        kind: DataSecurityScanKind.Content,
        result,
        startedAt,
        keepMaskedSamples: setup.setting.keepMaskedSamples !== false,
        contentScanIntervalInHours:
          setup.setting.contentScanIntervalInHours || 24,
        customDataTypes: setup.customTypes,
      });
    } catch (error) {
      await DataSecurityFindingWriter.recordFailedScan({
        projectId,
        dataStoreId,
        kind: DataSecurityScanKind.Content,
        startedAt,
        errorMessage:
          error instanceof Error ? error.message : "The scan failed.",
      });
    }
  }

  // The scanner each kind of store is read with, or null when none may run.
  private static async sampleStore(
    projectId: ObjectID,
    store: DataStore,
    options: ContentScanOptions,
  ): Promise<ContentScanResult | null> {
    const info: DataStoreKindInfo | undefined = getDataStoreKindInfo(
      store.kind,
    );

    if (!info?.contentScannable) {
      return null;
    }

    if (info.provider === DataStoreProvider.SelfManaged) {
      if (!store.connectionString) {
        return null;
      }

      return sampleDatabase(
        {
          engine:
            store.kind === DataStoreKind.MySql
              ? "mysql"
              : store.kind === DataStoreKind.SqlServer
                ? "sqlserver"
                : "postgresql",
          connectionString: store.connectionString,
        },
        options,
      );
    }

    if (!store.cloudConnectionId) {
      return null;
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: { _id: store.cloudConnectionId, projectId },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

    if (
      !connection ||
      getConnectionDataSecurityLevel(connection.config) !== "content"
    ) {
      return null;
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    const name: string = store.name || "";

    if (store.kind === DataStoreKind.AwsS3Bucket) {
      const reader: ObjectStoreReader = createAwsObjectStoreReader(settings, {
        connectionId: connection.id!,
        bucket: name,
        region: store.region || "us-east-1",
        accountNumber: store.cloudAccountNumber || "",
      });

      return sampleObjectStore(reader, options);
    }

    if (store.kind === DataStoreKind.GcpStorageBucket) {
      return sampleObjectStore(
        createGcsObjectStoreReader(settings, {
          connectionId: connection.id!.toString(),
          bucket: name,
        }),
        options,
      );
    }

    if (store.kind === DataStoreKind.AzureStorageAccount) {
      const containers: Array<string> = await listAzureBlobContainers(
        settings,
        {
          connectionId: connection.id!.toString(),
          accountName: name,
        },
      );
      const merged: ContentScanResult = emptyContentScanResult();

      for (const containerName of containers.slice(
        0,
        MAX_CONTAINERS_PER_ACCOUNT,
      )) {
        const part: ContentScanResult = await sampleObjectStore(
          createAzureBlobObjectStoreReader(settings, {
            connectionId: connection.id!.toString(),
            accountName: name,
            containerName,
          }),
          options,
        );

        this.mergeInto(merged, part, `${containerName}/`);
      }

      merged.isComplete =
        merged.isComplete && containers.length <= MAX_CONTAINERS_PER_ACCOUNT;

      return merged;
    }

    if (store.kind === DataStoreKind.GcpBigQueryDataset) {
      return this.sampleBigQuery(
        settings,
        connection.id!.toString(),
        store,
        options,
      );
    }

    return null;
  }

  private static mergeInto(
    target: ContentScanResult,
    part: ContentScanResult,
    prefix: string,
  ): void {
    for (const location of part.locations) {
      target.locations.push({
        ...location,
        location: prefix + location.location,
      });
    }

    target.readLog.push(
      ...part.readLog.map((entry: string) => {
        return prefix + entry;
      }),
    );
    target.objectsRead += part.objectsRead;
    target.rowsRead += part.rowsRead;
    target.bytesRead += part.bytesRead;
    target.warnings.push(...part.warnings);
    target.plaintextPasswordFields.push(...part.plaintextPasswordFields);
    target.isComplete = target.isComplete && part.isComplete;

    for (const [dataTypeId, sketch] of Object.entries(part.fingerprints)) {
      if (!target.fingerprints[dataTypeId]) {
        target.fingerprints[dataTypeId] = sketch;
      }
    }

    if (typeof part.estimatedRecords === "number") {
      target.estimatedRecords =
        (target.estimatedRecords || 0) + part.estimatedRecords;
    }
  }

  private static async sampleBigQuery(
    settings: CloudConnectionSettings,
    connectionId: string,
    store: DataStore,
    options: ContentScanOptions,
  ): Promise<ContentScanResult> {
    const [projectPart, datasetPart] = (store.providerResourceId || "")
      .replace(/^.*\/projects\//, "")
      .split("/datasets/");
    const sample: {
      tables: Array<{
        table: string;
        columns: Array<string>;
        rows: Array<Record<string, unknown>>;
      }>;
      warnings: Array<string>;
    } = await readBigQuerySample(settings, {
      connectionId,
      projectId: projectPart || store.cloudAccountNumber || "",
      datasetId: datasetPart || store.name || "",
      maxTables: options.limits.maxTables,
      maxRowsPerTable: options.limits.maxRowsPerTable,
    });
    const result: ContentScanResult = emptyContentScanResult();
    const highConfidence: Map<string, Array<string>> = new Map();

    for (const table of sample.tables) {
      const collector: FieldCollector = new FieldCollector();

      for (const row of table.rows) {
        collector.addRecord(row);
      }

      result.readLog.push(table.table);
      result.rowsRead += table.rows.length;

      const locations: Array<LocationFindings> = [];

      for (const field of collector.getFields()) {
        const classifications: Array<FieldClassification> = classifyField(
          field.path,
          field.values,
          {
            // Every built-in detector, and the project's own types beside them.
            detectors:
              options.customDetectors.length > 0
                ? [...BUILT_IN_DETECTORS, ...options.customDetectors]
                : undefined,
            disabledDataTypeIds: options.disabledDataTypeIds,
            allowedValues: options.allowedValues,
            extraHints: options.extraHints,
          },
        );

        if (classifications.length > 0) {
          locations.push({
            location: `${table.table}.${field.path}`,
            locationKind: DataStoreLocationKind.Column,
            classifications,
          });
        }

        this.collectForFingerprint(field, classifications, highConfidence);
      }

      result.locations.push(...locations);
    }

    for (const [dataTypeId, values] of highConfidence) {
      result.fingerprints[dataTypeId] = buildFingerprint(
        values,
        options.fingerprintKey,
      );
    }

    result.warnings.push(...sample.warnings);
    result.isComplete = sample.tables.length < options.limits.maxTables;

    return result;
  }

  private static collectForFingerprint(
    field: CollectedField,
    classifications: Array<FieldClassification>,
    into: Map<string, Array<string>>,
  ): void {
    for (const classification of classifications) {
      if (classification.confidence !== "High" || classification.isFreeText) {
        continue;
      }

      const values: Array<string> = into.get(classification.dataTypeId) || [];

      for (const value of field.values) {
        if (typeof value === "string" && values.length < 2000) {
          values.push(value.trim().toLowerCase());
        }
      }

      into.set(classification.dataTypeId, values);
    }
  }

  /*
   * Scans a project's telemetry: each service's logs, traces, exceptions,
   * replays and AI conversations become stores of their own, and a finding
   * a scrub rule already masks is marked so.
   */
  public static async scanTelemetry(projectId: ObjectID): Promise<void> {
    const startedAt: Date = OneUptimeDate.getCurrentDate();
    const setup: ScanSetup = await this.getScanSetup(projectId);

    if (setup.setting.isTelemetryScanEnabled === false) {
      return;
    }

    const results: Array<{
      serviceId: string;
      serviceName?: string | undefined;
      kind: DataStoreKind;
      result: ContentScanResult;
    }> = await scanProjectTelemetry({
      projectId,
      sampleSize: setup.setting.telemetrySampleSize || 500,
      since: OneUptimeDate.addRemoveHours(startedAt, -1),
      options: setup.options,
    });
    /*
     * Which findings ingest already masks. When the scrub rules cannot be
     * read, findings keep the mark they had rather than all turning
     * "not scrubbed" at once.
     */
    let coverage: ScrubCoverage | null = null;

    try {
      coverage = await getScrubCoverage(projectId);
    } catch (error) {
      logger.error(
        `DataSecurity: could not read the scrub rules of project ${projectId.toString()}:`,
      );
      logger.error(error);
    }

    for (const item of results) {
      if (!ObjectID.isValidUUID(item.serviceId)) {
        continue;
      }

      const dataStoreId: ObjectID | null =
        await DataSecurityDiscovery.ensureTelemetryStore({
          projectId,
          serviceId: new ObjectID(item.serviceId),
          serviceName: item.serviceName || "Service",
          kind: item.kind,
        });

      if (!dataStoreId) {
        continue;
      }

      await DataSecurityFindingWriter.recordContentScan({
        projectId,
        dataStoreId,
        kind: DataSecurityScanKind.Telemetry,
        result: item.result,
        startedAt,
        keepMaskedSamples: setup.setting.keepMaskedSamples !== false,
        contentScanIntervalInHours: 1,
        customDataTypes: setup.customTypes,
      });

      if (coverage) {
        await this.markScrubbed(dataStoreId, item.kind, coverage);
      }
    }
  }

  private static async markScrubbed(
    dataStoreId: ObjectID,
    kind: DataStoreKind,
    coverage: ScrubCoverage,
  ): Promise<void> {
    const findings: Array<{
      id?: ObjectID | null;
      dataTypeId?: string;
      location?: string;
      isScrubbed?: boolean;
    }> = await DataStoreFindingService.findBy({
      query: { dataStoreId },
      select: { _id: true, dataTypeId: true, location: true, isScrubbed: true },
      skip: 0,
      limit: 2000,
      props: { isRoot: true },
    });

    for (const finding of findings) {
      if (!finding.id || !finding.dataTypeId || !finding.location) {
        continue;
      }

      const scrubbed: boolean = isFindingScrubbed(coverage, {
        kind,
        dataTypeId: finding.dataTypeId,
        location: finding.location,
      });

      if (scrubbed !== Boolean(finding.isScrubbed)) {
        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: finding.id,
          data: { isScrubbed: scrubbed },
        });
      }
    }
  }
}
