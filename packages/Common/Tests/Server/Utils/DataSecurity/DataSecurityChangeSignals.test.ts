import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  DataSecurityChangeSignalsResult,
  DataStoreChangeMatcher,
  PostureChange,
  buildDataStoreChangeEvent,
  buildPostureChangeStatement,
  getDataStoreChangeEventUid,
  getPostureChangeOperations,
  getRemovedProtection,
  readPostureChange,
  recordPostureChangeSignals,
} from "../../../../Server/Utils/DataSecurity/DataSecurityChangeSignals";
import logger from "../../../../Server/Utils/Logger";
import SecurityEventDedupe from "../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../Types/DataSecurity/DataStorePosture";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityEntityType,
  entitiesFromObservables,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  DATA_STORE_EXPORT_OPERATIONS,
  DATA_STORE_PROTECTION_OPERATIONS,
  DATA_STORE_PUBLIC_ACCESS_OPERATIONS,
  DATA_STORE_SNAPSHOT_SHARING_OPERATIONS,
  DataStoreProtection,
} from "../../../../Types/SecurityEvent/DataSecuritySignal";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryCategory,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import {
  DetectionRuleDataKind,
  isDetectionRuleDataKindSeen,
} from "../../../../Types/SecurityEvent/DetectionRuleDataKind";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { sigmaRuleMatchesEvent } from "../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Detection and response for data: a cloud change to a store Data Security
 * finds sensitive becomes a security event the Data security rules read.
 * The changes are read with one parameterized statement, matched to the
 * store they changed (its Cloud Resource, or its id at the provider within
 * the account), kept only for stores at Confidential or above, written
 * once each - and each library rule fires on the change it is about, and
 * on no other.
 *
 * The runner's own list of posture changes is stood in for: the runner
 * reads clouds, and none is read here.
 */
