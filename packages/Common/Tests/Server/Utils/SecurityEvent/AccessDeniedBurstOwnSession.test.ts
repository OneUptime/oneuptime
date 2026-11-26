import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityEventService, {
  DetectionMatchGroup,
  doesGroupMeetDetectionThreshold,
} from "../../../../Server/Services/SecurityEventService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import { AwsRolePurpose } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import OneUptimeAwsSessions from "../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import { CloudAuditRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudAuditSecurityEvents from "../../../../Server/Utils/SecurityEvent/CloudAudit/CloudAuditSecurityEvents";
import SecurityLogScanner, {
  SecurityLogStoredEvents,
} from "../../../../Server/Utils/SecurityEvent/LogScan/SecurityLogScanner";
import RealTimeDetections from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import SecurityEventStoreOnce, {
  SharedRecordGroup,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventStoreOnce";
import { resolveSigmaField } from "../../../../Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DetectionRuleLibraryEntry,
  RECOMMENDED_DETECTION_RULE_IDS,
  getDetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ONEUPTIME_ACTOR_ATTRIBUTE,
  ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/OneUptimeActor";
import SigmaRule from "../../../../Types/SecurityEvent/SigmaRule";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import SigmaRuleParser from "../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import {
  RECORDED_CONNECTION_ID,
  RECORDED_PROJECT_ID,
  RECORDED_ROLE_ARN,
  RECORDED_SESSION_EXPIRES_MS,
  RECORDED_SESSION_ISSUED_MS,
  RECORDED_SESSION_KEY,
  asIamUser,
  asSession,
  cloudTrailLogLine,
  installMemoryGlobalCache,
  MemoryGlobalCache,
  readCloudTrailRecording,
} from "../../../Helpers/CloudTrailRecordings";
import { sigmaRuleMatchesEvent } from "../../../Utils/SecurityEvent/LogParsers/SigmaTestMatcher";

/*
 * BURST OF ACCESS-DENIED API CALLS, AGAINST ONEUPTIME'S OWN ROLE (#10427).
 *
 * Data Security reads a connected AWS account through the connection's
 * role, and twenty-five reads AWS refused it - recorded as CloudTrail
 * records them (Tests/Fixtures/CloudTrail) - used to open a medium case
 * naming OneUptime's own role as someone probing a stolen key. Read the way
 * "Your logs" and Cloud audit logs read them, and judged by the recommended
 * rule as the engine judges it - grouped by userIdentity.arn, twenty in ten
 * minutes:
 *
 *   - OneUptime's own session never trips the rule, and its calls are still
 *     kept, marked as OneUptime's own;
 *   - the same calls from another session of the same role still do - and
 *     so do OneUptime's session name with a key OneUptime was never
 *     handed, a session with a source identity, another principal, and
 *     Stratus Red Team's recorded burst;
 *   - when OneUptime cannot tell (the shared cache is gone), the rule fires
 *     as before.
 */

const RULE_ID: string = "2917bec0-2331-4e59-bdd4-a81211529156";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";

function burstRule(): DetectionRuleLibraryEntry {
  return getDetectionRuleLibraryEntry(RULE_ID)!;
}

function valueOf(event: NormalizedSecurityEvent, field: string): string {
  const resolved: ReturnType<typeof resolveSigmaField> =
    resolveSigmaField(field);
  const value: JSONValue | unknown =
    resolved.kind === "attribute"
      ? event.attributes[resolved.attributeKey]
      : (event as unknown as Record<string, unknown>)[resolved.column];

  return value === undefined || value === null ? "" : String(value);
}

/*
 * The rule's findings over the events, as a run judges them: its Sigma
 * selection, grouped by its field, each group held to its threshold.
 */
function findingsOf(events: Array<NormalizedSecurityEvent>): Array<string> {
  const entry: DetectionRuleLibraryEntry = burstRule();
  const rule: SigmaRule = SigmaRuleParser.parse(entry.sigmaRuleYaml);
  const groups: Map<string, number> = new Map();

  for (const event of events) {
    if (!sigmaRuleMatchesEvent(rule, event)) {
      continue;
    }

    const group: string = valueOf(event, entry.groupByField!);
    groups.set(group, (groups.get(group) || 0) + 1);
  }

  return Array.from(groups.entries())
    .filter(([groupValue, matchCount]: [string, number]): boolean => {
      const group: DetectionMatchGroup = {
        groupValue,
        matchCount,
        distinctCount: 0,
        sampleMessage: "",
        sampleObservables: [],
      };

      return doesGroupMeetDetectionThreshold({
        group,
        usesDistinctCount: false,
        minMatchCount: entry.matchCountThreshold,
      });
    })
    .map(([groupValue]: [string, number]): string => {
      return groupValue;
    });
}

// The refused reads, as "Your logs" reads a CloudTrail log file, marked as the log scan marks them.
async function readThroughYourLogs(
  records: Array<JSONObject>,
  projectId: string = RECORDED_PROJECT_ID,
): Promise<Array<NormalizedSecurityEvent>> {
  const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
    cloudTrailLogLine(records),
  );

  await OneUptimeAwsSessions.markSecurityEvents({ projectId, events });

  return events;
}

