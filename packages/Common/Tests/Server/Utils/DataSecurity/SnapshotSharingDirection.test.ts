import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFeed from "../../../../Models/DatabaseModels/DataStoreFeed";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import {
  readAwsTrailEvent,
  readSnapshotSharingGrant,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsChanges";
import {
  AwsRolePurpose,
  getRoleSessionName,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import OneUptimeAwsSessions from "../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import CloudChangeRecorder, {
  buildCloudChangeEntry,
} from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import { CloudChange } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSecurityChangeSignalsResult,
  DataStoreForSignal,
  DataStoreResponseFeedLine,
  DataStoreResponseLink,
  PostureChange,
  RESPONSE_FEED_SLACK_BEFORE_MS,
  RESPONSE_FEED_WINDOW_AFTER_MS,
  isOnlyRemovingSnapshotAccess,
  pickDataStoreResponseLink,
  readPostureChange,
  recordPostureChangeSignals,
} from "../../../../Server/Utils/DataSecurity/DataSecurityChangeSignals";
import {
  getResponseActionStoreFeedMarkdown,
  readResponseActionOfStoreFeed,
} from "../../../../Server/Utils/DataSecurity/DataSecurityResponseFeed";
import logger from "../../../../Server/Utils/Logger";
import RealTimeDetections from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityEventDedupe from "../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import TelemetryFanInWriter from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  DataSecurityResponseAction,
} from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getDetectionRuleLibraryEntry } from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { ONEUPTIME_ACTOR_ATTRIBUTE } from "../../../../Types/SecurityEvent/OneUptimeActor";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { ParsedChangeEventEntry } from "../../../../Server/Utils/Telemetry/ChangeEventRow";
import {
  CHANGE_MADE_BY_CLOUD_CONNECTION,
  ChangeEventAttribute,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  RECORDED_ACCOUNT_ID,
  RECORDED_CONNECTION_ID,
  RECORDED_PROJECT_ID,
  RECORDED_ROLE_ARN,
  RECORDED_SESSION_KEY,
  RECORDED_SESSION_NAME,
  installMemoryGlobalCache,
  readCloudTrailRecording,
} from "../../../Helpers/CloudTrailRecordings";
import { sigmaRuleMatchesEvent } from "../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";

/*
 * CLOSING A SHARED SNAPSHOT IS NOT SHARING IT (#10428). Data Security's
 * Revoke sharing - and the Close a Data Exposure playbook - stops sharing an
 * RDS snapshot with ModifyDBSnapshotAttribute naming accounts to remove, the
 * same call that shares one; a store at Confidential or above wrote a
 * security event for it, and "A snapshot of a sensitive database was
 * shared" opened a high alert minutes after OneUptime closed the exposure.
 * Read from the recorded samples (Tests/Fixtures/CloudTrail/SnapshotSharing):
 *
 *   - the activity log's request says which way a sharing change went - a
 *     yes or no kept on the change event, never the accounts;
 *   - a change that only removed accounts writes no event; one that added
 *     any writes one, as before; one that says neither writes one, as
 *     before;
 *   - a change OneUptime made in its own session says so, and names the
 *     response action on the store's feed that made it - only when the call
 *     was signed with the key AWS handed OneUptime.
 */

const PROJECT_ID: ObjectID = new ObjectID(RECORDED_PROJECT_ID);
const NOW: Date = new Date("2026-11-20T12:30:00.000Z");
// OneUptime's session in the samples: made at its creationDate, an hour long.
const SESSION_ISSUED_MS: number = new Date("2026-11-20T11:58:40Z").getTime();
const SESSION_EXPIRES_MS: number = SESSION_ISSUED_MS + 60 * 60 * 1000;
const SNAPSHOT: string = "orders-nightly-2026-11-19";
const SNAPSHOT_ARN: string = `arn:aws:rds:us-east-1:${RECORDED_ACCOUNT_ID}:snapshot:${SNAPSHOT}`;
const CLUSTER_SNAPSHOT: string = "ledger-cluster-2026-11-19";
const CLUSTER_SNAPSHOT_ARN: string = `arn:aws:rds:us-east-1:${RECORDED_ACCOUNT_ID}:cluster-snapshot:${CLUSTER_SNAPSHOT}`;
const OUTSIDE: string = "210987654321";

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