jest.mock("../../../../Server/Utils/DataSecurity/DataSecurityRunner", () => {
  return {
    POSTURE_CHANGING_OPERATIONS: [
      "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketAcl",
      "s3:PutPublicAccessBlock",
      "s3:DeletePublicAccessBlock",
      "s3:PutBucketEncryption",
      "s3:DeleteBucketEncryption",
      "s3:PutBucketVersioning",
      "s3:PutBucketLogging",
      "rds:ModifyDBInstance",
      "rds:ModifyDBSnapshotAttribute",
      "rds:ModifyDBClusterSnapshotAttribute",
      "rds:CopyDBSnapshot",
      "rds:StartExportTask",
    ],
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ACCOUNT: string = "123456789012";
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const CHANGED_AT: Date = new Date("2026-10-27T11:40:00.000Z");
const CARDS_RESOURCE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "OneUptime Data Security",
  primaryEntityId: new ObjectID("34343434-3434-4434-8434-343434343434"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function bucket(
  name: string,
  sensitivity: DataSensitivity,
  overrides: Partial<DataStore> = {},
): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.name = name;
  model.kind = DataStoreKind.AwsS3Bucket;
  model.storeKey = `cloud:aws:${DataStoreKind.AwsS3Bucket}:arn:aws:s3:::${name}`;
  model.providerResourceId = `arn:aws:s3:::${name}`;
  model.cloudAccountNumber = ACCOUNT;
  model.region = "us-east-1";
  model.sensitivity = sensitivity;
  model.exposure = DataStoreExposure.Private;
  Object.assign(model, overrides);
  return model;
}

function database(name: string, sensitivity: DataSensitivity): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.name = name;
  model.kind = DataStoreKind.AwsRdsSnapshot;
  model.storeKey = `cloud:aws:${DataStoreKind.AwsRdsSnapshot}:arn:aws:rds:us-east-1:${ACCOUNT}:snapshot:${name}`;
  model.providerResourceId = `arn:aws:rds:us-east-1:${ACCOUNT}:snapshot:${name}`;
  model.cloudAccountNumber = ACCOUNT;
  model.sensitivity = sensitivity;
  return model;
}

function change(overrides: Partial<PostureChange> = {}): PostureChange {
  return {
    time: CHANGED_AT,
    operation: "s3:PutBucketPolicy",
    actor: "alice",
    provider: "aws",
    accountId: ACCOUNT,
    region: "us-east-1",
    providerResourceId: "cards",
    cloudResourceId: "",
    eventId: "8b7e0f52-1111-4a5b-9c3d-0e6f1a2b3c4d",
    failed: false,
    ...overrides,
  };
}

// A change event row as the statement reads it.
function row(
  overrides: Record<string, string> = {},
  timeInMs?: number,
): JSONObject {
  return {
    timeInMs: String(timeInMs ?? CHANGED_AT.getTime()),
    attributes: {
      "oneuptime.change.source": "cloud",
      "oneuptime.change.status": "succeeded",
      "oneuptime.cloud.operation": "s3:PutBucketPolicy",
      "oneuptime.cloud.actor": "alice",
      "oneuptime.cloud.event_id": "8b7e0f52-1111-4a5b-9c3d-0e6f1a2b3c4d",
      "cloud.provider": "aws",
      "cloud.account.id": ACCOUNT,
      "cloud.region": "us-east-1",
      "cloud.resource_id": "cards",
      ...overrides,
    },
  };
}

type Spy = ReturnType<typeof getJestSpyOn>;

let rows: Array<JSONObject>;
let stores: Array<DataStore>;
let existing: Set<string>;
let inserted: Array<JSONObject>;
let executeQuery: Spy;

beforeEach(() => {
  rows = [];
  stores = [];
  existing = new Set();
  inserted = [];

  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });

  getJestSpyOn(Semaphore, "lock").mockResolvedValue({} as never);
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  executeQuery = getJestSpyOn(
    ChangeEventService,
    "executeQuery",
  ).mockImplementation((async () => {
    return {
      json: async (): Promise<JSONObject> => {
        return { data: rows } as unknown as JSONObject;
      },
    };
  }) as never);
  getJestSpyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return stores;
  }) as never);
  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockImplementation(
    (async () => {
      return existing;
    }) as never,
  );
  getJestSpyOn(OTelIngestService, "telemetryServiceFromName").mockResolvedValue(
    SERVICE_METADATA as never,
  );
  getJestSpyOn(ThreatIntelEnricher, "enrichNormalizedEvents").mockResolvedValue(
    { eventsMatched: 0, valuesLookedUp: 0 } as never,
  );
  getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(
    (async (insertedRows: Array<JSONObject>) => {
      inserted.push(...insertedRows);
    }) as never,
  );
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the statement that reads the cloud's changes", () => {
  test("carries every value as a parameter, the attribute keys too", () => {
    const since: Date = new Date("2026-10-27T11:00:00.000Z");
    const statement: Statement = buildPostureChangeStatement({
      projectId: PROJECT_ID,
      since,
    });
    const params: Array<unknown> = Object.values(statement.query_params);

    expect(statement.query).toContain("FROM ");
    expect(statement.query).toContain(
      `.${AnalyticsTableName.ChangeEvent} WHERE projectId = {p0:String}`,
    );
    // By when a change arrived, within when it could have happened.
    expect(statement.query).toContain("createdAt >= {p2:DateTime}");
    expect(statement.query).toContain("time >= {p1:DateTime64(9)}");
    expect(statement.query).toContain("IN {p6:Array(String)}");

    for (const literal of [
      PROJECT_ID.toString(),
      "s3:PutBucketPolicy",
      "oneuptime.change.source",
      "oneuptime.cloud.operation",
      "'cloud'",
    ]) {
      expect([literal, statement.query.includes(literal)]).toEqual([
        literal,
        false,
      ]);
    }

    expect(params).toContain(PROJECT_ID.toString());
    expect(params).toContain("cloud");
    expect(params).toContain("oneuptime.change.source");
    expect(params).toContain("oneuptime.cloud.operation");
    expect(statement.query_params["p2"]).toBe("2026-10-27 11:00:00");
    expect(statement.query_params["p6"]).toEqual(getPostureChangeOperations());
  });

  test("reads the runner's posture changes and every one a Data security rule reads", () => {
    const operations: Array<string> = getPostureChangeOperations();

    for (const operation of [
      "s3:DeleteBucketPolicy",
      "rds:ModifyDBInstance",
      ...DATA_STORE_PUBLIC_ACCESS_OPERATIONS,
      ...DATA_STORE_SNAPSHOT_SHARING_OPERATIONS,
      ...DATA_STORE_EXPORT_OPERATIONS,
      ...Object.keys(DATA_STORE_PROTECTION_OPERATIONS),
    ]) {
      expect([operation, operations.includes(operation)]).toEqual([
        operation,
        true,
      ]);
    }

    expect(new Set(operations).size).toBe(operations.length);
  });

  test("a row reads as the change it is, and one without an operation or a time as none", () => {
    expect(
      readPostureChange(
        row({
          "oneuptime.resource.type": "CloudResource",
          "oneuptime.resource.id": CARDS_RESOURCE_ID.toString(),
          "oneuptime.change.status": "failed",
        }),
      ),
    ).toEqual(
      change({
        cloudResourceId: CARDS_RESOURCE_ID.toString(),
        failed: true,
      }),
    );
    expect(
      readPostureChange(row({ "oneuptime.cloud.operation": "" })),
    ).toBeNull();
    expect(readPostureChange({ timeInMs: "soon", attributes: {} })).toBeNull();
    expect(readPostureChange({ timeInMs: "1" })).toBeNull();
  });
});

