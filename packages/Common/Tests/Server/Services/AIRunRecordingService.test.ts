import AIRunRecording from "../../../Models/DatabaseModels/AIRunRecording";
import AIRunRecordingService, {
  Service as AIRunRecordingServiceClass,
} from "../../../Server/Services/AIRunRecordingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Services from "../../../Server/Services/Index";
import { toStorableJson } from "../../../Server/Utils/Database/PostgresStorableValue";
import AIAgentRunLimitsHelper from "../../../Types/AI/AIAgentRunLimits";
import {
  INVESTIGATION_RECORDING_RETENTION_IN_DAYS,
  INVESTIGATION_RECORDING_VERSION,
  InvestigationRecording,
} from "../../../Types/AI/InvestigationRecording";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { EVERY_DAY } from "../../../Utils/CronTime";
import { getJestSpyOn } from "../../Spy";
import RunCron from "../../../../App/FeatureSet/Workers/Utils/Cron";
import "../../../../App/FeatureSet/Workers/Jobs/HardDelete/HardDeleteItemsInDatabase";
import fs from "fs";
import path from "path";
import { FindOperator } from "typeorm";

jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

// The worker walks this registry: narrowed to the service under test.
jest.mock("../../../Server/Services/Index", () => {
  return { __esModule: true, default: [] };
});

// An install that bills nothing: the recordings are swept all the same.
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: false,
    IsDevelopment: false,
  };
});

/*
 * WHERE AN INVESTIGATION'S RECORDING IS KEPT (issue #6800):
 * AIRunRecordingService writes what a run saw once its attempt completed
 * the run, and reads it back for a replay.
 *
 * Under test, with the database boundary replaced:
 *
 *   - retention: the text is telemetry the tools read, so a recording is
 *     hard deleted INVESTIGATION_RECORDING_RETENTION_IN_DAYS after it was
 *     written, by the daily worker job, on every install - billed or not;
 *   - saveForRun: one row for the run, written as the system, its text
 *     made storable (a NUL a log line carried, half of an emoji a result
 *     was cut through) without touching what it was handed;
 *   - getForRun: the run's latest recording in its project, or null for a
 *     run that kept none or one this server cannot read.
 */

type CronHandler = () => Promise<void>;

const NOW: Date = new Date("2026-11-13T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;
const JOB_NAME: string = "HardDelete:HardDeleteOlderItemsInDatabase";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUN_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

function recording(
  overrides: Partial<InvestigationRecording> = {},
): InvestigationRecording {
  return {
    version: INVESTIGATION_RECORDING_VERSION,
    inputs: {
      contextText: "# Incident\nTitle: Checkout returns 500s",
      aiContext: null,
      promptTime: "2026-11-10T08:30:00.000Z",
      runLimits: AIAgentRunLimitsHelper.getDefault(),
      maxOutputTokens: 4096,
      excludedToolNames: ["get_ai_investigation", "start_investigation"],
      extraTools: [],
    },
    toolCalls: [
      {
        toolName: "search_logs",
        arguments: { query: "checkout" },
        success: true,
        text: "3 rows: pool exhausted",
        rowCount: 3,
      },
    ],
    toolCallsNotKept: 0,
    ...overrides,
  };
}

function rowWith(stored: unknown): AIRunRecording {
  const row: AIRunRecording = new AIRunRecording();
  row.recording = stored as InvestigationRecording;
  return row;
}

function jobHandler(): CronHandler {
  const registration: Array<unknown> | undefined = (
    RunCron as jest.Mock
  ).mock.calls.find((call: Array<unknown>): boolean => {
    return call[0] === JOB_NAME;
  });

  expect(registration).toBeDefined();
  expect(registration![1]).toEqual({
    schedule: EVERY_DAY,
    runOnStartup: false,
  });

  return registration![2] as CronHandler;
}

describe("AIRunRecordingService: retention", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    Services.splice(0, Services.length);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("a recording is kept 30 days from when it was written", () => {
    expect(INVESTIGATION_RECORDING_RETENTION_IN_DAYS).toBe(30);
    expect(AIRunRecordingService.hardDeleteItemByColumnName).toBe("createdAt");
    expect(AIRunRecordingService.hardDeleteItemsOlderThanDays).toBe(
      INVESTIGATION_RECORDING_RETENTION_IN_DAYS,
    );
    // Every instance, not one configured by hand.
    expect(new AIRunRecordingServiceClass().hardDeleteItemsOlderThanDays).toBe(
      30,
    );
  });

  test("is a database service the worker walks: registered once, for the AIRunRecording model", () => {
    expect(AIRunRecordingService).toBeInstanceOf(DatabaseService);
    expect(AIRunRecordingService.modelType).toBe(AIRunRecording);

    const registry: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Services/Index.ts"),
      "utf8",
    );

    expect(registry).toContain(
      'import AIRunRecordingService from "./AIRunRecordingService";',
    );
    expect(registry.match(/^ {2}AIRunRecordingService,$/gm)).toHaveLength(1);
  });

  test("the daily job hard deletes the recordings written more than 30 days ago, on an install that bills nothing", async () => {
    const service: AIRunRecordingServiceClass =
      new AIRunRecordingServiceClass();
    const hardDeleteBy: jest.SpyInstance = getJestSpyOn(service, "hardDeleteBy")
      .mockResolvedValueOnce(LIMIT_MAX)
      .mockResolvedValueOnce(0);
    Services.push(service);

    await jobHandler()();

    // A full batch is followed by another, until one comes back short.
    expect(hardDeleteBy).toHaveBeenCalledTimes(2);

    const request: {
      query: Record<string, FindOperator<Date>>;
      props: { isRoot?: boolean };
      limit: number;
      skip: number;
    } = hardDeleteBy.mock.calls[0]![0];

    expect(Object.keys(request.query)).toEqual(["createdAt"]);

    const operator: FindOperator<Date> = request.query["createdAt"]!;

    expect(operator.getSql!("created")).toMatch(/^\(created < :\w+\)$/);
    expect(Object.values(operator.objectLiteralParameters!)[0]).toEqual(
      new Date(NOW.getTime() - 30 * DAY_MS),
    );
    expect(request.props).toEqual({ isRoot: true });
    expect(request.limit).toBe(LIMIT_MAX);
    expect(request.skip).toBe(0);
  });
});