// The samples, by who made each and how.
interface Samples {
  revoke: JSONObject;
  revokeCluster: JSONObject;
  sharedByAlice: JSONObject;
  publicByAnotherSession: JSONObject;
  sharedWithOneUptimesName: JSONObject;
  directionUnread: JSONObject;
}

function samples(): Samples {
  const records: Array<JSONObject> = readCloudTrailRecording("SnapshotSharing");

  return {
    revoke: records[0]!,
    revokeCluster: records[1]!,
    sharedByAlice: records[2]!,
    publicByAnotherSession: records[3]!,
    sharedWithOneUptimesName: records[4]!,
    directionUnread: records[5]!,
  };
}

/*
 * A record as CloudTrail's LookupEvents lists it - what a connection's
 * read of the account's changes gets - with the record itself inside.
 */
function lookupEventOf(record: JSONObject): JSONObject {
  const identity: JSONObject = record["userIdentity"] as JSONObject;
  const isCluster: boolean =
    record["eventName"] === "ModifyDBClusterSnapshotAttribute";
  const arn: string = String(identity["arn"]);

  return {
    EventId: record["eventID"],
    EventName: record["eventName"],
    ReadOnly: "false",
    AccessKeyId: identity["accessKeyId"],
    EventTime: new Date(String(record["eventTime"])).getTime() / 1000,
    EventSource: record["eventSource"],
    // An assumed role's session by its name alone; a user by theirs.
    Username:
      identity["type"] === "AssumedRole"
        ? arn.slice(arn.lastIndexOf("/") + 1)
        : identity["userName"],
    Resources: [
      {
        ResourceType: isCluster
          ? "AWS::RDS::DBClusterSnapshot"
          : "AWS::RDS::DBSnapshot",
        ResourceName: isCluster ? CLUSTER_SNAPSHOT_ARN : SNAPSHOT_ARN,
      },
    ],
    CloudTrailEvent: JSON.stringify(record),
  };
}

function changeOf(record: JSONObject): CloudChange {
  return readAwsTrailEvent({
    event: lookupEventOf(record),
    accountId: RECORDED_ACCOUNT_ID,
    region: "us-east-1",
  })!;
}

async function signedIn(): Promise<void> {
  await OneUptimeAwsSessions.remember({
    projectId: RECORDED_PROJECT_ID,
    connectionId: RECORDED_CONNECTION_ID,
    roleArn: RECORDED_ROLE_ARN,
    purpose: AwsRolePurpose.CloudConnect,
    accessKeyId: RECORDED_SESSION_KEY,
    issuedAtMs: SESSION_ISSUED_MS,
    expiresAtMs: SESSION_EXPIRES_MS,
  });
}

// What the recorder writes for the changes: each as its change event's row, as the statement reads it back.
async function changeEventRowsOf(
  records: Array<JSONObject>,
): Promise<Array<JSONObject>> {
  const changes: Array<CloudChange> = records.map(changeOf);
  const own: Map<CloudChange, unknown> =
    await OneUptimeAwsSessions.findOwnChanges({
      projectId: RECORDED_PROJECT_ID,
      changes,
    });

  return changes.map((change: CloudChange): JSONObject => {
    const entry: ParsedChangeEventEntry = buildCloudChangeEntry({
      change,
      resource: null,
      accountRecordId: null,
      madeInOwnSession: (own.get(change) as never) || null,
    });

    return {
      timeInMs: String(entry.time.getTime()),
      attributes: entry.attributes as unknown as JSONObject,
    };
  });
}

function snapshotStore(name: string, arn: string): DataStore {
  const model: DataStore = new DataStore();
  model._id = ObjectID.generate().toString();
  model.projectId = PROJECT_ID;
  model.name = name;
  model.kind = DataStoreKind.AwsRdsSnapshot;
  model.storeKey = `cloud:aws:${DataStoreKind.AwsRdsSnapshot}:${arn}`;
  model.providerResourceId = arn;
  model.cloudAccountNumber = RECORDED_ACCOUNT_ID;
  model.region = "us-east-1";
  model.sensitivity = DataSensitivity.Restricted;
  model.cloudConnectionId = new ObjectID(RECORDED_CONNECTION_ID);
  return model;
}

// A line of the store's feed, as Revoke sharing writes it once it changed the store.
function revokeLine(id: string, at: Date): DataStoreFeed {
  const feed: DataStoreFeed = new DataStoreFeed();
  feed._id = id;
  feed.createdAt = at;
  feed.feedInfoInMarkdown = getResponseActionStoreFeedMarkdown({
    action: DataSecurityResponseAction.RevokeSharing,
    outcome: {
      changed: true,
      summary: `Stopped sharing snapshot ${SNAPSHOT} with everyone (it was public) and account ${OUTSIDE}.`,
    },
  }).toString();
  return feed;
}

