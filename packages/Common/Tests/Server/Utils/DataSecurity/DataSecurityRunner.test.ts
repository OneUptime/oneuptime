import DataSecurityRunner, {
  CONFIGURATION_READ_INTERVAL_IN_HOURS,
  DATA_SECURITY_TURN_TIME_LIMIT_IN_MS,
  getConnectionDataSecurityLevel,
  getFingerprintKey,
} from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import * as AwsReader from "../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityReader";
import * as AzureReader from "../../../../Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityReader";
import * as GcpReader from "../../../../Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityReader";
import {
  CloudDataSecurityReadResult,
  ObjectStoreReader,
} from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import * as DatabaseSampler from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import * as ObjectStoreSampler from "../../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import DataSecurityDiscovery from "../../../../Server/Utils/DataSecurity/DataSecurityDiscovery";
import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
  DataSecurityScanKind,
  DataSecurityScanStatus,
} from "../../../../Server/Utils/DataSecurity/DataSecurityFindingWriter";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
} from "../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import * as TelemetryDataScanner from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import * as TelemetryScrubCoverage from "../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import { EncryptionSecret } from "../../../../Server/EnvironmentConfig";
import { deriveFingerprintKey } from "../../../../Server/Utils/DataSecurity/Fingerprint";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import DataSecurityCustomDataTypeService from "../../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityScanService from "../../../../Server/Services/DataSecurityScanService";
import DataSecuritySettingService from "../../../../Server/Services/DataSecuritySettingService";
import DataStoreFindingService from "../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import logger from "../../../../Server/Utils/Logger";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import DataSecurityCustomDataType from "../../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityScan from "../../../../Models/DatabaseModels/DataSecurityScan";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataCategory from "../../../../Types/DataSecurity/DataCategory";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../../Types/DataSecurity/DataStoreKind";
import { customDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The work behind each Data Security job (DataSecurityRunner): which
 * stores are due and claimed, each scan's limits and custom types from
 * the project's setting, what a cloud connection's own setting allows to
 * be read - its configuration, its content on top, or nothing - a storage
 * account's containers merged into one scan, and each project's telemetry
 * turned into stores of their own. The cloud readers, samplers, Postgres
 * and ClickHouse are stood in for; the runner's own decisions run as they
 * are.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (alias: string) => string;
}

let setting: DataSecuritySetting;
let customRows: Array<DataSecurityCustomDataType>;
let storeRow: DataStore | null;
let connectionRow: CloudConnection | null;
let accountRows: Array<{ accountId: string }>;
let settingsSpy: jest.SpyInstance;
let recordScanSpy: jest.SpyInstance;
let recordFailedSpy: jest.SpyInstance;
let sampleSpy: jest.SpyInstance;
let sampleDatabaseSpy: jest.SpyInstance;
let awsReaderSpy: jest.SpyInstance;
let gcsReaderSpy: jest.SpyInstance;
let azureReaderSpy: jest.SpyInstance;
let containersSpy: jest.SpyInstance;
let querySpy: jest.Mock;
let errorSpy: jest.SpyInstance;

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.AWS,
  projectId: PROJECT_ID.toString(),
  config: {},
  secrets: {},
};

function readerNamed(description: string): ObjectStoreReader {
  return {
    description,
    listObjects: async () => {
      return { objects: [] };
    },
    readObjectStart: async () => {
      return new Uint8Array();
    },
  };
}

function classification(
  dataTypeId: string,
  confidence: DataConfidence = DataConfidence.High,
): FieldClassification {
  return {
    dataTypeId,
    matchCount: 3,
    testValueCount: 0,
    confidence,
    maskedSamples: [],
    distinctValues: 3,
    distinctValuesCapped: false,
    matchRatio: 1,
    valueCount: 3,
    valuesWithMatch: 3,
    isFreeText: false,
    nameHinted: false,
    foundByName: false,
  };
}

