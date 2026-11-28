import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "Common/Models/AnalyticsModels/RumSession";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, {
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import ServiceService from "Common/Server/Services/ServiceService";
import { getClickhouseDatabaseName } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  ContentScanOptions,
  LocationFindings,
} from "Common/Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  scanProjectTelemetry,
  TelemetryStoreScan,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import {
  findTelemetryFindingOccurrences,
  OccurrencePlan,
  planOccurrenceRead,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import {
  CoveringScrubRule,
  findCoveringScrubRule,
  readScrubbableTarget,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  pickUnprovenScrubRuleCandidate,
  planScrubRuleCandidates,
  ScrubPlanFinding,
  ScrubRuleCandidate,
  ScrubRuleSource,
} from "Common/Server/Utils/DataSecurity/Telemetry/TelemetryScrubPlanner";
import LlmConversationPrivacy from "Common/Server/Utils/LlmObservability/LlmConversationPrivacy";
import { compileScrubRule } from "Common/Server/Utils/Telemetry/ScrubEngine/CompiledScrubRule";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "Common/Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "Common/Types/DataSecurity/FindingSampleRecord";
import { ScrubTarget } from "Common/Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SessionReplayScrubService, {
  CompiledScrubRule,
} from "../../FeatureSet/Telemetry/Services/SessionReplayScrubService";