let rows: Array<JSONObject>;
let stores: Array<DataStore>;
let feedLines: Array<DataStoreFeed>;
let written: Array<NormalizedSecurityEvent>;

function installDataSecurity(): void {
  rows = [];
  stores = [
    snapshotStore(SNAPSHOT, SNAPSHOT_ARN),
    snapshotStore(CLUSTER_SNAPSHOT, CLUSTER_SNAPSHOT_ARN),
  ];
  feedLines = [];
  written = [];

  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(ChangeEventService, "executeQuery")
    .mockImplementation((async () => {
      return {
        json: async (): Promise<JSONObject> => {
          return { data: rows } as unknown as JSONObject;
        },
      };
    }) as never);
  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return stores;
  }) as never);
  jest.spyOn(DataStoreFeedService, "findBy").mockImplementation((async () => {
    return feedLines;
  }) as never);
  jest
    .spyOn(SecurityEventDedupe, "findExistingEventUids")
    .mockResolvedValue(new Set<string>() as never);
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockResolvedValue(SERVICE_METADATA as never);
  jest
    .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
    .mockImplementation((async (data: {
      events: Array<NormalizedSecurityEvent>;
    }) => {
      written.push(...data.events);
      return { eventsMatched: 0, valuesLookedUp: 0 };
    }) as never);
  jest
    .spyOn(SecurityEventService, "insertJsonRows")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RealTimeDetections, "screen")
    .mockResolvedValue(undefined as never);
}

