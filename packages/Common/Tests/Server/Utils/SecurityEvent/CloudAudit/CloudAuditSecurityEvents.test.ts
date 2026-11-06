import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityTelemetrySource from "../../../../../Models/DatabaseModels/SecurityTelemetrySource";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../../Server/Services/SecurityEventService";
import SecurityTelemetrySourceService from "../../../../../Server/Services/SecurityTelemetrySourceService";
import { CloudAuditRecord } from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import logger from "../../../../../Server/Utils/Logger";
import CloudAuditSecurityEvents, {
  CLOUD_AUDIT_ACCOUNT_ATTRIBUTE,
  CLOUD_AUDIT_CONNECTION_ATTRIBUTE,
  CLOUD_AUDIT_FORMATS,
  CLOUD_AUDIT_RECORD_TIME_ATTRIBUTE,
  CloudAuditStoreOutcome,
} from "../../../../../Server/Utils/SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import RealTimeDetections from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityEventDedupe from "../../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import { SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE } from "../../../../../Server/Utils/SecurityEvent/SecurityEventStoreOnce";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DetectionRuleDataKind,
  isDetectionRuleDataKindSeen,
} from "../../../../../Types/SecurityEvent/DetectionRuleDataKind";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
} from "../../../../../Types/SecurityEvent/SecurityLogFormat";
import { SecurityTelemetrySourceKind } from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import SecurityLogParser from "../../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import { getJestSpyOn } from "../../../../Spy";
import { azureActivityApiEvent } from "../../../../Utils/SecurityEvent/Connectors/EntraIdFixtures";
import { googleAuditEntry } from "../../../../Utils/SecurityEvent/LogParsers/GoogleCloudAuditFixtures";
import { cloudTrailRecord } from "../../../../Utils/SecurityEvent/LogParsers/LogParserFixtures";