describe("which store a change is about", () => {
  const cards: DataStore = bucket("cards", DataSensitivity.Restricted, {
    cloudResourceId: CARDS_RESOURCE_ID,
  });
  const orders: DataStore = bucket("orders", DataSensitivity.Confidential);
  const elsewhere: DataStore = bucket("orders-eu", DataSensitivity.Restricted, {
    cloudAccountNumber: "210987654321",
  });
  const matcher: DataStoreChangeMatcher = new DataStoreChangeMatcher([
    cards,
    orders,
    elsewhere,
  ]);

  test("the store of the Cloud Resource it changed", () => {
    expect(
      matcher
        .match(
          change({
            cloudResourceId: CARDS_RESOURCE_ID.toString(),
            providerResourceId: "something-else",
          }),
        )
        ?.id?.toString(),
    ).toBe(cards.id!.toString());
  });

  test("else the store whose id at the provider it names, whole or by its name, in its account", () => {
    expect(
      matcher.match(change({ providerResourceId: "arn:aws:s3:::orders" }))
        ?.name,
    ).toBe("orders");
    expect(matcher.match(change({ providerResourceId: "ORDERS" }))?.name).toBe(
      "orders",
    );
    // The same name in another account is another store.
    expect(
      matcher.match(change({ providerResourceId: "orders-eu" })),
    ).toBeNull();
    expect(
      matcher.match(
        change({ providerResourceId: "orders-eu", accountId: "210987654321" }),
      )?.name,
    ).toBe("orders-eu");
    expect(matcher.match(change({ providerResourceId: "" }))).toBeNull();
    expect(matcher.match(change({ providerResourceId: "logs" }))).toBeNull();
  });

  test("never guesses between two stores of one name", () => {
    const twins: DataStoreChangeMatcher = new DataStoreChangeMatcher([
      bucket("exports", DataSensitivity.Restricted),
      bucket("exports", DataSensitivity.Restricted, {
        kind: DataStoreKind.AwsRdsInstance,
        providerResourceId: `arn:aws:rds:us-east-1:${ACCOUNT}:db:exports`,
      }),
    ]);

    expect(twins.match(change({ providerResourceId: "exports" }))).toBeNull();
  });
});