beforeEach(() => {
  setting = new DataSecuritySetting();
  setting.projectId = PROJECT_ID;
  customRows = [];
  storeRow = null;
  connectionRow = null;
  accountRows = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  jest
    .spyOn(DataSecuritySettingService, "getOrCreateForProject")
    .mockImplementation(async () => {
      return setting;
    });
  jest
    .spyOn(DataSecurityCustomDataTypeService, "findBy")
    .mockImplementation((async () => {
      return customRows;
    }) as never);
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    return storeRow;
  }) as never);
  jest
    .spyOn(CloudConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return connectionRow;
    }) as never);
  settingsSpy = jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockResolvedValue(SETTINGS);
  querySpy = jest.fn(async () => {
    return accountRows;
  });
  jest.spyOn(DataStoreService, "getRepository").mockReturnValue({
    manager: { query: querySpy },
  } as never);

  recordScanSpy = jest
    .spyOn(DataSecurityFindingWriter, "recordContentScan")
    .mockResolvedValue({ scanId: ObjectID.generate(), findingsWritten: 0 });
  recordFailedSpy = jest
    .spyOn(DataSecurityFindingWriter, "recordFailedScan")
    .mockResolvedValue(undefined);
  sampleSpy = jest
    .spyOn(ObjectStoreSampler, "sampleObjectStore")
    .mockImplementation(async () => {
      return emptyContentScanResult();
    });
  sampleDatabaseSpy = jest
    .spyOn(DatabaseSampler, "sampleDatabase")
    .mockImplementation(async () => {
      return emptyContentScanResult();
    });
  awsReaderSpy = jest
    .spyOn(AwsReader, "createAwsObjectStoreReader")
    .mockImplementation(() => {
      return readerNamed("s3://bucket");
    });
  gcsReaderSpy = jest
    .spyOn(GcpReader, "createGcsObjectStoreReader")
    .mockImplementation(() => {
      return readerNamed("gs://bucket");
    });
  azureReaderSpy = jest
    .spyOn(AzureReader, "createAzureBlobObjectStoreReader")
    .mockImplementation(
      (
        _settings: CloudConnectionSettings,
        options: { containerName: string },
      ) => {
        return readerNamed(`azure://${options.containerName}`);
      },
    );
  containersSpy = jest
    .spyOn(AzureReader, "listAzureBlobContainers")
    .mockResolvedValue([]);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function storeOf(data: {
  kind: DataStoreKind;
  name?: string | undefined;
  isContentScanEnabled?: boolean | undefined;
  cloudConnectionId?: ObjectID | undefined;
  connectionString?: string | undefined;
  scanProbeId?: ObjectID | undefined;
  providerResourceId?: string | undefined;
}): DataStore {
  const store: DataStore = new DataStore(STORE_ID);
  store.kind = data.kind;
  store.name = data.name || "customer-exports";
  store.region = "eu-west-1";
  store.cloudAccountNumber = "123456789012";
  store.isContentScanEnabled =
    data.isContentScanEnabled === undefined ? true : data.isContentScanEnabled;

  if (data.cloudConnectionId) {
    store.cloudConnectionId = data.cloudConnectionId;
  }

  if (data.connectionString) {
    store.connectionString = data.connectionString;
  }

  if (data.scanProbeId) {
    store.scanProbeId = data.scanProbeId;
  }

  if (data.providerResourceId) {
    store.providerResourceId = data.providerResourceId;
  }

  storeRow = store;
  return store;
}

function connectionOf(
  level: string | undefined,
  provider: CloudProvider = CloudProvider.AWS,
  isEnabled: boolean = true,
): CloudConnection {
  const connection: CloudConnection = new CloudConnection(CONNECTION_ID);
  connection.projectId = PROJECT_ID;
  connection.provider = provider;
  connection.isEnabled = isEnabled;
  connection.config = level === undefined ? {} : { dataSecurity: level };
  connectionRow = connection;
  return connection;
}

function scanned(): ContentScanResult {
  expect(recordScanSpy).toHaveBeenCalledTimes(1);
  return (recordScanSpy.mock.calls[0]![0] as { result: ContentScanResult })
    .result;
}

function skippedWith(): JSONObject {
  expect(recordScanSpy).not.toHaveBeenCalled();
  expect(recordFailedSpy).toHaveBeenCalledTimes(1);
  return recordFailedSpy.mock.calls[0]![0] as JSONObject;
}

describe("getConnectionDataSecurityLevel", () => {
  test("is off until the connection's setup granted configuration or content reads", () => {
    expect(getConnectionDataSecurityLevel({ dataSecurity: "content" })).toBe(
      "content",
    );
    expect(
      getConnectionDataSecurityLevel({ dataSecurity: "configuration" }),
    ).toBe("configuration");

    for (const config of [
      undefined,
      {},
      { dataSecurity: "off" },
      { dataSecurity: "everything" },
      { dataSecurity: true },
      { dataSecurity: "CONTENT" },
    ]) {
      expect(
        getConnectionDataSecurityLevel(config as JSONObject | undefined),
      ).toBe("off");
    }
  });
});

describe("getFingerprintKey", () => {
  test("is the project's own, stable key: two projects' fingerprints never compare", () => {
    const key: string = getFingerprintKey(PROJECT_ID);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(getFingerprintKey(new ObjectID(PROJECT_ID.toString()))).toBe(key);
    expect(getFingerprintKey(ObjectID.generate())).not.toBe(key);
  });

  test("is the one derivation every scan uses, a probe's included", () => {
    expect(getFingerprintKey(PROJECT_ID)).toBe(
      deriveFingerprintKey(EncryptionSecret.toString(), PROJECT_ID.toString()),
    );
  });
});

describe("listProjectIds", () => {
  test("every project with stores, connections, monitored databases or live services, valid ids only", async () => {
    const other: ObjectID = ObjectID.generate();
    querySpy.mockResolvedValue([
      { projectId: PROJECT_ID.toString() },
      { projectId: other.toString() },
      { projectId: "not-a-project" },
    ] as never);

    const ids: Array<ObjectID> = await DataSecurityRunner.listProjectIds();

    expect(ids.map(String)).toEqual([PROJECT_ID.toString(), other.toString()]);

    const sql: string = querySpy.mock.calls[0]![0] as unknown as string;

    for (const table of [
      '"DataStore"',
      '"CloudConnection"',
      '"DatabaseServer"',
      '"Service"',
    ]) {
      expect(sql).toContain(table);
    }
  });
});