// What OneUptime's sign-in to the connection's role keeps (AwsCloudConnector.getCredentials).
async function signedIn(
  projectId: string = RECORDED_PROJECT_ID,
  purpose: AwsRolePurpose = AwsRolePurpose.CloudConnect,
): Promise<void> {
  await OneUptimeAwsSessions.remember({
    projectId,
    connectionId: RECORDED_CONNECTION_ID,
    roleArn: RECORDED_ROLE_ARN,
    purpose,
    accessKeyId: RECORDED_SESSION_KEY,
    issuedAtMs: RECORDED_SESSION_ISSUED_MS,
    expiresAtMs: RECORDED_SESSION_EXPIRES_MS,
  });
}

function refusedReads(): Array<JSONObject> {
  return readCloudTrailRecording("DataSecurityRefusedReads");
}

function eachAs(
  records: Array<JSONObject>,
  change: (record: JSONObject) => JSONObject,
): Array<JSONObject> {
  return records.map(change);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the recommended rule", () => {
  test("is recommended, counts twenty refusals for one identity in ten minutes, and leaves OneUptime's own out", () => {
    const entry: DetectionRuleLibraryEntry = burstRule();

    expect(RECOMMENDED_DETECTION_RULE_IDS).toContain(RULE_ID);
    expect(entry).toMatchObject({
      groupByField: "userIdentity.arn",
      matchCountThreshold: 20,
      evaluationIntervalInMinutes: 10,
    });
    expect(entry.sigmaRuleYaml).toContain(
      "  filter_oneuptime:\n    oneuptime.actor: oneuptime\n  condition: selection and not filter_oneuptime\n",
    );
    expect(entry.description).toContain(
      "OneUptime's own reads of a connected account are left out.",
    );
  });

  test("the samples are a burst: twenty-five refused calls, in one session, within a minute", () => {
    const records: Array<JSONObject> = refusedReads();
    const times: Array<number> = records.map((record: JSONObject): number => {
      return new Date(String(record["eventTime"])).getTime();
    });

    expect(records).toHaveLength(25);
    expect(
      new Set(
        records.map((record: JSONObject): string => {
          return String((record["userIdentity"] as JSONObject)["arn"]);
        }),
      ).size,
    ).toBe(1);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(60 * 1000);
  });
});