describe("what a change takes off a store", () => {
  const AFTER: Date = new Date(CHANGED_AT.getTime() + 60_000);
  const BEFORE: Date = new Date(CHANGED_AT.getTime() - 60_000);

  test("removing a bucket's encryption always does, unless it failed", () => {
    expect(
      getRemovedProtection({
        operation: "s3:DeleteBucketEncryption",
        failed: false,
        changedAt: CHANGED_AT,
        posture: undefined,
        postureReadAt: undefined,
      }),
    ).toBe(DataStoreProtection.Encryption);
    expect(
      getRemovedProtection({
        operation: "s3:DeleteBucketEncryption",
        failed: true,
        changedAt: CHANGED_AT,
        posture: undefined,
        postureReadAt: undefined,
      }),
    ).toBeUndefined();
  });

  test("a switch reads after the change as where it was left, before it as where it was moved from", () => {
    const removed: (
      operation: string,
      posture: JSONObject,
      postureReadAt: Date,
    ) => DataStoreProtection | undefined = (
      operation: string,
      posture: JSONObject,
      postureReadAt: Date,
    ): DataStoreProtection | undefined => {
      return getRemovedProtection({
        operation,
        failed: false,
        changedAt: CHANGED_AT,
        posture,
        postureReadAt,
      });
    };

    // Versioning suspended: off after the change, or on before it.
    expect(
      removed("s3:PutBucketVersioning", { versioning: false }, AFTER),
    ).toBe(DataStoreProtection.Versioning);
    expect(
      removed("s3:PutBucketVersioning", { versioning: true }, BEFORE),
    ).toBe(DataStoreProtection.Versioning);
    // Versioning turned on: nothing taken.
    expect(
      removed("s3:PutBucketVersioning", { versioning: true }, AFTER),
    ).toBeUndefined();
    expect(
      removed("s3:PutBucketVersioning", { versioning: false }, BEFORE),
    ).toBeUndefined();
    // Logging turned off.
    expect(
      removed("s3:PutBucketLogging", { accessLogging: false }, AFTER),
    ).toBe(DataStoreProtection.AccessLogging);
    // A configuration Data Security could not read says nothing.
    expect(
      removed("s3:PutBucketLogging", { accessLogging: null }, AFTER),
    ).toBeUndefined();
    // Any other operation takes nothing.
    expect(
      removed("s3:PutBucketPolicy", { versioning: false }, AFTER),
    ).toBeUndefined();
    expect(removed("constructor", {}, AFTER)).toBeUndefined();
  });
});

