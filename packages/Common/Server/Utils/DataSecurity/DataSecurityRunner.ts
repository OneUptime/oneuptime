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
import { EncryptionSecret, IsBillingEnabled } from "../../EnvironmentConfig";
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
import {
  capObjectStoreState,
  MAX_STATE_ENTRIES,
  sampleObjectStore,
} from "./Content/ObjectStoreSampler";
import { DatabaseConnection, sampleDatabase } from "./Content/DatabaseSampler";
import { sampleSearchStore } from "./Content/SearchStoreSampler";
import {
  createSearchTransport,
  getWorkersPostureReadFrom,
} from "./Content/SearchStoreHttp";
import { assertDatabaseConnectionAllowed } from "../DataObservability/DatabaseConnectionGuard";
import DataSecurityDiscovery from "./DataSecurityDiscovery";
import { queueDataStoreOwnerProposals } from "./DataSecurityJobs";
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
  MAX_UNPLACED_FIELDS_PER_SCAN,
} from "./DataSecurityScanTypes";
import { buildFingerprint, deriveFingerprintKey } from "./Fingerprint";
import {
  CONTENT_STORE_KEY,
  createModelScanContext,
  getModelWarnings,
  recognizeFields,
} from "./Model/ModelScan";
import { ModelRecognitions } from "../../../Utils/DataSecurity/Model/RecognizedEntity";
import {
  ModelTurnTracker,
  readModelResumeAt,
  rotateForModel,
  withModelResumeAt,
} from "./Model/ModelTurns";
import {
  claimDueDataStoresForWorkers,
  isDataStoreContentScannableByWorkers,
} from "./DataSecurityWorkerClaim";
import {
  getTelemetryOwnersNotScanned,
  isProjectTelemetryScannable,
  isTelemetryOwnerNotScanned,
} from "./DataSecurityTelemetryScanRule";
import { ClaimedDataStore } from "./DataSecurityProbeClaim";
import {
  readMetricRotationCursor,
  scanProjectTelemetry,
  TelemetryOwnersNotScanned,
} from "./Telemetry/TelemetryDataScanner";
import {
  getScrubCoverage,
  isFindingScrubbed,
  readFoundByOf,
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
  isSearchEngineDataStoreKind,
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
import {
  countShadowField,
  mergeShadowCounts,
  ShadowCounts,
} from "../../../Utils/DataSecurity/ShadowCount";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";
import {
  describeUnplacedField,
  MAX_UNPLACED_LOCATION_LENGTH,
  UnplacedField,
} from "../../../Utils/DataSecurity/UnplacedFields";
import DataTypeProving from "./DataTypeProving";
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

// Where a storage account's state keeps each of its containers' (sampleStorageAccount).
export const CONTAINER_STATES_KEY: string = "containers";

// Each container's state as an account's last scan kept it, by container.
export function readContainerStates(state: JSONObject | undefined): JSONObject {
  const containers: unknown = state?.[CONTAINER_STATES_KEY];

  return containers &&
    typeof containers === "object" &&
    !Array.isArray(containers)
    ? (containers as JSONObject)
    : {};
}

/*
 * Cloud audit operations that change a store's exposure, encryption or
 * sharing: one of them makes the connection's next read due at once. By
 * the names the activity log records them under: a bucket's public access
 * block is PutBucketPublicAccessBlock and DeleteBucketPublicAccessBlock in
 * CloudTrail, not S3's API names PutPublicAccessBlock and
 * DeletePublicAccessBlock.
 */
export const POSTURE_CHANGING_OPERATIONS: ReadonlyArray<string> = [
  "s3:PutBucketPolicy",
  "s3:DeleteBucketPolicy",
  "s3:PutBucketAcl",
  "s3:PutObjectAcl",
  "s3:PutBucketPublicAccessBlock",
  "s3:DeleteBucketPublicAccessBlock",
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
  /*
   * Every project with something Data Security may watch - and, so the
   * stores OneUptime keeps for a project's security are declared without
   * anyone opening Data Security first (DeclaredDataStores, #10398), every
   * project whose Security Events reads something or whose devices report
   * network flows.
   */
  public static async listProjectIds(): Promise<Array<ObjectID>> {
    const rows: Array<{ projectId: string }> =
      await DataStoreService.getRepository().manager.query(
        `SELECT DISTINCT "projectId" FROM "DataStore" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "CloudConnection" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "DatabaseServer" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "Service" WHERE "deletedAt" IS NULL AND "lastSeenAt" > now() - interval '1 day'
         UNION SELECT DISTINCT "projectId" FROM "SecurityEventConnection" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "SecurityLogSource" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "SecurityTelemetrySource" WHERE "deletedAt" IS NULL
         UNION SELECT DISTINCT "projectId" FROM "NetworkDevice" WHERE "deletedAt" IS NULL
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

  /*
   * `model` says which scan the setup is for, and so whether the project's
   * names-and-addresses switch for it is on: content scans read free text
   * with the model unless the project turned it off; the hourly telemetry
   * scan only when the project turned it on.
   */
  public static async getScanSetup(
    projectId: ObjectID,
    store?: DataStore | undefined,
    model: "content" | "telemetry" | "none" = "none",
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
        model: await createModelScanContext({
          /*
           * Telemetry needs both switches: its own sits under the content
           * one on the settings page, and does nothing with that one off.
           */
          isEnabled:
            model === "content"
              ? setting.isModelScanEnabled !== false
              : model === "telemetry"
                ? setting.isModelScanEnabled !== false &&
                  setting.isTelemetryModelScanEnabled === true
                : false,
          scope: model === "telemetry" ? "telemetry" : "content",
          place: "server",
        }),
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

      await this.proposeOwnersAfterFirstRead({ projectId, cloudConnectionId });
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

  /*
   * A connection read for the first time: OneUptime AI proposes owners for
   * the stores it found (#10374), under the project's switches and AI
   * rules (DataStoreOwnerProposalRun). Only the first read that worked
   * counts. Never fails the read.
   */
  private static async proposeOwnersAfterFirstRead(data: {
    projectId: ObjectID;
    cloudConnectionId: ObjectID;
  }): Promise<void> {
    try {
      const reads: number = (
        await DataSecurityScanService.countBy({
          query: {
            projectId: data.projectId,
            cloudConnectionId: data.cloudConnectionId,
            kind: DataSecurityScanKind.Configuration,
            status: QueryHelper.any([
              DataSecurityScanStatus.Succeeded,
              DataSecurityScanStatus.PartlySucceeded,
            ]),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (reads === 1) {
        await queueDataStoreOwnerProposals(data);
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not have OneUptime AI propose owners after connection ${data.cloudConnectionId.toString()}'s first read:`,
      );
      logger.error(error);
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
   * Stores whose content is due, claimed in one statement that holds each
   * an hour on (DataSecurityWorkerClaim): only those a worker may scan -
   * content scanning on for the store and the project, not archived, of a
   * kind a worker samples, of a project that is served - the longest
   * overdue first. Stores scanned from a probe are the probe's to claim.
   */
  public static async claimDueStores(
    limit: number,
  ): Promise<Array<{ projectId: ObjectID; dataStoreId: ObjectID }>> {
    const claimed: Array<{ projectId: ObjectID; dataStoreId: ObjectID }> = [];

    const rows: Array<ClaimedDataStore> = await claimDueDataStoresForWorkers({
      limit,
    });

    for (const row of rows) {
      if (
        !ObjectID.isValidUUID(row._id) ||
        !ObjectID.isValidUUID(row.projectId)
      ) {
        continue;
      }

      claimed.push({
        projectId: new ObjectID(row.projectId),
        dataStoreId: new ObjectID(row._id),
      });
    }

    return claimed;
  }

  /*
   * Samples one store's content. Before it reads anything it asks the
   * claim's rule again (isDataStoreContentScannableByWorkers): a store
   * whose switch was turned off, or whose project turned content scanning
   * off or stopped being served, after it was claimed - or one Scan Now
   * queued - is left alone. It asks once more before it writes what it
   * read, so the same turned off while it read keeps nothing of the scan.
   */
  public static async scanStore(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<void> {
    const startedAt: Date = OneUptimeDate.getCurrentDate();

    if (
      !(await isDataStoreContentScannableByWorkers({ projectId, dataStoreId }))
    ) {
      return;
    }

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

    const setup: ScanSetup = await this.getScanSetup(
      projectId,
      store,
      "content",
    );

    if (setup.setting.isContentScanEnabled === false) {
      return;
    }

    // The data types OneUptime AI drafted from its fields, counted in shadow (#10371).
    setup.options.shadowDetectors =
      await DataTypeProving.getShadowDetectorsForStore({
        projectId,
        dataStoreId,
      });

    try {
      const result: ContentScanResult | null = await this.sampleStore(
        projectId,
        store,
        setup.options,
      );

      /*
       * And again before anything of the scan is written. A scan reads for
       * minutes (8 for a bucket), and a store whose switch, or whose
       * project's, was turned off in that time, or whose project was
       * suspended, keeps no finding and no masked sample of it - as a
       * probe's result is not kept then either (OneUptime issue #8391), and
       * as the telemetry scan asks again before it writes.
       */
      if (
        !(await isDataStoreContentScannableByWorkers({
          projectId,
          dataStoreId,
        }))
      ) {
        return;
      }

      // What the names-and-addresses model read, and whether its time ran out.
      if (result) {
        for (const warning of getModelWarnings(
          setup.options.model,
          CONTENT_STORE_KEY,
        )) {
          if (!result.warnings.includes(warning)) {
            result.warnings.push(warning);
          }
        }
      }

      if (!result) {
        await DataSecurityFindingWriter.recordFailedScan({
          projectId,
          dataStoreId,
          kind: DataSecurityScanKind.Content,
          startedAt,
          status: DataSecurityScanStatus.Skipped,
          errorMessage:
            "Content scanning needs the connection's content permission, or a connection string for a store you run.",
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

      /*
       * A search cluster, over its HTTP API (#11140): every request
       * guarded as a data source's is, and its exposure checked from
       * where the workers run.
       */
      if (isSearchEngineDataStoreKind(store.kind)) {
        return await sampleSearchStore(
          { kind: store.kind!, connectionString: store.connectionString },
          options,
          {
            transport: createSearchTransport(),
            readFrom: getWorkersPostureReadFrom(IsBillingEnabled),
          },
        );
      }

      const connection: DatabaseConnection = {
        engine:
          store.kind === DataStoreKind.MySql
            ? "mysql"
            : store.kind === DataStoreKind.SqlServer
              ? "sqlserver"
              : "postgresql",
        connectionString: store.connectionString,
      };

      await assertDatabaseConnectionAllowed(connection);

      return sampleDatabase(connection, options);
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

      return this.sampleStorageAccount({
        containers,
        options,
        readerOf: (containerName: string): ObjectStoreReader => {
          return createAzureBlobObjectStoreReader(settings, {
            connectionId: connection.id!.toString(),
            accountName: name,
            containerName,
          });
        },
      });
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

  /*
   * A storage account's containers, each sampled as a bucket is, as one
   * store's result. Each container keeps its own state - what it read and
   * when, what the model had no time for - which used to be lost, so every
   * scan of an account read the same newest objects again. With the model
   * on, the containers take turns at its time as tables do (#10928): the
   * first is the one it stopped in.
   */
  public static async sampleStorageAccount(data: {
    containers: ReadonlyArray<string>;
    options: ContentScanOptions;
    readerOf: (containerName: string) => ObjectStoreReader;
    sample?: typeof sampleObjectStore | undefined;
  }): Promise<ContentScanResult> {
    const merged: ContentScanResult = emptyContentScanResult();
    const previous: JSONObject | undefined = data.options.previousState;
    const previousContainers: JSONObject = readContainerStates(previous);
    const resumeAt: string | null = readModelResumeAt(previous);
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: data.options.model,
      previous: resumeAt,
    });
    const sampled: Array<string> = data.containers.slice(
      0,
      MAX_CONTAINERS_PER_ACCOUNT,
    );
    const ordered: Array<string> = turn.isTurning
      ? rotateForModel(
          sampled,
          (containerName: string): string => {
            return containerName;
          },
          resumeAt,
        )
      : sampled;
    // Every container's state together no larger than one bucket's.
    const entriesPerContainer: number = Math.max(
      1,
      Math.floor(MAX_STATE_ENTRIES / Math.max(1, ordered.length)),
    );
    const nextContainers: JSONObject = {};

    for (const [index, containerName] of ordered.entries()) {
      const containerState: unknown = previousContainers[containerName];

      turn.begin();

      const part: ContentScanResult = await (data.sample || sampleObjectStore)(
        data.readerOf(containerName),
        {
          ...data.options,
          previousState:
            containerState &&
            typeof containerState === "object" &&
            !Array.isArray(containerState)
              ? (containerState as JSONObject)
              : undefined,
        },
      );

      turn.end(containerName, ordered[(index + 1) % ordered.length] || null);
      this.mergeInto(merged, part, `${containerName}/`);

      const capped: JSONObject | undefined = capObjectStoreState(
        part.nextState,
        entriesPerContainer,
      );

      if (capped) {
        nextContainers[containerName] = capped;
      }
    }

    merged.isComplete =
      merged.isComplete && data.containers.length <= MAX_CONTAINERS_PER_ACCOUNT;

    // An account with no container keeps nothing: there is nothing to skip next time.
    if (ordered.length === 0) {
      return merged;
    }

    merged.nextState = { [CONTAINER_STATES_KEY]: nextContainers };

    if (turn.isTurning) {
      merged.nextState = withModelResumeAt(merged.nextState, turn.nextResumeAt);
    }

    return merged;
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

    const unplacedFields: Array<UnplacedField> = target.unplacedFields || [];

    for (const unplaced of part.unplacedFields || []) {
      if (unplacedFields.length >= MAX_UNPLACED_FIELDS_PER_SCAN) {
        break;
      }

      const location: string = prefix + unplaced.location;

      if (location.length <= MAX_UNPLACED_LOCATION_LENGTH) {
        unplacedFields.push({ ...unplaced, location });
      }
    }

    target.unplacedFields = unplacedFields;

    if (part.shadowCounts) {
      target.shadowCounts = target.shadowCounts || {};
      mergeShadowCounts(target.shadowCounts, part.shadowCounts, prefix);
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
    const unplacedFields: Array<UnplacedField> = [];
    const shadowCounts: ShadowCounts = {};
    /*
     * With the model on, the dataset's tables take turns at its time
     * (#10928): read from the one it stopped at last scan.
     */
    const resumeAt: string | null = readModelResumeAt(options.previousState);
    const turn: ModelTurnTracker = new ModelTurnTracker({
      model: options.model,
      previous: resumeAt,
    });
    const tables: typeof sample.tables = turn.isTurning
      ? rotateForModel(
          sample.tables,
          (table: { table: string }): string => {
            return table.table;
          },
          resumeAt,
        )
      : sample.tables;

    for (const [index, table] of tables.entries()) {
      const collector: FieldCollector = new FieldCollector();

      for (const row of table.rows) {
        collector.addRecord(row);
      }

      result.readLog.push(table.table);
      result.rowsRead += table.rows.length;

      const locations: Array<LocationFindings> = [];

      // The names-and-addresses model reads the table's free-text columns.
      turn.begin();

      const recognitions: ModelRecognitions | undefined = await recognizeFields(
        options.model,
        CONTENT_STORE_KEY,
        collector.getFields(),
      );

      turn.end(table.table, tables[(index + 1) % tables.length]?.table || null);

      for (const field of collector.getFields()) {
        // The drafts run in shadow, each alone: counted, never found (#10371).
        countShadowField({
          counts: shadowCounts,
          detectors: options.shadowDetectors || [],
          location: `${table.table}.${field.path}`,
          values: field.values,
          allowedValues: options.allowedValues,
        });

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
            recognitions,
          },
        );

        if (classifications.length > 0) {
          locations.push({
            location: `${table.table}.${field.path}`,
            locationKind: DataStoreLocationKind.Column,
            classifications,
          });
        } else if (unplacedFields.length < MAX_UNPLACED_FIELDS_PER_SCAN) {
          // Not placed, nor known to be safe: described for OneUptime AI, never its values.
          const unplaced: UnplacedField | null = describeUnplacedField({
            path: `${table.table}.${field.path}`,
            values: field.values,
            neighbours: table.columns.map((column: string): string => {
              return `${table.table}.${column}`;
            }),
            locationKind: DataStoreLocationKind.Column,
          });

          if (unplaced) {
            unplacedFields.push(unplaced);
          }
        }

        this.collectForFingerprint(field, classifications, highConfidence);
      }

      result.locations.push(...locations);
    }

    result.unplacedFields = unplacedFields;

    if ((options.shadowDetectors || []).length > 0) {
      result.shadowCounts = shadowCounts;
    }

    for (const [dataTypeId, values] of highConfidence) {
      result.fingerprints[dataTypeId] = buildFingerprint(
        values,
        options.fingerprintKey,
      );
    }

    result.warnings.push(...sample.warnings);
    result.isComplete = sample.tables.length < options.limits.maxTables;

    if (turn.isTurning) {
      result.nextState = withModelResumeAt(result.nextState, turn.nextResumeAt);
    }

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
   * replays, AI conversations and metrics become stores of their own, and
   * a finding a scrub rule or a metric pipeline rule already masks is
   * marked so.
   *
   * Nothing is read of a project that is not served or that turned
   * telemetry scanning off, nor of a service whose store turned content
   * scanning off (DataSecurityTelemetryScanRule). Both are asked again
   * before anything is written, so a switch turned off while the scan ran
   * keeps what it read out of the findings.
   */
  public static async scanTelemetry(projectId: ObjectID): Promise<void> {
    const startedAt: Date = OneUptimeDate.getCurrentDate();

    if (!(await isProjectTelemetryScannable(projectId))) {
      return;
    }

    const setup: ScanSetup = await this.getScanSetup(
      projectId,
      undefined,
      "telemetry",
    );

    if (setup.setting.isTelemetryScanEnabled === false) {
      return;
    }

    const ownersNotScanned: TelemetryOwnersNotScanned | null =
      await this.readTelemetryOwnersNotScanned(projectId);

    // Which services must be left out is unknown: nothing is read.
    if (!ownersNotScanned) {
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
      ownersNotScanned,
      // Each service's metrics go on in turn from where the last scan stopped.
      metricCursors: await this.readMetricCursors(projectId),
      // The data types OneUptime AI drafted, counted in shadow on their stores (#10371).
      shadowDetectorsByStore:
        await DataTypeProving.getTelemetryShadowDetectors(projectId),
    });

    if (results.length === 0) {
      return;
    }

    // The switches again, as they are now: one turned off while it read wins.
    const ownersNotScannedNow: TelemetryOwnersNotScanned | null =
      (await isProjectTelemetryScannable(projectId))
        ? await this.readTelemetryOwnersNotScanned(projectId)
        : null;

    if (!ownersNotScannedNow) {
      return;
    }
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
      if (
        !ObjectID.isValidUUID(item.serviceId) ||
        isTelemetryOwnerNotScanned(
          ownersNotScannedNow,
          item.kind,
          item.serviceId,
        )
      ) {
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
        await this.markScrubbed(
          dataStoreId,
          item.kind,
          coverage,
          item.serviceId,
        );
      }
    }
  }

  /*
   * Where each service's metrics' rotation stopped, from its metrics store
   * (issue #9755): the scan reads the next ones in turn from there. When
   * the stores cannot be read, each rotation starts again from the start
   * of its ring - its metrics are still read, in the same order.
   */
  public static async readMetricCursors(
    projectId: ObjectID,
  ): Promise<Map<string, number>> {
    const cursors: Map<string, number> = new Map();

    try {
      const stores: Array<DataStore> = await DataStoreService.findBy({
        query: { projectId, kind: DataStoreKind.TelemetryMetrics },
        select: { _id: true, serviceId: true, contentScanState: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      for (const store of stores) {
        const serviceId: string = store.serviceId?.toString() || "";
        const cursor: number | undefined = readMetricRotationCursor(
          store.contentScanState,
        );

        if (serviceId && cursor !== undefined) {
          cursors.set(serviceId.toLowerCase(), cursor);
        }
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read where project ${projectId.toString()}'s metrics were read up to; each service's turn starts again:`,
      );
      logger.warn(error);
    }

    return cursors;
  }

  /*
   * The services whose telemetry store of a kind turned content scanning
   * off, or null when they cannot be read: then the scan reads nothing,
   * rather than read one a person turned off.
   */
  private static async readTelemetryOwnersNotScanned(
    projectId: ObjectID,
  ): Promise<TelemetryOwnersNotScanned | null> {
    try {
      return await getTelemetryOwnersNotScanned(projectId);
    } catch (error) {
      logger.error(
        `DataSecurity: could not read which telemetry stores of project ${projectId.toString()} turned content scanning off; its telemetry is not scanned this time:`,
      );
      logger.error(error);
      return null;
    }
  }

  /*
   * Which of a telemetry store's findings a rule already hides at ingest:
   * the store's service is named, as a metric pipeline rule may be its own.
   */
  private static async markScrubbed(
    dataStoreId: ObjectID,
    kind: DataStoreKind,
    coverage: ScrubCoverage,
    serviceId: string,
  ): Promise<void> {
    const findings: Array<{
      id?: ObjectID | null;
      dataTypeId?: string;
      location?: string;
      isScrubbed?: boolean;
      isFoundByContext?: boolean | null;
      isFoundByModel?: boolean;
    }> = await DataStoreFindingService.findBy({
      query: { dataStoreId },
      select: {
        _id: true,
        dataTypeId: true,
        location: true,
        isScrubbed: true,
        // How its values were found says whether a rule hides them (#11502).
        isFoundByContext: true,
        isFoundByModel: true,
      },
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
        serviceId,
        ...readFoundByOf(finding),
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
