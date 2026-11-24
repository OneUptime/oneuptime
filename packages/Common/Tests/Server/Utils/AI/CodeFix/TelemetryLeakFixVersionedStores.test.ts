// The watches reach the job queue, which needs Redis; nothing here queues.
jest.mock("../../../../../Server/Utils/DataSecurity/DataSecurityJobs", () => {
  return {
    queueDataSecurityEvaluation: jest.fn(),
    queueDataSecurityConnectionRead: jest.fn(),
    queueDataStoreScan: jest.fn(),
  };
});

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import MetricPipelineRule from "../../../../../Models/DatabaseModels/MetricPipelineRule";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import FixProductionVerifier, {
  VerifierRun,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import TelemetryLeakFixReads, {
  LeakDataFound,
  PROVABLE_LEAK_STORE_KINDS,
  getLeakPlaceSource,
  getLeakStoreNoun,
  getLeakTrafficSource,
  isReadableLeakPlace,
  toLeakPlaceToRead,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixReads";
import {
  decideTelemetryLeakBaseline,
  decideTelemetryLeakVerdict,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixVerdict";
import TelemetryLeakFixWatch from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixWatch";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityIssueAlerts from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import DataSecurityIssueResolutions from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueResolutions";
import DataSecurityRunner from "../../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { ContentScanOptions } from "../../../../../Server/Utils/DataSecurity/DataSecurityScanTypes";
import {
  SERVICE_VERSION_ATTRIBUTE_KEY,
  SESSION_APP_VERSION_COLUMN,
  VERSIONED_OCCURRENCE_SOURCES,
  buildTelemetryOccurrenceStatement,
  planOccurrenceRead,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryFindingOccurrences";
import { TelemetrySampleSource } from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetrySampleSource";
import {
  capsOf,
  getTelemetrySource,
} from "../../../../../Server/Utils/DataSecurity/Telemetry/TelemetryDataScanner";
import logger from "../../../../../Server/Utils/Logger";
import FixProductionBaseline, {
  TelemetryLeakFixBaseline,
  TelemetryLeakFixPlace,
} from "../../../../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import URL from "../../../../../Types/API/URL";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID } from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import MetricPipelineRuleType from "../../../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * A CODE FIX OF A LEAK IN METRICS OR SESSION REPLAYS, PROVEN BY THE VERSION
 * THAT SHIPPED IT (#10832).
 *
 * #10368 proved a fix of a leak in a service's logs and spans by its new
 * version; a leak found only in a metric's attributes or a session replay
 * was Unverifiable from its first check. Now every telemetry store names
 * the version that wrote it - a metric's data points under their
 * resource's service.version, a RUM application's logs and spans there
 * too, its sessions in their appVersion - and each kind of record is read
 * in the deploy's version only where its own records name it. A metric
 * place a metric pipeline Redact Attribute rule hides is read for the
 * rule's replacement under the key; one a rule removes or drops cannot be
 * told.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-000000000002",
);
const METRICS_STORE_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-000000000003",
);
const ISSUE_ID: ObjectID = new ObjectID("8c5e3f31-0000-4000-8000-000000000004");
const RUN_ID: ObjectID = new ObjectID("8c5e3f31-0000-4000-8000-000000000005");
const TASK_ID: ObjectID = new ObjectID("8c5e3f31-0000-4000-8000-000000000006");
const FIX_ID: ObjectID = new ObjectID("8c5e3f31-0000-4000-8000-000000000007");
const FINDING_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-000000000008",
);
const METRIC_RULE_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-000000000009",
);
const RUM_APP_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-00000000000a",
);
const REPLAY_STORE_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-00000000000b",
);
const LOG_FINDING_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-00000000000c",
);
const LABEL_FINDING_ID: ObjectID = new ObjectID(
  "8c5e3f31-0000-4000-8000-00000000000d",
);

const HOUR: number = 60 * 60 * 1000;
const MERGED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const DEPLOYED_AT: Date = new Date(MERGED_AT.getTime() + 2 * HOUR);
const GRACE: number = 10 * 60 * 1000;
const EMAIL: string = "jane.doe@acme-corp.io";

const OPTIONS: ContentScanOptions = {
  limits: {
    maxObjects: 2000,
    maxBytesPerObject: 65536,
    maxBytesTotal: 52428800,
    maxRowsPerTable: 1000,
    maxTables: 200,
    deadline: new Date("2026-11-22T11:00:00.000Z"),
  },
  customDetectors: [],
  extraHints: [],
  disabledDataTypeIds: new Set<string>(),
  allowedValues: new Set<string>(),
  exclusions: [],
  fingerprintKey: "versioned-stores-test",
};

function hoursAfterMerge(hours: number): Date {
  return new Date(MERGED_AT.getTime() + hours * HOUR);
}