function eventFor(snapshot: string): Array<NormalizedSecurityEvent> {
  return written.filter((event: NormalizedSecurityEvent): boolean => {
    return event.attributes["oneuptime.data_store.name"] === snapshot;
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("which way a snapshot's sharing went, as the activity log says it", () => {
  test("Data Security's Revoke sharing only removed accounts: false, for an instance's snapshot and a cluster's", () => {
    expect(changeOf(samples().revoke).grantsAccess).toBe(false);
    expect(changeOf(samples().revokeCluster).grantsAccess).toBe(false);
  });

  test("a share - the recorded one, a public one, one in OneUptime's name - added accounts: true", () => {
    expect(changeOf(samples().sharedByAlice).grantsAccess).toBe(true);
    expect(changeOf(samples().publicByAnotherSession).grantsAccess).toBe(true);
    expect(changeOf(samples().sharedWithOneUptimesName).grantsAccess).toBe(
      true,
    );
  });

  test("a change whose request the log does not hold says nothing: undefined", () => {
    expect(changeOf(samples().directionUnread).grantsAccess).toBeUndefined();
  });

  test("the fact is a yes or no: no account the request named is kept on the change", () => {
    for (const record of Object.values(samples())) {
      const kept: string = JSON.stringify(changeOf(record));

      expect(kept).not.toContain(OUTSIDE);
      expect(kept).not.toContain("valuesTo");
    }
  });

  test.each<[string, JSONObject, boolean | undefined]>([
    ["accounts to add", { valuesToAdd: [OUTSIDE] }, true],
    ["everyone to add", { valuesToAdd: ["all"] }, true],
    ["one account to add, as a string", { valuesToAdd: OUTSIDE }, true],
    [
      "accounts to add and to remove",
      { valuesToAdd: [OUTSIDE], valuesToRemove: ["all"] },
      true,
    ],
    ["accounts to remove only", { valuesToRemove: ["all", OUTSIDE] }, false],
    [
      "none to add, accounts to remove",
      { valuesToAdd: [], valuesToRemove: [OUTSIDE] },
      false,
    ],
    ["the parameters in another case", { ValuesToRemove: [OUTSIDE] }, false],
    ["empty lists", { valuesToAdd: [], valuesToRemove: [] }, undefined],
    ["neither list", {}, undefined],
    ["blank values", { valuesToAdd: [" "], valuesToRemove: [""] }, undefined],
    [
      "an attribute other than restore",
      { attributeName: "copy", valuesToAdd: [OUTSIDE] },
      undefined,
    ],
  ])(
    "a request naming %s",
    (_case: string, parameters: JSONObject, expected: boolean | undefined) => {
      expect(
        readSnapshotSharingGrant({
          eventSource: "rds.amazonaws.com",
          eventName: "ModifyDBSnapshotAttribute",
          trail: {
            requestParameters: { attributeName: "restore", ...parameters },
          },
        }),
      ).toBe(expected);
    },
  );

  test("only a change of who may restore a snapshot is read for it", () => {
    const trail: JSONObject = {
      requestParameters: { valuesToRemove: [OUTSIDE] },
    };

    expect(
      readSnapshotSharingGrant({
        eventSource: "rds.amazonaws.com",
        eventName: "CopyDBSnapshot",
        trail,
      }),
    ).toBeUndefined();
    expect(
      readSnapshotSharingGrant({
        eventSource: "ec2.amazonaws.com",
        eventName: "ModifyDBSnapshotAttribute",
        trail,
      }),
    ).toBeUndefined();
    expect(
      readSnapshotSharingGrant({
        eventSource: "rds.amazonaws.com",
        eventName: "ModifyDBSnapshotAttribute",
        trail: { requestParameters: null },
      }),
    ).toBeUndefined();
  });

  test("who signed it is kept on the change only when it could be OneUptime's own session", () => {
    expect(changeOf(samples().revoke).actorSession?.accessKeyId).toBe(
      RECORDED_SESSION_KEY,
    );
    expect(changeOf(samples().sharedByAlice).actorSession).toBeUndefined();
  });
});

describe("what the change event keeps of it", () => {
  test("a yes or a no under oneuptime.cloud.grants_access, and nothing when the log says neither", () => {
    const attributesOf: (record: JSONObject) => JSONObject = (
      record: JSONObject,
    ): JSONObject => {
      return buildCloudChangeEntry({
        change: changeOf(record),
        resource: null,
        accountRecordId: null,
      }).attributes as unknown as JSONObject;
    };

    expect(
      attributesOf(samples().revoke)[ChangeEventAttribute.CloudGrantsAccess],
    ).toBe("false");
    expect(
      attributesOf(samples().sharedByAlice)[
        ChangeEventAttribute.CloudGrantsAccess
      ],
    ).toBe("true");
    expect(
      attributesOf(samples().directionUnread)[
        ChangeEventAttribute.CloudGrantsAccess
      ],
    ).toBeUndefined();
  });

  test("the recorder marks the changes OneUptime made in its own session, and no other", async () => {
    installMemoryGlobalCache();
    const submitted: Array<JSONObject> = [];

    await signedIn();
    jest.spyOn(CloudResourceService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(CloudAccountService, "findAccount").mockResolvedValue(null);
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true as never);
    jest.spyOn(TelemetryFanInWriter, "submit").mockImplementation((async (
      _target: unknown,
      submittedRows: Array<JSONObject>,
    ) => {
      submitted.push(...submittedRows);
      return { flushed: Promise.resolve() };
    }) as never);

    const records: Samples = samples();

    await CloudChangeRecorder.record({
      projectId: PROJECT_ID,
      provider: CloudProvider.AWS,
      changes: [
        records.revoke,
        records.sharedByAlice,
        records.publicByAnotherSession,
        records.sharedWithOneUptimesName,
      ].map(changeOf),
    });

    expect(
      submitted.map((row: JSONObject): unknown => {
        return (row["attributes"] as JSONObject)[ChangeEventAttribute.MadeBy];
      }),
    ).toEqual([
      CHANGE_MADE_BY_CLOUD_CONNECTION,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("a change read back says which way it went, and whether OneUptime made it", async () => {
    installMemoryGlobalCache();
    await signedIn();

    const [revoke, shared] = await changeEventRowsOf([
      samples().revoke,
      samples().sharedByAlice,
    ]);
    const revoked: PostureChange = readPostureChange(revoke!)!;
    const share: PostureChange = readPostureChange(shared!)!;

    expect(revoked).toMatchObject({
      operation: "rds:ModifyDBSnapshotAttribute",
      actor: RECORDED_SESSION_NAME,
      grantsAccess: false,
      madeByOneUptime: true,
    });
    expect(isOnlyRemovingSnapshotAccess(revoked)).toBe(true);
    expect(share).toMatchObject({ grantsAccess: true, madeByOneUptime: false });
    expect(isOnlyRemovingSnapshotAccess(share)).toBe(false);
  });
});

describe("the security events Data Security writes", () => {
  test("ModifyDBSnapshotAttribute with only valuesToRemove writes no event", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().revoke, samples().revokeCluster]);

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(result).toMatchObject({
      changesRead: 2,
      changesMatched: 2,
      onlyRemovedAccess: 2,
      eventsRecorded: 0,
    });
    expect(written).toEqual([]);
  });

  test("ModifyDBSnapshotAttribute with valuesToAdd writes an event, as before - whoever made it", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([
      samples().sharedByAlice,
      samples().publicByAnotherSession,
      samples().sharedWithOneUptimesName,
    ]);

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(result).toMatchObject({ onlyRemovedAccess: 0, eventsRecorded: 3 });

    // None is OneUptime's: not even the share made in OneUptime's name with another key.
    for (const event of written) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    }

    // And the library rule fires on each.
    const rule: SigmaRule = SigmaRuleParser.parse(
      getDetectionRuleLibraryEntry("281a4d7b-8fe9-4b78-b847-33b464cabe01")!
        .sigmaRuleYaml,
    );

    expect(
      written.map((event: NormalizedSecurityEvent): boolean => {
        return sigmaRuleMatchesEvent(rule, event);
      }),
    ).toEqual([true, true, true]);
  });

  test("ModifyDBSnapshotAttribute with neither readable writes an event, as before", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().directionUnread]);

    const result: DataSecurityChangeSignalsResult =
      await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(result).toMatchObject({ onlyRemovedAccess: 0, eventsRecorded: 1 });
    expect(eventFor(SNAPSHOT)).toHaveLength(1);
  });

  test("the alert the issue saw: Revoke sharing, then a share by someone else - one event, the share's", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().revoke, samples().sharedByAlice]);

    await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(
      written.map((event: NormalizedSecurityEvent): string => {
        return event.principalUser;
      }),
    ).toEqual(["alice"]);
  });
});