describe("the security event a change to a sensitive store is", () => {
  test("is the cloud's API call, by whom, on which store, how sensitive it is", () => {
    const cards: DataStore = bucket("cards", DataSensitivity.Restricted);
    const event: NormalizedSecurityEvent = buildDataStoreChangeEvent({
      change: change(),
      store: cards,
      sensitivity: DataSensitivity.Restricted,
      recordedAt: NOW,
    });

    expect(event).toMatchObject({
      // Stamped when written: a rule reads events by their time.
      time: NOW,
      eventUid: getDataStoreChangeEventUid(change()),
      className: "API Activity",
      classUid: 6003,
      categoryName: "Application Activity",
      activityName: "Update",
      severityName: OcsfSeverity.High,
      statusName: "Success",
      vendorName: "OneUptime",
      productName: "Data Security",
      principalUser: "alice",
      targetResource: "arn:aws:s3:::cards",
      mitreTactics: ["TA0009"],
      mitreTechniques: ["T1530"],
    });
    expect(event.message).toBe(
      "alice ran s3:PutBucketPolicy on cards, AWS S3 Bucket holding Restricted data.",
    );
    expect(event.attributes).toEqual({
      "oneuptime.source": "data-security",
      "oneuptime.signal": "data-security.store-change",
      "oneuptime.data_store.entity": `data-store:${cards.storeKey}`,
      "oneuptime.data_store.id": cards.id!.toString(),
      "oneuptime.data_store.name": "cards",
      "oneuptime.data_store.kind": DataStoreKind.AwsS3Bucket,
      "oneuptime.data_store.sensitivity": "Restricted",
      "oneuptime.data_store.exposure": "Private",
      "oneuptime.change.time": CHANGED_AT.toISOString(),
      "oneuptime.change.status": "succeeded",
      "oneuptime.cloud.operation": "s3:PutBucketPolicy",
      "oneuptime.cloud.actor": "alice",
      "oneuptime.cloud.event_id": "8b7e0f52-1111-4a5b-9c3d-0e6f1a2b3c4d",
      "cloud.provider": "aws",
      "cloud.account.id": ACCOUNT,
      "cloud.region": "us-east-1",
      "cloud.resource_id": "cards",
    });
    // The store is an entity of the event, typed as one.
    expect(entitiesFromObservables(event.observables)).toContainEqual({
      type: SecurityEntityType.DataStore,
      value: `data-store:${cards.storeKey}`,
    });
  });

  test("a Confidential store's change is Medium; a refused one says so", () => {
    const event: NormalizedSecurityEvent = buildDataStoreChangeEvent({
      change: change({ failed: true, actor: "" }),
      store: bucket("orders", DataSensitivity.Confidential),
      sensitivity: DataSensitivity.Confidential,
      recordedAt: NOW,
    });

    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.statusName).toBe("Failure");
    expect(event.attributes["oneuptime.change.status"]).toBe("failed");
    expect(event.message).toBe(
      "Someone tried to run s3:PutBucketPolicy on orders, AWS S3 Bucket holding Confidential data.",
    );
  });

  test("a change's identity is the cloud's event id, or what it was when it has none", () => {
    expect(getDataStoreChangeEventUid(change())).toBe(
      getDataStoreChangeEventUid(change({ actor: "bob" })),
    );
    expect(getDataStoreChangeEventUid(change())).not.toBe(
      getDataStoreChangeEventUid(change({ eventId: "another" })),
    );
    expect(getDataStoreChangeEventUid(change({ eventId: "" }))).not.toBe(
      getDataStoreChangeEventUid(change({ eventId: "", actor: "bob" })),
    );
    expect(getDataStoreChangeEventUid(change())).toMatch(
      /^data-store-change:[0-9a-f]{64}$/,
    );
  });
});