describe("OneUptime's own session", () => {
  test("twenty-five refused calls make no finding", async () => {
    installMemoryGlobalCache();
    await signedIn();

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toEqual([]);
  });

  test("its refused calls are kept, every one, marked as OneUptime's own read", async () => {
    installMemoryGlobalCache();
    await signedIn();

    const events: Array<NormalizedSecurityEvent> =
      await readThroughYourLogs(refusedReads());
    const rule: SigmaRule = SigmaRuleParser.parse(burstRule().sigmaRuleYaml);

    expect(events).toHaveLength(25);

    for (const event of events) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBe("oneuptime");
      expect(event.attributes[ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE]).toBe(
        RECORDED_CONNECTION_ID,
      );
      expect(event.message.startsWith("OneUptime's own read: ")).toBe(true);
      // Found by what AWS said, as any refusal is: only the burst rule leaves it out.
      expect(event.attributes["errorCode"]).toBe("AccessDenied");
      expect(sigmaRuleMatchesEvent(rule, event)).toBe(false);
    }
  });

  test("read through Cloud audit logs instead, it makes no finding either", async () => {
    installMemoryGlobalCache();
    await signedIn();

    const events: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.AWS,
        records: refusedReads().map((record: JSONObject): CloudAuditRecord => {
          return { accountId: "111122223333", record };
        }),
        connectionId: new ObjectID(RECORDED_CONNECTION_ID),
        now: new Date("2026-11-20T10:05:00Z"),
      });

    await OneUptimeAwsSessions.markSecurityEvents({
      projectId: RECORDED_PROJECT_ID,
      events,
    });

    expect(events).toHaveLength(25);
    expect(findingsOf(events)).toEqual([]);
  });
});

describe("the same calls from anyone else still make a finding", () => {
  test.each<[string, (record: JSONObject) => JSONObject]>([
    [
      "another session of the same role",
      (record: JSONObject): JSONObject => {
        return asSession(record, {
          sessionName: "temp-admin",
          accessKeyId: "ASIA2ANOTHERSESSION1",
        });
      },
    ],
    [
      "OneUptime's session name, signed with a key OneUptime was never handed",
      (record: JSONObject): JSONObject => {
        return asSession(record, { accessKeyId: "ASIA2NOTONEUPTIMES01" });
      },
    ],
    [
      "OneUptime's own key and session, carrying a source identity it never sets",
      (record: JSONObject): JSONObject => {
        return asSession(record, { sourceIdentity: "mallory@example.com" });
      },
    ],
    [
      "OneUptime's session name on another role",
      (record: JSONObject): JSONObject => {
        return asSession(record, { roleName: "AdminAccess" });
      },
    ],
    [
      "another principal",
      (record: JSONObject): JSONObject => {
        return asIamUser(record, "alice");
      },
    ],
  ])(
    "%s: one finding",
    async (_who: string, change: (record: JSONObject) => JSONObject) => {
      installMemoryGlobalCache();
      await signedIn();

      const events: Array<NormalizedSecurityEvent> = await readThroughYourLogs(
        eachAs(refusedReads(), change),
      );

      expect(findingsOf(events)).toHaveLength(1);

      for (const event of events) {
        expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
      }
    },
  );

  test("OneUptime's own burst beside another session's: one finding, the other session's", async () => {
    installMemoryGlobalCache();
    await signedIn();

    const another: Array<JSONObject> = eachAs(
      refusedReads(),
      (record: JSONObject): JSONObject => {
        return asSession(record, {
          sessionName: "temp-admin",
          accessKeyId: "ASIA2ANOTHERSESSION1",
        });
      },
    );
    const events: Array<NormalizedSecurityEvent> = await readThroughYourLogs([
      ...refusedReads(),
      ...another,
    ]);

    expect(findingsOf(events)).toEqual([
      "arn:aws:sts::111122223333:assumed-role/OneUptimeReadOnly-5f3a9c1e/temp-admin",
    ]);
  });

  test("another project's OneUptime session in this account makes one: it is not this project's own", async () => {
    installMemoryGlobalCache();
    await signedIn(OTHER_PROJECT_ID);

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toHaveLength(
      1,
    );
  });

  test("when OneUptime cannot tell - the shared cache is gone - the rule fires, as before", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    await signedIn();
    cache.failing = true;

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toHaveLength(
      1,
    );
  });

  test("calls recorded with OneUptime's key but made after its session ended keep the alert", async () => {
    installMemoryGlobalCache();
    await signedIn();

    // Twenty-five refusals, each half an hour after the session ended.
    const late: Array<JSONObject> = eachAs(
      refusedReads(),
      (record: JSONObject): JSONObject => {
        const at: number =
          new Date(String(record["eventTime"])).getTime() -
          RECORDED_SESSION_ISSUED_MS +
          RECORDED_SESSION_EXPIRES_MS +
          30 * 60 * 1000;

        return { ...record, eventTime: new Date(at).toISOString() };
      },
    );
    const events: Array<NormalizedSecurityEvent> =
      await readThroughYourLogs(late);

    expect(findingsOf(events)).toHaveLength(1);

    for (const event of events) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    }
  });

  test("a key OneUptime remembered for a project's Amazon SES role is never a connection's: the rule fires", async () => {
    installMemoryGlobalCache();
    await signedIn(RECORDED_PROJECT_ID, AwsRolePurpose.AmazonSes);

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toHaveLength(
      1,
    );
  });

  test("the shared cache lost the key - it restarted - and the rule fires, as before", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    await signedIn();
    cache.values.clear();

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toHaveLength(
      1,
    );
  });

  test("before OneUptime signs in - no key remembered - the rule fires, as before", async () => {
    installMemoryGlobalCache();

    expect(findingsOf(await readThroughYourLogs(refusedReads()))).toHaveLength(
      1,
    );
  });
});

