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
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import DataSecurityIssue from "../../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import LogScrubRule from "../../../../../Models/DatabaseModels/LogScrubRule";
import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../../../Server/Services/DataSecurityIssueService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import DataStoreFindingService from "../../../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../../../Server/Services/DataStoreService";
import LogScrubRuleService from "../../../../../Server/Services/LogScrubRuleService";
import MetricPipelineRuleService from "../../../../../Server/Services/MetricPipelineRuleService";
import TraceScrubRuleService from "../../../../../Server/Services/TraceScrubRuleService";
import DataSecurityFixTarget, {
  DataSecurityFixTargetRead,
} from "../../../../../Server/Utils/AI/CodeFix/DataSecurityFixTarget";
import FixProductionCheckPicker from "../../../../../Server/Utils/AI/CodeFix/FixProductionCheckPicker";
import FixProductionVerifier, {
  VerifierRun,
  isFirstCheckOfTheHour,
} from "../../../../../Server/Utils/AI/CodeFix/FixProductionVerifier";
import StoreConfigurationFixWatch from "../../../../../Server/Utils/AI/CodeFix/StoreConfigurationFixWatch";
import {
  STORE_CONFIGURATION_FIX_THRESHOLDS,
  decideStoreConfigurationVerdict,
  isADayAfterMerge,
  isReadADayAfterMerge,
} from "../../../../../Server/Utils/AI/CodeFix/StoreConfigurationFixVerdict";
import TelemetryLeakFixReads, {
  pickValueCountRows,
  sumValueCountRows,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixReads";
import {
  decideTelemetryLeakBaseline,
  decideTelemetryLeakVerdict,
  hasEnoughTraffic,
} from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixVerdict";
import TelemetryLeakFixWatch from "../../../../../Server/Utils/AI/CodeFix/TelemetryLeakFixWatch";
import DataSecurityAiProposals from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import DataSecurityFixNotAppliedNotice from "../../../../../Server/Utils/DataSecurity/DataSecurityFixNotAppliedNotice";
import DataSecurityIssueAlerts from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueAlerts";
import DataSecurityIssueReconciler, {
  ReconcileStoreOutput,
} from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueReconciler";
import DataSecurityIssueResolutions from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueResolutions";
import { queueDataSecurityConnectionRead } from "../../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import logger from "../../../../../Server/Utils/Logger";
import CodeFixTaskType from "../../../../../Types/AI/CodeFixTaskType";
import FixProductionBaseline, {
  TelemetryLeakFixBaseline,
} from "../../../../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../../../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../../../../Types/AI/FixProductionStatus";
import URL from "../../../../../Types/API/URL";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import {
  DataSecurityCheckStatus,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  getDataSecurityCheck,
} from "../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import DataSecurityIssueResolution, {
  readDataSecurityIssueResolutionDetails,
} from "../../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../../../Types/JSON";
import LogScrubPatternType from "../../../../../Types/Log/LogScrubPatternType";
import ObjectID from "../../../../../Types/ObjectID";
import SecuritySeverity from "../../../../../Types/SecuritySeverity";