describe("recordPostureChangeSignals", () => {
  test("writes an event for each change to a store at Confidential or above, and nothing for the rest", async () => {
    stores = [
      bucket("cards", DataSensitivity.Restricted),
      bucket("orders", DataSensitivity.Confidential),
      bucket("logs", DataSensitivity.Internal),
      bucket("site", DataSensitivity.Public, {
        sensitivityOverride: DataSensitivity.Confidential,
      }),
    ];
    rows = [
      row({ "cloud.resource_id": "cards", "oneuptime.cloud.event_id": "e1" }),
      row({ "cloud.resource_id": "orders", "oneuptime.cloud.event_id": "e2" }),
      row({ "cloud.resource_id": "logs", "oneuptime.cloud.event_id": "e3" }),
      row({ "cloud.resource_id": "site", "oneuptime.cloud.event_id": "e4" }),
      row({ "cloud.resource_id": "unknown", "oneuptime.cloud.event_id": "e5" }),
    ];

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(
        PROJECT_ID,
        new Date("2026-10-27T11:00:00.000Z"),
      );

    expect(result).toEqual({
      changesRead: 5,
      changesMatched: 4,
      eventsRecorded: 3,
      isTruncated: false,
    });
    expect(
      inserted.map((inserted: JSONObject): unknown => {
        return (inserted["attributes"] as JSONObject)[
          "oneuptime.data_store.name"
        ];
      }),
    ).toEqual(["cards", "orders", "site"]);
    expect(inserted[0]).toMatchObject({
      projectId: PROJECT_ID.toString(),
      vendorName: "OneUptime",
      productName: "Data Security",
      primaryEntityId: SERVICE_METADATA.primaryEntityId.toString(),
    });
    expect(OTelIngestService.telemetryServiceFromName).toHaveBeenCalledWith({
      serviceName: "OneUptime Data Security",
      projectId: PROJECT_ID,
    });
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("writes a change once: one already stored, or read twice, is not written again", async () => {
    stores = [bucket("cards", DataSensitivity.Restricted)];
    rows = [
      row({ "oneuptime.cloud.event_id": "e1" }),
      row({ "oneuptime.cloud.event_id": "e1" }),
      row({ "oneuptime.cloud.event_id": "e2" }),
    ];
    existing = new Set([getDataStoreChangeEventUid(change({ eventId: "e2" }))]);

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, NOW);

    expect(result.eventsRecorded).toBe(1);
    expect(inserted).toHaveLength(1);
    // Looked up once each, under Data Security's vendor and product.
    expect(SecurityEventDedupe.findExistingEventUids).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      vendorName: "OneUptime",
      productName: "Data Security",
      ids: [
        getDataStoreChangeEventUid(change({ eventId: "e1" })),
        getDataStoreChangeEventUid(change({ eventId: "e2" })),
      ],
    });
    expect(inserted[0]!["eventUid"]).toBe(
      getDataStoreChangeEventUid(change({ eventId: "e1" })),
    );
  });

  test("reads at most a day back, whatever it is asked", async () => {
    await recordPostureChangeSignals(PROJECT_ID, new Date("2020-01-01"));

    const statement: Statement = executeQuery.mock.calls[0]![0] as Statement;

    expect(statement.query_params["p2"]).toBe("2026-10-26 12:00:00");
  });

  test("with nothing changed, reads no store and writes nothing", async () => {
    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, NOW);

    expect(result.changesRead).toBe(0);
    expect(DataStoreService.findBy).not.toHaveBeenCalled();
    expect(SecurityEventService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("leaves the project to the call that holds its lock", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Timeout") as never,
    );

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, NOW);

    expect(result.changesRead).toBe(0);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  test("never throws: what could not be read is logged, and the lock given back", async () => {
    executeQuery.mockRejectedValue(new Error("ClickHouse is down") as never);

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, NOW);

    expect(result.eventsRecorded).toBe(0);
    expect(logger.error).toHaveBeenCalled();
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });
});

