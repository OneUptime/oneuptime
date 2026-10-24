import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import InsightTriage from "../../../../../Server/Utils/AI/SRE/Insights/Triage";
import ProfileInsightFix, {
  ProfileInsightFixSkip,
} from "../../../../../Server/Utils/AI/TelemetryAi/ProfileInsightFix";
import TelemetryAiRouting, {
  TELEMETRY_AI_FIX_STARTERS,
  TelemetryAiSweepResult,
} from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiRouting";
import TelemetryAiRules from "../../../../../Server/Utils/AI/TelemetryAi/TelemetryAiRules";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightStatus from "../../../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP,
  TelemetryAiLane,
} from "../../../../../Types/AI/TelemetryAi";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * One look at a lane's open problems (TelemetryAiRouting.sweepLane): what
 * OneUptime AI does with each, as Enable AI, the lane's switch and its AI
 * rules say - one triage and one fix per problem, ever, and a fix attached
 * to its insight only while the insight has none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5092cccc-0000-4000-8000-000000000001",
);
const CHECKOUT: string = "5092cccc-0000-4000-8000-000000000002";
const NOW: Date = new Date("2026-10-24T09:00:04.000Z");
const HOUR: number = 60 * 60 * 1000;

// The SQL a raw query operator (QueryHelper.isNull, ...) writes for a column.
function sqlOf(operator: unknown): string {
  const raw: { getSql?: (alias: string) => string } = operator as {
    getSql?: (alias: string) => string;
  };

  return raw.getSql ? raw.getSql("fixAiRunId") : "";
}

function project(overrides: Partial<Project> = {}): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  value.enableAi = true;
  value.enableAutomaticProfileRemediation = true;
  Object.assign(value, overrides);
  return value;
}

function problem(overrides: Partial<AIInsight> = {}): AIInsight {
  const value: AIInsight = new AIInsight();
  value.id = ObjectID.generate();
  value.projectId = PROJECT_ID;
  value.insightType = AIInsightType.ProfileHotspot;
  value.status = AIInsightStatus.ActionRequired;
  value.title = "OrderParser.parse takes 18% of the CPU time in checkout";
  value.telemetryServiceId = new ObjectID(CHECKOUT);
  value.firstSeenAt = new Date(NOW.getTime() - 3 * HOUR);
  value.lastSeenAt = new Date(NOW.getTime() - 60 * 1000);
  Object.assign(value, overrides);
  return value;
}

function rule(
  overrides: Partial<AutoRemediationRule> = {},
): AutoRemediationRule {
  const value: AutoRemediationRule = new AutoRemediationRule();
  value.id = ObjectID.generate();
  value.name = "Every service";
  value.investigates = true;
  value.fixes = true;
  value.executionMode = AutoRemediationExecutionMode.FullAuto;
  Object.assign(value, overrides);
  return value;
}