describe("Stratus Red Team's recorded burst", () => {
  test("AWS hands each sign-in its own key, even for one session name of one role, and records the key on every call", () => {
    const records: Array<JSONObject> = readCloudTrailRecording(
      "RecordedRoleSessionRefusals",
    );
    const signIns: Array<JSONObject> = records.filter(
      (record: JSONObject): boolean => {
        return record["eventName"] === "AssumeRole" && !record["errorCode"];
      },
    );
    const names: Set<string> = new Set(
      signIns.map((record: JSONObject): string => {
        return String(
          (record["requestParameters"] as JSONObject)["roleSessionName"],
        );
      }),
    );
    const keys: Array<string> = signIns.map((record: JSONObject): string => {
      return String(
        (
          (record["responseElements"] as JSONObject)[
            "credentials"
          ] as JSONObject
        )["accessKeyId"],
      );
    });
    const signedWith: Set<string> = new Set(
      records
        .filter((record: JSONObject): boolean => {
          return (
            Boolean(record["errorCode"]) && record["eventName"] !== "AssumeRole"
          );
        })
        .map((record: JSONObject): string => {
          return String((record["userIdentity"] as JSONObject)["accessKeyId"]);
        }),
    );

    // One name, one role, two sign-ins: two keys.
    expect(signIns).toHaveLength(2);
    expect(names.size).toBe(1);
    expect(new Set(keys).size).toBe(2);
    // Every refused call names the one key that signed it.
    expect(Array.from(signedWith)).toEqual(["ASIA2SECONDSIGNINXMP"]);
  });

  test("its refused calls are never OneUptime's own, and each counts toward the burst", async () => {
    installMemoryGlobalCache();
    await signedIn();

    const events: Array<NormalizedSecurityEvent> = await readThroughYourLogs(
      readCloudTrailRecording("RecordedRoleSessionRefusals"),
    );
    const rule: SigmaRule = SigmaRuleParser.parse(burstRule().sigmaRuleYaml);
    const counted: Array<NormalizedSecurityEvent> = events.filter(
      (event: NormalizedSecurityEvent): boolean => {
        return sigmaRuleMatchesEvent(rule, event);
      },
    );

    for (const event of events) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    }

    // Fifteen refusals of the session, and the user's two refused sign-ins.
    expect(counted).toHaveLength(17);
  });

  test("five more of them in the same ten minutes make a finding", async () => {
    installMemoryGlobalCache();

    const recorded: Array<JSONObject> = readCloudTrailRecording(
      "RecordedRoleSessionRefusals",
    ).filter((record: JSONObject): boolean => {
      return record["errorCode"] === "Client.UnauthorizedOperation";
    });
    const events: Array<NormalizedSecurityEvent> = await readThroughYourLogs([
      ...recorded,
      ...recorded
        .slice(0, 5)
        .map((record: JSONObject, index: number): JSONObject => {
          return {
            ...record,
            eventID: `b1c2d3e4-0000-4000-8000-00000000000${index}`,
          };
        }),
    ]);

    expect(findingsOf(events)).toEqual([
      "arn:aws:sts::444455556666:assumed-role/stratus-red-team-get-usr-data-role/aws-go-sdk-1722455550269043000",
    ]);
  });
});