describe("the rule library's Data security rules", () => {
  const RULES: Array<[string, Array<string>]> = [
    [
      "A sensitive bucket was made public",
      [...DATA_STORE_PUBLIC_ACCESS_OPERATIONS],
    ],
    [
      "A snapshot of a sensitive database was shared",
      [...DATA_STORE_SNAPSHOT_SHARING_OPERATIONS],
    ],
    ["A sensitive database was exported", [...DATA_STORE_EXPORT_OPERATIONS]],
  ];

  function ruleTitled(title: string): SigmaRule {
    const entry: DetectionRuleLibraryEntry | undefined =
      DETECTION_RULE_LIBRARY.find(
        (candidate: DetectionRuleLibraryEntry): boolean => {
          return candidate.title === title;
        },
      );

    expect(entry).toBeDefined();

    return SigmaRuleParser.parse(entry!.sigmaRuleYaml);
  }

  function eventOf(
    operation: string,
    overrides: Partial<PostureChange> = {},
    store: DataStore = database("orders-snap", DataSensitivity.Restricted),
  ): NormalizedSecurityEvent {
    return buildDataStoreChangeEvent({
      change: change({ operation, ...overrides }),
      store,
      sensitivity: DataSensitivity.Restricted,
      recordedAt: NOW,
    });
  }

  const PROTECTION_REMOVED: Array<NormalizedSecurityEvent> = [
    eventOf("s3:DeleteBucketEncryption"),
    eventOf(
      "s3:PutBucketVersioning",
      {},
      bucket("cards", DataSensitivity.Restricted, {
        posture: { readAt: NOW.toISOString(), versioning: false },
      }),
    ),
    eventOf(
      "s3:PutBucketLogging",
      {},
      bucket("cards", DataSensitivity.Restricted, {
        posture: { readAt: NOW.toISOString(), accessLogging: false },
      }),
    ),
  ];

  test("are one category of four, each grouped on the store, reading Data Security's events", () => {
    const entries: Array<DetectionRuleLibraryEntry> =
      DETECTION_RULE_LIBRARY.filter((entry: DetectionRuleLibraryEntry) => {
        return entry.category === DetectionRuleLibraryCategory.DataSecurity;
      });

    expect(
      entries.map((entry: DetectionRuleLibraryEntry): string => {
        return entry.title;
      }),
    ).toEqual([
      "A sensitive bucket was made public",
      "A snapshot of a sensitive database was shared",
      "Protection was removed from a sensitive store",
      "A sensitive database was exported",
    ]);

    for (const entry of entries) {
      expect(entry.dataKind).toBe(DetectionRuleDataKind.DataSecurity);
      expect(entry.groupByField).toBe("oneuptime.data_store.entity");
    }

    // A project whose Data Security writes these is told it sends them.
    expect(
      isDetectionRuleDataKindSeen(DetectionRuleDataKind.DataSecurity, {
        classNames: ["API Activity"],
        vendorNames: ["OneUptime"],
        productNames: [eventOf("s3:PutBucketPolicy").productName],
      }),
    ).toBe(true);
  });

  test.each(RULES)(
    "%s fires on each change it is about, and on no other",
    (title: string, operations: Array<string>) => {
      const rule: SigmaRule = ruleTitled(title);

      for (const operation of operations) {
        expect([
          operation,
          sigmaRuleMatchesEvent(rule, eventOf(operation)),
        ]).toEqual([operation, true]);
        // A change the cloud refused opened nothing.
        expect(
          sigmaRuleMatchesEvent(rule, eventOf(operation, { failed: true })),
        ).toBe(false);
      }

      for (const other of getPostureChangeOperations().filter(
        (operation: string): boolean => {
          return !operations.includes(operation);
        },
      )) {
        expect([other, sigmaRuleMatchesEvent(rule, eventOf(other))]).toEqual([
          other,
          false,
        ]);
      }

      for (const event of PROTECTION_REMOVED) {
        expect(sigmaRuleMatchesEvent(rule, event)).toBe(false);
      }
    },
  );

  test("Protection was removed fires when a safeguard was taken off, not when one was put on", () => {
    const rule: SigmaRule = ruleTitled(
      "Protection was removed from a sensitive store",
    );

    for (const event of PROTECTION_REMOVED) {
      expect([
        event.attributes["oneuptime.cloud.operation"],
        sigmaRuleMatchesEvent(rule, event),
      ]).toEqual([event.attributes["oneuptime.cloud.operation"], true]);
    }

    // Versioning and logging turned on, as the configuration read after says.
    const turnedOn: Array<NormalizedSecurityEvent> = [
      eventOf(
        "s3:PutBucketVersioning",
        {},
        bucket("cards", DataSensitivity.Restricted, {
          posture: { readAt: NOW.toISOString(), versioning: true },
        }),
      ),
      eventOf(
        "s3:PutBucketLogging",
        {},
        bucket("cards", DataSensitivity.Restricted, {
          posture: { readAt: NOW.toISOString(), accessLogging: true },
        }),
      ),
    ];

    for (const event of [
      ...turnedOn,
      eventOf("s3:DeleteBucketEncryption", { failed: true }),
      eventOf("s3:PutBucketPolicy"),
      eventOf("rds:StartExportTask"),
    ]) {
      expect(sigmaRuleMatchesEvent(rule, event)).toBe(false);
    }
  });

  test("each rule's ATT&CK tags include what its events stand for", () => {
    for (const [title, operations] of RULES) {
      const rule: SigmaRule = ruleTitled(title);
      const event: NormalizedSecurityEvent = eventOf(operations[0]!);

      expect(rule.mitreTechniques).toEqual(
        expect.arrayContaining(event.mitreTechniques),
      );
    }

    const protection: SigmaRule = ruleTitled(
      "Protection was removed from a sensitive store",
    );

    for (const event of PROTECTION_REMOVED) {
      expect(protection.mitreTechniques).toEqual(
        expect.arrayContaining(event.mitreTechniques),
      );
    }
  });
});