// A check `hours` into the deployed fix's watch, after the rollout grace.
function watchedFor(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function runAt(now: Date): VerifierRun {
  return {
    now,
    tokens: new Map<string, string | null>(),
    failedCompares: new Set<string>(),
  };
}

function queryOf(statement: Statement): string {
  return String((statement.toJSON() as JSONObject)["query"]);
}

function parametersOf(statement: Statement): string {
  return JSON.stringify((statement.toJSON() as JSONObject)["query_params"]);
}

// A leak of a user's email in a metric's attributes, no rule hiding it.
const METRIC_PLACE: TelemetryLeakFixPlace = {
  findingId: FINDING_ID.toString(),
  dataTypeId: "email-address",
  location: "attributes.user.email",
  scrubRuleIds: [],
  lastSeenAt: hoursAfterMerge(-3).toISOString(),
};

const METRIC_BASELINE: TelemetryLeakFixBaseline = {
  serviceId: SERVICE_ID.toString(),
  taskId: TASK_ID.toString(),
  stores: [
    {
      dataStoreId: METRICS_STORE_ID.toString(),
      kind: DataStoreKind.TelemetryMetrics,
      issueIds: [ISSUE_ID.toString()],
      places: [METRIC_PLACE],
      recordsBefore: 1800,
      recordsBeforeHour: hoursAfterMerge(-3).toISOString(),
    },
  ],
  valuesChangedBefore: 0,
  from: hoursAfterMerge(-7 * 24).toISOString(),
  to: MERGED_AT.toISOString(),
};

// A RUM application's leak: an email in its browser logs, and in the session's user label.
const REPLAY_BASELINE: TelemetryLeakFixBaseline = {
  serviceId: RUM_APP_ID.toString(),
  taskId: TASK_ID.toString(),
  stores: [
    {
      dataStoreId: REPLAY_STORE_ID.toString(),
      kind: DataStoreKind.TelemetrySessionReplays,
      issueIds: [ISSUE_ID.toString()],
      places: [
        {
          findingId: LOG_FINDING_ID.toString(),
          dataTypeId: "email-address",
          location: "logs.attributes.user.email",
          scrubRuleIds: [],
          lastSeenAt: hoursAfterMerge(-2).toISOString(),
        },
        {
          findingId: LABEL_FINDING_ID.toString(),
          dataTypeId: "email-address",
          location: "sessions.identifiedUserLabel",
          scrubRuleIds: [],
          lastSeenAt: hoursAfterMerge(-2).toISOString(),
        },
      ],
      recordsBefore: 640,
      recordsBeforeHour: hoursAfterMerge(-2).toISOString(),
    },
  ],
  valuesChangedBefore: 0,
  from: hoursAfterMerge(-7 * 24).toISOString(),
  to: MERGED_AT.toISOString(),
};

function watchingFix(
  baseline: TelemetryLeakFixBaseline,
  overrides: JSONObject = {},
): AIAgentTaskPullRequest {
  return {
    id: FIX_ID,
    _id: FIX_ID.toString(),
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    createdAt: hoursAfterMerge(-5),
    pullRequestState: PullRequestState.Merged,
    pullRequestNumber: 91,
    pullRequestUrl: URL.fromString("https://github.com/acme/web/pull/91"),
    mergeCommitSha: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
    mergedAt: MERGED_AT,
    productionCheck: FixProductionCheck.TelemetryLeak,
    productionStatus: FixProductionStatus.Watching,
    productionStatusAt: DEPLOYED_AT,
    productionSummary: "still watching",
    deployedAt: DEPLOYED_AT,
    deployedVersion: "2.4.1",
    repoOrganizationName: "acme",
    repoName: "web",
    productionBaseline: {
      telemetryLeak: baseline,
    } as FixProductionBaseline as unknown as JSONObject,
    ...overrides,
  } as unknown as AIAgentTaskPullRequest;
}

let pullRequestWrites: Array<JSONObject>;

beforeEach(() => {
  pullRequestWrites = [];
  jest
    .spyOn(AIAgentTaskPullRequestService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }): Promise<void> => {
      pullRequestWrites.push(data.data);
    }) as never);
  jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined as never);
  jest.spyOn(DataSecurityAiProposals, "onIssuesClosed").mockResolvedValue();
  jest
    .spyOn(DataSecurityIssueAlerts, "resolveForClosedIssues")
    .mockResolvedValue(0);
  jest
    .spyOn(DataSecurityRunner, "getScanSetup")
    .mockResolvedValue({ options: OPTIONS } as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastVerdict(): JSONObject {
  const verdicts: Array<JSONObject> = pullRequestWrites.filter(
    (data: JSONObject): boolean => {
      return data["productionStatus"] !== undefined;
    },
  );

  expect(verdicts.length).toBeGreaterThan(0);
  return verdicts[verdicts.length - 1]!;
}

/*
 * ---------------------------------------------------------------------------
 * Every telemetry store names the version that wrote it
 * ---------------------------------------------------------------------------
 */

describe("every kind of telemetry record names the version that wrote it", () => {
  test("a service's metrics and a RUM application's logs, spans and sessions are read by version", () => {
    for (const source of [
      TelemetrySampleSource.Logs,
      TelemetrySampleSource.Traces,
      TelemetrySampleSource.AiConversations,
      TelemetrySampleSource.Exceptions,
      TelemetrySampleSource.Metrics,
      TelemetrySampleSource.RumLogs,
      TelemetrySampleSource.RumSpans,
      TelemetrySampleSource.RumSessions,
    ]) {
      expect(VERSIONED_OCCURRENCE_SOURCES.has(source)).toBe(true);
    }

    expect(PROVABLE_LEAK_STORE_KINDS).toEqual(
      expect.arrayContaining([
        DataStoreKind.TelemetryMetrics,
        DataStoreKind.TelemetrySessionReplays,
      ]),
    );
  });

  test("a metric's data points of one version: its resource's service.version, bound as a parameter", () => {
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: DEPLOYED_AT,
      until: watchedFor(25),
      plan: planOccurrenceRead(
        DataStoreKind.TelemetryMetrics,
        "attributes.user.email",
      )!,
      ownerId: SERVICE_ID.toString(),
      limit: 300,
      caps: capsOf(getTelemetrySource(TelemetrySampleSource.Metrics), OPTIONS),
      serviceVersion: "2.4.1'; DROP TABLE Metric; --",
      readsServiceVersion: true,
    });
    const query: string = queryOf(statement);

    expect(query).toContain("FROM ");
    // A text holding a security scan's word is sent hex encoded (Statement).
    expect(query).toMatch(
      / AND attributes\[\{p\d+:String\}\] = (unhex\()?\{p\d+:String\}/,
    );
    expect(query).toMatch(
      /substringUTF8\(attributes\[\{p\d+:String\}\], 1, \{p\d+:\w+\}\) AS readServiceVersion/,
    );
    expect(parametersOf(statement)).toContain(SERVICE_VERSION_ATTRIBUTE_KEY);
    // The version is a parameter, never written into the query.
    expect(query).not.toContain("DROP TABLE");
  });

  test("a session of one release: its appVersion column, the recorder's own", () => {
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: DEPLOYED_AT,
      until: watchedFor(25),
      plan: planOccurrenceRead(
        DataStoreKind.TelemetrySessionReplays,
        "sessions.identifiedUserLabel",
      )!,
      ownerId: RUM_APP_ID.toString(),
      limit: 300,
      caps: capsOf(
        getTelemetrySource(TelemetrySampleSource.RumSessions),
        OPTIONS,
      ),
      serviceVersion: "web-2026.11.20",
      readsServiceVersion: true,
    });
    const query: string = queryOf(statement);

    expect(query).toContain(` AND ${SESSION_APP_VERSION_COLUMN} = {p`);
    expect(query).toContain(`substringUTF8(${SESSION_APP_VERSION_COLUMN}, 1, `);
    expect(query).not.toContain(SERVICE_VERSION_ATTRIBUTE_KEY);
    expect(parametersOf(statement)).toContain("web-2026.11.20");
  });

  test("a browser log of one release: the browser SDK's service.version, as a service's log", () => {
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: DEPLOYED_AT,
      until: watchedFor(25),
      plan: planOccurrenceRead(
        DataStoreKind.TelemetrySessionReplays,
        "logs.attributes.user.email",
      )!,
      ownerId: RUM_APP_ID.toString(),
      limit: 300,
      caps: capsOf(getTelemetrySource(TelemetrySampleSource.RumLogs), OPTIONS),
      serviceVersion: "3.1.0",
    });

    expect(queryOf(statement)).toMatch(
      / AND attributes\[\{p\d+:String\}\] = \{p\d+:String\}/,
    );
    expect(parametersOf(statement)).toContain(SERVICE_VERSION_ATTRIBUTE_KEY);
  });

  test("a read that asks for no version reads every version, as before", () => {
    const statement: Statement = buildTelemetryOccurrenceStatement({
      projectId: PROJECT_ID,
      since: DEPLOYED_AT,
      until: watchedFor(25),
      plan: planOccurrenceRead(
        DataStoreKind.TelemetryMetrics,
        "attributes.user.email",
      )!,
      ownerId: SERVICE_ID.toString(),
      limit: 300,
      caps: capsOf(getTelemetrySource(TelemetrySampleSource.Metrics), OPTIONS),
    });

    expect(queryOf(statement)).not.toContain("readServiceVersion");
    expect(parametersOf(statement)).not.toContain(
      SERVICE_VERSION_ATTRIBUTE_KEY,
    );
  });
});