/*
 * ------------------------------------------------------------------
 * A RUM SESSION'S TAGS, IN A REAL CLICKHOUSE (#11458).
 *
 * A page tags its session with setTags() and addTag(); the recorder never
 * masks a tag, the session's tags column keeps it as sent, and everyone
 * who can list sessions reads it. Data Security's scan never read the
 * column, so an email a page tagged its sessions with was found nowhere.
 * Here, on the product's own RumSessionV1 columns, with sessions whose
 * tags hold planted values - an email, a card number, a GitHub token, a
 * password under a key that names one - beside tags that hold nothing:
 *
 *   - the scan finds each at its tag, sessions.tags.<key>, and nothing at
 *     an opaque one;
 *   - a finding's records are read back from the same column: exactly the
 *     sessions it was seen in, the value masked;
 *   - no statement the scan or the read sends, and nothing ClickHouse
 *     logged of them, holds a planted value: every value stays data;
 *   - each finding is scrubbable: the rule Scrub It plans for it (the
 *     planner's narrowest, as a session replay's is never proven - and a
 *     secret's tag whole, which a pattern no record proved could miss)
 *     counts it as scrubbed, and run through the very code ingest runs
 *     over a new session's tags, it leaves nothing the scan finds there
 *     again.
 *
 * Opt in against a disposable local server, credentials in the URL:
 *
 *   docker run -d --rm -p 18458:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18458 \
 *     npx jest Tests/Telemetry/SessionTagsDataSecurityClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];
jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `session_tags_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000b1458",
);
const WEB_APP: string = "0192f1a0-0000-7000-8000-0000000b1459";

// What the page tagged its sessions with, each found by the first 16 characters a search reads.
const PLANTED: Readonly<Record<string, string>> = {
  email: "noor.haddad@acmecorp.io",
  card: "4539 1488 0343 6467",
  githubToken: "ghp_R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u",
  password: "vH7#qL2!xT9$mR4@",
};

// The tags each planted value sits under, and the data type each is found as.
const PLANTED_TAGS: ReadonlyArray<{
  key: string;
  value: string;
  dataTypeId: string;
}> = [
  { key: "customer", value: PLANTED["email"]!, dataTypeId: "email-address" },
  {
    key: "paid_with",
    value: PLANTED["card"]!,
    dataTypeId: "credit-card-number",
  },
  { key: "github", value: PLANTED["githubToken"]!, dataTypeId: "github-token" },
  {
    key: "password",
    value: PLANTED["password"]!,
    dataTypeId: "generic-secret",
  },
];

// What the tagged sessions also say, which holds nothing sensitive.
const OPAQUE_TAGS: Record<string, string> = {
  build: "2026.11.28",
  experiment: "checkout-b",
};

const TAGGED_SESSIONS: ReadonlyArray<string> = ["s-tagged-1", "s-tagged-2"];
const OPAQUE_SESSION: string = "s-opaque-1";

let client: ClickhouseClient;
let clickhouse: ClickhouseDatabase;
// Every statement the scan and the reads sent.
const sent: Array<Statement> = [];

function inDatabase(query: string): string {
  return query.split(`${getClickhouseDatabaseName()}.`).join(`${database}.`);
}

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

// A ClickHouse DateTime64 the JSON insert reads.
function at(time: Date): string {
  return time.toISOString().replace("T", " ").replace("Z", "");
}

function sessionRow(data: {
  sessionId: string;
  startTime: Date;
  tags: Record<string, string>;
}): JSONObject {
  return {
    projectId: PROJECT_ID.toString(),
    rumApplicationId: WEB_APP,
    primaryEntityId: WEB_APP,
    primaryEntityType: "RealUserMonitor",
    startTime: at(data.startTime),
    endTime: at(new Date(data.startTime.getTime() + 60_000)),
    sessionId: data.sessionId,
    version: String(data.startTime.getTime()),
    entryUrl: "https://shop.example.com/checkout",
    appVersion: "2026.11.28",
    tags: data.tags,
    attributes: { "recorder.capabilities": "clicks,network" },
    identifiedUserTraits: {},
    identifiedUserLabel: "",
    retentionDate: at(new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)).slice(
      0,
      19,
    ),
  };
}

async function insertSessions(rows: Array<JSONObject>): Promise<void> {
  await client.insert({
    table: `${database}.${new RumSession().tableName}`,
    format: "JSONEachRow",
    values: rows,
  });
}

async function scanSince(since: Date): Promise<TelemetryStoreScan> {
  const scans: Array<TelemetryStoreScan> = await scanProjectTelemetry({
    projectId: PROJECT_ID,
    sampleSize: 500,
    since,
    options: options(),
  });

  return scans.find((scan: TelemetryStoreScan): boolean => {
    return (
      scan.kind === DataStoreKind.TelemetrySessionReplays &&
      scan.serviceId === WEB_APP
    );
  })!;
}

function at_(scan: TelemetryStoreScan, location: string): LocationFindings {
  return scan.result.locations.find((entry: LocationFindings): boolean => {
    return entry.location === location;
  })!;
}

function typesAt(scan: TelemetryStoreScan, location: string): Array<string> {
  return (at_(scan, location)?.classifications || []).map(
    (classification: { dataTypeId: string }): string => {
      return classification.dataTypeId;
    },
  );
}

integration("a RUM session's tags, in a real ClickHouse (#11458)", () => {
  // The tagged sessions: half an hour ago. The rule's sessions come later.
  const taggedAt: Date = new Date(Date.now() - 30 * 60 * 1000);

  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const config: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(config);
    // connect() creates the database before opening the pool on it.
    client = await clickhouse.connect(config);

    // The product's own columns, codecs and skip indexes, under a plain MergeTree.
    const model: AnalyticsBaseModel = new RumSession();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: RumSession as unknown as { new (): AnalyticsBaseModel },
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    const plantedTags: Record<string, string> = { ...OPAQUE_TAGS };

    for (const tag of PLANTED_TAGS) {
      plantedTags[tag.key] = tag.value;
    }

    await insertSessions([
      ...TAGGED_SESSIONS.map((sessionId: string, index: number): JSONObject => {
        return sessionRow({
          sessionId,
          startTime: new Date(taggedAt.getTime() + index * 1000),
          tags: plantedTags,
        });
      }),
      sessionRow({
        sessionId: OPAQUE_SESSION,
        startTime: new Date(taggedAt.getTime() + 5000),
        tags: OPAQUE_TAGS,
      }),
    ]);

    // Every read the scan and the lookup make, against this database.
    jest
      .spyOn(AnalyticsDatabaseService.prototype, "executeQuery")
      .mockImplementation((async (statement: Statement): Promise<Results> => {
        sent.push(statement);

        const result: { json: () => Promise<unknown> } = await client.query({
          query: inDatabase(statement.query),
          query_params: statement.query_params,
          format: "JSON",
        });
        const data: Array<JSONObject> = (
          (await result.json()) as { data: Array<JSONObject> }
        ).data;

        return {
          json: (): Promise<unknown> => {
            return Promise.resolve({ data });
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
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    if (client) {
      try {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      } finally {
        await clickhouse.disconnect();
      }
    }
  });

  test("the scan finds each planted value at the tag it sits under, and nothing at an opaque tag", async () => {
    const replays: TelemetryStoreScan = await scanSince(
      new Date(taggedAt.getTime() - 60_000),
    );

    expect(replays.serviceName).toBe("storefront-web");

    for (const tag of PLANTED_TAGS) {
      expect({
        tag: tag.key,
        types: typesAt(replays, `sessions.tags.${tag.key}`),
      }).toEqual({
        tag: tag.key,
        types: expect.arrayContaining([tag.dataTypeId]),
      });
    }

    for (const key of Object.keys(OPAQUE_TAGS)) {
      expect(typesAt(replays, `sessions.tags.${key}`)).toEqual([]);
    }

    // Each finding keeps the sessions it was found in, by their ids, never a value.
    const kept: Array<FindingSampleRecord> =
      at_(replays, "sessions.tags.customer").sampleRecords?.["email-address"] ||
      [];

    expect(
      kept
        .map((record: FindingSampleRecord): string => {
          return record.sessionId || "";
        })
        .sort(),
    ).toEqual([...TAGGED_SESSIONS].sort());

    const stored: string = JSON.stringify(replays.result.locations);

    for (const value of Object.values(PLANTED)) {
      expect(stored).not.toContain(value);
    }
  });

  test("a tag's finding reads back exactly the sessions it was seen in, from the tags column, the value masked", async () => {
    const replays: TelemetryStoreScan = await scanSince(
      new Date(taggedAt.getTime() - 60_000),
    );
    const plan: OccurrencePlan = planOccurrenceRead(
      DataStoreKind.TelemetrySessionReplays,
      "sessions.tags.customer",
    )!;
    const found: DataSecurityFindingOccurrences =
      await findTelemetryFindingOccurrences({
        projectId: PROJECT_ID,
        plan,
        ownerId: WEB_APP,
        location: "sessions.tags.customer",
        dataTypeId: "email-address",
        options: options(),
        sampleRecords:
          at_(replays, "sessions.tags.customer").sampleRecords?.[
            "email-address"
          ] || [],
        lastSeenAt: new Date(),
      });

    expect(
      found.occurrences
        .map((occurrence: DataSecurityFindingOccurrence): string => {
          return occurrence.sessionId || "";
        })
        .sort(),
    ).toEqual([...TAGGED_SESSIONS].sort());

    for (const occurrence of found.occurrences) {
      expect(occurrence.rumApplicationId).toBe(WEB_APP);
      expect(occurrence.maskedValue.length).toBeGreaterThan(0);
      expect(occurrence.maskedValue).not.toContain(PLANTED["email"]);
      expect(occurrence.maskedValue).not.toContain("noor.haddad");
    }
  });

  test("no statement sent, and nothing ClickHouse logged of them, holds a value the page tagged", async () => {
    const windowStart: Date = new Date();

    await scanSince(new Date(taggedAt.getTime() - 60_000));

    expect(sent.length).toBeGreaterThan(0);

    for (const statement of sent) {
      const text: string = JSON.stringify([
        statement.query,
        statement.query_params,
      ]);

      for (const value of Object.values(PLANTED)) {
        expect(text).not.toContain(value);
      }
    }

    await client.command({ query: "SYSTEM FLUSH LOGS" });

    const logged: Array<JSONObject> = (
      (await (
        await client.query({
          query: `SELECT query FROM system.query_log WHERE event_time_microseconds >= fromUnixTimestamp64Micro(toInt64(${windowStart.getTime() * 1000})) AND has(databases, '${database}') AND query NOT LIKE '%INSERT INTO%'`,
          format: "JSON",
        })
      ).json()) as { data: Array<JSONObject> }
    ).data;

    expect(logged.length).toBeGreaterThan(0);

    for (const row of logged) {
      for (const value of Object.values(PLANTED)) {
        expect(String(row["query"])).not.toContain(value);
      }
    }
  });

  test("each finding is scrubbable: Scrub It's rule counts it as scrubbed, and run as ingest runs it over new sessions' tags, the scan finds nothing there again", async () => {
    const replays: TelemetryStoreScan = await scanSince(
      new Date(taggedAt.getTime() - 60_000),
    );
    const compiledRules: Array<CompiledScrubRule> = [];
    const covering: Array<CoveringScrubRule> = [];

    for (const tag of PLANTED_TAGS) {
      const location: string = `sessions.tags.${tag.key}`;
      const dataTypeId: string = typesAt(replays, location).includes(
        tag.dataTypeId,
      )
        ? tag.dataTypeId
        : typesAt(replays, location)[0]!;
      // What Scrub It reads: the finding is scrubbable, and its target the log attributes.
      const scrubbable: { location: string; target: ScrubTarget } =
        readScrubbableTarget({
          kind: DataStoreKind.TelemetrySessionReplays,
          dataTypeId,
          location,
        });

      expect(scrubbable.target).toEqual({
        signal: "log",
        field: "attributes",
        key: tag.key,
      });

      /*
       * A session replay's rule is never proven: Scrub It makes the
       * planner's narrowest, and for a secret the tag whole.
       */
      const finding: ScrubPlanFinding = {
        dataTypeId,
        location,
        target: scrubbable.target as ScrubTarget & {
          signal: "log" | "trace";
        },
      };
      const candidate: ScrubRuleCandidate = pickUnprovenScrubRuleCandidate({
        candidates: planScrubRuleCandidates({ finding }),
        finding,
      })!;

      expect(candidate.signal).toBe("log");

      if (tag.key === "password" || tag.key === "github") {
        expect(candidate.source).toBe(ScrubRuleSource.NamedKeys);
        expect(candidate.attributeKeys).toEqual([tag.key]);
      }

      const saved: LogScrubRule = new LogScrubRule();

      saved._id = ObjectID.generate().toString();
      saved.projectId = PROJECT_ID;
      saved.name = `Data Security: ${dataTypeId} in ${tag.key}`;
      saved.patternType = candidate.patternType as LogScrubRule["patternType"];
      saved.customRegex = candidate.customRegex;
      saved.scrubAction = candidate.scrubAction as LogScrubRule["scrubAction"];
      saved.fieldsToScrub =
        candidate.fieldsToScrub as LogScrubRule["fieldsToScrub"];
      saved.attributeKeys = candidate.attributeKeys;

      compiledRules.push(compileScrubRule(saved)!);
      covering.push({
        id: saved._id,
        name: saved.name,
        signal: "log",
        patternType: candidate.patternType,
        customRegex: candidate.customRegex,
        fieldsToScrub: candidate.fieldsToScrub,
        attributeKeys: candidate.attributeKeys,
      });

      // Coverage counts the finding as scrubbed by its own rule.
      expect({
        tag: tag.key,
        covered:
          findCoveringScrubRule(
            { rules: [covering[covering.length - 1]!] },
            {
              kind: DataStoreKind.TelemetrySessionReplays,
              dataTypeId,
              location,
              serviceId: WEB_APP,
            },
          ) !== null,
      }).toEqual({ tag: tag.key, covered: true });
    }

    // The next sessions the page tags the same way, through ingest's own code.
    const ruleMadeAt: Date = new Date(Date.now() - 10 * 60 * 1000);
    const plantedTags: Record<string, string> = { ...OPAQUE_TAGS };

    for (const tag of PLANTED_TAGS) {
      plantedTags[tag.key] = tag.value;
    }

    const scrubbed: Record<string, string> =
      SessionReplayScrubService.scrubTags({
        tags: plantedTags,
        compiledRules,
        rumApplicationId: WEB_APP,
        appVersion: "2026.11.29",
        countValues: false,
      });

    // The opaque tags are as the page sent them.
    for (const [key, value] of Object.entries(OPAQUE_TAGS)) {
      expect(scrubbed[key]).toBe(value);
    }

    await insertSessions(
      ["s-after-rule-1", "s-after-rule-2"].map(
        (sessionId: string, index: number): JSONObject => {
          return sessionRow({
            sessionId,
            startTime: new Date(ruleMadeAt.getTime() + 60_000 + index * 1000),
            tags: scrubbed,
          });
        },
      ),
    );

    const stored: string = JSON.stringify(
      (
        (await (
          await client.query({
            query: `SELECT tags FROM ${database}.${new RumSession().tableName} WHERE sessionId LIKE 's-after-rule-%'`,
            format: "JSON",
          })
        ).json()) as { data: Array<JSONObject> }
      ).data,
    );

    for (const value of Object.values(PLANTED)) {
      expect(stored).not.toContain(value);
    }

    // A scan of the sessions since the rule: nothing at any tag that held a value.
    const after: TelemetryStoreScan = await scanSince(ruleMadeAt);

    expect(after.result.rowsRead).toBe(2);

    for (const tag of PLANTED_TAGS) {
      expect({
        tag: tag.key,
        types: typesAt(after, `sessions.tags.${tag.key}`).filter(
          (dataTypeId: string): boolean => {
            return dataTypeId === tag.dataTypeId;
          },
        ),
      }).toEqual({ tag: tag.key, types: [] });
    }
  });
});

describe("Session tags ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