describe("TelemetryAiRouting.sweepLane", () => {
  let problems: Array<AIInsight>;
  let rules: Array<AutoRemediationRule> | null;
  let findProblems: SpyInstance<typeof AIInsightService.findBy>;
  let readRules: SpyInstance<typeof TelemetryAiRules.readRules>;
  let triage: SpyInstance<typeof InsightTriage.enqueueInsightTriage>;
  let startFix: SpyInstance<typeof ProfileInsightFix.start>;
  let attachFix: SpyInstance<typeof AIInsightService.updateOneBy>;
  const fixTaskId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    problems = [problem()];
    rules = [];

    findProblems = jest
      .spyOn(AIInsightService, "findBy")
      .mockImplementation(async () => {
        return problems;
      });
    readRules = jest
      .spyOn(TelemetryAiRules, "readRules")
      .mockImplementation(async () => {
        return rules;
      });
    jest.spyOn(TelemetryAiRules, "readServices").mockResolvedValue(new Map());
    triage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({ triageAiRunId: ObjectID.generate() });
    startFix = jest
      .spyOn(ProfileInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    attachFix = jest
      .spyOn(AIInsightService, "updateOneBy")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function sweep(over?: Project): Promise<TelemetryAiSweepResult> {
    return TelemetryAiRouting.sweepLane({
      project: over || project(),
      lane: TelemetryAiLane.Profile,
      now: NOW,
    });
  }

  test("Enable AI off: nothing is read or started", async () => {
    await expect(sweep(project({ enableAi: false }))).resolves.toEqual({
      problemsRead: 0,
      investigationsStarted: 0,
      fixesStarted: 0,
      waiting: 0,
    });
    expect(findProblems).not.toHaveBeenCalled();
  });

  test("the lane's switch off: nothing is read or started", async () => {
    await sweep(project({ enableAutomaticProfileRemediation: false }));

    expect(findProblems).not.toHaveBeenCalled();
    expect(startFix).not.toHaveBeenCalled();
  });

  test("reads the lane's open problems that are still being found, newest first, as root", async () => {
    await sweep();

    const call: JSONObject = findProblems.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(JSON.stringify(query["insightType"])).toContain(
      AIInsightType.ProfileHotspot,
    );
    expect(JSON.stringify(query["status"])).toContain(
      AIInsightStatus.ActionRequired,
    );
    expect(JSON.stringify(query["status"])).toContain(
      AIInsightStatus.FixOpened,
    );
    expect(JSON.stringify(query["lastSeenAt"])).toContain(
      new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    );
    expect(call["limit"]).toBe(TELEMETRY_AI_MAX_PROBLEMS_PER_SWEEP);
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("no rule: the triage and the pull request start, and the fix is attached to its insight", async () => {
    const result: TelemetryAiSweepResult = await sweep();

    expect(result).toEqual({
      problemsRead: 1,
      investigationsStarted: 1,
      fixesStarted: 1,
      waiting: 0,
    });
    expect(triage).toHaveBeenCalledWith({
      insight: problems[0],
      llmProviderId: undefined,
    });
    expect(startFix).toHaveBeenCalledTimes(1);

    const attach: JSONObject = attachFix.mock
      .calls[0]![0] as unknown as JSONObject;
    expect((attach["query"] as JSONObject)["_id"]).toBe(
      problems[0]!.id!.toString(),
    );
    // Only an insight still without a fix takes it.
    expect(sqlOf((attach["query"] as JSONObject)["fixAiRunId"])).toBe(
      "(fixAiRunId IS NULL)",
    );
    expect(attach["data"]).toEqual({
      status: AIInsightStatus.FixOpened,
      fixAiRunId: fixTaskId,
    });
  });

  test("the rules' LLM provider is the triage's", async () => {
    const provider: string = "5092cccc-0000-4000-8000-0000000000aa";
    rules = [rule({ llmProviderId: new ObjectID(provider) })];

    await sweep();

    expect(triage).toHaveBeenCalledWith({
      insight: problems[0],
      llmProviderId: provider,
    });
  });

  test("ask before fixing: investigated, and the pull request left to a person", async () => {
    rules = [rule({ executionMode: AutoRemediationExecutionMode.Suggest })];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(1);
    expect(result.fixesStarted).toBe(0);
    expect(startFix).not.toHaveBeenCalled();
  });

  test("don't fix: investigated only", async () => {
    rules = [rule({ fixes: false })];

    await sweep();

    expect(triage).toHaveBeenCalledTimes(1);
    expect(startFix).not.toHaveBeenCalled();
  });

  test("rules set up and none matching: nothing", async () => {
    rules = [rule({ serviceNamePattern: "^nothing-matches$" })];

    await sweep();

    expect(triage).not.toHaveBeenCalled();
    expect(startFix).not.toHaveBeenCalled();
  });

  test("rules that cannot be read: nothing", async () => {
    rules = null;

    await sweep();

    expect(triage).not.toHaveBeenCalled();
    expect(startFix).not.toHaveBeenCalled();
  });

  test("a problem already triaged and fixed is not read further", async () => {
    problems = [
      problem({
        triageAiRunId: ObjectID.generate(),
        fixAiRunId: ObjectID.generate(),
      }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.problemsRead).toBe(0);
    expect(readRules).not.toHaveBeenCalled();
  });

  test("one triage and one fix, ever: what is there is not started again", async () => {
    problems = [
      problem({ triageAiRunId: ObjectID.generate() }),
      problem({ fixAiRunId: ObjectID.generate() }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(1);
    expect(result.fixesStarted).toBe(1);
    expect(triage).toHaveBeenCalledWith(
      expect.objectContaining({ insight: problems[1] }),
    );
    expect(startFix).toHaveBeenCalledWith(
      expect.objectContaining({ insight: problems[0] }),
    );
  });

  test("a rule's wait not over yet: counted as waiting, nothing started", async () => {
    rules = [rule({ onlyIfOpenAfterMinutes: 240 })];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.waiting).toBe(1);
    expect(triage).not.toHaveBeenCalled();
    expect(startFix).not.toHaveBeenCalled();
  });

  test("a fix that cannot start yet attaches nothing, and is looked at again next time", async () => {
    startFix.mockResolvedValue({ skip: ProfileInsightFixSkip.NoRepository });

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.fixesStarted).toBe(0);
    expect(attachFix).not.toHaveBeenCalled();
  });

  test("a triage that did not enqueue (budget, no provider) is not counted", async () => {
    triage.mockResolvedValue({});

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(0);
  });

  test("one problem failing does not stop the others", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    problems = [problem(), problem()];
    triage
      .mockRejectedValueOnce(new Error("queue down"))
      .mockResolvedValue({ triageAiRunId: ObjectID.generate() });

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(1);
    expect(startFix).toHaveBeenCalledTimes(1);
  });

  test("a failed read of the problems is an empty look, never a throw", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    findProblems.mockRejectedValue(new Error("db down"));

    await expect(sweep()).resolves.toEqual({
      problemsRead: 0,
      investigationsStarted: 0,
      fixesStarted: 0,
      waiting: 0,
    });
  });

  test("the Profile lane's fix is a Code task for the slow code", () => {
    expect(Object.keys(TELEMETRY_AI_FIX_STARTERS)).toEqual([
      TelemetryAiLane.Profile,
    ]);
  });
});
