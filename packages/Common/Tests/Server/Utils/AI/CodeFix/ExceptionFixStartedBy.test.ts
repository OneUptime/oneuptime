import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { DashboardClientUrl } from "../../../../../Server/EnvironmentConfig";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import ExceptionFixStartedBy, {
  ExceptionFixStartedByJSON,
  MAX_EXCEPTION_FIX_FINDING_LENGTH,
} from "../../../../../Server/Utils/AI/CodeFix/ExceptionFixStartedBy";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Why an exception's AI task was started, for its pull request to say
 * (ExceptionFixStartedBy): the finding that started it - its title,
 * redacted and cut, and where the Dashboard shows it - and whether OneUptime
 * started it on its own; nothing for a task a person started on the
 * exception's page, or one that is not a code fix of this exception.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5240dddd-0000-4000-8000-000000000001",
);
const EXCEPTION_ID: ObjectID = new ObjectID(
  "5240dddd-0000-4000-8000-0000000000e1",
);
const TASK_ID: ObjectID = new ObjectID("5240dddd-0000-4000-8000-0000000000f1");
const INSIGHT_ID: ObjectID = new ObjectID(
  "5240dddd-0000-4000-8000-0000000000d1",
);

// A record's fields to set - any of them left empty (undefined) on purpose.
type Fields<T> = { [K in keyof T]?: T[K] | undefined };

function run(overrides: Fields<AIRun> = {}): AIRun {
  const value: AIRun = new AIRun();
  value.id = TASK_ID;
  value.triggeredByAiInsightId = INSIGHT_ID;
  Object.assign(value, overrides);
  return value;
}

function finding(overrides: Partial<AIInsight> = {}): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = INSIGHT_ID;
  value.title = "New exception in checkout: TypeError";
  value.insightType = AIInsightType.NewException;
  Object.assign(value, overrides);
  return value;
}

function mockReads(data: { run: AIRun | null; insight?: AIInsight | null }): {
  readRun: SpyInstance<typeof AIRunService.findOneBy>;
  readInsight: SpyInstance<typeof AIInsightService.findOneBy>;
} {
  return {
    readRun: jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(data.run),
    readInsight: jest
      .spyOn(AIInsightService, "findOneBy")
      .mockResolvedValue(data.insight === undefined ? finding() : data.insight),
  };
}

async function read(): Promise<ExceptionFixStartedByJSON | null> {
  return ExceptionFixStartedBy.read({
    taskId: TASK_ID,
    exceptionId: EXCEPTION_ID,
    projectId: PROJECT_ID,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionFixStartedBy", () => {
  test("the exception's page in OneUptime", () => {
    expect(
      ExceptionFixStartedBy.getExceptionUrl({
        projectId: PROJECT_ID,
        exceptionId: EXCEPTION_ID,
      }),
    ).toBe(
      `${DashboardClientUrl.toString()}/${PROJECT_ID.toString()}/exceptions/${EXCEPTION_ID.toString()}`,
    );
  });

  test("OneUptime started it from a finding: the finding's title, its page under Exceptions' AI section, on its own", async () => {
    const { readRun, readInsight } = mockReads({ run: run() });

    expect(await read()).toEqual({
      finding: "New exception in checkout: TypeError",
      findingUrl: `${DashboardClientUrl.toString()}/${PROJECT_ID.toString()}/exceptions/ai/insights/${INSIGHT_ID.toString()}`,
      isStartedByOneUptime: true,
    });

    // Only a code fix of this exception, in this project, says anything.
    const query: JSONObject = (
      readRun.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    expect(String(query["_id"])).toBe(TASK_ID.toString());
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["triggeredByTelemetryExceptionId"]).toBe(EXCEPTION_ID);

    const insightQuery: JSONObject = (
      readInsight.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    expect(String(insightQuery["_id"])).toBe(INSIGHT_ID.toString());
    expect(insightQuery["projectId"]).toBe(PROJECT_ID);
  });

  test("a person asked from the finding: not on its own", async () => {
    mockReads({ run: run({ userId: ObjectID.generate() }) });

    expect((await read())?.isStartedByOneUptime).toBe(false);
  });

  test("a finding of AI Insights' own: its page there", async () => {
    mockReads({
      run: run(),
      insight: finding({ insightType: AIInsightType.ErrorLogSpike }),
    });

    expect((await read())?.findingUrl).toBe(
      `${DashboardClientUrl.toString()}/${PROJECT_ID.toString()}/ai/insights/${INSIGHT_ID.toString()}`,
    );
  });

  test("a task started on the exception's own page, one that is not this exception's, or a finding gone: nothing", async () => {
    mockReads({ run: run({ triggeredByAiInsightId: undefined }) });
    expect(await read()).toBeNull();

    jest.restoreAllMocks();
    const { readInsight } = mockReads({ run: null });
    expect(await read()).toBeNull();
    expect(readInsight).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    mockReads({ run: run(), insight: null });
    expect(await read()).toBeNull();
  });

  test("the finding's title is redacted and cut before a pull request carries it", async () => {
    mockReads({
      run: run(),
      insight: finding({
        title: `Token ghp_012345678901234567890123456789012345 leaked ${"x".repeat(400)}`,
      }),
    });

    const startedBy: ExceptionFixStartedByJSON | null = await read();

    expect(startedBy?.finding).not.toContain(
      "ghp_012345678901234567890123456789012345",
    );
    expect(startedBy?.finding).toContain("[redacted-github-token]");
    expect(startedBy?.finding.length).toBe(MAX_EXCEPTION_FIX_FINDING_LENGTH);
    expect(startedBy?.finding.endsWith("…")).toBe(true);
  });
});
