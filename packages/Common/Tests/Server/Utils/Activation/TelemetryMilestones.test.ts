import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The first telemetry of each kind (issue #6830): marked by the fan-in
 * writer once ClickHouse has accepted a submission's rows, for the projects
 * the rows belong to - never for a submission that was refused or failed,
 * and at the cost of a memo lookup once a project has the kind.
 *
 * The writer is the real class with tiny limits and a mocked insert target;
 * ProjectMilestoneService.reachInBackground is the spy the marks land in.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
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

import TelemetryMilestones, {
  PendingTelemetryMilestones,
  TELEMETRY_KIND_OF_TABLE,
} from "../../../../Server/Utils/Activation/TelemetryMilestones";
import {
  FanInInsertTarget,
  FanInSubmitResult,
  TelemetryFanInWriter,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import ProjectMilestoneService, {
  ReachMilestoneData,
} from "../../../../Server/Services/ProjectMilestoneService";
import ActivationMilestone from "../../../../Types/Analytics/ActivationMilestone";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";

const PROJECT_A: string = "aaaaaaaa-1111-4111-8111-111111111111";
const PROJECT_B: string = "bbbbbbbb-2222-4222-8222-222222222222";

const rowsOf: (projectIds: Array<string>) => Array<JSONObject> = (
  projectIds: Array<string>,
): Array<JSONObject> => {
  return projectIds.map((projectId: string): JSONObject => {
    return { projectId: projectId, body: "a log line" };
  });
};

const makeWriter: () => TelemetryFanInWriter = (): TelemetryFanInWriter => {
  return new TelemetryFanInWriter({
    maxBatchRows: 1000,
    maxWaitMs: 5,
    maxConcurrentInserts: 2,
    maxPendingRows: 10000,
    retryMaxAttempts: 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    sleep: async (): Promise<void> => {
      // no backoff
    },
  });
};

const makeTarget: (
  tableName: string,
  insert?: () => Promise<void>,
) => FanInInsertTarget = (
  tableName: string,
  insert?: () => Promise<void>,
): FanInInsertTarget => {
  return {
    model: { tableName: tableName },
    insertJsonRows:
      insert ||
      (async (): Promise<void> => {
        // accepted
      }),
  };
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("TelemetryMilestones", () => {
  let reached: Array<ReachMilestoneData>;
  let known: Set<string>;

  beforeEach(() => {
    reached = [];
    known = new Set<string>();

    jest
      .spyOn(ProjectMilestoneService, "reachInBackground")
      .mockImplementation((data: ReachMilestoneData): void => {
        reached.push(data);
      });
    jest
      .spyOn(ProjectMilestoneService, "isKnownReached")
      .mockImplementation(
        (projectId: unknown, milestone: ActivationMilestone): boolean => {
          return known.has(`${String(projectId)}:${milestone}`);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("which tables are which kind", () => {
    test("logs, spans, metrics, exceptions and both profile tables each have their milestone", () => {
      expect(
        TelemetryMilestones.getMilestoneOfTable(AnalyticsTableName.Log),
      ).toBe(ActivationMilestone.FirstLogsReceived);
      expect(
        TelemetryMilestones.getMilestoneOfTable(AnalyticsTableName.Span),
      ).toBe(ActivationMilestone.FirstTracesReceived);
      expect(
        TelemetryMilestones.getMilestoneOfTable(AnalyticsTableName.Metric),
      ).toBe(ActivationMilestone.FirstMetricsReceived);
      expect(
        TelemetryMilestones.getMilestoneOfTable(
          AnalyticsTableName.ExceptionInstance,
        ),
      ).toBe(ActivationMilestone.FirstExceptionsReceived);
      expect(
        TelemetryMilestones.getMilestoneOfTable(AnalyticsTableName.Profile),
      ).toBe(ActivationMilestone.FirstProfilesReceived);
      expect(
        TelemetryMilestones.getMilestoneOfTable(
          AnalyticsTableName.ProfileSample,
        ),
      ).toBe(ActivationMilestone.FirstProfilesReceived);
      expect(Object.keys(TELEMETRY_KIND_OF_TABLE)).toHaveLength(6);
    });

    test("a table that is no telemetry kind - a monitor log, a change event, a session replay - has none", () => {
      for (const table of [
        AnalyticsTableName.MonitorLog,
        AnalyticsTableName.ChangeEvent,
        AnalyticsTableName.RumSessionChunk,
        AnalyticsTableName.SecurityEvent,
        "TestTable",
      ]) {
        expect(TelemetryMilestones.getMilestoneOfTable(table)).toBeNull();
        expect(
          TelemetryMilestones.collect(table, rowsOf([PROJECT_A])),
        ).toBeNull();
      }
    });
  });

  describe("collect", () => {
    test("names each project in the rows once, in the order they come", () => {
      const pending: PendingTelemetryMilestones | null =
        TelemetryMilestones.collect(
          AnalyticsTableName.Log,
          rowsOf([PROJECT_A, PROJECT_A, PROJECT_B, PROJECT_A, PROJECT_B]),
        );

      expect(pending).toEqual({
        milestone: ActivationMilestone.FirstLogsReceived,
        projectIds: [PROJECT_A, PROJECT_B],
      });
    });

    test("leaves out a project known to have the kind, and is null when every project is known", () => {
      known.add(`${PROJECT_A}:${ActivationMilestone.FirstTracesReceived}`);

      expect(
        TelemetryMilestones.collect(
          AnalyticsTableName.Span,
          rowsOf([PROJECT_A, PROJECT_B]),
        ),
      ).toEqual({
        milestone: ActivationMilestone.FirstTracesReceived,
        projectIds: [PROJECT_B],
      });

      known.add(`${PROJECT_B}:${ActivationMilestone.FirstTracesReceived}`);

      expect(
        TelemetryMilestones.collect(
          AnalyticsTableName.Span,
          rowsOf([PROJECT_A, PROJECT_B]),
        ),
      ).toBeNull();
    });

    test("asks the memo once per run of rows of one project, not once a row", () => {
      TelemetryMilestones.collect(
        AnalyticsTableName.Metric,
        rowsOf(new Array(500).fill(PROJECT_A)),
      );

      expect(ProjectMilestoneService.isKnownReached).toHaveBeenCalledTimes(1);
    });

    test("rows without a project, no rows, and rows that are not objects are no project", () => {
      expect(
        TelemetryMilestones.collect(AnalyticsTableName.Log, []),
      ).toBeNull();
      expect(
        TelemetryMilestones.collect(AnalyticsTableName.Log, [
          { body: "no project" },
          { projectId: 42 } as unknown as JSONObject,
          null as unknown as JSONObject,
        ]),
      ).toBeNull();
    });
  });

  test("markReached keeps each collected project's milestone, and nothing for null", () => {
    TelemetryMilestones.markReached(null);
    expect(reached).toEqual([]);

    TelemetryMilestones.markReached({
      milestone: ActivationMilestone.FirstProfilesReceived,
      projectIds: [PROJECT_A, PROJECT_B],
    });

    expect(reached).toEqual([
      {
        projectId: PROJECT_A,
        milestone: ActivationMilestone.FirstProfilesReceived,
      },
      {
        projectId: PROJECT_B,
        milestone: ActivationMilestone.FirstProfilesReceived,
      },
    ]);
  });

  describe("through the fan-in writer", () => {
    test("rows ClickHouse accepted mark their projects' first telemetry of that kind", async () => {
      const writer: TelemetryFanInWriter = makeWriter();

      const submission: FanInSubmitResult = await writer.submit(
        makeTarget(AnalyticsTableName.Log),
        rowsOf([PROJECT_A, PROJECT_B]),
      );

      expect(reached).toEqual([]);

      await submission.flushed;
      await flush();

      expect(reached).toEqual([
        {
          projectId: PROJECT_A,
          milestone: ActivationMilestone.FirstLogsReceived,
        },
        {
          projectId: PROJECT_B,
          milestone: ActivationMilestone.FirstLogsReceived,
        },
      ]);
    });

    test("rows ClickHouse refused mark nothing, and the submitter still hears of the failure", async () => {
      const writer: TelemetryFanInWriter = makeWriter();

      const submission: FanInSubmitResult = await writer.submit(
        makeTarget(AnalyticsTableName.Span, async (): Promise<void> => {
          throw new Error("Code: 27. Cannot parse input");
        }),
        rowsOf([PROJECT_A]),
      );

      await expect(submission.flushed).rejects.toThrow();
      await flush();

      expect(reached).toEqual([]);
    });

    test("a table that is no telemetry kind marks nothing", async () => {
      const writer: TelemetryFanInWriter = makeWriter();

      const submission: FanInSubmitResult = await writer.submit(
        makeTarget(AnalyticsTableName.MonitorLog),
        rowsOf([PROJECT_A]),
      );

      await submission.flushed;
      await flush();

      expect(reached).toEqual([]);
    });

    test("projects known to have the kind cost no mark at all", async () => {
      known.add(`${PROJECT_A}:${ActivationMilestone.FirstMetricsReceived}`);

      const writer: TelemetryFanInWriter = makeWriter();

      const submission: FanInSubmitResult = await writer.submit(
        makeTarget(AnalyticsTableName.Metric),
        rowsOf([PROJECT_A, PROJECT_A]),
      );

      await submission.flushed;
      await flush();

      expect(reached).toEqual([]);
    });
  });
});