describe("getScanSetup", () => {
  test("a scan's limits are the project's, with sensible defaults where it set none", async () => {
    setting.maxObjectsPerScan = 500;
    setting.maxBytesPerObject = 4096;
    setting.maxBytesPerScan = 10485760;
    setting.maxRowsPerTable = 50;
    setting.maxTablesPerScan = 12;

    const custom: ContentScanOptions = (
      await DataSecurityRunner.getScanSetup(PROJECT_ID)
    ).options;

    expect(custom.limits).toEqual({
      maxObjects: 500,
      maxBytesPerObject: 4096,
      maxBytesTotal: 10485760,
      maxRowsPerTable: 50,
      maxTables: 12,
      deadline: new Date(NOW.getTime() + DATA_SECURITY_TURN_TIME_LIMIT_IN_MS),
    });

    setting = new DataSecuritySetting();

    const defaults: ContentScanOptions = (
      await DataSecurityRunner.getScanSetup(PROJECT_ID)
    ).options;

    expect(defaults.limits).toEqual({
      maxObjects: 2000,
      maxBytesPerObject: 65536,
      maxBytesTotal: 52428800,
      maxRowsPerTable: 1000,
      maxTables: 200,
      deadline: new Date(NOW.getTime() + 8 * 60 * 1000),
    });
  });

  test("the project's turned-off types and allowed values, the store's exclusions and last state, and the project's key", async () => {
    setting.disabledDataTypeIds = ["ip-address", "postal-code"];
    setting.allowedValues = ["  Support@Acme.io ", "ACME-TEST-CARD"];
    const store: DataStore = new DataStore(STORE_ID);
    store.scanExclusions = ["logs/", "tmp/"];
    store.contentScanState = { cursor: "exports/2026-10-26" };

    const options: ContentScanOptions = (
      await DataSecurityRunner.getScanSetup(PROJECT_ID, store)
    ).options;

    expect([...options.disabledDataTypeIds]).toEqual([
      "ip-address",
      "postal-code",
    ]);
    expect([...options.allowedValues]).toEqual([
      "support@acme.io",
      "acme-test-card",
    ]);
    expect(options.exclusions).toEqual(["logs/", "tmp/"]);
    expect(options.previousState).toEqual({ cursor: "exports/2026-10-26" });
    expect(options.fingerprintKey).toBe(getFingerprintKey(PROJECT_ID));

    const bare: ContentScanOptions = (
      await DataSecurityRunner.getScanSetup(PROJECT_ID)
    ).options;

    expect(bare.exclusions).toEqual([]);
    expect(bare.previousState).toBeUndefined();
    expect(bare.customDetectors).toEqual([]);
    expect(bare.extraHints).toEqual([]);
  });

  test("the project's enabled custom data types are compiled to detectors, with their name hints, and described for its findings", async () => {
    const loyalty: DataSecurityCustomDataType = new DataSecurityCustomDataType(
      ObjectID.generate(),
    );
    loyalty.name = "Loyalty card number";
    loyalty.pattern = "LOY-[0-9]{6}";
    loyalty.nameHints = ["loyalty card", "loyalty id"];
    loyalty.category = DataCategory.Financial;
    loyalty.sensitivity = DataSensitivity.Confidential;
    const broken: DataSecurityCustomDataType = new DataSecurityCustomDataType(
      ObjectID.generate(),
    );
    broken.name = "Broken";
    broken.pattern = "([unclosed";
    broken.category = DataCategory.BusinessConfidential;
    broken.sensitivity = DataSensitivity.Internal;
    const hintsOnly: DataSecurityCustomDataType =
      new DataSecurityCustomDataType(ObjectID.generate());
    hintsOnly.nameHints = ["badge number"];
    const nameless: DataSecurityCustomDataType =
      new DataSecurityCustomDataType();
    nameless.pattern = "X-[0-9]+";
    customRows = [loyalty, broken, hintsOnly, nameless];

    const setup: {
      options: ContentScanOptions;
      customTypes: Map<string, CustomDataTypeSummary>;
    } = await DataSecurityRunner.getScanSetup(PROJECT_ID);

    expect(
      (
        (
          DataSecurityCustomDataTypeService.findBy as unknown as jest.SpyInstance
        ).mock.calls[0]![0] as { query: JSONObject }
      ).query,
    ).toEqual({ projectId: PROJECT_ID, isEnabled: true });

    const loyaltyId: string = customDataTypeId(loyalty.id!.toString());

    expect(
      setup.options.customDetectors.map((detector: { dataTypeId: string }) => {
        return detector.dataTypeId;
      }),
    ).toEqual([loyaltyId]);

    const detector: {
      findCandidates: (
        text: string,
      ) => Array<{ start: number; end: number; value: string }>;
    } = setup.options.customDetectors[0] as never;

    expect(
      detector
        .findCandidates("Member LOY-123456 and LOY-12 asked")
        .map((candidate: { value: string }): string => {
          return candidate.value;
        }),
    ).toEqual(["LOY-123456"]);
    expect(setup.options.extraHints).toEqual([
      { dataTypeId: loyaltyId, hints: ["loyalty card", "loyalty id"] },
      {
        dataTypeId: customDataTypeId(hintsOnly.id!.toString()),
        hints: ["badge number"],
      },
    ]);
    expect([...setup.customTypes.entries()]).toEqual([
      [
        loyaltyId,
        {
          name: "Loyalty card number",
          category: DataCategory.Financial,
          sensitivity: DataSensitivity.Confidential,
        },
      ],
      [
        customDataTypeId(broken.id!.toString()),
        {
          name: "Broken",
          category: DataCategory.BusinessConfidential,
          sensitivity: DataSensitivity.Internal,
        },
      ],
    ]);
  });
});