describe("where the events are stored", () => {
  const SERVICE: TelemetryServiceMetadata = {
    serviceName: "OneUptime Logs",
    primaryEntityId: new ObjectID("0192f1a0-0000-7000-8000-00000000e101"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: 15,
    projectRetentionConfig: null,
    projectRetentionInDays: 30,
  } as unknown as TelemetryServiceMetadata;

  // What a store inserts: CloudTrail records are stored once, by whichever way reads them first.
  function captureInserts(): Array<JSONObject> {
    const inserted: Array<JSONObject> = [];

    jest
      .spyOn(SecurityEventService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        inserted.push(...rows);
      });
    jest
      .spyOn(SecurityEventStoreOnce, "storeNew")
      .mockImplementation(
        async (data: {
          group: SharedRecordGroup;
          insert: (events: Array<NormalizedSecurityEvent>) => Promise<void>;
        }): Promise<Array<NormalizedSecurityEvent>> => {
          await data.insert(data.group.events);
          return data.group.events;
        },
      );
    jest
      .spyOn(RealTimeDetections, "screen")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ThreatIntelEnricher, "enrichNormalizedEvents")
      .mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });

    return inserted;
  }

  function actorsOf(rows: Array<JSONObject>): Array<string> {
    return rows.map((row: JSONObject): string => {
      return String(
        (row["attributes"] as JSONObject)[ONEUPTIME_ACTOR_ATTRIBUTE] || "",
      );
    });
  }

  test("Your logs: the log scan stores OneUptime's own calls marked, and the rest as they were", async () => {
    installMemoryGlobalCache();
    await signedIn();
    const inserted: Array<JSONObject> = captureInserts();
    const mark: SpyInstance<typeof OneUptimeAwsSessions.markSecurityEvents> =
      jest.spyOn(OneUptimeAwsSessions, "markSecurityEvents");

    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      cloudTrailLogLine([
        ...refusedReads().slice(0, 3),
        asIamUser(refusedReads()[3]!, "alice"),
      ]),
    );
    const stored: SecurityLogStoredEvents =
      await SecurityLogScanner.storeEvents({
        projectId: new ObjectID(RECORDED_PROJECT_ID),
        events,
        serviceMetadata: SERVICE,
      });

    expect(mark).toHaveBeenCalledTimes(1);
    expect(stored.events).toHaveLength(4);
    expect(actorsOf(inserted)).toEqual([
      "oneuptime",
      "oneuptime",
      "oneuptime",
      "",
    ]);
  });

  test("Cloud audit logs: stored marked the same, so a record reads the same whichever way stored it", async () => {
    installMemoryGlobalCache();
    await signedIn();
    const inserted: Array<JSONObject> = captureInserts();

    // The service the events are attributed to.
    jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockResolvedValue(SERVICE);

    const events: Array<NormalizedSecurityEvent> =
      CloudAuditSecurityEvents.parseRecords({
        provider: CloudProvider.AWS,
        records: [
          ...refusedReads().slice(0, 2),
          asIamUser(refusedReads()[2]!, "alice"),
        ].map((record: JSONObject): CloudAuditRecord => {
          return { accountId: "111122223333", record };
        }),
        connectionId: new ObjectID(RECORDED_CONNECTION_ID),
        now: new Date("2026-11-20T10:05:00Z"),
      });

    await CloudAuditSecurityEvents.storeEvents({
      projectId: new ObjectID(RECORDED_PROJECT_ID),
      events,
    });

    expect(actorsOf(inserted)).toEqual(["oneuptime", "oneuptime", ""]);
  });
});