/*
 * DATA SECURITY'S FIXES, FOLLOWED TO PRODUCTION (#10368).
 *
 * The two checks' pure verdicts, on recorded deploys and counters - and
 * the issue's four scenarios, through the watches with the database, the
 * counter and the telemetry stood in for:
 *
 *   1. a deployed code fix is marked Fixed in code, with the version;
 *   2. a Terraform fix that was never applied is called out after a day,
 *      once, to the store's owners and the pull request's author;
 *   3. a leak contained by a rule and never fixed in code is resolved as
 *      contained, apart from fixed (the reconciler's suite and the issue
 *      page's suite say how it reads and that it offers the code fix);
 *   4. a regression after a verified fix opens the issue again and names
 *      the version that brought it back.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b4f2e20-0000-4000-8000-000000000001",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "7b4f2e20-0000-4000-8000-000000000002",
);
const STORE_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000003");
const ISSUE_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000004");
const RUN_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000005");
const TASK_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000006");
const FIX_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000007");
const FINDING_ID: ObjectID = new ObjectID(
  "7b4f2e20-0000-4000-8000-000000000008",
);
const RULE_ID: ObjectID = new ObjectID("7b4f2e20-0000-4000-8000-000000000009");
const AUTHOR_ID: ObjectID = new ObjectID(
  "7b4f2e20-0000-4000-8000-00000000000a",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "7b4f2e20-0000-4000-8000-00000000000b",
);

const HOUR: number = 60 * 60 * 1000;
const MERGED_AT: Date = new Date("2026-11-20T10:00:00.000Z");
const DEPLOYED_AT: Date = new Date(MERGED_AT.getTime() + 2 * HOUR);
const GRACE: number = 10 * 60 * 1000;

function hoursAfterMerge(hours: number): Date {
  return new Date(MERGED_AT.getTime() + hours * HOUR);
}

// A check `hours` into the deployed fix's watch, after the rollout grace.
function runAt(now: Date): VerifierRun {
  return {
    now,
    tokens: new Map<string, string | null>(),
    failedCompares: new Set<string>(),
  };
}

function watchedFor(hours: number): Date {
  return new Date(DEPLOYED_AT.getTime() + GRACE + hours * HOUR);
}

function fixOf(
  check: FixProductionCheck,
  overrides: JSONObject = {},
): AIAgentTaskPullRequest {
  return {
    id: FIX_ID,
    _id: FIX_ID.toString(),
    projectId: PROJECT_ID,
    aiRunId: RUN_ID,
    createdAt: hoursAfterMerge(-5),
    pullRequestState: PullRequestState.Merged,
    pullRequestNumber: 482,
    pullRequestUrl: URL.fromString("https://github.com/acme/checkout/pull/482"),
    mergeCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    mergedAt: MERGED_AT,
    productionCheck: check,
    productionStatus: FixProductionStatus.AwaitingDeploy,
    productionStatusAt: MERGED_AT,
    productionSummary:
      "Merged. Waiting for a recorded deploy of the service that contains the fix.",
    repoOrganizationName: "acme",
    repoName: "checkout",
    ...overrides,
  } as unknown as AIAgentTaskPullRequest;
}

// A code fix of a leak in checkout's logs, its email contained by a rule.
const LEAK_BASELINE: TelemetryLeakFixBaseline = {
  serviceId: SERVICE_ID.toString(),
  taskId: TASK_ID.toString(),
  stores: [
    {
      dataStoreId: STORE_ID.toString(),
      kind: DataStoreKind.TelemetryLogs,
      issueIds: [ISSUE_ID.toString()],
      places: [
        {
          findingId: FINDING_ID.toString(),
          dataTypeId: "email-address",
          location: "attributes.user.email",
          scrubRuleIds: [RULE_ID.toString()],
          lastSeenAt: hoursAfterMerge(-3).toISOString(),
        },
      ],
      recordsBefore: 4210,
      recordsBeforeHour: hoursAfterMerge(-3).toISOString(),
    },
  ],
  valuesChangedBefore: 1204,
  from: hoursAfterMerge(-7 * 24).toISOString(),
  to: MERGED_AT.toISOString(),
};

function watchingLeakFix(overrides: JSONObject = {}): AIAgentTaskPullRequest {
  return fixOf(FixProductionCheck.TelemetryLeak, {
    productionStatus: FixProductionStatus.Watching,
    productionSummary: "still watching",
    deployedAt: DEPLOYED_AT,
    deployedVersion: "2.4.1",
    productionBaseline: { telemetryLeak: LEAK_BASELINE } as unknown as JSONObject,
    ...overrides,
  });
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
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  (queueDataSecurityConnectionRead as jest.Mock).mockClear();
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
 * The telemetry leak check's verdicts
 * ---------------------------------------------------------------------------
 */

describe("a telemetry leak's code fix, by what its new version wrote", () => {
  const traffic: { noun: string; since: number; before: number } = {
    noun: "logs",
    since: 4300,
    before: 4210,
  };

  function decide(
    hours: number,
    measure: Partial<Parameters<typeof decideTelemetryLeakVerdict>[0]["measure"]>,
  ): ReturnType<typeof decideTelemetryLeakVerdict> {
    return decideTelemetryLeakVerdict({
      deployedAt: DEPLOYED_AT,
      now: watchedFor(hours),
      deployLabel: "version 2.4.1",
      measure: {
        valuesChanged: 0,
        recordsRead: 0,
        recordsWithData: 0,
        hasRules: true,
        hasUncoveredPlaces: false,
        traffic: [traffic],
        ...measure,
      },
    });
  }

  test("one value its rule changed in the new version is a fix that did not stop it", () => {
    expect(decide(2, { valuesChanged: 12 })).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        "The scrub rules that contain this leak changed 12 values in version 2.4.1 after it shipped the fix: the code still writes the data.",
    });
    expect(decide(2, { valuesChanged: 1 }).summary).toContain("changed 1 value in");
  });

  test("a record of the new version that still holds the data is too", () => {
    expect(
      decide(2, {
        hasRules: false,
        hasUncoveredPlaces: true,
        recordsRead: 40,
        recordsWithData: 3,
      }),
    ).toEqual({
      status: FixProductionStatus.Regressed,
      summary:
        "Version 2.4.1 still writes the data: 3 of its records held it after it shipped the fix.",
    });
  });

  test("silence counts only after a day - however much it sent", () => {
    const early: ReturnType<typeof decideTelemetryLeakVerdict> = decide(23, {});

    expect(early.status).toBe(FixProductionStatus.Watching);
    // Worded the same on every check that learns nothing.
    expect(decide(5, {})).toEqual(early);
    expect(early.summary).toBe(
      "Version 2.4.1 shipped the fix, and has written none of the data since. It counts as fixed once it has run a day and sent 4,210 logs, as the old version did in the hour the leak was last seen.",
    );
  });

  test("and only over as much traffic as the old version had in the leak's hour", () => {
    expect(
      decide(30, { traffic: [{ ...traffic, since: 4000 }] }).status,
    ).toBe(FixProductionStatus.Watching);
    expect(decide(25, {})).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        "In the 25 hours since version 2.4.1 shipped the fix, the scrub rules that contain it changed no value in 4,300 logs - at least the 4,210 logs the old version sent in the hour the leak was last seen.",
    });
  });

  test("says how it was told: the rule's counter, the records, or both", () => {
    expect(
      decide(25, { hasRules: false, hasUncoveredPlaces: true }).summary,
    ).toContain("none of its records held the data in 4,300 logs");
    expect(decide(25, { hasUncoveredPlaces: true }).summary).toContain(
      "changed no value, and none of its records held the data",
    );
  });

  test("every store of the fix must send enough: logs and spans", () => {
    const both: ReturnType<typeof decideTelemetryLeakVerdict> = decide(25, {
      traffic: [traffic, { noun: "spans", since: 100, before: 980 }],
    });

    expect(both.status).toBe(FixProductionStatus.Watching);
    expect(both.summary).toContain("4,210 logs and 980 spans");
    expect(
      hasEnoughTraffic([traffic, { noun: "spans", since: 980, before: 980 }]),
    ).toBe(true);
  });

  test("a version too quiet for a week cannot be told", () => {
    expect(
      decide(7 * 24, { traffic: [{ ...traffic, since: 900 }] }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "Version 2.4.1 wrote none of the data in the 7 days after it shipped the fix, but sent only 900 logs, fewer than the 4,210 logs the old version sent in the hour the leak was last seen: too little to tell.",
    });
  });

  test("a fix whose issue has no place to watch, or only metrics and replays, cannot be told", () => {
    expect(
      decideTelemetryLeakBaseline({ placeCount: 0, unreadablePlaceCount: 0 })
        ?.status,
    ).toBe(FixProductionStatus.Unverifiable);
    expect(
      decideTelemetryLeakBaseline({ placeCount: 3, unreadablePlaceCount: 3 })
        ?.summary,
    ).toContain("a metric or a session replay");
    expect(
      decideTelemetryLeakBaseline({ placeCount: 3, unreadablePlaceCount: 1 }),
    ).toBeNull();
  });
});

