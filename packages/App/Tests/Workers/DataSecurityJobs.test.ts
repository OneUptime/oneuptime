import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import {
  EVERY_DAY,
  EVERY_FIFTEEN_MINUTE,
  EVERY_FIVE_MINUTE,
  EVERY_HOUR,
} from "Common/Utils/CronTime";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
/*
 * `jest` deliberately NOT imported from @jest/globals: the `jest.Mock`
 * type annotations below must resolve to the same @types/jest global
 * namespace as the jest.fn()/jest.mock() calls (the ThreatIntelJobs pattern).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Data Security's schedule (Workers/Jobs/DataSecurity/DataSecurityJobs.ts)
 * registers purely as a module side effect, so the one import line in
 * Workers/Index.ts is load-bearing, and a job the dictionary does not know
 * - or knows under a name a cron also uses - fails silently. The REAL
 * RunCron, JobDictionary and queue helpers (Utils/DataSecurity/
 * DataSecurityJobs) run here; only the queue underneath them and the work
 * each job hands to - the runner, discovery, the evaluator and OneUptime
 * AI's runs - are stood in for, so what each cron queues and what each job
 * runs can be read back.
 */

const mockAddJob: jest.Mock = jest.fn(() => {
  return Promise.resolve(undefined);
});
const mockListProjectIds: jest.Mock = jest.fn();
const mockDueConnections: jest.Mock = jest.fn();
const mockClaimDueStores: jest.Mock = jest.fn();
const mockScanTelemetry: jest.Mock = jest.fn();
const mockScanStore: jest.Mock = jest.fn();
const mockReadConnection: jest.Mock = jest.fn();
const mockDiscoverProject: jest.Mock = jest.fn();
const mockEvaluateProject: jest.Mock = jest.fn();
const mockSuggestForStore: jest.Mock = jest.fn();
const mockListProvingProjectIds: jest.Mock = jest.fn();
const mockDiscoverDataTypes: jest.Mock = jest.fn();
const mockJudgeStore: jest.Mock = jest.fn();
const mockTuneScans: jest.Mock = jest.fn();
const mockAiEvaluateIssue: jest.Mock = jest.fn();
const mockSendOwnerNotice: jest.Mock = jest.fn();
const mockProposeStoreOwners: jest.Mock = jest.fn();
const mockProposeOwnerRules: jest.Mock = jest.fn();
const mockDraftRecords: jest.Mock = jest.fn();
const mockAssessExposure: jest.Mock = jest.fn();
const mockGroupIssues: jest.Mock = jest.fn();
const mockProposeTelemetryFixes: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock("Common/Server/Utils/DataSecurity/DataSecurityRunner", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/DataSecurity/DataSecurityRunner",
  );

  return {
    ...actual,
    __esModule: true,
    default: {
      listProjectIds: mockListProjectIds,
      dueConnections: mockDueConnections,
      claimDueStores: mockClaimDueStores,
      scanTelemetry: mockScanTelemetry,
      scanStore: mockScanStore,
      readConnection: mockReadConnection,
    },
  };
});

jest.mock("Common/Server/Utils/DataSecurity/DataSecurityDiscovery", () => {
  return {
    __esModule: true,
    default: { discoverProject: mockDiscoverProject },
  };
});

jest.mock("Common/Server/Utils/DataSecurity/DataSecurityEvaluator", () => {
  return {
    __esModule: true,
    default: { evaluateProject: mockEvaluateProject },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/FieldSuggestion", () => {
  return {
    __esModule: true,
    default: { suggestForStore: mockSuggestForStore },
  };
});

/*
 * The work the later jobs hand to (#10364 - #10377): each module's own
 * exports stay, and only the class a job calls is stood in for.
 */
jest.mock("Common/Server/Utils/DataSecurity/DataTypeProving", () => {
  return {
    ...jest.requireActual("Common/Server/Utils/DataSecurity/DataTypeProving"),
    __esModule: true,
    default: { listProvingProjectIds: mockListProvingProjectIds },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/DataTypeDiscovery", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/DataTypeDiscovery",
    ),
    __esModule: true,
    default: { runForProject: mockDiscoverDataTypes },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/FindingVerdicts", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/FindingVerdicts",
    ),
    __esModule: true,
    default: { judgeStore: mockJudgeStore },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/DataSecurityScanTuning", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/DataSecurityScanTuning",
    ),
    __esModule: true,
    default: { proposeForProject: mockTuneScans },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/DataSecurityAiEngine", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/DataSecurityAiEngine",
    ),
    __esModule: true,
    default: { evaluateIssue: mockAiEvaluateIssue },
  };
});