/*
 * Cloud audit logs: the audit records a connected cloud account's read
 * brings in - CloudTrail, Google Cloud's Admin Activity log, the Azure
 * Activity Log - read by the parsers "Your logs" reads them with, so each
 * is the same security event either way, stored once, stamped when it is
 * stored with the record's own time beside it, attributed to the "OneUptime
 * Cloud Audit Logs" service, and what each read found written on the
 * source. ClickHouse, Valkey and Postgres are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c10da0d1-0000-4000-8000-0000000000a1",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "c10da0d1-0000-4000-8000-0000000000c1",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "c10da0d1-0000-4000-8000-0000000000s1",
);
const STORED_AT: Date = new Date("2026-10-30T10:20:00.000Z");
const ACCOUNT: string = "111122223333";

function source(): SecurityTelemetrySource {
  const value: SecurityTelemetrySource = new SecurityTelemetrySource();
  value.id = SOURCE_ID;
  value.projectId = PROJECT_ID;
  value.kind = SecurityTelemetrySourceKind.CloudAudit;
  value.isEnabled = true;
  return value;
}

function trail(overrides: JSONObject): CloudAuditRecord {
  return { accountId: ACCOUNT, record: cloudTrailRecord(overrides) };
}

const CREATE_ACCESS_KEY: CloudAuditRecord = trail({});
const CONSOLE_LOGIN_FAILED: CloudAuditRecord = trail({
  eventSource: "signin.amazonaws.com",
  eventName: "ConsoleLogin",
  eventID: "8f1c2e3d-0000-0000-0000-000000000002",
  eventTime: "2026-10-30T10:01:00Z",
  responseElements: { ConsoleLogin: "Failure" },
  errorMessage: "Failed authentication",
  additionalEventData: { MFAUsed: "No" },
});
// AWS reading its own configuration: no security event.
const DESCRIBE: CloudAuditRecord = trail({
  eventSource: "ec2.amazonaws.com",
  eventName: "DescribeInstances",
  eventID: "8f1c2e3d-0000-0000-0000-000000000003",
  readOnly: true,
});

describe("CloudAuditSecurityEvents - each cloud's records, read as Your logs reads them", () => {
  test("each cloud has the format and parser Your logs gives its audit log", () => {
    expect(CLOUD_AUDIT_FORMATS).toEqual({
      [CloudProvider.AWS]: SecurityLogFormat.AwsCloudTrail,
      [CloudProvider.GCP]: SecurityLogFormat.GoogleCloudAudit,
      [CloudProvider.Azure]: SecurityLogFormat.AzureActivity,
    });
  });

  test("CloudTrail: a change and a refused sign-in are events, a read is not", () => {
    const events: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.AWS,
        records: [CREATE_ACCESS_KEY, CONSOLE_LOGIN_FAILED, DESCRIBE],
        connectionId: CONNECTION_ID,
        now: STORED_AT,
      });

    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.eventUid;
      }),
    ).toEqual([
      "cloudtrail:8f1c2e3d-0000-0000-0000-000000000001",
      "cloudtrail:8f1c2e3d-0000-0000-0000-000000000002",
    ]);
    expect(events[1]).toMatchObject({
      className: "Authentication",
      statusName: "Failure",
      vendorName: "AWS",
      productName: "AWS CloudTrail",
      principalUser: expect.stringContaining("alice"),
    });
  });

  test("stamped when stored, the record's own time, account and connection beside it, from cloud audit logs", () => {
    const [event] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.AWS,
      records: [CREATE_ACCESS_KEY],
      connectionId: CONNECTION_ID,
      now: STORED_AT,
    });

    expect(event!.time).toEqual(STORED_AT);
    expect(event!.attributes).toMatchObject({
      [CLOUD_AUDIT_RECORD_TIME_ATTRIBUTE]: "2026-10-19T09:58:00.000Z",
      [CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]: ACCOUNT,
      [CLOUD_AUDIT_CONNECTION_ATTRIBUTE]: CONNECTION_ID.toString(),
      [SECURITY_LOG_SOURCE_ATTRIBUTE]: SecurityTelemetrySourceKind.CloudAudit,
      [SECURITY_LOG_FORMAT_ATTRIBUTE]: SecurityLogFormat.AwsCloudTrail,
      // The record's own fields, as the rule library's CloudTrail rules read them.
      eventName: "CreateAccessKey",
      "userIdentity.type": "IAMUser",
    });
  });

  test("the same record read from the logs is the same event: same id, vendor and product, so it is stored once", () => {
    for (const [provider, record] of [
      [CloudProvider.AWS, cloudTrailRecord({})],
      [CloudProvider.GCP, googleAuditEntry("activity")],
      [CloudProvider.Azure, azureActivityApiEvent()],
    ] as Array<[CloudProvider, JSONObject]>) {
      const [fromAccount] = CloudAuditSecurityEvents.parseRecords({
        provider,
        records: [{ accountId: ACCOUNT, record }],
        now: STORED_AT,
      });
      const [fromLogs] = SecurityLogParser.parse({
        body: JSON.stringify(record),
        attributes: {},
        time: STORED_AT,
        logId: "0192f1a0-0000-7000-8000-000000000001",
      });

      expect(fromAccount).toBeDefined();
      expect([
        provider,
        fromAccount!.eventUid,
        fromAccount!.vendorName,
        fromAccount!.productName,
      ]).toEqual([
        provider,
        fromLogs!.eventUid,
        fromLogs!.vendorName,
        fromLogs!.productName,
      ]);
    }
  });

  test("Google Cloud's and Azure's records keep their ids: insertId and eventDataId", () => {
    const [google] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.GCP,
      records: [
        { accountId: "acme-prod", record: googleAuditEntry("activity") },
      ],
      now: STORED_AT,
    });
    const [azure] = CloudAuditSecurityEvents.parseRecords({
      provider: CloudProvider.Azure,
      records: [
        {
          accountId: "11111111-2222-3333-4444-555555555555",
          record: azureActivityApiEvent(),
        },
      ],
      now: STORED_AT,
    });

    expect(google!.eventUid).toBe("gcp-audit:1a2b3c4d5e");
    expect(google!.attributes[CLOUD_AUDIT_ACCOUNT_ATTRIBUTE]).toBe("acme-prod");
    expect(azure!.eventUid).toBe(
      "azure-activity:a0b1c2d3-0000-4000-8000-000000000008",
    );
    expect(azure!.principalIp).toBe("198.51.100.66");
  });

  test("a record the cloud gave no id of its own is left out: it could not be stored once", () => {
    const azureWithoutId: JSONObject = azureActivityApiEvent();

    delete azureWithoutId["eventDataId"];

    expect(
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.Azure,
        records: [{ accountId: "sub", record: azureWithoutId }],
        now: STORED_AT,
      }),
    ).toEqual([]);
  });

  test("the rule library tells the project sends each kind, by the product its events carry", () => {
    for (const [provider, record, kind] of [
      [
        CloudProvider.AWS,
        cloudTrailRecord({}),
        DetectionRuleDataKind.AwsCloudTrail,
      ],
      [
        CloudProvider.GCP,
        googleAuditEntry("activity"),
        DetectionRuleDataKind.GoogleCloudAuditLogs,
      ],
      [
        CloudProvider.Azure,
        azureActivityApiEvent(),
        DetectionRuleDataKind.AzureActivityLog,
      ],
    ] as Array<[CloudProvider, JSONObject, DetectionRuleDataKind]>) {
      const [event] = CloudAuditSecurityEvents.parseRecords({
        provider,
        records: [{ accountId: ACCOUNT, record }],
        now: STORED_AT,
      });

      expect(
        isDetectionRuleDataKindSeen(kind, {
          classNames: [],
          vendorNames: [],
          productNames: [event!.productName],
        }),
      ).toBe(true);
    }
  });
});

describe("CloudAuditSecurityEvents.store", () => {
  let inserted: Array<{ rows: Array<JSONObject>; options: unknown }>;
  let existing: Set<string>;
  let updates: Array<JSONObject>;
  let screened: number;
  let locks: Array<{ namespace: string; key: string }>;

  beforeEach(() => {
    inserted = [];
    existing = new Set();
    updates = [];
    screened = 0;
    locks = [];

    getJestSpyOn(
      OTelIngestService,
      "telemetryServiceFromName",
    ).mockImplementation((async (data: { serviceName: string }) => {
      return {
        serviceName: data.serviceName,
        primaryEntityId: new ObjectID("c10da0d1-0000-4000-8000-0000000000e1"),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: 15,
        projectRetentionConfig: null,
        projectRetentionInDays: 30,
      } as unknown as TelemetryServiceMetadata;
    }) as never);
    getJestSpyOn(
      ThreatIntelEnricher,
      "enrichNormalizedEvents",
    ).mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 } as never);
    getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockImplementation((async () => {
      return existing;
    }) as never);
    getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
      namespace: string;
      key: string;
    }) => {
      locks.push({ namespace: data.namespace, key: data.key });
      return {};
    }) as never);
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
      (async (rows: Array<JSONObject>, options: unknown) => {
        inserted.push({ rows, options });
      }) as never,
    );
    getJestSpyOn(RealTimeDetections, "screen").mockImplementation(
      (async (data: { rows: Array<JSONObject> }) => {
        screened += data.rows.length;
        return 0;
      }) as never,
    );
    getJestSpyOn(
      SecurityTelemetrySourceService,
      "updateOneById",
    ).mockImplementation((async (data: { data: unknown }) => {
      updates.push(data.data as JSONObject);
      return 1;
    }) as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stores what is new, once, under the product's lock, and writes what the read found on the source", async () => {
    existing = new Set(["cloudtrail:8f1c2e3d-0000-0000-0000-000000000001"]);

    const outcome: CloudAuditStoreOutcome =
      await CloudAuditSecurityEvents.store({
        projectId: PROJECT_ID,
        provider: CloudProvider.AWS,
        connectionId: CONNECTION_ID,
        source: source(),
        records: [CREATE_ACCESS_KEY, CONSOLE_LOGIN_FAILED, DESCRIBE],
        now: STORED_AT,
      });

    expect(outcome).toEqual({
      recordsRead: 3,
      eventsFound: 1,
      byFormat: { [SecurityLogFormat.AwsCloudTrail]: 1 },
    });
    // The access key was stored another way first: only the sign-in is.
    expect(
      inserted.flatMap((call: { rows: Array<JSONObject> }) => {
        return call.rows.map((row: JSONObject): unknown => {
          return row["eventUid"];
        });
      }),
    ).toEqual(["cloudtrail:8f1c2e3d-0000-0000-0000-000000000002"]);
    // Synchronously, so the next way to look finds it.
    expect(inserted[0]!.options).toEqual({
      clickhouseSettings: { async_insert: 0, insert_distributed_sync: 1 },
    });
    expect(locks).toEqual([
      {
        namespace: SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE,
        key: `${PROJECT_ID.toString()}:product:AWS CloudTrail`,
      },
    ]);
    expect(screened).toBe(1);
    expect(OTelIngestService.telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "OneUptime Cloud Audit Logs",
      projectId: PROJECT_ID,
    });
    expect(updates).toEqual([
      {
        lastScannedAt: STORED_AT,
        lastError: null,
        lastScanResult: {
          recordsRead: 3,
          eventsFound: 1,
          bySignal: { [SecurityLogFormat.AwsCloudTrail]: 1 },
        },
        lastEventFoundAt: STORED_AT,
      },
    ]);
  });

  test("a read that brought in nothing, or nothing new, still says it was read", async () => {
    await CloudAuditSecurityEvents.store({
      projectId: PROJECT_ID,
      provider: CloudProvider.GCP,
      source: source(),
      records: [],
      now: STORED_AT,
    });

    expect(inserted).toEqual([]);
    expect(updates).toEqual([
      {
        lastScannedAt: STORED_AT,
        lastError: null,
        lastScanResult: { recordsRead: 0, eventsFound: 0, bySignal: {} },
      },
    ]);
  });

  test("records that could not be stored throw, so the read reads them again, and the source says why", async () => {
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockRejectedValue(
      new Error("ClickHouse is not answering") as never,
    );

    await expect(
      CloudAuditSecurityEvents.store({
        projectId: PROJECT_ID,
        provider: CloudProvider.AWS,
        source: source(),
        records: [CONSOLE_LOGIN_FAILED],
        now: STORED_AT,
      }),
    ).rejects.toThrow("ClickHouse is not answering");
    expect(updates).toHaveLength(1);
    expect(updates[0]!["lastScannedAt"]).toEqual(STORED_AT);
    expect(String(updates[0]!["lastError"])).toContain(
      "ClickHouse is not answering",
    );
  });
});

describe("CloudAuditSecurityEvents.findEnabledSource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the project's cloud audit logs, only when they are on; null when they cannot be told", async () => {
    const on: SecurityTelemetrySource = source();
    const off: SecurityTelemetrySource = source();
    off.isEnabled = false;
    const lookUp: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityTelemetrySourceService,
      "findForProject",
    );

    lookUp.mockResolvedValueOnce(on as never);
    await expect(
      CloudAuditSecurityEvents.findEnabledSource(PROJECT_ID),
    ).resolves.toBe(on);
    expect(lookUp).toHaveBeenCalledWith(
      PROJECT_ID,
      SecurityTelemetrySourceKind.CloudAudit,
    );

    lookUp.mockResolvedValueOnce(off as never);
    await expect(
      CloudAuditSecurityEvents.findEnabledSource(PROJECT_ID),
    ).resolves.toBeNull();

    lookUp.mockResolvedValueOnce(null as never);
    await expect(
      CloudAuditSecurityEvents.findEnabledSource(PROJECT_ID),
    ).resolves.toBeNull();

    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    lookUp.mockRejectedValueOnce(new Error("Postgres is away") as never);
    await expect(
      CloudAuditSecurityEvents.findEnabledSource(PROJECT_ID),
    ).resolves.toBeNull();
  });
});