describe("a change OneUptime made in its own session", () => {
  test("says so, and names the response action on the store's feed that made it", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().directionUnread]);
    feedLines = [
      revokeLine(
        "0192f1a0-0000-7000-8000-00000000f001",
        new Date("2026-11-20T12:05:04Z"),
      ),
    ];

    await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    const event: NormalizedSecurityEvent = eventFor(SNAPSHOT)[0]!;

    expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBe("oneuptime");
    expect(event.attributes["oneuptime.data_store.response_action"]).toBe(
      DataSecurityResponseAction.RevokeSharing,
    );
    expect(event.attributes["oneuptime.data_store.response_feed_item_id"]).toBe(
      "0192f1a0-0000-7000-8000-00000000f001",
    );
    expect(
      event.message.startsWith(
        "OneUptime's own change (Revoke sharing, on the store's timeline): ",
      ),
    ).toBe(true);
  });

  test("with no line of the store's feed to tie it to, it is OneUptime's own all the same, without a link", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().directionUnread]);

    await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    const event: NormalizedSecurityEvent = eventFor(SNAPSHOT)[0]!;

    expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBe("oneuptime");
    expect(
      event.attributes["oneuptime.data_store.response_action"],
    ).toBeUndefined();
    expect(event.message.startsWith("OneUptime's own change: ")).toBe(true);
  });

  test("a feed that cannot be read leaves the link out, and fails nothing", async () => {
    installMemoryGlobalCache();
    await signedIn();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().directionUnread]);
    jest
      .spyOn(DataStoreFeedService, "findBy")
      .mockRejectedValue(new Error("Postgres is not reachable"));

    await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(eventFor(SNAPSHOT)).toHaveLength(1);
    expect(
      eventFor(SNAPSHOT)[0]!.attributes["oneuptime.data_store.response_action"],
    ).toBeUndefined();
  });

  test("without the key OneUptime was handed, it is anyone's: not marked, and no feed is read", async () => {
    installMemoryGlobalCache();
    installDataSecurity();
    rows = await changeEventRowsOf([samples().directionUnread]);
    feedLines = [
      revokeLine(
        "0192f1a0-0000-7000-8000-00000000f001",
        new Date("2026-11-20T12:05:04Z"),
      ),
    ];
    const feed: SpyInstance<typeof DataStoreFeedService.findBy> = jest.spyOn(
      DataStoreFeedService,
      "findBy",
    );

    await recordPostureChangeSignals(PROJECT_ID, new Date(SESSION_ISSUED_MS));

    expect(
      eventFor(SNAPSHOT)[0]!.attributes[ONEUPTIME_ACTOR_ATTRIBUTE],
    ).toBeUndefined();
    expect(feed).not.toHaveBeenCalled();
  });
});