describe("AIRunRecordingService.saveForRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function captureCreate(): jest.SpyInstance {
    return getJestSpyOn(AIRunRecordingService, "create").mockImplementation(
      async (data: { data: AIRunRecording }): Promise<AIRunRecording> => {
        return data.data;
      },
    );
  }

  test("writes one row for the run, in its project, as the system", async () => {
    const create: jest.SpyInstance = captureCreate();
    const kept: InvestigationRecording = recording();

    await expect(
      AIRunRecordingService.saveForRun({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        recording: kept,
      }),
    ).resolves.toBeUndefined();

    expect(create).toHaveBeenCalledTimes(1);

    const written: { data: AIRunRecording; props: unknown } =
      create.mock.calls[0]![0];

    expect(written.props).toEqual({ isRoot: true });
    expect(written.data).toBeInstanceOf(AIRunRecording);
    expect(written.data.projectId).toEqual(PROJECT_ID);
    expect(written.data.aiRunId).toEqual(RUN_ID);
    expect(written.data.recording).toEqual(kept);
    // A copy for storage: never the caller's object.
    expect(written.data.recording).not.toBe(kept);
  });

  test("a character Postgres will not keep in JSON becomes U+FFFD, one for one, and the caller's recording is left as it was", async () => {
    const create: jest.SpyInstance = captureCreate();
    const text: string = `line one\u0000line two, cut through an emoji \ud83d`;
    const kept: InvestigationRecording = recording({
      toolCalls: [
        {
          toolName: "search_logs",
          arguments: { "query\u0000": "checkout" },
          success: true,
          text,
        },
      ],
    });

    await AIRunRecordingService.saveForRun({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      recording: kept,
    });

    const stored: InvestigationRecording = (
      create.mock.calls[0]![0] as { data: AIRunRecording }
    ).data.recording!;

    expect(stored.toolCalls[0]!.text).toBe(
      "line one\ufffdline two, cut through an emoji \ufffd",
    );
    expect(stored.toolCalls[0]!.arguments).toEqual({
      "query\ufffd": "checkout",
    });
    expect(stored).toEqual(toStorableJson(kept));
    // What the run saw stays as it saw it.
    expect(kept.toolCalls[0]!.text).toBe(text);
    expect(Object.keys(kept.toolCalls[0]!.arguments)).toEqual(["query\u0000"]);
  });

  test("a row that cannot be written fails the save, for the engine to log", async () => {
    getJestSpyOn(AIRunRecordingService, "create").mockRejectedValue(
      new Error("value too long"),
    );

    await expect(
      AIRunRecordingService.saveForRun({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        recording: recording(),
      }),
    ).rejects.toThrow("value too long");
  });
});

describe("AIRunRecordingService.getForRun", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the run's latest recording, in its project, as the system", async () => {
    const kept: InvestigationRecording = recording();
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      AIRunRecordingService,
      "findOneBy",
    ).mockResolvedValue(rowWith(kept));

    expect(
      await AIRunRecordingService.getForRun({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
      }),
    ).toBe(kept);
    expect(findOneBy).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, aiRunId: RUN_ID },
      select: { recording: true },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });
  });

  test("a run that kept none, or whose recording is gone, has none", async () => {
    getJestSpyOn(AIRunRecordingService, "findOneBy").mockResolvedValue(null);

    expect(
      await AIRunRecordingService.getForRun({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
      }),
    ).toBeNull();
  });

  test.each([
    ["a row without its recording", undefined],
    ["a recording that is no object", "a string"],
    ["a recording of another version", { ...recording(), version: 2 }],
    [
      "a recording that names no version",
      { ...recording(), version: undefined },
    ],
    ["tool calls that are no list", { ...recording(), toolCalls: {} }],
    ["no inputs", { ...recording(), inputs: undefined }],
    [
      "no starting context",
      { ...recording(), inputs: { ...recording().inputs, contextText: 7 } },
    ],
  ])(
    "one this server cannot read is none: %s",
    async (_name: string, stored: unknown) => {
      getJestSpyOn(AIRunRecordingService, "findOneBy").mockResolvedValue(
        rowWith(stored),
      );

      expect(
        await AIRunRecordingService.getForRun({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
        }),
      ).toBeNull();
    },
  );

  test("a recording with no tool calls and an empty context is still one: the run made no call", async () => {
    const kept: InvestigationRecording = recording({ toolCalls: [] });
    kept.inputs.contextText = "";
    getJestSpyOn(AIRunRecordingService, "findOneBy").mockResolvedValue(
      rowWith(kept),
    );

    expect(
      await AIRunRecordingService.getForRun({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
      }),
    ).toBe(kept);
  });
});