describe("claimDueStores", () => {
  test("claims the scannable stores that are due and no probe scans, holding each for an hour first", async () => {
    const due: DataStore = new DataStore(STORE_ID);
    due.projectId = PROJECT_ID;
    const orphan: DataStore = new DataStore(ObjectID.generate());
    const findSpy: jest.SpyInstance = jest
      .spyOn(DataStoreService, "findBy")
      .mockResolvedValue([due, orphan] as never);
    const holdSpy: jest.SpyInstance = jest
      .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    const claimed: Array<{ projectId: ObjectID; dataStoreId: ObjectID }> =
      await DataSecurityRunner.claimDueStores(50);

    expect(
      claimed.map((store: { dataStoreId: ObjectID }) => {
        return store.dataStoreId.toString();
      }),
    ).toEqual([STORE_ID.toString()]);

    const findBy: { query: JSONObject; limit: number; props: JSONObject } =
      findSpy.mock.calls[0]![0];

    expect(findBy.limit).toBe(50);
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.query["isArchived"]).toBe(false);
    expect(findBy.query["isContentScanEnabled"]).toBe(true);
    expect(
      ((findBy.query["kind"] as Includes).values as Array<string>).sort(),
    ).toEqual(
      [
        DataStoreKind.AwsS3Bucket,
        DataStoreKind.AzureStorageAccount,
        DataStoreKind.GcpStorageBucket,
        DataStoreKind.GcpBigQueryDataset,
        DataStoreKind.PostgreSql,
        DataStoreKind.MySql,
        DataStoreKind.SqlServer,
      ].sort(),
    );

    const nextScan: RawOperator = findBy.query[
      "nextContentScanAt"
    ] as unknown as RawOperator;

    expect(nextScan.getSql("next")).toContain("next <=");
    expect(nextScan.getSql("next")).toContain("IS NULL");
    expect(Object.values(nextScan.objectLiteralParameters)).toContainEqual(NOW);
    expect(
      (findBy.query["scanProbeId"] as unknown as RawOperator).getSql("probe"),
    ).toContain("IS NULL");
    expect(holdSpy).toHaveBeenCalledTimes(1);
    expect(holdSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { nextContentScanAt: new Date(NOW.getTime() + HOUR_IN_MS) },
    });
  });
});