jest.mock("Common/Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/DataSecurityOwnerNotice",
    ),
    __esModule: true,
    default: { send: mockSendOwnerNotice },
  };
});

jest.mock(
  "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun",
  () => {
    return {
      ...jest.requireActual(
        "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerProposalRun",
      ),
      __esModule: true,
      default: { run: mockProposeStoreOwners },
    };
  },
);

jest.mock(
  "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals",
  () => {
    return {
      ...jest.requireActual(
        "Common/Server/Utils/AI/DataSecurity/DataStoreOwnerRuleProposals",
      ),
      __esModule: true,
      default: { proposeForProject: mockProposeOwnerRules },
    };
  },
);

jest.mock(
  "Common/Server/Utils/AI/DataSecurity/RecordOfProcessingDraftRun",
  () => {
    return {
      ...jest.requireActual(
        "Common/Server/Utils/AI/DataSecurity/RecordOfProcessingDraftRun",
      ),
      __esModule: true,
      default: { run: mockDraftRecords },
    };
  },
);

jest.mock("Common/Server/Utils/AI/DataSecurity/ExposureAssessmentRun", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/AI/DataSecurity/ExposureAssessmentRun",
    ),
    __esModule: true,
    default: { run: mockAssessExposure },
  };
});

jest.mock("Common/Server/Utils/DataSecurity/DataSecurityIssueGrouper", () => {
  return {
    ...jest.requireActual(
      "Common/Server/Utils/DataSecurity/DataSecurityIssueGrouper",
    ),
    __esModule: true,
    default: { groupProject: mockGroupIssues },
  };
});

jest.mock(
  "Common/Server/Utils/AI/DataSecurity/TelemetryLeakFixProposals",
  () => {
    return {
      ...jest.requireActual(
        "Common/Server/Utils/AI/DataSecurity/TelemetryLeakFixProposals",
      ),
      __esModule: true,
      default: { proposeForProject: mockProposeTelemetryFixes },
    };
  },
);

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

// Imported AFTER the mocks; the job import comes last - its side effects are the subject.
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import { DATA_SECURITY_TURN_TIME_LIMIT_IN_MS } from "Common/Server/Utils/DataSecurity/DataSecurityRunner";
import {
  DATA_SECURITY_AI_EVALUATE_ISSUE_JOB,
  DATA_SECURITY_ASSESS_EXPOSURE_JOB,
  DATA_SECURITY_DISCOVER_DATA_TYPES_JOB,
  DATA_SECURITY_DISCOVER_PROJECT_JOB,
  DATA_SECURITY_DRAFT_RECORDS_JOB,
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_GROUP_ISSUES_JOB,
  DATA_SECURITY_JUDGE_FINDINGS_JOB,
  DATA_SECURITY_NOTIFY_OWNERS_JOB,
  DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
  DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
  DATA_SECURITY_PROPOSE_TELEMETRY_FIXES_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
  DATA_SECURITY_SCAN_TELEMETRY_JOB,
  DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
  DATA_SECURITY_TUNE_SCANS_JOB,
} from "Common/Server/Utils/DataSecurity/DataSecurityJobs";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import "../../FeatureSet/Workers/Jobs/DataSecurity/DataSecurityJobs";

// Snapshotted at import time; registration happens exactly once.
const registrationAddJobCalls: Array<Array<unknown>> =
  mockAddJob.mock.calls.map((call: Array<unknown>) => {
    return [...call];
  });

const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STORE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const MINUTE_IN_MS: number = 60 * 1000;

interface CronCase {
  name: string;
  schedule: string;
  timeoutInMs: number;
}