describe("a store's traffic, counted in its version", () => {
  test("a metric's data points are counted in their version now", () => {
    const built: ReturnType<
      typeof TelemetryLeakFixReads.buildRecordCountStatement
    > = TelemetryLeakFixReads.buildRecordCountStatement({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      serviceId: SERVICE_ID.toString(),
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "2.4.1",
    });

    expect(built).not.toBeNull();
    expect(built!.source.source).toBe(TelemetrySampleSource.Metrics);
    expect(queryOf(built!.statement)).toMatch(/^SELECT count\(\) AS records/);
    expect(parametersOf(built!.statement)).toContain(
      SERVICE_VERSION_ATTRIBUTE_KEY,
    );
  });

  test("a session is counted once however many times the table keeps it, in its appVersion", () => {
    const built: ReturnType<
      typeof TelemetryLeakFixReads.buildRecordCountStatement
    > = TelemetryLeakFixReads.buildRecordCountStatement({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetrySessionReplays,
      source: TelemetrySampleSource.RumSessions,
      serviceId: RUM_APP_ID.toString(),
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "web-2026.11.20",
    });
    const query: string = queryOf(built!.statement);

    expect(query).toMatch(/^SELECT uniq\(sessionId\) AS records/);
    expect(query).toContain(`AND ${SESSION_APP_VERSION_COLUMN} = {p`);
  });

  test("a session replay store's traffic needs the kind of record to count", () => {
    expect(
      TelemetryLeakFixReads.buildRecordCountStatement({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetrySessionReplays,
        serviceId: RUM_APP_ID.toString(),
        since: DEPLOYED_AT,
        until: watchedFor(25),
      }),
    ).toBeNull();
  });

  test("a session replay store is counted in the kind of record most of its places are in", () => {
    expect(
      getLeakTrafficSource(DataStoreKind.TelemetrySessionReplays, [
        "sessions.identifiedUserLabel",
        "sessions.identifiedUserTraits.email",
        "logs.attributes.user.email",
      ]),
    ).toBe(TelemetrySampleSource.RumSessions);
    // A tie goes to the logs, then the spans.
    expect(
      getLeakTrafficSource(DataStoreKind.TelemetrySessionReplays, [
        "spans.attributes.user.email",
        "logs.attributes.user.email",
      ]),
    ).toBe(TelemetrySampleSource.RumLogs);
    expect(
      getLeakTrafficSource(DataStoreKind.TelemetrySessionReplays, [
        "replay.dom.text",
      ]),
    ).toBeNull();
    expect(getLeakTrafficSource(DataStoreKind.TelemetryMetrics)).toBe(
      TelemetrySampleSource.Metrics,
    );
    expect(getLeakTrafficSource(DataStoreKind.TelemetryLogs)).toBe(
      TelemetrySampleSource.Logs,
    );
  });

  test("what each store's records are called in a verdict", () => {
    expect(getLeakStoreNoun(DataStoreKind.TelemetryMetrics)).toBe(
      "data points",
    );
    expect(getLeakStoreNoun(DataStoreKind.TelemetryLogs)).toBe("logs");
    expect(
      getLeakStoreNoun(DataStoreKind.TelemetrySessionReplays, [
        "logs.attributes.user.email",
      ]),
    ).toBe("browser logs");
    expect(
      getLeakStoreNoun(DataStoreKind.TelemetrySessionReplays, [
        "sessions.identifiedUserLabel",
      ]),
    ).toBe("sessions");
    expect(
      getLeakStoreNoun(DataStoreKind.TelemetrySessionReplays, [
        "spans.attributes.user.email",
      ]),
    ).toBe("browser spans");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A metric place a metric pipeline rule hides
 * ---------------------------------------------------------------------------
 */

describe("a metric place a metric pipeline rule hides", () => {
  test("a Redact Attribute rule leaves its replacement to read; one that removes or drops leaves nothing", () => {
    const place: Pick<TelemetryLeakFixPlace, "location" | "metricRule"> = {
      location: "attributes.user.email",
    };

    expect(isReadableLeakPlace(DataStoreKind.TelemetryMetrics, place)).toBe(
      true,
    );
    expect(
      isReadableLeakPlace(DataStoreKind.TelemetryMetrics, {
        ...place,
        metricRule: {
          id: METRIC_RULE_ID.toString(),
          ruleType: MetricPipelineRuleType.RedactAttribute,
          replacement: "[REDACTED]",
        },
      }),
    ).toBe(true);

    for (const ruleType of [
      MetricPipelineRuleType.RemoveAttribute,
      MetricPipelineRuleType.Drop,
    ]) {
      expect(
        isReadableLeakPlace(DataStoreKind.TelemetryMetrics, {
          ...place,
          metricRule: { id: METRIC_RULE_ID.toString(), ruleType },
        }),
      ).toBe(false);
    }
  });

  test("a place no record has, or a store that is not telemetry, cannot be read", () => {
    expect(
      isReadableLeakPlace(DataStoreKind.TelemetrySessionReplays, {
        location: "replay.dom.text",
      }),
    ).toBe(false);
    expect(
      isReadableLeakPlace(DataStoreKind.TelemetrySessionReplays, {
        location: "sessions.identifiedUserTraits.email",
      }),
    ).toBe(true);
    expect(isReadableLeakPlace("Postgres", { location: "users.email" })).toBe(
      false,
    );
    expect(
      getLeakPlaceSource(
        DataStoreKind.TelemetrySessionReplays,
        "spans.attributes.user.email",
      ),
    ).toBe(TelemetrySampleSource.RumSpans);
  });

  test("a Redact Attribute place is read for the rule's own replacement, or ingest's default", () => {
    expect(
      toLeakPlaceToRead({
        dataTypeId: "email-address",
        location: "attributes.user.email",
        metricRule: {
          id: METRIC_RULE_ID.toString(),
          ruleType: MetricPipelineRuleType.RedactAttribute,
          replacement: "***",
        },
      }),
    ).toEqual({
      dataTypeId: "email-address",
      location: "attributes.user.email",
      redactedAs: "***",
    });
    expect(
      toLeakPlaceToRead({
        dataTypeId: "email-address",
        location: "attributes.user.email",
        metricRule: {
          id: METRIC_RULE_ID.toString(),
          ruleType: MetricPipelineRuleType.RedactAttribute,
        },
      }).redactedAs,
    ).toBe("[REDACTED]");
    expect(
      toLeakPlaceToRead({
        dataTypeId: "email-address",
        location: "attributes.user.email",
      }),
    ).toEqual({
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });
  });

  test("the baseline says why it cannot be told when every place is removed or dropped", () => {
    const verdict: ReturnType<typeof decideTelemetryLeakBaseline> =
      decideTelemetryLeakBaseline({ placeCount: 2, unreadablePlaceCount: 2 });

    expect(verdict?.status).toBe(FixProductionStatus.Unverifiable);
    expect(verdict?.summary).toContain("A metric pipeline rule removes");
    expect(verdict?.summary).toContain("Redact Attribute");
    expect(
      decideTelemetryLeakBaseline({ placeCount: 2, unreadablePlaceCount: 1 }),
    ).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Reading the new version's records at a place
 * ---------------------------------------------------------------------------
 */

describe("the new version's records at a place", () => {
  const ROW_TIME: number = DEPLOYED_AT.getTime() + 3 * HOUR;

  function metricRow(
    value: string,
    key: string = "user.email",
    version: string = "2.4.1",
  ): JSONObject {
    return {
      ownerId: SERVICE_ID.toString(),
      recordTime: ROW_TIME,
      readMetricName: "checkout.requests",
      readAttributes: [[key, value]],
      readServiceVersion: version,
    };
  }

  test("a metric data point of the version that still holds the email is the code still sending it", async () => {
    const statements: Array<Statement> = [];
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      serviceId: SERVICE_ID.toString(),
      // A key whose name hints at no data type: only its values tell.
      places: [{ dataTypeId: "email-address", location: "attributes.tenant" }],
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "2.4.1",
      options: OPTIONS,
      readRows: async (data: {
        statement: Statement;
      }): Promise<Array<JSONObject>> => {
        statements.push(data.statement);
        return [metricRow(EMAIL, "tenant"), metricRow("guest", "tenant")];
      },
    });

    expect(found).toEqual({
      recordsRead: 2,
      recordsWithData: 1,
      versions: ["2.4.1"],
    });
    expect(statements).toHaveLength(1);
    // Narrowed by the email's own pattern, in the version only.
    expect(queryOf(statements[0]!)).toContain("match(");
    expect(parametersOf(statements[0]!)).toContain("2.4.1");
  });

  test("silence in the version's data points is a record read that holds nothing", async () => {
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      serviceId: SERVICE_ID.toString(),
      places: [
        { dataTypeId: "email-address", location: "attributes.user.email" },
      ],
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "2.4.1",
      options: OPTIONS,
      readRows: async (): Promise<Array<JSONObject>> => {
        return [metricRow("guest"), metricRow("anonymous")];
      },
    });

    expect(found.recordsRead).toBe(2);
    expect(found.recordsWithData).toBe(0);
  });

  test("a Redact Attribute rule's replacement under the key is a value the rule changed: the code still sends it", async () => {
    const statements: Array<Statement> = [];
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      serviceId: SERVICE_ID.toString(),
      places: [
        {
          dataTypeId: "email-address",
          location: "attributes.tenant",
          redactedAs: "[REDACTED]",
        },
      ],
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "2.4.1",
      options: OPTIONS,
      readRows: async (data: {
        statement: Statement;
      }): Promise<Array<JSONObject>> => {
        statements.push(data.statement);
        return [
          metricRow("[REDACTED]", "tenant"),
          metricRow("guest", "tenant"),
        ];
      },
    });

    expect(found.recordsWithData).toBe(1);
    // A replacement has no email's shape: the database is not asked to narrow by it.
    expect(queryOf(statements[0]!)).not.toContain("match(");
  });

  test("without the rule, the same replacement is no data", async () => {
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryMetrics,
      serviceId: SERVICE_ID.toString(),
      places: [
        { dataTypeId: "email-address", location: "attributes.user.email" },
      ],
      since: DEPLOYED_AT,
      until: watchedFor(25),
      options: OPTIONS,
      readRows: async (): Promise<Array<JSONObject>> => {
        return [metricRow("[REDACTED]")];
      },
    });

    expect(found.recordsWithData).toBe(0);
  });

  test("a session of the release whose user label still is an email, read from the sessions", async () => {
    const statements: Array<Statement> = [];
    const found: LeakDataFound = await TelemetryLeakFixReads.findDataAtPlaces({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetrySessionReplays,
      serviceId: RUM_APP_ID.toString(),
      places: [
        {
          dataTypeId: "email-address",
          location: "sessions.identifiedUserLabel",
        },
      ],
      since: DEPLOYED_AT,
      until: watchedFor(25),
      version: "web-2026.11.20",
      options: OPTIONS,
      readRows: async (data: {
        statement: Statement;
      }): Promise<Array<JSONObject>> => {
        statements.push(data.statement);
        return [
          {
            ownerId: RUM_APP_ID.toString(),
            recordTime: ROW_TIME,
            readSessionId: "s-1",
            readLabel: EMAIL,
            readServiceVersion: "web-2026.11.20",
          },
        ];
      },
    });

    expect(found).toEqual({
      recordsRead: 1,
      recordsWithData: 1,
      versions: ["web-2026.11.20"],
    });
    expect(queryOf(statements[0]!)).toContain(
      `AND ${SESSION_APP_VERSION_COLUMN} = {p`,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * The first check: a metric store's places and the rules hiding them
 * ---------------------------------------------------------------------------
 */

describe("a metric leak's first check", () => {
  function metricStoreExists(): void {
    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([
      Object.assign(new DataSecurityIssue(ISSUE_ID), {
        dataStoreId: METRICS_STORE_ID,
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      }),
    ] as never);
    jest.spyOn(DataStoreService, "findBy").mockResolvedValue([
      Object.assign(new DataStore(METRICS_STORE_ID), {
        kind: DataStoreKind.TelemetryMetrics,
        serviceId: SERVICE_ID,
      }),
    ] as never);
    jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([
      Object.assign(new DataStoreFinding(FINDING_ID), {
        dataTypeId: "email-address",
        location: "attributes.user.email",
        confidence: DataConfidence.High,
        matchCount: 40,
        isScrubbed: false,
        lastSeenAt: hoursAfterMerge(-3),
      }),
    ] as never);
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  }

  function metricRuleIs(ruleType: MetricPipelineRuleType): void {
    jest.spyOn(MetricPipelineRuleService, "findBy").mockResolvedValue([
      Object.assign(new MetricPipelineRule(METRIC_RULE_ID), {
        name: "Data Security: Email address in attributes.user.email",
        ruleType,
        addAttributeKey: "user.email",
        serviceId: SERVICE_ID,
        filters: [],
        redactReplacement: "<email>",
        isEnabled: true,
      }),
    ] as never);
  }

  async function readBaseline(): Promise<
    TelemetryLeakFixBaseline | ReturnType<typeof decideTelemetryLeakVerdict>
  > {
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });

    return await TelemetryLeakFixWatch.readBaseline({
      fix: watchingFix(METRIC_BASELINE),
      target: {
        check: FixProductionCheck.TelemetryLeak,
        issueIds: [ISSUE_ID],
        taskId: TASK_ID,
      },
      mergedAt: MERGED_AT,
      now: hoursAfterMerge(1),
    });
  }

  test("a metric's place is watched, its data points counted in the leak's last hour", async () => {
    metricStoreExists();
    jest
      .spyOn(MetricPipelineRuleService, "findBy")
      .mockResolvedValue([] as never);
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockResolvedValue(1800);

    expect(await readBaseline()).toMatchObject({
      serviceId: SERVICE_ID.toString(),
      stores: [
        {
          dataStoreId: METRICS_STORE_ID.toString(),
          kind: DataStoreKind.TelemetryMetrics,
          places: [
            {
              findingId: FINDING_ID.toString(),
              location: "attributes.user.email",
              scrubRuleIds: [],
            },
          ],
          recordsBefore: 1800,
        },
      ],
    });
    expect(counts.mock.calls[0]![0]).toMatchObject({
      kind: DataStoreKind.TelemetryMetrics,
      source: TelemetrySampleSource.Metrics,
      since: new Date(Math.floor(hoursAfterMerge(-3).getTime() / HOUR) * HOUR),
    });
  });

  test("a place a Redact Attribute rule hides keeps the rule and what it writes", async () => {
    metricStoreExists();
    metricRuleIs(MetricPipelineRuleType.RedactAttribute);
    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(1800);

    const baseline: TelemetryLeakFixBaseline =
      (await readBaseline()) as TelemetryLeakFixBaseline;

    expect(baseline.stores[0]!.places[0]).toMatchObject({
      scrubRuleIds: [],
      metricRule: {
        id: METRIC_RULE_ID.toString(),
        ruleType: MetricPipelineRuleType.RedactAttribute,
        replacement: "<email>",
      },
    });
  });

  test("a place a rule removes before it is stored cannot be told: Unverifiable, saying why", async () => {
    metricStoreExists();
    metricRuleIs(MetricPipelineRuleType.RemoveAttribute);
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockResolvedValue(1800);

    const verdict: ReturnType<typeof decideTelemetryLeakVerdict> =
      (await readBaseline()) as ReturnType<typeof decideTelemetryLeakVerdict>;

    expect(verdict.status).toBe(FixProductionStatus.Unverifiable);
    expect(verdict.summary).toContain("A metric pipeline rule removes");
    // Nothing to weigh a silence against was counted.
    expect(counts).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The deployed fix, watched: a metric's and a session replay's
 * ---------------------------------------------------------------------------
 */

describe("scenario: a metric leak's code fix, by its version's data points", () => {
  test("a day into version 2.4.1, enough data points and none holding the email: Fixed in code, version 2.4.1", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockResolvedValue(2100);
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({
        recordsRead: 300,
        recordsWithData: 0,
        versions: [],
      });
    const marked: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);

    await TelemetryLeakFixWatch.verify(
      watchingFix(METRIC_BASELINE),
      runAt(watchedFor(25)),
    );

    const verdict: JSONObject = lastVerdict();

    expect(verdict["productionStatus"]).toBe(FixProductionStatus.Verified);
    expect(String(verdict["productionSummary"])).toContain(
      "none of its records held the data in 2,100 data points",
    );
    expect(String(verdict["productionSummary"])).toContain(
      "the 1,800 data points the old version sent",
    );
    // The version's own data points, from the deploy on.
    expect(reads.mock.calls[0]![0]).toMatchObject({
      kind: DataStoreKind.TelemetryMetrics,
      version: "2.4.1",
      since: DEPLOYED_AT,
      places: [
        { dataTypeId: "email-address", location: "attributes.user.email" },
      ],
    });
    // Whether metrics name the version: asked once, and its answer is the traffic.
    expect(counts).toHaveBeenCalledTimes(1);
    expect(counts.mock.calls[0]![0]).toMatchObject({
      source: TelemetrySampleSource.Metrics,
      version: "2.4.1",
      since: DEPLOYED_AT,
    });
    expect(marked.mock.calls[0]![0]).toMatchObject({
      issueIds: [ISSUE_ID],
      fix: { version: "2.4.1", number: 91 },
    });
  });

  test("one data point of the version still holding the email: Regressed, and the issue says so", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(40);
    jest.spyOn(TelemetryLeakFixReads, "findDataAtPlaces").mockResolvedValue({
      recordsRead: 40,
      recordsWithData: 1,
      versions: ["2.4.1"],
    });
    const noted: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "noteOnIssues")
      .mockResolvedValue();
    const marked: jest.SpyInstance = jest.spyOn(
      DataSecurityIssueResolutions,
      "markFixedInCode",
    );

    await TelemetryLeakFixWatch.verify(
      watchingFix(METRIC_BASELINE),
      runAt(watchedFor(2)),
    );

    expect(lastVerdict()).toMatchObject({
      productionStatus: FixProductionStatus.Regressed,
      productionSummary:
        "Version 2.4.1 still writes the data: 1 of its records held it after it shipped the fix.",
    });
    expect(marked).not.toHaveBeenCalled();
    expect(noted).toHaveBeenCalledTimes(1);
  });

  test("metrics that do not name the version, when spans do, are read from the rollout grace on", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockImplementation((async (data: {
        version?: string | undefined;
      }): Promise<number> => {
        // No data point carries version 2.4.1; 2,000 arrived since the grace.
        return data.version ? 0 : 2000;
      }) as never);
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({
        recordsRead: 120,
        recordsWithData: 0,
        versions: [],
      });
    jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);

    await TelemetryLeakFixWatch.verify(
      watchingFix(METRIC_BASELINE),
      runAt(watchedFor(25)),
    );

    expect(reads.mock.calls[0]![0]).toMatchObject({
      version: undefined,
      since: new Date(DEPLOYED_AT.getTime() + GRACE),
    });
    expect(counts.mock.calls[1]![0]).toMatchObject({
      version: undefined,
      since: new Date(DEPLOYED_AT.getTime() + GRACE),
    });
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
  });

  test("a place a Redact Attribute rule hides is read for its replacement in the new version", async () => {
    const redacted: TelemetryLeakFixBaseline = {
      ...METRIC_BASELINE,
      stores: [
        {
          ...METRIC_BASELINE.stores[0]!,
          places: [
            {
              ...METRIC_PLACE,
              metricRule: {
                id: METRIC_RULE_ID.toString(),
                ruleType: MetricPipelineRuleType.RedactAttribute,
                replacement: "<email>",
              },
            },
          ],
        },
      ],
    };

    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(30);
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({
        recordsRead: 30,
        recordsWithData: 30,
        versions: ["2.4.1"],
      });
    jest
      .spyOn(DataSecurityIssueResolutions, "noteOnIssues")
      .mockResolvedValue();

    await TelemetryLeakFixWatch.verify(
      watchingFix(redacted),
      runAt(watchedFor(3)),
    );

    expect(reads.mock.calls[0]![0]).toMatchObject({
      places: [
        {
          dataTypeId: "email-address",
          location: "attributes.user.email",
          redactedAs: "<email>",
        },
      ],
    });
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
  });
});

describe("scenario: a RUM application's leak, by its release", () => {
  test("its browser logs and its sessions each read in the release they name: Fixed in code", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockResolvedValue(700);
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({ recordsRead: 50, recordsWithData: 0, versions: [] });
    const marked: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);

    await TelemetryLeakFixWatch.verify(
      watchingFix(REPLAY_BASELINE),
      runAt(watchedFor(25)),
    );

    // One read for the browser logs, one for the sessions, each in the release.
    expect(reads).toHaveBeenCalledTimes(2);
    expect(reads.mock.calls[0]![0]).toMatchObject({
      kind: DataStoreKind.TelemetrySessionReplays,
      serviceId: RUM_APP_ID.toString(),
      places: [{ location: "logs.attributes.user.email" }],
      version: "2.4.1",
      since: DEPLOYED_AT,
    });
    expect(reads.mock.calls[1]![0]).toMatchObject({
      places: [{ location: "sessions.identifiedUserLabel" }],
      version: "2.4.1",
    });
    // Each kind asked once whether it names the release.
    expect(
      counts.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as JSONObject)["source"];
      }),
    ).toEqual([
      TelemetrySampleSource.RumLogs,
      TelemetrySampleSource.RumSessions,
    ]);
    expect(String(lastVerdict()["productionSummary"])).toContain(
      "700 browser logs",
    );
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
    expect(marked.mock.calls[0]![0]).toMatchObject({
      fix: { version: "2.4.1" },
    });
  });

  test("a session of the release still labelled with an email: Regressed", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(700);
    jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockImplementation((async (data: {
        places: Array<{ location: string }>;
      }): Promise<LeakDataFound> => {
        return data.places[0]!.location === "sessions.identifiedUserLabel"
          ? { recordsRead: 20, recordsWithData: 3, versions: ["2.4.1"] }
          : { recordsRead: 50, recordsWithData: 0, versions: [] };
      }) as never);
    jest
      .spyOn(DataSecurityIssueResolutions, "noteOnIssues")
      .mockResolvedValue();

    await TelemetryLeakFixWatch.verify(
      watchingFix(REPLAY_BASELINE),
      runAt(watchedFor(5)),
    );

    expect(lastVerdict()).toMatchObject({
      productionStatus: FixProductionStatus.Regressed,
      productionSummary:
        "Version 2.4.1 still writes the data: 3 of its records held it after it shipped the fix.",
    });
  });

  test("a release no record names is read from the rollout grace on, every kind alike", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockImplementation((async (data: {
        version?: string | undefined;
      }): Promise<number> => {
        return data.version ? 0 : 900;
      }) as never);
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({ recordsRead: 10, recordsWithData: 0, versions: [] });
    jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);

    await TelemetryLeakFixWatch.verify(
      watchingFix(REPLAY_BASELINE),
      runAt(watchedFor(25)),
    );

    for (const call of reads.mock.calls) {
      expect(call[0]).toMatchObject({
        version: undefined,
        since: new Date(DEPLOYED_AT.getTime() + GRACE),
      });
    }
  });
});