describe("scanStore: what the cloud connection allows", () => {
  test("a bucket is sampled when its connection granted content reads, within the project's setup", async () => {
    storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content");
    setting.contentScanIntervalInHours = 6;
    const found: ContentScanResult = {
      ...emptyContentScanResult(),
      locations: [
        {
          location: "exports/*.csv",
          locationKind: DataStoreLocationKind.Object,
          classifications: [classification("email-address")],
        },
      ],
      objectsRead: 4,
    };
    sampleSpy.mockResolvedValue(found);

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(settingsSpy).toHaveBeenCalledWith(connectionRow);
    expect(awsReaderSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: connectionRow!.id,
      bucket: "customer-exports",
      region: "eu-west-1",
      accountNumber: "123456789012",
    });
    expect(
      (sampleSpy.mock.calls[0]![1] as ContentScanOptions).fingerprintKey,
    ).toBe(getFingerprintKey(PROJECT_ID));
    expect(recordScanSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      kind: DataSecurityScanKind.Content,
      result: found,
      startedAt: NOW,
      keepMaskedSamples: true,
      contentScanIntervalInHours: 6,
      customDataTypes: new Map(),
    });
  });

  test("a connection granted configuration only: the bucket is checked, never sampled, and the scan says why", async () => {
    storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("configuration");

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(awsReaderSpy).not.toHaveBeenCalled();
    expect(sampleSpy).not.toHaveBeenCalled();
    expect(skippedWith()).toEqual({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      kind: DataSecurityScanKind.Content,
      startedAt: NOW,
      status: DataSecurityScanStatus.Skipped,
      errorMessage:
        "Content scanning needs the connection's content permission, or a connection string for a database.",
    });
  });

  test("a connection that is off, gone, or a bucket with no connection: nothing is sampled", async () => {
    for (const arrange of [
      (): void => {
        storeOf({
          kind: DataStoreKind.GcpStorageBucket,
          cloudConnectionId: CONNECTION_ID,
        });
        connectionOf(undefined, CloudProvider.GCP);
      },
      (): void => {
        storeOf({
          kind: DataStoreKind.AwsS3Bucket,
          cloudConnectionId: CONNECTION_ID,
        });
        connectionRow = null;
      },
      (): void => {
        storeOf({ kind: DataStoreKind.AzureStorageAccount });
      },
    ]) {
      recordFailedSpy.mockClear();
      arrange();

      await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

      expect(skippedWith()["status"]).toBe(DataSecurityScanStatus.Skipped);
    }

    expect(sampleSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  test("a store not enabled for content scans, scanned by a probe, or gone is left alone", async () => {
    for (const arrange of [
      (): void => {
        storeOf({
          kind: DataStoreKind.AwsS3Bucket,
          isContentScanEnabled: false,
        });
      },
      (): void => {
        storeOf({
          kind: DataStoreKind.PostgreSql,
          scanProbeId: ObjectID.generate(),
        });
      },
      (): void => {
        storeRow = null;
      },
    ]) {
      arrange();
      await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);
    }

    expect(
      DataSecuritySettingService.getOrCreateForProject,
    ).not.toHaveBeenCalled();
    expect(recordScanSpy).not.toHaveBeenCalled();
    expect(recordFailedSpy).not.toHaveBeenCalled();
  });

  test("a project that turned content scans off reads nothing", async () => {
    storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content");
    setting.isContentScanEnabled = false;

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(sampleSpy).not.toHaveBeenCalled();
    expect(recordScanSpy).not.toHaveBeenCalled();
    expect(recordFailedSpy).not.toHaveBeenCalled();
  });

  test("a project that keeps no samples says so to the writer", async () => {
    storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content");
    setting.keepMaskedSamples = false;

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(
      (recordScanSpy.mock.calls[0]![0] as { keepMaskedSamples: boolean })
        .keepMaskedSamples,
    ).toBe(false);
  });

  test("a Cloud Storage bucket is read through its own reader", async () => {
    storeOf({
      kind: DataStoreKind.GcpStorageBucket,
      name: "acme-backups",
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content", CloudProvider.GCP);

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(gcsReaderSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID.toString(),
      bucket: "acme-backups",
    });
    expect(recordScanSpy).toHaveBeenCalledTimes(1);
  });

  test("a PostgreSQL or MySQL database is sampled with its connection string, by engine; without one it is skipped", async () => {
    for (const [kind, engine] of [
      [DataStoreKind.PostgreSql, "postgresql"],
      [DataStoreKind.MySql, "mysql"],
    ] as Array<[DataStoreKind, string]>) {
      sampleDatabaseSpy.mockClear();
      storeOf({
        kind,
        connectionString: "postgres://reader:x@db.internal/app",
      });

      await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

      expect(sampleDatabaseSpy.mock.calls[0]![0]).toEqual({
        engine,
        connectionString: "postgres://reader:x@db.internal/app",
      });
    }

    recordFailedSpy.mockClear();
    storeOf({ kind: DataStoreKind.PostgreSql });

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(recordFailedSpy.mock.calls[0]![0]).toMatchObject({
      status: DataSecurityScanStatus.Skipped,
    });
  });

  test("a SQL Server database is not sampled: its kind is not one Data Security reads the content of", async () => {
    storeOf({
      kind: DataStoreKind.SqlServer,
      connectionString: "mssql://reader:x@sql.internal:1433/app",
    });

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(sampleDatabaseSpy).not.toHaveBeenCalled();
    expect(skippedWith()["status"]).toBe(DataSecurityScanStatus.Skipped);
  });

  test("a kind no reader can sample is skipped", async () => {
    storeOf({
      kind: DataStoreKind.AwsRdsInstance,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content");

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(skippedWith()["status"]).toBe(DataSecurityScanStatus.Skipped);
  });

  test("a scan that fails is recorded as failed, with what went wrong", async () => {
    storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content");
    sampleSpy.mockRejectedValue(new Error("AccessDenied: s3:GetObject"));

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(skippedWith()).toEqual({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      kind: DataSecurityScanKind.Content,
      startedAt: NOW,
      errorMessage: "AccessDenied: s3:GetObject",
    });
  });
});

describe("scanStore: an Azure storage account's containers", () => {
  function partOf(
    container: string,
    overrides: Partial<ContentScanResult>,
  ): ContentScanResult {
    return {
      ...emptyContentScanResult(),
      locations: [
        {
          location: "exports/*.csv",
          locationKind: DataStoreLocationKind.Object,
          classifications: [classification("email-address")],
        },
      ],
      readLog: [`exports/${container}.csv`],
      objectsRead: 2,
      rowsRead: 10,
      bytesRead: 100,
      warnings: [`${container}: one object was too large`],
      ...overrides,
    };
  }

  test("every container is sampled and merged into one scan, each location and read prefixed by its container", async () => {
    storeOf({
      kind: DataStoreKind.AzureStorageAccount,
      name: "acmecustomerfiles",
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content", CloudProvider.Azure);
    containersSpy.mockResolvedValue(["exports", "backups"]);
    sampleSpy.mockImplementation(async (reader: ObjectStoreReader) => {
      return reader.description === "azure://exports"
        ? partOf("exports", {
            fingerprints: { "email-address": [1, 2, 3] },
            plaintextPasswordFields: ["users.csv.password"],
            estimatedRecords: 40,
          })
        : partOf("backups", {
            fingerprints: {
              "email-address": [9, 9, 9],
              "phone-number": [4, 5, 6],
            },
            estimatedRecords: 2,
            isComplete: false,
          });
    });

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(containersSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID.toString(),
      accountName: "acmecustomerfiles",
    });
    expect(
      azureReaderSpy.mock.calls.map((call: Array<unknown>) => {
        return call[1];
      }),
    ).toEqual([
      {
        connectionId: CONNECTION_ID.toString(),
        accountName: "acmecustomerfiles",
        containerName: "exports",
      },
      {
        connectionId: CONNECTION_ID.toString(),
        accountName: "acmecustomerfiles",
        containerName: "backups",
      },
    ]);

    const merged: ContentScanResult = scanned();

    expect(
      merged.locations.map((location: { location: string }) => {
        return location.location;
      }),
    ).toEqual(["exports/exports/*.csv", "backups/exports/*.csv"]);
    expect(merged.readLog).toEqual([
      "exports/exports/exports.csv",
      "backups/exports/backups.csv",
    ]);
    expect(merged.objectsRead).toBe(4);
    expect(merged.rowsRead).toBe(20);
    expect(merged.bytesRead).toBe(200);
    expect(merged.warnings).toEqual([
      "exports: one object was too large",
      "backups: one object was too large",
    ]);
    expect(merged.plaintextPasswordFields).toEqual(["users.csv.password"]);
    // A data type's first sketch is kept: one container's values, not a mix.
    expect(merged.fingerprints).toEqual({
      "email-address": [1, 2, 3],
      "phone-number": [4, 5, 6],
    });
    expect(merged.estimatedRecords).toBe(42);
    expect(merged.isComplete).toBe(false);
  });

  test("at most ten containers are sampled, and the scan then says it read only part", async () => {
    storeOf({
      kind: DataStoreKind.AzureStorageAccount,
      name: "acmecustomerfiles",
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content", CloudProvider.Azure);
    containersSpy.mockResolvedValue(
      Array.from({ length: 12 }, (_value: unknown, index: number): string => {
        return `container-${index}`;
      }),
    );

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(sampleSpy).toHaveBeenCalledTimes(10);
    expect(scanned().isComplete).toBe(false);
  });

  test("an account with no containers is a complete scan that found nothing", async () => {
    storeOf({
      kind: DataStoreKind.AzureStorageAccount,
      name: "acmeempty",
      cloudConnectionId: CONNECTION_ID,
    });
    connectionOf("content", CloudProvider.Azure);

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(sampleSpy).not.toHaveBeenCalled();
    expect(scanned()).toEqual(emptyContentScanResult());
  });
});

describe("scanStore: a BigQuery dataset", () => {
  test("its sampled tables are classified column by column, and the dataset is read from its resource name", async () => {
    storeOf({
      kind: DataStoreKind.GcpBigQueryDataset,
      name: "crm",
      cloudConnectionId: CONNECTION_ID,
      providerResourceId:
        "//bigquery.googleapis.com/projects/acme-prod/datasets/crm",
    });
    connectionOf("content", CloudProvider.GCP);
    setting.maxTablesPerScan = 5;
    const rows: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < 8; index++) {
      rows.push({
        customer_email: `zq${index}.buyer@acme-shop.io`,
        plan: "pro",
      });
    }

    const sampleSpyBigQuery: jest.SpyInstance = jest
      .spyOn(GcpReader, "readBigQuerySample")
      .mockResolvedValue({
        tables: [
          { table: "customers", columns: ["customer_email", "plan"], rows },
        ],
        warnings: ["The orders table could not be read."],
      } as never);

    await DataSecurityRunner.scanStore(PROJECT_ID, STORE_ID);

    expect(sampleSpyBigQuery.mock.calls[0]![1]).toEqual({
      connectionId: CONNECTION_ID.toString(),
      projectId: "acme-prod",
      datasetId: "crm",
      maxTables: 5,
      maxRowsPerTable: 1000,
    });

    const result: ContentScanResult = scanned();

    expect(result.readLog).toEqual(["customers"]);
    expect(result.rowsRead).toBe(8);
    expect(
      result.locations.map((location: { location: string }) => {
        return location.location;
      }),
    ).toEqual(["customers.customer_email"]);
    expect(result.locations[0]!.locationKind).toBe(
      DataStoreLocationKind.Column,
    );
    expect(result.locations[0]!.classifications[0]!.dataTypeId).toBe(
      "email-address",
    );
    expect(result.fingerprints["email-address"]).toHaveLength(128);
    expect(result.warnings).toEqual(["The orders table could not be read."]);
    expect(result.isComplete).toBe(true);
  });
});

describe("dueConnections", () => {
  function connectionNamed(
    id: ObjectID,
    projectId: ObjectID,
    level: string | undefined,
  ): CloudConnection {
    const connection: CloudConnection = new CloudConnection(id);
    connection.projectId = projectId;
    connection.config = level === undefined ? {} : { dataSecurity: level };
    return connection;
  }

  function changesIn(projectIds: Array<string>): void {
    jest.spyOn(ChangeEventService, "executeQuery").mockResolvedValue({
      json: async () => {
        return {
          data: projectIds.map((projectId: string) => {
            return { projectId };
          }),
        };
      },
    } as never);
  }

  test("a connection on for Data Security and not read for a day is due; one read since is not, unless its cloud changed", async () => {
    const changedProject: ObjectID = ObjectID.generate();
    const unread: CloudConnection = connectionNamed(
      ObjectID.generate(),
      PROJECT_ID,
      "content",
    );
    const read: CloudConnection = connectionNamed(
      ObjectID.generate(),
      PROJECT_ID,
      "configuration",
    );
    const off: CloudConnection = connectionNamed(
      ObjectID.generate(),
      PROJECT_ID,
      undefined,
    );
    const changed: CloudConnection = connectionNamed(
      ObjectID.generate(),
      changedProject,
      "configuration",
    );
    const connectionsSpy: jest.SpyInstance = jest
      .spyOn(CloudConnectionService, "findBy")
      .mockResolvedValue([unread, read, off, changed] as never);
    const recentReads: Array<DataSecurityScan> = [read, changed].map(
      (connection: CloudConnection): DataSecurityScan => {
        const scan: DataSecurityScan = new DataSecurityScan();
        scan.cloudConnectionId = connection.id!;
        return scan;
      },
    );
    const scansSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityScanService, "findBy")
      .mockResolvedValue(recentReads as never);
    changesIn([changedProject.toString()]);

    const due: Array<{ projectId: ObjectID; cloudConnectionId: ObjectID }> =
      await DataSecurityRunner.dueConnections();

    expect(
      due.map((item: { cloudConnectionId: ObjectID }): string => {
        return item.cloudConnectionId.toString();
      }),
    ).toEqual([unread.id!.toString(), changed.id!.toString()]);
    expect(
      (connectionsSpy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ isEnabled: true });

    // The connections read in the last day, in one query.
    expect(scansSpy).toHaveBeenCalledTimes(1);

    const findBy: { query: JSONObject; select: JSONObject; limit: number } =
      scansSpy.mock.calls[0]![0];

    expect(findBy.query["kind"]).toBe(DataSecurityScanKind.Configuration);
    expect(findBy.select).toEqual({ cloudConnectionId: true });
    expect(findBy.limit).toBe(LIMIT_MAX);
    expect(
      Object.values(
        (findBy.query["startedAt"] as unknown as RawOperator)
          .objectLiteralParameters,
      )[0],
    ).toEqual(
      new Date(
        NOW.getTime() - CONFIGURATION_READ_INTERVAL_IN_HOURS * HOUR_IN_MS,
      ),
    );
  });

  test("when cloud changes cannot be read, connections are judged by their last read alone", async () => {
    const read: CloudConnection = connectionNamed(
      ObjectID.generate(),
      PROJECT_ID,
      "content",
    );
    jest
      .spyOn(CloudConnectionService, "findBy")
      .mockResolvedValue([read] as never);
    const scan: DataSecurityScan = new DataSecurityScan();
    scan.cloudConnectionId = read.id!;
    jest
      .spyOn(DataSecurityScanService, "findBy")
      .mockResolvedValue([scan] as never);
    jest
      .spyOn(ChangeEventService, "executeQuery")
      .mockRejectedValue(new Error("ClickHouse went away"));

    expect(await DataSecurityRunner.dueConnections()).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not read cloud changes:",
    );
  });
});

describe("readConnection", () => {
  function readResult(complete: boolean): CloudDataSecurityReadResult {
    return {
      stores: [
        {
          identity: {
            kind: DataStoreKind.AwsS3Bucket,
            name: "customer-exports",
            providerResourceId: "arn:aws:s3:::customer-exports",
            accountNumber: "123456789012",
          },
          posture: {},
          access: [],
        },
      ],
      warnings: ["s3:GetBucketLogging was denied."],
      complete,
    };
  }

  test("reads an AWS connection with the project's connected accounts, and records what it found", async () => {
    connectionOf("configuration");
    accountRows = [{ accountId: "123456789012" }, { accountId: "" }];
    const readSpy: jest.SpyInstance = jest
      .spyOn(AwsReader, "readAwsDataSecurity")
      .mockResolvedValue(readResult(true));
    const recordSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityDiscovery, "recordCloudReads")
      .mockResolvedValue(1);
    const scanSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityScanService, "create")
      .mockResolvedValue(new DataSecurityScan() as never);

    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);

    expect(readSpy).toHaveBeenCalledWith(SETTINGS, {
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      connectedAccountIds: ["123456789012"],
    });
    expect(querySpy.mock.calls[0]![1]).toEqual([PROJECT_ID.toString(), "aws"]);
    expect(recordSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudConnectionId: CONNECTION_ID,
      provider: DataStoreProvider.Aws,
      result: readResult(true),
    });

    const scan: DataSecurityScan = (
      scanSpy.mock.calls[0]![0] as CreateBy<DataSecurityScan>
    ).data;

    expect(scan.kind).toBe(DataSecurityScanKind.Configuration);
    expect(scan.status).toBe(DataSecurityScanStatus.Succeeded);
    expect(scan.cloudConnectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(scan.storesRead).toBe(1);
    expect(scan.findingsFound).toBe(0);
    expect(scan.readLog).toEqual(["customer-exports"]);
    expect(scan.warnings).toEqual(["s3:GetBucketLogging was denied."]);
    expect(scan.startedAt).toEqual(NOW);
  });

  test("Azure and Google Cloud connections go to their own readers, and a partial read says so", async () => {
    const azureSpy: jest.SpyInstance = jest
      .spyOn(AzureReader, "readAzureDataSecurity")
      .mockResolvedValue(readResult(false));
    const gcpSpy: jest.SpyInstance = jest
      .spyOn(GcpReader, "readGcpDataSecurity")
      .mockResolvedValue(readResult(true));
    const recordSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityDiscovery, "recordCloudReads")
      .mockResolvedValue(1);
    const scanSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityScanService, "create")
      .mockResolvedValue(new DataSecurityScan() as never);
    accountRows = [{ accountId: "sub-1" }];

    connectionOf("content", CloudProvider.Azure);
    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);
    connectionOf("content", CloudProvider.GCP);
    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);

    expect(azureSpy).toHaveBeenCalledWith(SETTINGS, {
      projectId: PROJECT_ID.toString(),
      connectionId: CONNECTION_ID.toString(),
      connectedSubscriptionIds: ["sub-1"],
    });
    expect(gcpSpy).toHaveBeenCalledWith(SETTINGS, {
      projectId: PROJECT_ID.toString(),
      connectionId: CONNECTION_ID.toString(),
      connectedProjectIds: ["sub-1"],
    });
    expect(
      recordSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { provider: DataStoreProvider }).provider;
      }),
    ).toEqual([DataStoreProvider.Azure, DataStoreProvider.Gcp]);
    expect(
      (scanSpy.mock.calls[0]![0] as CreateBy<DataSecurityScan>).data.status,
    ).toBe(DataSecurityScanStatus.PartlySucceeded);
  });

  test("a connection that is off, disabled, or of another project is not read", async () => {
    const readSpy: jest.SpyInstance = jest.spyOn(
      AwsReader,
      "readAwsDataSecurity",
    );

    connectionOf(undefined);
    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);
    connectionOf("content", CloudProvider.AWS, false);
    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);
    connectionRow = null;
    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);

    expect(
      (
        (CloudConnectionService.findOneBy as unknown as jest.SpyInstance).mock
          .calls[0]![0] as { query: JSONObject }
      ).query,
    ).toEqual({ _id: CONNECTION_ID, projectId: PROJECT_ID });
    expect(readSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  test("a read that fails is recorded as a failed configuration scan on the connection", async () => {
    connectionOf("configuration");
    jest
      .spyOn(AwsReader, "readAwsDataSecurity")
      .mockRejectedValue(new Error("The role cannot be assumed."));

    await DataSecurityRunner.readConnection(PROJECT_ID, CONNECTION_ID);

    expect(recordFailedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudConnectionId: CONNECTION_ID,
      kind: DataSecurityScanKind.Configuration,
      startedAt: NOW,
      errorMessage: "The role cannot be assumed.",
    });
  });
});

