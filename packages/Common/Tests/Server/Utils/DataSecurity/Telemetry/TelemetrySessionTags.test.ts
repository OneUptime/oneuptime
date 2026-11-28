import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import RumApplication from "../../../../../Models/DatabaseModels/RumApplication";
import AnalyticsDatabaseService, {
  Results,
} from "../../../../../Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "../../../../../Server/Services/RumApplicationService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ContentScanOptions,
  DataStoreLocationKind,
  LocationFindings,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  buildTelemetrySampleStatement,
  readTelemetryRecordValues,
  scanProjectTelemetry,
  TelemetryRecordValue,
  TelemetrySampleCaps,
  TelemetrySampleSource,
  TelemetryStoreScan,
  TELEMETRY_SCAN_MAX_KEY_LENGTH,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  buildTelemetryOccurrenceStatement,
  OccurrencePlan,
  planOccurrenceRead,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import {
  RUM_IDENTIFY_CALL,
  readLeakPlaces,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryLeakPlaces";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  planScrubRule,
  readScrubbableTarget,
  SESSION_DETAILS_NOT_SCRUBBABLE,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  describeUnplacedAttribute,
  getTelemetryAttributeKey,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryUnplacedAttributes";
import LlmConversationPrivacy from "../../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import logger from "../../../../../Server/Utils/Logger";
import DataTypeNamer from "../../../../../Types/DataSecurity/DataTypeNamer";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../../Types/DataSecurity/FindingSampleRecord";
import {
  getRumSessionPart,
  isRumSessionTagLocation,
  RUM_SESSION_TAGS_PREFIX,
  RUM_SET_TAGS_CALL,
  RumSessionPart,
} from "../../../../../Types/DataSecurity/RumSessionPlaces";
import {
  getRumSessionKey,
  getRumTelemetryLeakSignal,
  getTelemetryLeakSignalOf,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
} from "../../../../../Types/DataSecurity/TelemetryLeakFix";
import {
  getScrubTarget,
  getScrubUnavailableReason,
  ScrubbedField,
  TelemetryScrubUnavailableReason,
} from "../../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubAction from "../../../../../Types/Log/LogScrubAction";
import LogScrubField from "../../../../../Types/Log/LogScrubField";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import { buildTelemetryLeakTemplate } from "../../../../../Utils/DataSecurity/TelemetryLeakTemplate";
import BadDataException from "../../../../../Types/Exception/BadDataException";

/*
 * A RUM SESSION'S TAGS, WHICH EVERY READER OF THE SESSION LIST READS
 * (#11458).
 *
 * A page tags its session with setTags() and addTag(). The recorder never
 * masks a tag - tags exist to be searched - and the session's tags column
 * is read under the ordinary session ACL, wider than the identity ACL over
 * identify()'s traits. Data Security's scan read a session's attributes,
 * traits and label, and never its tags, so an email a page put in one was
 * found nowhere. Here, without a database:
 *
 *  - the scan selects the tags as it selects the session's other pairs -
 *    cut in the database to the same caps - and names a finding
 *    sessions.tags.<key>, an attribute's kind, a key under OneUptime's own
 *    prefix included (the recorders add no tag of their own);
 *  - the records a finding was seen in are read back from the same column;
 *  - Scrub It reaches a tag (a log rule over attributes, every service's,
 *    as ingest now runs one over the tags) and says why it reaches none of
 *    a session's other details; coverage counts the rules that hide it;
 *  - Fix with AI's front-end place names the setTags() call.
 *
 * The real ClickHouse half is App/Tests/Telemetry/SessionTagsDataSecurityClickhouse.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000b1458",
);
const WEB_APP: string = "0192f1a0-0000-7000-8000-0000000b1459";

const EMAIL: string = "noor.haddad@acmecorp.io";
const CARD: string = "4539 1488 0343 6467";
const GITHUB_TOKEN: string = "ghp_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u";

const CAPS: TelemetrySampleCaps = {
  textLength: 8192,
  attributeValueLength: 4096,
  attributesPerRecord: 128,
  eventsPerSpan: 16,
  attributesPerEvent: 32,
};

function valuesOf(row: JSONObject): Array<TelemetryRecordValue> {
  return readTelemetryRecordValues(
    TelemetrySampleSource.RumSessions,
    row,
    CAPS,
  )!;
}

function locationsOf(values: Array<TelemetryRecordValue>): Array<string> {
  return values.map((value: TelemetryRecordValue): string => {
    return value.location;
  });
}

describe("the scan reads a session's tags (#11458)", () => {
  test("the sessions read selects the tags, cut as the session's other pairs are, and never a recording", () => {
    const statement: Statement = buildTelemetrySampleStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-11-28T10:00:00.000Z"),
      until: new Date("2026-11-28T11:00:00.000Z"),
      source: TelemetrySampleSource.RumSessions,
      ownerIds: [WEB_APP],
      perOwner: 10,
      total: 10,
      caps: CAPS,
    });

    expect(statement.query).toContain("mapKeys(tags)");
    expect(statement.query).toContain("mapValues(tags)");
    expect(statement.query).toContain("AS readTags");
    // Beside its attributes and traits, each cut the same way.
    expect(statement.query).toContain("mapKeys(identifiedUserTraits)");
    expect(statement.query).toContain("mapKeys(attributes)");
    expect(statement.query.split("arraySlice(mapKeys(").length - 1).toBe(3);
    // Every bound is a parameter: the caps, never a value.
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining([
        TELEMETRY_SCAN_MAX_KEY_LENGTH,
        CAPS.attributeValueLength,
        CAPS.attributesPerRecord,
      ]),
    );
    expect(statement.query).not.toContain("RumSessionChunk");
    expect(statement.query).not.toContain("payload");
  });

  test("each tag is a place of its own, sessions.tags.<key>, an attribute beside the session's attributes, traits and user", () => {
    const values: Array<TelemetryRecordValue> = valuesOf({
      readSessionId: "s-1",
      readAttributes: [["recorder.capabilities", "clicks,network"]],
      readTags: [
        ["build", "2026.11.28"],
        ["customer", EMAIL],
        ["checkout.card", CARD],
      ],
      readTraits: [["plan", "pro"]],
      readLabel: "u-7",
    });

    expect(locationsOf(values)).toEqual([
      "sessions.attributes.recorder.capabilities",
      "sessions.tags.build",
      "sessions.tags.customer",
      "sessions.tags.checkout.card",
      "sessions.identifiedUserTraits.plan",
      "sessions.identifiedUserLabel",
    ]);

    const customer: TelemetryRecordValue = values.find(
      (value: TelemetryRecordValue): boolean => {
        return value.location === "sessions.tags.customer";
      },
    )!;

    expect(customer).toEqual({
      location: "sessions.tags.customer",
      locationKind: DataStoreLocationKind.Attribute,
      value: EMAIL,
      field: "customer",
    });
  });

  test("a tag's key with numbered parts is folded, as an attribute's is, and an empty tag is left out", () => {
    const values: Array<TelemetryRecordValue> = valuesOf({
      readTags: [
        ["contacts.0.email", EMAIL],
        ["contacts.1.email", "rafa.ortiz@acmecorp.io"],
        ["empty", ""],
      ],
    });

    expect(locationsOf(values)).toEqual([
      "sessions.tags.contacts[].email",
      "sessions.tags.contacts[].email",
    ]);
    expect(
      values.map((value: TelemetryRecordValue): string => {
        return value.field || "";
      }),
    ).toEqual(["contacts.0.email", "contacts.1.email"]);
  });

  test("a tag under OneUptime's own prefix is read, since the recorders add no tag of their own - an attribute or a trait under it is not", () => {
    const values: Array<TelemetryRecordValue> = valuesOf({
      readAttributes: [["oneuptime.recorder", "browser"]],
      readTags: [["oneuptime.customer", EMAIL]],
      readTraits: [["oneuptime.plan", "pro"]],
    });

    expect(locationsOf(values)).toEqual(["sessions.tags.oneuptime.customer"]);
  });

  test("the tags are held to the record's caps: so many pairs, each key and value so long", () => {
    const tags: Array<[string, string]> = [];

    for (let index: number = 0; index < CAPS.attributesPerRecord + 5; index++) {
      tags.push([`tag${index}`, `value-${index}`]);
    }

    tags[0] = ["k".repeat(TELEMETRY_SCAN_MAX_KEY_LENGTH + 40), "x".repeat(10)];
    tags[1] = ["long", "v".repeat(CAPS.attributeValueLength + 100)];

    const values: Array<TelemetryRecordValue> = valuesOf({ readTags: tags });

    expect(values).toHaveLength(CAPS.attributesPerRecord);
    expect(values[0]!.field!.length).toBe(TELEMETRY_SCAN_MAX_KEY_LENGTH);
    expect(values[1]!.value.length).toBe(CAPS.attributeValueLength);
  });

  test("a row without tags reads as it did, and one whose tags are not pairs reads none of them", () => {
    expect(locationsOf(valuesOf({ readLabel: EMAIL }))).toEqual([
      "sessions.identifiedUserLabel",
    ]);
    expect(
      locationsOf(valuesOf({ readTags: "customer=" + EMAIL, readLabel: "u-1" })),
    ).toEqual(["sessions.identifiedUserLabel"]);
    expect(
      locationsOf(valuesOf({ readTags: [["customer"]], readLabel: "" })),
    ).toEqual([]);
  });
});

describe("a session's tags in a scan of the project (#11458)", () => {
  let statements: Array<Statement> = [];

  beforeEach(() => {
    statements = [];

    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        statements.push(statement);

        const isSessions: boolean = statement.query.includes("RumSessionV1");
        const isOwners: boolean = statement.query.includes(" AS records FROM ");
        const rows: Array<JSONObject> = !isSessions
          ? []
          : isOwners
            ? [{ ownerId: WEB_APP, records: "3" }]
            : [
                {
                  ownerId: WEB_APP,
                  readRecordTime: String(Date.now() - 60_000),
                  readSessionId: "s-1",
                  readAttributes: [],
                  readTags: [
                    ["build", "2026.11.28"],
                    ["customer", EMAIL],
                    ["paid.with", CARD],
                    ["github", GITHUB_TOKEN],
                  ],
                  readTraits: [],
                  readLabel: "",
                },
                // The same session's older version: read once, by its newest.
                {
                  ownerId: WEB_APP,
                  readRecordTime: String(Date.now() - 120_000),
                  readSessionId: "s-1",
                  readAttributes: [],
                  readTags: [["older", "rafa.ortiz@acmecorp.io"]],
                  readTraits: [],
                  readLabel: "",
                },
                {
                  ownerId: WEB_APP,
                  readRecordTime: String(Date.now() - 90_000),
                  readSessionId: "s-2",
                  readAttributes: [],
                  readTags: [["customer", "lena.berg@acmecorp.io"]],
                  readTraits: [],
                  readLabel: "",
                },
              ];

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data: rows });
          },
        } as unknown as Results;
      }) as never);

    const application: RumApplication = new RumApplication();
    application._id = WEB_APP;
    application.name = "storefront-web";

    jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([application] as never);
    jest.spyOn(ServiceService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
      .mockResolvedValue([]);
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function options(): ContentScanOptions {
    return {
      limits: {
        maxObjects: 2000,
        maxBytesPerObject: 65536,
        maxBytesTotal: 52428800,
        maxRowsPerTable: 1000,
        maxTables: 200,
        deadline: new Date(Date.now() + 60 * 60 * 1000),
      },
      customDetectors: [],
      extraHints: [],
      disabledDataTypeIds: new Set(),
      allowedValues: new Set(),
      exclusions: [],
      fingerprintKey: "test-key",
    };
  }

  async function replaysOf(): Promise<TelemetryStoreScan> {
    const scans: Array<TelemetryStoreScan> = await scanProjectTelemetry({
      projectId: PROJECT_ID,
      sampleSize: 100,
      since: new Date(Date.now() - 60 * 60 * 1000),
      options: options(),
    });

    return scans.find((scan: TelemetryStoreScan): boolean => {
      return (
        scan.kind === DataStoreKind.TelemetrySessionReplays &&
        scan.serviceId === WEB_APP
      );
    })!;
  }

  function at(scan: TelemetryStoreScan, location: string): LocationFindings {
    return scan.result.locations.find((entry: LocationFindings): boolean => {
      return entry.location === location;
    })!;
  }

  function typesAt(scan: TelemetryStoreScan, location: string): Array<string> {
    return (at(scan, location)?.classifications || []).map(
      (classification: { dataTypeId: string }): string => {
        return classification.dataTypeId;
      },
    );
  }

  test("an email, a card and a token a page tagged its sessions with are each found at their tag, an opaque tag is not", async () => {
    const replays: TelemetryStoreScan = await replaysOf();

    expect(replays.serviceName).toBe("storefront-web");
    expect(typesAt(replays, "sessions.tags.customer")).toEqual([
      "email-address",
    ]);
    expect(typesAt(replays, "sessions.tags.paid.with")).toEqual(
      expect.arrayContaining(["credit-card-number"]),
    );
    expect(typesAt(replays, "sessions.tags.github")).toEqual(
      expect.arrayContaining(["github-token"]),
    );
    expect(typesAt(replays, "sessions.tags.build")).toEqual([]);
    expect(at(replays, "sessions.tags.customer").locationKind).toBe(
      DataStoreLocationKind.Attribute,
    );
    // Two sessions: the older version of the first is not read.
    expect(replays.result.rowsRead).toBe(2);
    expect(at(replays, "sessions.tags.older")).toBeUndefined();
  });

  test("a tag's finding keeps the sessions it was found in, by their ids, and no value", async () => {
    const replays: TelemetryStoreScan = await replaysOf();
    const kept: Array<FindingSampleRecord> =
      at(replays, "sessions.tags.customer").sampleRecords?.["email-address"] ||
      [];

    expect(
      kept.map((record: FindingSampleRecord): string => {
        return record.sessionId || "";
      }),
    ).toEqual(["s-1", "s-2"]);
    expect(JSON.stringify(replays.result.locations)).not.toContain(EMAIL);
    expect(JSON.stringify(replays.result.locations)).not.toContain(
      GITHUB_TOKEN,
    );
  });

  test("no statement the scan sends holds a value the page tagged", async () => {
    await replaysOf();

    expect(statements.length).toBeGreaterThan(0);

    for (const statement of statements) {
      const sent: string = JSON.stringify([
        statement.query,
        statement.query_params,
      ]);

      expect(sent).not.toContain(EMAIL);
      expect(sent).not.toContain(GITHUB_TOKEN);
    }
  });
});

describe("the records a tag's finding was seen in (#11458)", () => {
  test("are read from the session's tags, by the tag's key", () => {
    const plan: OccurrencePlan | null = planOccurrenceRead(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.tags.customer",
    );

    expect(plan).toEqual({
      source: TelemetrySampleSource.RumSessions,
      read: { kind: "pairs", column: "tags", key: "customer" },
    });
  });

  test("the read selects that tag alone, from the sessions that have it, never a recording", () => {
    const plan: OccurrencePlan = planOccurrenceRead(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.tags.customer",
    )!;
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-11-28T10:00:00.000Z"),
      until: new Date("2026-11-28T11:00:00.000Z"),
      plan,
      ownerId: WEB_APP,
      limit: 20,
      caps: CAPS,
    });

    expect(statement.query).toContain("RumSessionV1");
    expect(statement.query).toContain("AS readTags");
    expect(statement.query).toContain("mapContains(tags, ");
    expect(statement.query).toContain("sessionId AS readSessionId");
    expect(statement.query).not.toContain("identifiedUserTraits");
    expect(statement.query).not.toContain("identifiedUserLabel");
    expect(statement.query).not.toContain("payload");
    expect(Object.values(statement.query_params)).toContain("customer");
  });

  test("a folded key reads every numbered tag it stands for", () => {
    const plan: OccurrencePlan = planOccurrenceRead(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.tags.contacts[].email",
    )!;
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: new Date("2026-11-28T10:00:00.000Z"),
      until: new Date("2026-11-28T11:00:00.000Z"),
      plan,
      ownerId: WEB_APP,
      limit: 20,
      caps: CAPS,
    });

    expect(plan.read).toEqual({
      kind: "pairs",
      column: "tags",
      key: "contacts[].email",
    });
    expect(statement.query).toContain("mapKeys(tags)");
    expect(Object.values(statement.query_params)).toContain(
      "^contacts\\.[0-9]+\\.email$",
    );
  });

  test("a session's other places still read their own columns, and a tag with no key is none", () => {
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserTraits.email",
      )?.read,
    ).toEqual({
      kind: "pairs",
      column: "identifiedUserTraits",
      key: "email",
    });
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.attributes.plan",
      )?.read,
    ).toEqual({ kind: "pairs", column: "attributes", key: "plan" });
    expect(
      planOccurrenceRead(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.",
      ),
    ).toBeNull();
    // A service's logs have no session, and no tags.
    expect(
      planOccurrenceRead(DataStoreKind.TelemetryLogs, "sessions.tags.customer"),
    ).toBeNull();
  });
});

describe("Scrub It reaches a session's tags, and only them of its details (#11458)", () => {
  test("a tag is a log rule's, over the attributes, under the tag's key", () => {
    expect(
      getScrubTarget(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.customer",
      ),
    ).toEqual({
      signal: "log",
      field: ScrubbedField.Attributes,
      key: "customer",
    });
    expect(
      getScrubTarget(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.customer.email",
      )?.key,
    ).toBe("customer.email");
    expect(
      getScrubUnavailableReason(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.customer",
      ),
    ).toBeNull();
  });

  test("a session's user, its traits and the recorder's attributes still say no rule reaches them", () => {
    for (const location of [
      "sessions.identifiedUserLabel",
      "sessions.identifiedUserTraits.email",
      "sessions.attributes.recorder.capabilities",
      "sessions.tags.",
    ]) {
      expect(
        getScrubTarget(DataStoreKind.TelemetrySessionReplays, location),
      ).toBeNull();
      expect(
        getScrubUnavailableReason(
          DataStoreKind.TelemetrySessionReplays,
          location,
        ),
      ).toBe(TelemetryScrubUnavailableReason.SessionDetails);
      expect(() => {
        return readScrubbableTarget({
          kind: DataStoreKind.TelemetrySessionReplays,
          dataTypeId: "email-address",
          location,
        });
      }).toThrow(new BadDataException(SESSION_DETAILS_NOT_SCRUBBABLE));
    }
  });

  test("a tag's finding is scrubbable: Scrub It plans the email's masked pattern over the log attributes", () => {
    const scrubbable: ReturnType<typeof readScrubbableTarget> =
      readScrubbableTarget({
        kind: DataStoreKind.TelemetrySessionReplays,
        dataTypeId: "email-address",
        location: "sessions.tags.customer",
      });

    expect(scrubbable.location).toBe("sessions.tags.customer");
    expect(
      planScrubRule({
        dataTypeId: "email-address",
        location: scrubbable.location,
        target: scrubbable.target,
      }),
    ).toEqual({
      patternType: LogScrubPatternType.Email,
      scrubAction: LogScrubAction.Mask,
      fieldsToScrub: LogScrubField.Attributes,
    });
  });

  test("a secret under a tag that names it gets the Sensitive Attribute Keys rule", () => {
    const scrubbable: ReturnType<typeof readScrubbableTarget> =
      readScrubbableTarget({
        kind: DataStoreKind.TelemetrySessionReplays,
        dataTypeId: "generic-secret",
        location: "sessions.tags.api_token",
      });

    expect(
      planScrubRule({
        dataTypeId: "generic-secret",
        location: scrubbable.location,
        target: scrubbable.target,
      }),
    ).toEqual({
      patternType: LogScrubPatternType.SensitiveKeys,
      scrubAction: LogScrubAction.Redact,
      fieldsToScrub: LogScrubField.Attributes,
    });
  });
});

describe("which rules count a tag's finding as scrubbed (#11458)", () => {
  let count: number = 0;

  function rule(data: Partial<CoveringScrubRule>): CoveringScrubRule {
    count++;

    return {
      id: `rule-${count}`,
      name: `Rule ${count}`,
      signal: "log",
      patternType: LogScrubPatternType.Email,
      fieldsToScrub: LogScrubField.Attributes,
      ...data,
    };
  }

  function coveredBy(
    covering: CoveringScrubRule,
    location: string = "sessions.tags.customer",
    dataTypeId: string = "email-address",
  ): boolean {
    return (
      findCoveringScrubRule(
        { rules: [covering] },
        {
          kind: DataStoreKind.TelemetrySessionReplays,
          dataTypeId,
          location,
          // A RUM application's records are sent under its own id.
          serviceId: WEB_APP,
        },
      ) !== null
    );
  }

  test("a log rule of every service whose fields reach the attributes, and whose pattern finds the type", () => {
    expect(coveredBy(rule({}))).toBe(true);
    expect(coveredBy(rule({ fieldsToScrub: LogScrubField.Both }))).toBe(true);
    // Left at its default, a rule reads both.
    expect(coveredBy(rule({ fieldsToScrub: "" }))).toBe(false);
  });

  test("not one that reads only bodies, one for a service, a trace rule or one of another type", () => {
    expect(coveredBy(rule({ fieldsToScrub: LogScrubField.Body }))).toBe(false);
    expect(
      coveredBy(rule({ serviceId: "0192f1a0-0000-7000-8000-0000000c0001" })),
    ).toBe(false);
    expect(
      coveredBy(rule({ signal: "trace", fieldsToScrub: "attributes" })),
    ).toBe(false);
    expect(coveredBy(rule({ patternType: LogScrubPatternType.SSN }))).toBe(
      false,
    );
  });

  test("a Sensitive Attribute Keys rule, for a tag whose key looks secret", () => {
    const keys: CoveringScrubRule = rule({
      patternType: LogScrubPatternType.SensitiveKeys,
    });

    expect(coveredBy(keys, "sessions.tags.api_token", "generic-secret")).toBe(
      true,
    );
    expect(coveredBy(keys, "sessions.tags.customer")).toBe(false);
  });

  test("a Named Attributes rule, for the tag it names or one under it", () => {
    const named: CoveringScrubRule = rule({
      patternType: LogScrubPatternType.NamedKeys,
      attributeKeys: ["customer"],
    });

    expect(coveredBy(named, "sessions.tags.customer", "person-name")).toBe(
      true,
    );
    expect(coveredBy(named, "sessions.tags.customer.name", "person-name")).toBe(
      true,
    );
    expect(coveredBy(named, "sessions.tags.billing", "person-name")).toBe(
      false,
    );
  });

  test("a pattern rule that names attributes covers only the tags it names", () => {
    const narrow: CoveringScrubRule = rule({ attributeKeys: ["customer"] });

    expect(coveredBy(narrow, "sessions.tags.customer")).toBe(true);
    expect(coveredBy(narrow, "sessions.tags.billing")).toBe(false);
  });

  test("no rule covers a session's user, though it covers its tags", () => {
    const everyService: CoveringScrubRule = rule({
      fieldsToScrub: LogScrubField.Both,
    });

    expect(coveredBy(everyService, "sessions.identifiedUserLabel")).toBe(false);
    expect(coveredBy(everyService, "sessions.identifiedUserTraits.email")).toBe(
      false,
    );
    expect(coveredBy(everyService, "sessions.tags.customer")).toBe(true);
  });
});

describe("Fix with AI's place for a tag (#11458)", () => {
  const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();

  function templateOf(text: string): string {
    return buildTelemetryLeakTemplate(text, {
      nameOf: (dataTypeId: string): string => {
        return namer.nameOf(dataTypeId);
      },
    });
  }

  function placesAt(location: string): Array<TelemetryLeakPlace> {
    return readLeakPlaces({
      source: TelemetrySampleSource.RumSessions,
      rows: [
        {
          readSessionId: "s-1",
          readPage: `https://shop.example.com/account/${EMAIL}/orders?x=1`,
        },
      ],
      location,
      templateOf,
    });
  }

  test("a tag names the setTags() call that gave it, and the page the session started on, by its path alone", () => {
    const places: Array<TelemetryLeakPlace> = placesAt(
      "sessions.tags.customer",
    );

    expect(places).toHaveLength(1);
    expect(places[0]!.recorderCall).toBe(RUM_SET_TAGS_CALL);
    expect(places[0]!.recorderCall).toBe("setTags");
    expect(places[0]!.page?.startsWith("/account/")).toBe(true);
    expect(JSON.stringify(places)).not.toContain(EMAIL);
    expect(JSON.stringify(places)).not.toContain("shop.example.com");
  });

  test("a user detail still names identify(), and the recorder's attributes no call", () => {
    expect(placesAt("sessions.identifiedUserLabel")[0]!.recorderCall).toBe(
      RUM_IDENTIFY_CALL,
    );
    expect(
      placesAt("sessions.identifiedUserTraits.email")[0]!.recorderCall,
    ).toBe(RUM_IDENTIFY_CALL);
    expect(
      placesAt("sessions.attributes.recorder.capabilities")[0]!.recorderCall,
    ).toBeUndefined();
  });

  test("a tag is a session's leak, keyed by the tag", () => {
    expect(
      getRumTelemetryLeakSignal(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.customer",
      ),
    ).toBe(TelemetryLeakSignal.RumSessions);
    expect(
      getTelemetryLeakSignalOf(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.tags.customer",
      ),
    ).toBe(TelemetryLeakSignal.RumSessions);
    expect(getRumSessionKey("sessions.tags.customer")).toBe("customer");
    expect(getRumSessionKey("sessions.tags.contacts[].email")).toBe(
      "contacts[].email",
    );
    expect(getRumSessionKey("sessions.tags.")).toBeUndefined();
    expect(getRumSessionKey(`sessions.tags.${"k".repeat(5000)}`)!.length).toBe(
      getRumSessionKey(`sessions.attributes.${"k".repeat(5000)}`)!.length,
    );
  });
});

describe("a tag the scan found and no detector placed (#11458)", () => {
  test("is described by its key and its values' shapes, as an attribute is, never a value", () => {
    const values: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return `PL-${String(1004000 + index * 37)}`;
      },
    );

    expect(getTelemetryAttributeKey("sessions.tags.policy_ref")).toBe(
      "policy_ref",
    );
    expect(
      describeUnplacedAttribute({
        location: "sessions.tags.policy_ref",
        locationKind: DataStoreLocationKind.Attribute,
        values,
        neighbours: ["sessions.tags.policy_ref", "sessions.tags.build"],
      }),
    ).toMatchObject({
      location: "sessions.tags.policy_ref",
      locationKind: DataStoreLocationKind.Attribute,
      neighbours: ["build"],
      shapes: [{ shape: "AA-9999999", share: 1 }],
      valueCount: 10,
    });
    // A tag under OneUptime's own prefix is the page's too, and kept.
    expect(getTelemetryAttributeKey("sessions.tags.oneuptime.plan")).toBe(
      "oneuptime.plan",
    );
  });
});

describe("the places of a session's tags, as every reader names them (#11458)", () => {
  test("a tag's place has a key; the prefix alone is none", () => {
    expect(RUM_SESSION_TAGS_PREFIX).toBe("sessions.tags.");
    expect(isRumSessionTagLocation("sessions.tags.customer")).toBe(true);
    expect(isRumSessionTagLocation(" sessions.tags.customer ")).toBe(true);
    expect(isRumSessionTagLocation("sessions.tags.")).toBe(false);
    expect(isRumSessionTagLocation("sessions.tags")).toBe(false);
    expect(isRumSessionTagLocation("sessions.identifiedUserLabel")).toBe(
      false,
    );
    expect(isRumSessionTagLocation("logs.attributes.sessions.tags.x")).toBe(
      false,
    );
    expect(isRumSessionTagLocation(undefined)).toBe(false);
  });

  test("a session's part, in any case: its tags, its user's details or the recorder's attributes", () => {
    expect(getRumSessionPart("sessions.tags.customer")).toBe(
      RumSessionPart.Tags,
    );
    expect(getRumSessionPart("sessions.tags")).toBe(RumSessionPart.Tags);
    expect(getRumSessionPart("SESSIONS.TAGS.Customer")).toBe(
      RumSessionPart.Tags,
    );
    expect(getRumSessionPart("sessions.identifiedUserLabel")).toBe(
      RumSessionPart.User,
    );
    expect(getRumSessionPart("sessions.identifieduserlabel")).toBe(
      RumSessionPart.User,
    );
    expect(getRumSessionPart("sessions.identifiedUserTraits.email")).toBe(
      RumSessionPart.User,
    );
    expect(getRumSessionPart("sessions.attributes.plan")).toBe(
      RumSessionPart.Attributes,
    );
    expect(getRumSessionPart("sessions.tagsx.customer")).toBeNull();
    expect(getRumSessionPart("logs.attributes.user.email")).toBeNull();
    expect(getRumSessionPart(null)).toBeNull();
  });
});