describe("pickDataStoreResponseLink", () => {
  const store: DataStoreForSignal = snapshotStore(SNAPSHOT, SNAPSHOT_ARN);
  const at: Date = new Date("2026-11-20T12:05:00Z");

  function own(overrides: Partial<PostureChange> = {}): PostureChange {
    return {
      time: at,
      operation: "rds:ModifyDBSnapshotAttribute",
      actor: getRoleSessionName(RECORDED_CONNECTION_ID),
      provider: "aws",
      accountId: RECORDED_ACCOUNT_ID,
      region: "us-east-1",
      providerResourceId: SNAPSHOT_ARN,
      cloudResourceId: "",
      eventId: "e1",
      failed: false,
      madeByOneUptime: true,
      ...overrides,
    };
  }

  function line(
    id: string,
    offsetMs: number,
    action: DataSecurityResponseAction = DataSecurityResponseAction.RevokeSharing,
    changed: boolean = true,
  ): DataStoreResponseFeedLine {
    return {
      id,
      at: new Date(at.getTime() + offsetMs),
      markdown: getResponseActionStoreFeedMarkdown({
        action,
        outcome: { changed, summary: "Done." },
      }).toString(),
    };
  }

  test("the one line of an action that makes the change, written just after it", () => {
    const link: DataStoreResponseLink | null = pickDataStoreResponseLink({
      change: own(),
      store,
      lines: [line("a", 4000)],
    });

    expect(link).toEqual({
      action: DataSecurityResponseAction.RevokeSharing,
      feedItemId: "a",
    });
  });

  test("within the clocks' slack before the change, and the window after", () => {
    expect(
      pickDataStoreResponseLink({
        change: own(),
        store,
        lines: [line("a", -RESPONSE_FEED_SLACK_BEFORE_MS)],
      }),
    ).not.toBeNull();
    expect(
      pickDataStoreResponseLink({
        change: own(),
        store,
        lines: [line("a", RESPONSE_FEED_WINDOW_AFTER_MS)],
      }),
    ).not.toBeNull();
    expect(
      pickDataStoreResponseLink({
        change: own(),
        store,
        lines: [
          line("early", -RESPONSE_FEED_SLACK_BEFORE_MS - 1),
          line("late", RESPONSE_FEED_WINDOW_AFTER_MS + 1),
        ],
      }),
    ).toBeNull();
  });

  test("no link to a line that changed nothing, or of an action that does not make this operation", () => {
    expect(
      pickDataStoreResponseLink({
        change: own(),
        store,
        lines: [
          line(
            "unchanged",
            4000,
            DataSecurityResponseAction.RevokeSharing,
            false,
          ),
          line("versioning", 4000, DataSecurityResponseAction.TurnOnVersioning),
        ],
      }),
    ).toBeNull();
  });

  test("two lines that could be it: none, since a link to the wrong one would be worse", () => {
    expect(
      pickDataStoreResponseLink({
        change: own(),
        store,
        lines: [line("a", 4000), line("b", 60 * 1000)],
      }),
    ).toBeNull();
  });

  test("only a change made in the store's own connection's session, and only OneUptime's, is tied to its feed", () => {
    expect(
      pickDataStoreResponseLink({
        change: own({
          actor: getRoleSessionName(ObjectID.generate().toString()),
        }),
        store,
        lines: [line("a", 4000)],
      }),
    ).toBeNull();
    expect(
      pickDataStoreResponseLink({
        change: own({ madeByOneUptime: false }),
        store,
        lines: [line("a", 4000)],
      }),
    ).toBeNull();
  });
});

describe("a response action's line on the store's feed", () => {
  test("reads back as the action it records, and whether it changed the store, for every action", () => {
    for (const action of ALL_DATA_SECURITY_RESPONSE_ACTIONS) {
      for (const changed of [true, false]) {
        expect(
          readResponseActionOfStoreFeed(
            getResponseActionStoreFeedMarkdown({
              action,
              outcome: { changed, summary: "Stopped sharing it." },
            }).toString(),
          ),
        ).toEqual({ action, changed });
      }
    }
  });

  test("any other line of the feed is no response action", () => {
    expect(readResponseActionOfStoreFeed("**Environment**: Production")).toBe(
      null,
    );
    expect(readResponseActionOfStoreFeed("")).toBe(null);
  });
});