describe("the leak coming back after a metric fix was verified", () => {
  test("a Redact Attribute rule's replacement showing up again names the version that brought it back", async () => {
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    const reads: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({
        recordsRead: 12,
        recordsWithData: 4,
        versions: ["2.5.0"],
      });
    const verifiedAt: Date = watchedFor(30);

    expect(
      await TelemetryLeakFixWatch.readComingBack({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID.toString(),
        store: {
          ...METRIC_BASELINE.stores[0]!,
          places: [
            {
              ...METRIC_PLACE,
              metricRule: {
                id: METRIC_RULE_ID.toString(),
                ruleType: MetricPipelineRuleType.RedactAttribute,
                replacement: "<email>",
              },
            },
          ],
        },
        keptRuleIds: [],
        verifiedAt,
        now: watchedFor(60),
      }),
    ).toEqual({ version: "2.5.0" });
    expect(reads.mock.calls[0]![0]).toMatchObject({
      since: verifiedAt,
      places: [{ redactedAs: "<email>" }],
    });
  });

  test("nothing under the key since: not back - the scan's findings are read as before", async () => {
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });
    jest
      .spyOn(TelemetryLeakFixReads, "findDataAtPlaces")
      .mockResolvedValue({ recordsRead: 12, recordsWithData: 0, versions: [] });
    const findings: jest.SpyInstance = jest
      .spyOn(DataStoreFindingService, "findBy")
      .mockResolvedValue([] as never);

    expect(
      await TelemetryLeakFixWatch.readComingBack({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID.toString(),
        store: {
          ...METRIC_BASELINE.stores[0]!,
          places: [
            {
              ...METRIC_PLACE,
              metricRule: {
                id: METRIC_RULE_ID.toString(),
                ruleType: MetricPipelineRuleType.RedactAttribute,
              },
            },
          ],
        },
        keptRuleIds: [],
        verifiedAt: watchedFor(30),
        now: watchedFor(60),
      }),
    ).toBeNull();
    expect(findings).toHaveBeenCalledTimes(1);
  });
});