describe("the scrub rule counter, read for a version", () => {
  const since: Date = new Date(DEPLOYED_AT.getTime() + GRACE);
  const hourOfSince: Date = new Date(
    Math.floor(since.getTime() / HOUR) * HOUR,
  );

  test("reads the service's rows of the version, and the hour it starts in only for what changed after", () => {
    const rows: Parameters<typeof pickValueCountRows>[0]["rows"] = [
      // Before the grace ended, in the hour it ends in: the old pods.
      {
        scrubRuleId: RULE_ID.toString(),
        serviceId: SERVICE_ID.toString().toUpperCase(),
        serviceVersion: "2.3.0",
        hour: hourOfSince,
        valueCount: 40,
        lastChangedAt: new Date(since.getTime() - 60 * 1000),
      },
      {
        scrubRuleId: RULE_ID.toString(),
        serviceId: SERVICE_ID.toString(),
        serviceVersion: "2.4.1",
        hour: new Date(hourOfSince.getTime() + HOUR),
        valueCount: 3,
        lastChangedAt: new Date(hourOfSince.getTime() + HOUR + 5000),
      },
      // Another service's.
      {
        scrubRuleId: RULE_ID.toString(),
        serviceId: ObjectID.generate().toString(),
        serviceVersion: "2.4.1",
        hour: new Date(hourOfSince.getTime() + HOUR),
        valueCount: 99,
        lastChangedAt: new Date(hourOfSince.getTime() + HOUR),
      },
    ];

    expect(
      sumValueCountRows(
        pickValueCountRows({ rows, serviceId: SERVICE_ID.toString(), since }),
      ),
    ).toEqual({ valuesChanged: 3, versions: ["2.4.1"] });
    expect(
      pickValueCountRows({
        rows,
        serviceId: SERVICE_ID.toString(),
        since,
        version: "2.3.0",
      }),
    ).toEqual([]);
  });

  test("names the version that changed the most first", () => {
    expect(
      sumValueCountRows([
        {
          scrubRuleId: "a",
          serviceId: "s",
          serviceVersion: "2.5.0",
          valueCount: 30,
          lastChangedAt: null,
        },
        {
          scrubRuleId: "a",
          serviceId: "s",
          serviceVersion: "2.4.1",
          valueCount: 2,
          lastChangedAt: null,
        },
      ]),
    ).toEqual({ valuesChanged: 32, versions: ["2.5.0", "2.4.1"] });
  });

  test("a store's records are counted in its version, bound as a parameter; a metric's cannot be", () => {
    const built: ReturnType<
      typeof TelemetryLeakFixReads.buildRecordCountStatement
    > = TelemetryLeakFixReads.buildRecordCountStatement({
      projectId: PROJECT_ID,
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE_ID.toString(),
      since,
      until: watchedFor(25),
      version: "2.4.1'; DROP TABLE Log; --",
    });
    const json: JSONObject = built!.statement.toJSON() as JSONObject;

    expect(JSON.stringify(json)).toContain("resource.service.version");
    // The version is a parameter, never written into the query.
    expect(String(json["query"])).not.toContain("DROP TABLE");
    expect(
      TelemetryLeakFixReads.buildRecordCountStatement({
        projectId: PROJECT_ID,
        kind: DataStoreKind.TelemetryMetrics,
        serviceId: SERVICE_ID.toString(),
        since,
        until: watchedFor(25),
      }),
    ).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The store configuration check's verdicts
 * ---------------------------------------------------------------------------
 */

describe("a fix in infrastructure code, by where its issues stand", () => {
  test("every issue applied is Verified", () => {
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(3),
        counts: { applied: 40, open: 0, openAfterADay: 0, notThisFix: 2 },
      }),
    ).toEqual({
      status: FixProductionStatus.Verified,
      summary:
        "Applied: each of the 40 stores, read again after the merge, passes its check.",
    });
  });

  test("open within the day: waiting for the change to be applied, saying how many pass", () => {
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(3),
        counts: { applied: 0, open: 1, openAfterADay: 0, notThisFix: 0 },
      }),
    ).toEqual({
      status: FixProductionStatus.AwaitingDeploy,
      summary:
        "Merged. Waiting for the change to be applied: 1 store still fails its check.",
    });
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(3),
        counts: { applied: 3, open: 1, openAfterADay: 0, notThisFix: 0 },
      }),
    ).toEqual({
      status: FixProductionStatus.Watching,
      summary:
        "Merged. Waiting for the change to be applied: 1 store still fails its check. 3 stores of 4 pass their check now.",
    });
  });

  test("still failing when read a day after the merge: merged, not applied", () => {
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(25),
        counts: { applied: 0, open: 2, openAfterADay: 2, notThisFix: 0 },
      }).summary,
    ).toBe(
      "Merged, not applied: a day after the merge, 2 stores still fail their check when read again. An apply is usually what is missing.",
    );
  });

  test("never applied in the time a deploy is waited for: Unverifiable", () => {
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(STORE_CONFIGURATION_FIX_THRESHOLDS.maxWaitDays * 24),
        counts: { applied: 0, open: 1, openAfterADay: 1, notThisFix: 0 },
      }),
    ).toEqual({
      status: FixProductionStatus.Unverifiable,
      summary:
        "1 store of 1 still failed its check 14 days after the merge: the change was never applied, or did not fix the check.",
    });
  });

  test("nothing left for it to fix - accepted, set aside, fixed from here - cannot be told", () => {
    expect(
      decideStoreConfigurationVerdict({
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(3),
        counts: { applied: 0, open: 0, openAfterADay: 0, notThisFix: 3 },
      }).status,
    ).toBe(FixProductionStatus.Unverifiable);
  });

  test("a read counts as a day after the merge once it was, and its evaluation had time to follow", () => {
    expect(
      isReadADayAfterMerge({
        readAt: hoursAfterMerge(24.5),
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(25),
      }),
    ).toBe(true);
    // The read a minute ago: its evaluation may not have run.
    expect(
      isReadADayAfterMerge({
        readAt: hoursAfterMerge(24.99),
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(25),
      }),
    ).toBe(false);
    expect(
      isReadADayAfterMerge({
        readAt: hoursAfterMerge(23),
        mergedAt: MERGED_AT,
        now: hoursAfterMerge(25),
      }),
    ).toBe(false);
    expect(
      isReadADayAfterMerge({ readAt: null, mergedAt: MERGED_AT, now: hoursAfterMerge(25) }),
    ).toBe(false);
    expect(isADayAfterMerge({ mergedAt: MERGED_AT, now: hoursAfterMerge(23) })).toBe(
      false,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Which check follows a merged pull request
 * ---------------------------------------------------------------------------
 */

describe("which check follows a merged pull request", () => {
  function runOf(overrides: JSONObject): AIRun {
    return {
      id: RUN_ID,
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      codeFixTaskType: CodeFixTaskType.CodeRequest,
      ...overrides,
    } as unknown as AIRun;
  }

  function issueOnStore(kind: DataStoreKind): void {
    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([
        Object.assign(new DataSecurityIssue(ISSUE_ID), { dataStoreId: STORE_ID }),
      ] as never);
    jest
      .spyOn(DataStoreService, "findOneBy")
      .mockResolvedValue(Object.assign(new DataStore(STORE_ID), { kind }) as never);
  }

  test("a request in Code asked from a telemetry issue is a leak in code; from a bucket's, a store's configuration", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      runOf({ triggeredByDataSecurityIssueId: ISSUE_ID, userId: AUTHOR_ID }) as never,
    );
    issueOnStore(DataStoreKind.TelemetryLogs);

    expect(
      await FixProductionCheckPicker.forRun({
        aiRunId: RUN_ID,
        taskType: CodeFixTaskType.CodeRequest,
      }),
    ).toBe(FixProductionCheck.TelemetryLeak);

    issueOnStore(DataStoreKind.AwsS3Bucket);

    const target: DataSecurityFixTargetRead | null =
      await DataSecurityFixTarget.read(RUN_ID);

    expect(target?.check).toBe(FixProductionCheck.StoreConfiguration);
    expect(target?.askedByUserId?.toString()).toBe(AUTHOR_ID.toString());
  });

  test("a reply's pull request is its task's: the first turn holds the issue", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(runOf({ codeTaskId: TASK_ID }) as never);
    const taskRead: jest.SpyInstance = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(
        runOf({
          id: TASK_ID,
          _id: TASK_ID.toString(),
          triggeredByDataSecurityIssueId: ISSUE_ID,
        }) as never,
      );

    issueOnStore(DataStoreKind.TelemetryTraces);

    const target: DataSecurityFixTargetRead | null =
      await DataSecurityFixTarget.read(RUN_ID);

    expect(
      (taskRead.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ _id: TASK_ID.toString(), projectId: PROJECT_ID });
    expect(target?.taskId.toString()).toBe(TASK_ID.toString());
    expect(target?.check).toBe(FixProductionCheck.TelemetryLeak);
  });

  test("a group's one pull request lists its stores' issues, and is a store's configuration", async () => {
    const other: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([
        new DataSecurityIssue(ISSUE_ID),
        new DataSecurityIssue(other),
      ] as never);

    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      runOf({
        codeFixTaskType: CodeFixTaskType.FixInfrastructureCode,
        taskContext: {
          infrastructureFix: {
            groupId: ObjectID.generate().toString(),
            checkId: "access-not-logged",
            title: "Turn on access logging",
            cause: "the static-site module",
            request: "Turn on access logging in the module.",
            storeCount: 2,
            stores: [
              { name: "site-a", issueId: ISSUE_ID.toString() },
              { name: "site-b", issueId: other.toString() },
            ],
          },
        },
      }) as never,
    );

    const target: DataSecurityFixTargetRead | null =
      await DataSecurityFixTarget.read(RUN_ID);

    expect(target?.check).toBe(FixProductionCheck.StoreConfiguration);
    expect(target?.issueIds.map(String)).toEqual(
      [ISSUE_ID, other].map(String),
    );
    // Held to the run's project.
    expect(
      (findBy.mock.calls[0]![0] as { query: JSONObject }).query["projectId"],
    ).toBe(PROJECT_ID);
  });

  test("a task that names no Data Security issue is watched by its recipe, and a read that fails too", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(runOf({}) as never);

    expect(
      await FixProductionCheckPicker.forRun({
        aiRunId: RUN_ID,
        taskType: CodeFixTaskType.CodeRequest,
      }),
    ).toBeNull();

    jest
      .spyOn(AIRunService, "findOneById")
      .mockRejectedValue(new Error("Postgres is down"));

    expect(
      await FixProductionCheckPicker.forRun({
        aiRunId: RUN_ID,
        taskType: CodeFixTaskType.FixException,
      }),
    ).toBe(FixProductionCheck.Exception);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Scenario 1: a deployed code fix is marked Fixed in code, with the version
 * ---------------------------------------------------------------------------
 */

describe("scenario: a code fix of a leak, merged and deployed", () => {
  function rulesExist(): void {
    jest
      .spyOn(LogScrubRuleService, "findBy")
      .mockResolvedValue([
        Object.assign(new LogScrubRule(RULE_ID), {
          name: "Data Security: Email address in log attributes of checkout",
        }),
      ] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
  }

  test("its first check reads the issue's places, the rule hiding each, and the old version's traffic in the leak's hour", async () => {
    const lastSeen: Date = hoursAfterMerge(-3);

    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([
      Object.assign(new DataSecurityIssue(ISSUE_ID), {
        dataStoreId: STORE_ID,
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
      }),
    ] as never);
    jest.spyOn(DataStoreService, "findBy").mockResolvedValue([
      Object.assign(new DataStore(STORE_ID), {
        kind: DataStoreKind.TelemetryLogs,
        serviceId: SERVICE_ID,
      }),
    ] as never);
    jest.spyOn(DataStoreFindingService, "findBy").mockResolvedValue([
      Object.assign(new DataStoreFinding(FINDING_ID), {
        dataTypeId: "email-address",
        location: "attributes.user.email",
        confidence: DataConfidence.High,
        matchCount: 12,
        isScrubbed: true,
        lastSeenAt: lastSeen,
      }),
    ] as never);
    // The built-in email pattern, for this service: it hides the finding.
    jest.spyOn(LogScrubRuleService, "findBy").mockResolvedValue([
      Object.assign(new LogScrubRule(RULE_ID), {
        name: "Data Security: Email address in log attributes of checkout",
        patternType: LogScrubPatternType.Email,
        serviceId: SERVICE_ID,
      }),
    ] as never);
    jest.spyOn(TraceScrubRuleService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(MetricPipelineRuleService, "findBy").mockResolvedValue([] as never);
    const counts: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "countRecords")
      .mockResolvedValue(4210);

    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 1204, versions: ["2.3.0"] });

    const baseline: TelemetryLeakFixBaseline | ReturnType<
      typeof decideTelemetryLeakVerdict
    > = await TelemetryLeakFixWatch.readBaseline({
      fix: fixOf(FixProductionCheck.TelemetryLeak),
      target: {
        check: FixProductionCheck.TelemetryLeak,
        issueIds: [ISSUE_ID],
        taskId: TASK_ID,
      },
      mergedAt: MERGED_AT,
      now: hoursAfterMerge(1),
    });

    expect(baseline).toMatchObject({
      serviceId: SERVICE_ID.toString(),
      taskId: TASK_ID.toString(),
      valuesChangedBefore: 1204,
      stores: [
        {
          dataStoreId: STORE_ID.toString(),
          kind: DataStoreKind.TelemetryLogs,
          issueIds: [ISSUE_ID.toString()],
          places: [
            {
              findingId: FINDING_ID.toString(),
              dataTypeId: "email-address",
              location: "attributes.user.email",
              scrubRuleIds: [RULE_ID.toString()],
            },
          ],
          recordsBefore: 4210,
        },
      ],
    });
    // The hour the leak was last seen, whole.
    expect(counts.mock.calls[0]![0]).toMatchObject({
      kind: DataStoreKind.TelemetryLogs,
      serviceId: SERVICE_ID.toString(),
      since: new Date(Math.floor(lastSeen.getTime() / HOUR) * HOUR),
    });
  });

  test("a day into its version, with as much traffic and nothing changed: Fixed in code, version 2.4.1", async () => {
    rulesExist();
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    const changed: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 0, versions: [] });

    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(4300);
    const marked: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInCode")
      .mockResolvedValue([ISSUE_ID]);

    await TelemetryLeakFixWatch.verify(watchingLeakFix(), runAt(watchedFor(25)));

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
    // The rule's counter, read in the deployed version only.
    expect(changed.mock.calls[0]![0]).toMatchObject({
      serviceId: SERVICE_ID.toString(),
      scrubRuleIds: [RULE_ID.toString()],
      since: DEPLOYED_AT,
      version: "2.4.1",
    });
    expect(marked).toHaveBeenCalledTimes(1);
    expect(marked.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      issueIds: [ISSUE_ID],
      fix: {
        pullRequestId: FIX_ID.toString(),
        taskId: TASK_ID.toString(),
        number: 482,
        url: "https://github.com/acme/checkout/pull/482",
        version: "2.4.1",
        deployedAt: DEPLOYED_AT.toISOString(),
      },
      verifiedAt: watchedFor(25),
      keptRules: [
        {
          id: RULE_ID.toString(),
          signal: "log",
          name: "Data Security: Email address in log attributes of checkout",
        },
      ],
      findingIds: [FINDING_ID],
    });
  });

  test("its rule changing values in the new version: the fix did not stop it, and the issue says so", async () => {
    jest
      .spyOn(FixProductionVerifier, "versionToRead")
      .mockResolvedValue("2.4.1");
    jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 12, versions: ["2.4.1"] });
    jest.spyOn(TelemetryLeakFixReads, "countRecords").mockResolvedValue(10);
    const noted: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "noteOnIssues")
      .mockResolvedValue();
    const marked: jest.SpyInstance = jest.spyOn(
      DataSecurityIssueResolutions,
      "markFixedInCode",
    );

    await TelemetryLeakFixWatch.verify(watchingLeakFix(), runAt(watchedFor(2)));

    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Regressed,
    );
    expect(marked).not.toHaveBeenCalled();
    expect(noted.mock.calls[0]![0]).toMatchObject({
      issueIds: [new ObjectID(ISSUE_ID.toString())],
      eventType: DataSecurityIssueFeedEventType.FixRegressed,
    });
    expect(
      (noted.mock.calls[0]![0] as { markdown: { toString(): string } }).markdown.toString(),
    ).toContain("did not stop the leak");
  });

  test("between hourly reads, a check reads nothing", async () => {
    const changed: jest.SpyInstance = jest.spyOn(
      TelemetryLeakFixReads,
      "readValuesChanged",
    );

    // 25 hours and 30 minutes in: not the first check of the hour.
    await TelemetryLeakFixWatch.verify(
      watchingLeakFix(),
      runAt(new Date(watchedFor(25).getTime() + 30 * 60 * 1000)),
    );

    expect(changed).not.toHaveBeenCalled();
    expect(pullRequestWrites).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Scenario 2: a Terraform fix that was never applied is called out after a day
 * ---------------------------------------------------------------------------
 */

describe("scenario: a Terraform fix merged and never applied", () => {
  let issueRow: DataSecurityIssue;
  let storeRow: DataStore;

  beforeEach(() => {
    issueRow = Object.assign(new DataSecurityIssue(ISSUE_ID), {
      dataStoreId: STORE_ID,
      checkId: "public-read",
      status: DataSecurityIssueStatus.Open,
    });
    storeRow = Object.assign(new DataStore(STORE_ID), {
      cloudConnectionId: CONNECTION_ID,
      configurationReadAt: hoursAfterMerge(-2),
    });

    jest.spyOn(DataSecurityFixTarget, "read").mockResolvedValue({
      check: FixProductionCheck.StoreConfiguration,
      issueIds: [ISSUE_ID],
      taskId: TASK_ID,
      askedByUserId: AUTHOR_ID,
    });
    jest.spyOn(DataSecurityIssueService, "findBy").mockImplementation((async () => {
      return [issueRow];
    }) as never);
    jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
      return [storeRow];
    }) as never);
    jest.spyOn(DataSecurityIssueResolutions, "noteOnIssues").mockResolvedValue();
  });

  test("on merge, the store is read again at once and the issue says the fix merged; a day later it is called out, once", async () => {
    const notice: jest.SpyInstance = jest
      .spyOn(DataSecurityFixNotAppliedNotice, "send")
      .mockResolvedValue(2);
    const fix: AIAgentTaskPullRequest = fixOf(
      FixProductionCheck.StoreConfiguration,
    );

    // The first check, an hour after the merge: read at once, as Check Now.
    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(1)));

    expect(queueDataSecurityConnectionRead).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudConnectionId: CONNECTION_ID,
    });
    expect(fix.productionBaseline?.storeConfiguration).toMatchObject({
      issues: [
        {
          issueId: ISSUE_ID.toString(),
          dataStoreId: STORE_ID.toString(),
          checkId: "public-read",
        },
      ],
      taskId: TASK_ID.toString(),
      askedByUserId: AUTHOR_ID.toString(),
    });
    expect(lastVerdict()).toMatchObject({
      productionStatus: FixProductionStatus.AwaitingDeploy,
      productionSummary:
        "Merged. Waiting for the change to be applied: 1 store still fails its check.",
    });
    expect(notice).not.toHaveBeenCalled();

    // A day later, before any read made since: it is read once more first.
    (queueDataSecurityConnectionRead as jest.Mock).mockClear();
    fix.productionStatus = FixProductionStatus.AwaitingDeploy;
    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(24.2)));

    expect(queueDataSecurityConnectionRead).toHaveBeenCalledTimes(1);
    expect(fix.productionBaseline?.storeConfiguration?.dayReadAskedAt).toBe(
      hoursAfterMerge(24.2).toISOString(),
    );
    expect(notice).not.toHaveBeenCalled();

    // That read still finds it failing: merged, not applied - told once.
    storeRow.configurationReadAt = hoursAfterMerge(24.5);
    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(25)));

    expect(lastVerdict()["productionSummary"]).toBe(
      "Merged, not applied: a day after the merge, 1 store still fails its check when read again. An apply is usually what is missing.",
    );
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      fix: { pullRequestId: FIX_ID.toString(), number: 482 },
      issues: [
        { issueId: ISSUE_ID, dataStoreId: STORE_ID, checkId: "public-read" },
      ],
      authorUserId: AUTHOR_ID,
    });

    // The next check, and the one after: nobody is told again.
    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(26)));
    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(48)));

    expect(notice).toHaveBeenCalledTimes(1);
  });

  test("applied after all: the issue resolved by its check passing is Fixed in infrastructure code, and the fix Verified", async () => {
    const marked: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueResolutions, "markFixedInInfrastructureCode")
      .mockResolvedValue([ISSUE_ID]);
    const fix: AIAgentTaskPullRequest = fixOf(
      FixProductionCheck.StoreConfiguration,
      {
        productionBaseline: {
          storeConfiguration: {
            issues: [
              {
                issueId: ISSUE_ID.toString(),
                dataStoreId: STORE_ID.toString(),
                checkId: "public-read",
              },
            ],
            taskId: TASK_ID.toString(),
            askedByUserId: AUTHOR_ID.toString(),
          },
        } as unknown as JSONObject,
      },
    );

    Object.assign(issueRow, {
      status: DataSecurityIssueStatus.Resolved,
      resolution: DataSecurityIssueResolution.CheckPassed,
      resolvedAt: hoursAfterMerge(30),
    });

    await StoreConfigurationFixWatch.verify(fix, runAt(hoursAfterMerge(31)));

    expect(marked.mock.calls[0]![0]).toMatchObject({
      issueIds: [ISSUE_ID],
      fix: { pullRequestId: FIX_ID.toString(), taskId: TASK_ID.toString() },
    });
    expect(lastVerdict()["productionStatus"]).toBe(
      FixProductionStatus.Verified,
    );
  });

  test("fixed from here before it was applied: not this fix's to claim", () => {
    expect(
      StoreConfigurationFixWatch.standingOf({
        issue: Object.assign(new DataSecurityIssue(ISSUE_ID), {
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.FixedFromHere,
          resolvedAt: hoursAfterMerge(3),
        }),
        store: storeRow,
        mergedAt: MERGED_AT,
      }),
    ).toBe("NotThisFix");
    // A person's Mark Resolved counts once a read since left it resolved.
    expect(
      StoreConfigurationFixWatch.standingOf({
        issue: Object.assign(new DataSecurityIssue(ISSUE_ID), {
          status: DataSecurityIssueStatus.Resolved,
          resolution: DataSecurityIssueResolution.ResolvedByPerson,
          resolvedAt: hoursAfterMerge(3),
        }),
        store: Object.assign(new DataStore(STORE_ID), {
          configurationReadAt: hoursAfterMerge(4),
        }),
        mergedAt: MERGED_AT,
      }),
    ).toBe("Applied");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Scenario 4: a regression after a verified fix opens the issue again,
 * naming the version that brought it back
 * ---------------------------------------------------------------------------
 */

describe("scenario: the leak comes back after its fix was verified", () => {
  test("the kept rule changing values in version 2.5.0 opens the issue again, saying 2.5.0 brought it back", async () => {
    const verifiedAt: Date = watchedFor(25);
    const fixedIssue: DataSecurityIssue = Object.assign(
      new DataSecurityIssue(ISSUE_ID),
      {
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        checkId: SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
        title: getDataSecurityCheck(SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID)!.title,
        status: DataSecurityIssueStatus.Resolved,
        severity: SecuritySeverity.High,
        riskScore: 60,
        resolution: DataSecurityIssueResolution.FixedInCode,
        resolutionDetails: {
          at: verifiedAt.toISOString(),
          fix: {
            pullRequestId: FIX_ID.toString(),
            number: 482,
            url: "https://github.com/acme/checkout/pull/482",
            version: "2.4.1",
          },
          scrubRules: [
            { id: RULE_ID.toString(), signal: "log", name: "Email rule" },
          ],
        },
      },
    );

    jest
      .spyOn(DataSecurityIssueService, "findBy")
      .mockResolvedValue([fixedIssue] as never);
    const counter: jest.SpyInstance = jest
      .spyOn(TelemetryLeakFixReads, "readValuesChanged")
      .mockResolvedValue({ valuesChanged: 37, versions: ["2.5.0"] });
    const written: jest.SpyInstance = jest
      .spyOn(DataSecurityIssueService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    const findings: jest.SpyInstance = jest
      .spyOn(DataStoreFindingService, "updateBy")
      .mockResolvedValue(undefined as never);

    await TelemetryLeakFixWatch.watchVerifiedFix(
      fixOf(FixProductionCheck.TelemetryLeak, {
        productionStatus: FixProductionStatus.Verified,
        productionBaseline: {
          telemetryLeak: LEAK_BASELINE,
        } as unknown as JSONObject,
      }),
      runAt(new Date(verifiedAt.getTime() + 10 * 24 * HOUR)),
    );

    // The kept rule's counter, since the fix was verified, in every version.
    expect(counter.mock.calls[0]![0]).toMatchObject({
      scrubRuleIds: [RULE_ID.toString()],
      since: verifiedAt,
    });
    expect(
      (counter.mock.calls[0]![0] as { version?: string }).version,
    ).toBeUndefined();

    const details: JSONObject = (
      written.mock.calls[0]![0] as { data: JSONObject }
    ).data["resolutionDetails"] as JSONObject;

    expect(readDataSecurityIssueResolutionDetails(details).regression).toMatchObject({
      version: "2.5.0",
      fix: { number: 482, version: "2.4.1" },
    });
    // Its findings count again.
    expect(findings.mock.calls[0]![0]).toMatchObject({
      data: { fixedAt: null },
    });

    // The next evaluation opens it again, naming the version, with the rule still hiding it.
    jest.spyOn(DataSecurityIssueService, "updateOneById").mockResolvedValue(
      undefined as never,
    );
    const feed: jest.SpyInstance = jest.spyOn(
      DataSecurityIssueFeedService,
      "createDataSecurityIssueFeedItem",
    );
    const output: ReconcileStoreOutput =
      await DataSecurityIssueReconciler.reconcileStore({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        exposure: DataStoreExposure.Private,
        estimatedRecords: null,
        isProduction: true,
        hasRecentSecurityActivity: false,
        dataTypeIds: ["email-address"],
        checks: [
          {
            check: getDataSecurityCheck(SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID)!,
            result: { status: DataSecurityCheckStatus.Pass },
            severity: null,
          },
        ],
        existingIssues: [
          Object.assign(fixedIssue, { resolutionDetails: details }),
        ],
        containedCheckIds: new Set([SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID]),
        now: new Date(verifiedAt.getTime() + 10 * 24 * HOUR),
      });

    expect(output.opened).toHaveLength(1);
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("The leak came back in version 2.5.0");
  });

  test("an issue another fix fixed since, or one already back, is that fix's to watch", async () => {
    jest.spyOn(DataSecurityIssueService, "findBy").mockResolvedValue([
      Object.assign(new DataSecurityIssue(ISSUE_ID), {
        dataStoreId: STORE_ID,
        status: DataSecurityIssueStatus.Resolved,
        resolution: DataSecurityIssueResolution.FixedInCode,
        resolutionDetails: {
          at: watchedFor(25).toISOString(),
          fix: { pullRequestId: ObjectID.generate().toString() },
        },
      }),
    ] as never);
    const counter: jest.SpyInstance = jest.spyOn(
      TelemetryLeakFixReads,
      "readValuesChanged",
    );

    await TelemetryLeakFixWatch.watchVerifiedFix(
      fixOf(FixProductionCheck.TelemetryLeak, {
        productionStatus: FixProductionStatus.Verified,
        productionBaseline: {
          telemetryLeak: LEAK_BASELINE,
        } as unknown as FixProductionBaseline as unknown as JSONObject,
      }),
      runAt(watchedFor(30)),
    );

    expect(counter).not.toHaveBeenCalled();
  });

  test("verified fixes are watched at the first check of each hour", () => {
    expect(isFirstCheckOfTheHour(new Date("2026-11-21T14:05:00.000Z"))).toBe(
      true,
    );
    expect(isFirstCheckOfTheHour(new Date("2026-11-21T14:20:00.000Z"))).toBe(
      false,
    );
  });
});