describe("scanTelemetry", () => {
  const SERVICE_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  function telemetryResult(): ContentScanResult {
    return {
      ...emptyContentScanResult(),
      locations: [
        {
          location: "attributes.user.email",
          locationKind: DataStoreLocationKind.Attribute,
          classifications: [classification("email-address")],
        },
      ],
    };
  }

  test("each service's telemetry of a signal becomes a store, its findings recorded and marked scrubbed as the rules say", async () => {
    setting.telemetrySampleSize = 250;
    const scanSpy: jest.SpyInstance = jest
      .spyOn(TelemetryDataScanner, "scanProjectTelemetry")
      .mockResolvedValue([
        {
          serviceId: SERVICE_ID.toString(),
          serviceName: "checkout",
          kind: DataStoreKind.TelemetryLogs,
          result: telemetryResult(),
        },
        {
          serviceId: "not-a-service",
          kind: DataStoreKind.TelemetryTraces,
          result: telemetryResult(),
        },
      ]);
    const ensureSpy: jest.SpyInstance = jest
      .spyOn(DataSecurityDiscovery, "ensureTelemetryStore")
      .mockResolvedValue(STORE_ID);
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockResolvedValue({ rules: [] });
    jest
      .spyOn(TelemetryScrubCoverage, "isFindingScrubbed")
      .mockImplementation(
        (_coverage: unknown, finding: { dataTypeId: string }): boolean => {
          return finding.dataTypeId === "email-address";
        },
      );
    const scrubbedNow: DataStoreFinding = new DataStoreFinding(
      ObjectID.generate(),
    );
    scrubbedNow.dataTypeId = "email-address";
    scrubbedNow.location = "attributes.user.email";
    scrubbedNow.isScrubbed = false;
    const unchanged: DataStoreFinding = new DataStoreFinding(
      ObjectID.generate(),
    );
    unchanged.dataTypeId = "phone-number";
    unchanged.location = "body";
    unchanged.isScrubbed = false;
    jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockResolvedValue([scrubbedNow, unchanged] as never);
    const markSpy: jest.SpyInstance = jest
      .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    await DataSecurityRunner.scanTelemetry(PROJECT_ID);

    const asked: { projectId: ObjectID; sampleSize: number; since: Date } =
      scanSpy.mock.calls[0]![0];

    expect(asked.projectId).toBe(PROJECT_ID);
    expect(asked.sampleSize).toBe(250);
    expect(asked.since).toEqual(new Date(NOW.getTime() - HOUR_IN_MS));
    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      serviceName: "checkout",
      kind: DataStoreKind.TelemetryLogs,
    });
    expect(recordScanSpy).toHaveBeenCalledTimes(1);
    expect(recordScanSpy.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      kind: DataSecurityScanKind.Telemetry,
      contentScanIntervalInHours: 1,
      keepMaskedSamples: true,
    });
    expect(markSpy).toHaveBeenCalledTimes(1);
    expect(markSpy).toHaveBeenCalledWith({
      id: scrubbedNow.id,
      data: { isScrubbed: true },
    });
  });

  test("a project that turned telemetry scanning off reads nothing", async () => {
    setting.isTelemetryScanEnabled = false;
    const scanSpy: jest.SpyInstance = jest.spyOn(
      TelemetryDataScanner,
      "scanProjectTelemetry",
    );

    await DataSecurityRunner.scanTelemetry(PROJECT_ID);

    expect(scanSpy).not.toHaveBeenCalled();
  });

  test("a store that cannot be made is skipped; scrub rules that cannot be read leave findings as they were", async () => {
    jest.spyOn(TelemetryDataScanner, "scanProjectTelemetry").mockResolvedValue([
      {
        serviceId: SERVICE_ID.toString(),
        kind: DataStoreKind.TelemetryLogs,
        result: telemetryResult(),
      },
      {
        serviceId: ObjectID.generate().toString(),
        kind: DataStoreKind.TelemetryExceptions,
        result: telemetryResult(),
      },
    ]);
    jest
      .spyOn(DataSecurityDiscovery, "ensureTelemetryStore")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(STORE_ID);
    jest
      .spyOn(TelemetryScrubCoverage, "getScrubCoverage")
      .mockRejectedValue(new Error("Postgres went away"));
    const findSpy: jest.SpyInstance = jest.spyOn(
      DataStoreFindingService,
      "findBy",
    );

    await DataSecurityRunner.scanTelemetry(PROJECT_ID);

    expect(recordScanSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not read the scrub rules of project ${PROJECT_ID.toString()}:`,
    );
    expect(findSpy).not.toHaveBeenCalled();
  });
});