const CRONS: Array<CronCase> = [
  {
    name: "DataSecurity:Discover",
    schedule: EVERY_FIFTEEN_MINUTE,
    timeoutInMs: 14 * MINUTE_IN_MS,
  },
  {
    name: "DataSecurity:ReadDueConnections",
    schedule: EVERY_HOUR,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  {
    name: "DataSecurity:ScanDueStores",
    schedule: EVERY_FIVE_MINUTE,
    timeoutInMs: 4 * MINUTE_IN_MS,
  },
  {
    name: "DataSecurity:ScanTelemetry",
    schedule: EVERY_HOUR,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  {
    name: "DataSecurity:EvaluateAll",
    schedule: EVERY_DAY,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  // The drafts of the project's own data types whose proving time ran out (#10371).
  {
    name: "DataSecurity:DecideDataTypes",
    schedule: EVERY_HOUR,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  // Owners for the stores new today (#10374).
  {
    name: "DataSecurity:ProposeStoreOwners",
    schedule: EVERY_DAY,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  // Each project's record of processing, drafted (#10375).
  {
    name: "DataSecurity:DraftRecordsOfProcessing",
    schedule: EVERY_DAY,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
];

const QUEUE_JOBS: Array<{ name: string; timeoutInMs: number }> = [
  { name: DATA_SECURITY_DISCOVER_PROJECT_JOB, timeoutInMs: 10 * MINUTE_IN_MS },
  {
    name: DATA_SECURITY_SCAN_TELEMETRY_JOB,
    timeoutInMs: DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + MINUTE_IN_MS,
  },
  { name: DATA_SECURITY_EVALUATE_PROJECT_JOB, timeoutInMs: 10 * MINUTE_IN_MS },
  {
    name: DATA_SECURITY_SCAN_STORE_JOB,
    timeoutInMs: DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + MINUTE_IN_MS,
  },
  {
    name: DATA_SECURITY_READ_CONNECTION_JOB,
    timeoutInMs: DATA_SECURITY_TURN_TIME_LIMIT_IN_MS + MINUTE_IN_MS,
  },
  // One constrained call to OneUptime AI at most, inside its own 90 seconds.
  {
    name: DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB,
    timeoutInMs: 5 * MINUTE_IN_MS,
  },
  {
    name: DATA_SECURITY_DISCOVER_DATA_TYPES_JOB,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
  { name: DATA_SECURITY_JUDGE_FINDINGS_JOB, timeoutInMs: 5 * MINUTE_IN_MS },
  { name: DATA_SECURITY_TUNE_SCANS_JOB, timeoutInMs: 5 * MINUTE_IN_MS },
  { name: DATA_SECURITY_AI_EVALUATE_ISSUE_JOB, timeoutInMs: 5 * MINUTE_IN_MS },
  { name: DATA_SECURITY_NOTIFY_OWNERS_JOB, timeoutInMs: 5 * MINUTE_IN_MS },
  {
    name: DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
    timeoutInMs: 15 * MINUTE_IN_MS,
  },
  { name: DATA_SECURITY_DRAFT_RECORDS_JOB, timeoutInMs: 30 * MINUTE_IN_MS },
  { name: DATA_SECURITY_ASSESS_EXPOSURE_JOB, timeoutInMs: 5 * MINUTE_IN_MS },
  {
    name: DATA_SECURITY_PROPOSE_OWNER_RULES_JOB,
    timeoutInMs: 5 * MINUTE_IN_MS,
  },
  { name: DATA_SECURITY_GROUP_ISSUES_JOB, timeoutInMs: 10 * MINUTE_IN_MS },
  {
    name: DATA_SECURITY_PROPOSE_TELEMETRY_FIXES_JOB,
    timeoutInMs: 10 * MINUTE_IN_MS,
  },
];

// What the jobs after the first six hand their work to, each stood in for.
const LATER_JOBS_WORK: Array<jest.Mock> = [
  mockDiscoverDataTypes,
  mockJudgeStore,
  mockTuneScans,
  mockAiEvaluateIssue,
  mockSendOwnerNotice,
  mockProposeStoreOwners,
  mockProposeOwnerRules,
  mockDraftRecords,
  mockAssessExposure,
  mockGroupIssues,
  mockProposeTelemetryFixes,
];

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

function jobOf(data: Record<string, string>): QueueJob {
  return { data } as unknown as QueueJob;
}

// What the crons queued since the last reset: [job name, payload, dedup id].
function queuedSinceReset(): Array<[string, Record<string, string>, string]> {
  return mockAddJob.mock.calls.map(
    (call: Array<unknown>): [string, Record<string, string>, string] => {
      const options: { deduplication?: { id: string } } = (call[4] || {}) as {
        deduplication?: { id: string };
      };

      return [
        call[2] as string,
        call[3] as Record<string, string>,
        options.deduplication?.id || "",
      ];
    },
  );
}

beforeEach(() => {
  mockAddJob.mockClear();

  for (const mock of [
    mockListProjectIds,
    mockDueConnections,
    mockClaimDueStores,
    mockScanTelemetry,
    mockScanStore,
    mockReadConnection,
    mockDiscoverProject,
    mockEvaluateProject,
    mockSuggestForStore,
    mockListProvingProjectIds,
    ...LATER_JOBS_WORK,
  ]) {
    mock.mockReset();
  }

  mockListProjectIds.mockResolvedValue([PROJECT_A, PROJECT_B] as never);
  mockDueConnections.mockResolvedValue([] as never);
  mockClaimDueStores.mockResolvedValue([] as never);
  mockScanTelemetry.mockResolvedValue(undefined as never);
  mockScanStore.mockResolvedValue(undefined as never);
  mockReadConnection.mockResolvedValue(undefined as never);
  mockDiscoverProject.mockResolvedValue(0 as never);
  mockEvaluateProject.mockResolvedValue(undefined as never);
  mockSuggestForStore.mockResolvedValue({ asked: 0, written: 0 } as never);
  mockListProvingProjectIds.mockResolvedValue([] as never);

  for (const mock of LATER_JOBS_WORK) {
    mock.mockResolvedValue(undefined as never);
  }
});

describe("Data Security jobs: wired into the worker at all", () => {
  test("Workers/Index.ts imports the job file as a top-level side effect", () => {
    const file: string = path.join(
      WORKERS_DIR,
      "Jobs",
      "DataSecurity",
      "DataSecurityJobs.ts",
    );
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      { encoding: "utf-8" },
    );

    expect(fs.existsSync(file)).toBe(true);
    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/DataSecurity/DataSecurityJobs")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("registering logged no error, so nothing was silently swallowed", () => {
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe("Data Security jobs: the schedule", () => {
  test("every cron is scheduled exactly once, on its schedule, on the worker queue, with no run on startup", () => {
    expect(registrationAddJobCalls).toHaveLength(CRONS.length);

    for (const cron of CRONS) {
      const calls: Array<Array<unknown>> = registrationAddJobCalls.filter(
        (call: Array<unknown>) => {
          return call[2] === cron.name;
        },
      );

      expect({ cron: cron.name, calls: calls.length }).toEqual({
        cron: cron.name,
        calls: 1,
      });
      expect(calls[0]![0]).toBe("Worker");
      expect(calls[0]![1]).toBe(cron.name);
      expect(calls[0]![3]).toEqual({});
      expect(calls[0]![4]).toEqual({ scheduleAt: cron.schedule });
    }
  });

  test("every cron keeps its own timeout", () => {
    for (const cron of CRONS) {
      expect({
        cron: cron.name,
        timeoutInMs: JobDictionary.getTimeoutInMs(cron.name),
      }).toEqual({ cron: cron.name, timeoutInMs: cron.timeoutInMs });
    }
  });

  test("every queue job is in the job dictionary under a name no cron uses, with its own timeout", () => {
    const cronNames: Set<string> = new Set(
      CRONS.map((cron: CronCase): string => {
        return cron.name;
      }),
    );

    expect(
      new Set(
        QUEUE_JOBS.map((job: { name: string }) => {
          return job.name;
        }),
      ).size,
    ).toBe(QUEUE_JOBS.length);

    for (const job of QUEUE_JOBS) {
      expect({ job: job.name, isACronName: cronNames.has(job.name) }).toEqual({
        job: job.name,
        isACronName: false,
      });
      expect(JobDictionary.has(job.name)).toBe(true);
      expect(typeof JobDictionary.getJobFunction(job.name)).toBe("function");
      expect({
        job: job.name,
        timeoutInMs: JobDictionary.getTimeoutInMs(job.name),
      }).toEqual({ job: job.name, timeoutInMs: job.timeoutInMs });
    }
  });
});

describe("Data Security jobs: what each cron queues", () => {
  async function runCron(name: string): Promise<void> {
    const cron: PromiseVoidFunction = JobDictionary.getJobFunction(name);
    await cron();
  }

  test("Discover queues one discovery per project, and discovers nothing itself", async () => {
    await runCron("DataSecurity:Discover");

    expect(mockListProjectIds).toHaveBeenCalledTimes(1);
    expect(mockDiscoverProject).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_DISCOVER_PROJECT_JOB,
        { projectId: PROJECT_A.toString() },
        `data-security-discover-${PROJECT_A.toString()}`,
      ],
      [
        DATA_SECURITY_DISCOVER_PROJECT_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-discover-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("ScanTelemetry queues one telemetry scan per project, and scans nothing itself", async () => {
    await runCron("DataSecurity:ScanTelemetry");

    expect(mockListProjectIds).toHaveBeenCalledTimes(1);
    expect(mockScanTelemetry).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_SCAN_TELEMETRY_JOB,
        { projectId: PROJECT_A.toString() },
        `data-security-telemetry-${PROJECT_A.toString()}`,
      ],
      [
        DATA_SECURITY_SCAN_TELEMETRY_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-telemetry-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("EvaluateAll queues one evaluation per project, so accepted risks expire on time", async () => {
    await runCron("DataSecurity:EvaluateAll");

    expect(mockEvaluateProject).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_EVALUATE_PROJECT_JOB,
        { projectId: PROJECT_A.toString() },
        `data-security-evaluate-${PROJECT_A.toString()}`,
      ],
      [
        DATA_SECURITY_EVALUATE_PROJECT_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-evaluate-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("ReadDueConnections queues a read of each connection that is due", async () => {
    mockDueConnections.mockResolvedValue([
      { projectId: PROJECT_A, cloudConnectionId: CONNECTION_ID },
    ] as never);

    await runCron("DataSecurity:ReadDueConnections");

    expect(mockReadConnection).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_READ_CONNECTION_JOB,
        {
          projectId: PROJECT_A.toString(),
          cloudConnectionId: CONNECTION_ID.toString(),
        },
        `data-security-read-${CONNECTION_ID.toString()}`,
      ],
    ]);
  });

  test("ScanDueStores claims at most 50 stores and queues a scan of each", async () => {
    mockClaimDueStores.mockResolvedValue([
      { projectId: PROJECT_B, dataStoreId: STORE_ID },
    ] as never);

    await runCron("DataSecurity:ScanDueStores");

    expect(mockClaimDueStores).toHaveBeenCalledWith(50);
    expect(mockScanStore).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_SCAN_STORE_JOB,
        {
          projectId: PROJECT_B.toString(),
          dataStoreId: STORE_ID.toString(),
        },
        `data-security-scan-${STORE_ID.toString()}`,
      ],
    ]);
  });

  test("DecideDataTypes queues a data type discovery for each project with drafts being proven, and decides nothing itself", async () => {
    mockListProvingProjectIds.mockResolvedValue([PROJECT_B] as never);

    await runCron("DataSecurity:DecideDataTypes");

    expect(mockListProvingProjectIds).toHaveBeenCalledTimes(1);
    expect(mockListProjectIds).not.toHaveBeenCalled();
    expect(mockDiscoverDataTypes).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_DISCOVER_DATA_TYPES_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-data-types-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("ProposeStoreOwners queues one owner proposal per project, and proposes nothing itself", async () => {
    await runCron("DataSecurity:ProposeStoreOwners");

    expect(mockListProjectIds).toHaveBeenCalledTimes(1);
    expect(mockProposeStoreOwners).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
        { projectId: PROJECT_A.toString() },
        `data-security-owners-${PROJECT_A.toString()}`,
      ],
      [
        DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-owners-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("DraftRecordsOfProcessing queues one draft of each project's record of processing, and drafts nothing itself", async () => {
    await runCron("DataSecurity:DraftRecordsOfProcessing");

    expect(mockListProjectIds).toHaveBeenCalledTimes(1);
    expect(mockDraftRecords).not.toHaveBeenCalled();
    expect(queuedSinceReset()).toEqual([
      [
        DATA_SECURITY_DRAFT_RECORDS_JOB,
        { projectId: PROJECT_A.toString() },
        `data-security-record-drafts-${PROJECT_A.toString()}`,
      ],
      [
        DATA_SECURITY_DRAFT_RECORDS_JOB,
        { projectId: PROJECT_B.toString() },
        `data-security-record-drafts-${PROJECT_B.toString()}`,
      ],
    ]);
  });

  test("a cron with nothing due queues nothing", async () => {
    mockListProjectIds.mockResolvedValue([] as never);

    for (const cron of CRONS) {
      await runCron(cron.name);
    }

    expect(mockAddJob).not.toHaveBeenCalled();
  });

  test("a cron that cannot list what is due fails, so the failure is seen", async () => {
    const failure: Error = new Error("Postgres went away");
    mockListProjectIds.mockRejectedValue(failure as never);

    await expect(runCron("DataSecurity:Discover")).rejects.toThrow(failure);
  });
});

describe("Data Security jobs: what each queue job runs", () => {
  test("DiscoverProject discovers the project its payload names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_DISCOVER_PROJECT_JOB)(
      jobOf({ projectId: PROJECT_A.toString() }),
    );

    expect(mockDiscoverProject).toHaveBeenCalledTimes(1);
    expect(String(mockDiscoverProject.mock.calls[0]![0])).toBe(
      PROJECT_A.toString(),
    );
  });

  test("ScanTelemetry scans the telemetry of the project its payload names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_SCAN_TELEMETRY_JOB)(
      jobOf({ projectId: PROJECT_B.toString() }),
    );

    expect(mockScanTelemetry).toHaveBeenCalledTimes(1);
    expect(String(mockScanTelemetry.mock.calls[0]![0])).toBe(
      PROJECT_B.toString(),
    );
  });

  test("EvaluateProject evaluates the project its payload names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_EVALUATE_PROJECT_JOB)(
      jobOf({ projectId: PROJECT_A.toString() }),
    );

    expect(mockEvaluateProject).toHaveBeenCalledTimes(1);
    expect(String(mockEvaluateProject.mock.calls[0]![0])).toBe(
      PROJECT_A.toString(),
    );
  });

  test("ScanStore scans the store its payload names, in its project", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_SCAN_STORE_JOB)(
      jobOf({
        projectId: PROJECT_A.toString(),
        dataStoreId: STORE_ID.toString(),
      }),
    );

    expect(mockScanStore).toHaveBeenCalledTimes(1);
    expect(mockScanStore.mock.calls[0]!.map(String)).toEqual([
      PROJECT_A.toString(),
      STORE_ID.toString(),
    ]);
  });

  test("ReadConnection reads the connection its payload names, in its project", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_READ_CONNECTION_JOB)(
      jobOf({
        projectId: PROJECT_B.toString(),
        cloudConnectionId: CONNECTION_ID.toString(),
      }),
    );

    expect(mockReadConnection).toHaveBeenCalledTimes(1);
    expect(mockReadConnection.mock.calls[0]!.map(String)).toEqual([
      PROJECT_B.toString(),
      CONNECTION_ID.toString(),
    ]);
  });

  test("SuggestFieldTypes asks about the fields of the store its payload names, in its project", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB)(
      jobOf({
        projectId: PROJECT_B.toString(),
        dataStoreId: STORE_ID.toString(),
      }),
    );

    expect(mockSuggestForStore).toHaveBeenCalledTimes(1);

    const asked: { projectId: ObjectID; dataStoreId: ObjectID } =
      mockSuggestForStore.mock.calls[0]![0] as {
        projectId: ObjectID;
        dataStoreId: ObjectID;
      };

    expect([asked.projectId.toString(), asked.dataStoreId.toString()]).toEqual([
      PROJECT_B.toString(),
      STORE_ID.toString(),
    ]);
    // Asked by a scan, never by a schedule.
    expect(
      registrationAddJobCalls.map((call: Array<unknown>) => {
        return call[2];
      }),
    ).not.toContain(DATA_SECURITY_SUGGEST_FIELD_TYPES_JOB);
  });

  test("DiscoverDataTypes finds and decides the data types of the project its payload names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_DISCOVER_DATA_TYPES_JOB)(
      jobOf({ projectId: PROJECT_A.toString() }),
    );

    expect(mockDiscoverDataTypes).toHaveBeenCalledTimes(1);
    expect(
      String(
        (mockDiscoverDataTypes.mock.calls[0]![0] as { projectId: ObjectID })
          .projectId,
      ),
    ).toBe(PROJECT_A.toString());
  });

  test("ProposeStoreOwners proposes owners for the stores of the project its payload names, or of the cloud connection it names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB)(
      jobOf({ projectId: PROJECT_A.toString() }),
    );
    await JobDictionary.getJobFunction(DATA_SECURITY_PROPOSE_STORE_OWNERS_JOB)(
      jobOf({
        projectId: PROJECT_B.toString(),
        cloudConnectionId: CONNECTION_ID.toString(),
      }),
    );

    expect(
      mockProposeStoreOwners.mock.calls.map(
        (call: Array<unknown>): Array<string | undefined> => {
          const asked: {
            projectId: ObjectID;
            cloudConnectionId?: ObjectID | undefined;
          } = call[0] as {
            projectId: ObjectID;
            cloudConnectionId?: ObjectID | undefined;
          };

          return [
            asked.projectId.toString(),
            asked.cloudConnectionId?.toString(),
          ];
        },
      ),
    ).toEqual([
      [PROJECT_A.toString(), undefined],
      [PROJECT_B.toString(), CONNECTION_ID.toString()],
    ]);
  });

  test("DraftRecords drafts the record of processing of the project its payload names", async () => {
    await JobDictionary.getJobFunction(DATA_SECURITY_DRAFT_RECORDS_JOB)(
      jobOf({ projectId: PROJECT_B.toString() }),
    );

    expect(mockDraftRecords).toHaveBeenCalledTimes(1);
    expect(
      String(
        (mockDraftRecords.mock.calls[0]![0] as { projectId: ObjectID })
          .projectId,
      ),
    ).toBe(PROJECT_B.toString());
  });

  test("a payload without the valid ids a job needs runs nothing; a project job needs only the project's", async () => {
    const payloads: Array<QueueJob | undefined> = [
      undefined,
      jobOf({}),
      jobOf({ projectId: "not-an-id" }),
      jobOf({ projectId: PROJECT_A.toString(), dataStoreId: "../x" }),
      jobOf({ projectId: PROJECT_A.toString(), cloudConnectionId: "" }),
    ];

    for (const job of QUEUE_JOBS) {
      for (const payload of payloads) {
        await expect(
          JobDictionary.getJobFunction(job.name)(payload),
        ).resolves.toBeUndefined();
      }
    }

    expect(mockDiscoverProject).toHaveBeenCalledTimes(2);
    expect(mockScanTelemetry).toHaveBeenCalledTimes(2);
    expect(mockEvaluateProject).toHaveBeenCalledTimes(2);
    expect(mockScanStore).not.toHaveBeenCalled();
    expect(mockReadConnection).not.toHaveBeenCalled();
    expect(mockSuggestForStore).not.toHaveBeenCalled();

    // The later jobs: a project's ran for the two payloads with a valid project.
    expect({
      discoverDataTypes: mockDiscoverDataTypes.mock.calls.length,
      tuneScans: mockTuneScans.mock.calls.length,
      proposeStoreOwners: mockProposeStoreOwners.mock.calls.length,
      draftRecords: mockDraftRecords.mock.calls.length,
      proposeOwnerRules: mockProposeOwnerRules.mock.calls.length,
      groupIssues: mockGroupIssues.mock.calls.length,
      proposeTelemetryFixes: mockProposeTelemetryFixes.mock.calls.length,
      // A store's, an issue's, a held email's and a case's need their own ids too.
      judgeFindings: mockJudgeStore.mock.calls.length,
      aiEvaluateIssue: mockAiEvaluateIssue.mock.calls.length,
      notifyOwners: mockSendOwnerNotice.mock.calls.length,
      assessExposure: mockAssessExposure.mock.calls.length,
    }).toEqual({
      discoverDataTypes: 2,
      tuneScans: 2,
      proposeStoreOwners: 2,
      draftRecords: 2,
      proposeOwnerRules: 2,
      groupIssues: 2,
      proposeTelemetryFixes: 2,
      judgeFindings: 0,
      aiEvaluateIssue: 0,
      notifyOwners: 0,
      assessExposure: 0,
    });
  });

  test("a job whose work fails fails, so the queue sees it", async () => {
    const failure: Error = new Error("The read failed.");
    mockEvaluateProject.mockRejectedValue(failure as never);

    await expect(
      JobDictionary.getJobFunction(DATA_SECURITY_EVALUATE_PROJECT_JOB)(
        jobOf({ projectId: PROJECT_A.toString() }),
      ),
    ).rejects.toThrow(failure);
  });
});
