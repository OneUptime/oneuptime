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
import TraceInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/TraceInsightFix";
import LogInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/LogInsightFix";
import MetricInsightFix from "../../../../../Server/Utils/AI/TelemetryAi/MetricInsightFix";
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
      waitingForVerdict: 0,
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
      waitingForVerdict: 0,
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
      waitingForVerdict: 0,
    });
  });

  test("every lane has its fix starter: the Profiler's, Traces', Exceptions', Logs' and Metrics'", () => {
    expect(Object.keys(TELEMETRY_AI_FIX_STARTERS)).toEqual([
      TelemetryAiLane.Profile,
      TelemetryAiLane.Trace,
      TelemetryAiLane.Exception,
      TelemetryAiLane.Log,
      TelemetryAiLane.Metric,
    ]);
  });

  test("the look reads what each problem's investigation concluded", async () => {
    await sweep();

    const call: JSONObject = findProblems.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(call["select"]).toMatchObject({
      classification: true,
      triageCompletedAt: true,
    });
  });
});

/*
 * Traces' look: the same routing, its own fix starter, and a failing
 * operation's pull request opened on its own only once its investigation
 * found the code at fault.
 */
describe("TelemetryAiRouting.sweepLane - the Trace lane", () => {
  let problems: Array<AIInsight>;
  let rules: Array<AutoRemediationRule> | null;
  let findProblems: SpyInstance<typeof AIInsightService.findBy>;
  let triage: SpyInstance<typeof InsightTriage.enqueueInsightTriage>;
  let startTraceFix: SpyInstance<typeof TraceInsightFix.start>;
  let startProfileFix: SpyInstance<typeof ProfileInsightFix.start>;
  const fixTaskId: ObjectID = ObjectID.generate();

  function traceProblem(overrides: Partial<AIInsight> = {}): AIInsight {
    return problem({
      insightType: AIInsightType.TraceSlowOperation,
      title: "GET /orders in checkout runs the same database query 40 times",
      ...overrides,
    });
  }

  beforeEach(() => {
    problems = [traceProblem()];
    rules = [];

    findProblems = jest
      .spyOn(AIInsightService, "findBy")
      .mockImplementation(async () => {
        return problems;
      });
    jest.spyOn(TelemetryAiRules, "readRules").mockImplementation(async () => {
      return rules;
    });
    jest.spyOn(TelemetryAiRules, "readServices").mockResolvedValue(new Map());
    triage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({ triageAiRunId: ObjectID.generate() });
    startTraceFix = jest
      .spyOn(TraceInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    startProfileFix = jest
      .spyOn(ProfileInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function sweep(over?: Project): Promise<TelemetryAiSweepResult> {
    return TelemetryAiRouting.sweepLane({
      project:
        over ||
        project({
          enableAutomaticProfileRemediation: false,
          enableAutomaticTraceRemediation: true,
        }),
      lane: TelemetryAiLane.Trace,
      now: NOW,
    });
  }

  test("its switch is its own: off, nothing is read, whatever the Profiler's says", async () => {
    await sweep(
      project({
        enableAutomaticProfileRemediation: true,
        enableAutomaticTraceRemediation: false,
      }),
    );

    expect(findProblems).not.toHaveBeenCalled();
  });

  test("reads Traces' three kinds of finding, and starts Traces' own fix", async () => {
    const result: TelemetryAiSweepResult = await sweep();

    const query: JSONObject = (
      findProblems.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    for (const type of [
      AIInsightType.TraceSlowOperation,
      AIInsightType.TraceFailingOperation,
      AIInsightType.TraceMissingTracing,
    ]) {
      expect(JSON.stringify(query["insightType"])).toContain(type);
    }

    expect(JSON.stringify(query["insightType"])).not.toContain(
      AIInsightType.ProfileHotspot,
    );
    expect(result.fixesStarted).toBe(1);
    expect(startTraceFix).toHaveBeenCalledTimes(1);
    expect(startProfileFix).not.toHaveBeenCalled();
  });

  test("a slow operation and missing tracing open their pull request with the investigation", async () => {
    problems = [
      traceProblem(),
      traceProblem({ insightType: AIInsightType.TraceMissingTracing }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(2);
    expect(result.fixesStarted).toBe(2);
    expect(result.waitingForVerdict).toBe(0);
  });

  test("a failing operation waits for its investigation's verdict", async () => {
    problems = [
      traceProblem({ insightType: AIInsightType.TraceFailingOperation }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).toHaveBeenCalledTimes(1);
    expect(startTraceFix).not.toHaveBeenCalled();
    expect(result.waitingForVerdict).toBe(1);
  });

  test("a failing operation the investigation found the code at fault in gets its pull request", async () => {
    problems = [
      traceProblem({
        insightType: AIInsightType.TraceFailingOperation,
        triageAiRunId: ObjectID.generate(),
        triageCompletedAt: new Date(NOW.getTime() - HOUR),
        classification: "code-fault",
      }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).not.toHaveBeenCalled();
    expect(startTraceFix).toHaveBeenCalledTimes(1);
    expect(result.fixesStarted).toBe(1);
    expect(result.waitingForVerdict).toBe(0);
  });

  test("a failing operation that fails on purpose never gets one on its own", async () => {
    for (const classification of [
      "expected-denial",
      "user-error",
      "infrastructure",
      "unknown",
    ]) {
      startTraceFix.mockClear();
      problems = [
        traceProblem({
          insightType: AIInsightType.TraceFailingOperation,
          triageAiRunId: ObjectID.generate(),
          triageCompletedAt: new Date(NOW.getTime() - HOUR),
          classification: classification,
        }),
      ];

      const result: TelemetryAiSweepResult = await sweep();

      expect(startTraceFix).not.toHaveBeenCalled();
      expect(result.waitingForVerdict).toBe(0);
    }
  });

  test("ask before fixing waits for no verdict, and opens nothing", async () => {
    rules = [rule({ executionMode: AutoRemediationExecutionMode.Suggest })];
    problems = [
      traceProblem({ insightType: AIInsightType.TraceFailingOperation }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.waitingForVerdict).toBe(0);
    expect(startTraceFix).not.toHaveBeenCalled();
  });
});

/*
 * Logs' look: the same routing, its own fix starter, and an error log's
 * pull request opened on its own only once its investigation found the
 * code at fault - an error may be logged on purpose. Missing logging and
 * noisy logs change how the code logs: they wait for nothing.
 */
describe("TelemetryAiRouting.sweepLane - the Log lane", () => {
  let problems: Array<AIInsight>;
  let rules: Array<AutoRemediationRule> | null;
  let findProblems: SpyInstance<typeof AIInsightService.findBy>;
  let triage: SpyInstance<typeof InsightTriage.enqueueInsightTriage>;
  let startLogFix: SpyInstance<typeof LogInsightFix.start>;
  let startTraceFix: SpyInstance<typeof TraceInsightFix.start>;
  const fixTaskId: ObjectID = ObjectID.generate();
  const LLM_PROVIDER: string = "5092cccc-0000-4000-8000-0000000000c9";

  function logProblem(overrides: Partial<AIInsight> = {}): AIInsight {
    return problem({
      insightType: AIInsightType.LogNoisyPattern,
      title: '"cache hit for key <uuid>" is 62% of checkout\'s logs',
      ...overrides,
    });
  }

  beforeEach(() => {
    problems = [logProblem()];
    rules = [];

    findProblems = jest
      .spyOn(AIInsightService, "findBy")
      .mockImplementation(async () => {
        return problems;
      });
    jest.spyOn(TelemetryAiRules, "readRules").mockImplementation(async () => {
      return rules;
    });
    jest.spyOn(TelemetryAiRules, "readServices").mockResolvedValue(new Map());
    triage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({ triageAiRunId: ObjectID.generate() });
    startLogFix = jest
      .spyOn(LogInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    startTraceFix = jest
      .spyOn(TraceInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function sweep(over?: Project): Promise<TelemetryAiSweepResult> {
    return TelemetryAiRouting.sweepLane({
      project:
        over ||
        project({
          enableAutomaticProfileRemediation: false,
          enableAutomaticLogRemediation: true,
        }),
      lane: TelemetryAiLane.Log,
      now: NOW,
    });
  }

  test("its switch is its own: off, nothing is read, whatever the other lanes say", async () => {
    await sweep(
      project({
        enableAutomaticProfileRemediation: true,
        enableAutomaticTraceRemediation: true,
        enableAutomaticLogRemediation: false,
      }),
    );

    expect(findProblems).not.toHaveBeenCalled();
  });

  test("reads Logs' three kinds of finding, and starts Logs' own fix", async () => {
    const result: TelemetryAiSweepResult = await sweep();

    const query: JSONObject = (
      findProblems.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    for (const type of [
      AIInsightType.LogErrorPattern,
      AIInsightType.LogMissingLogging,
      AIInsightType.LogNoisyPattern,
    ]) {
      expect(JSON.stringify(query["insightType"])).toContain(type);
    }

    expect(JSON.stringify(query["insightType"])).not.toContain(
      AIInsightType.TraceFailingOperation,
    );
    expect(JSON.stringify(query["insightType"])).not.toContain(
      AIInsightType.ErrorLogSpike,
    );
    expect(result.fixesStarted).toBe(1);
    expect(startLogFix).toHaveBeenCalledTimes(1);
    expect(startTraceFix).not.toHaveBeenCalled();
  });

  test("missing logging and a noisy log open their pull request with the investigation", async () => {
    problems = [
      logProblem(),
      logProblem({ insightType: AIInsightType.LogMissingLogging }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.investigationsStarted).toBe(2);
    expect(result.fixesStarted).toBe(2);
    expect(result.waitingForVerdict).toBe(0);
  });

  test("an error log waits for its investigation's verdict", async () => {
    problems = [logProblem({ insightType: AIInsightType.LogErrorPattern })];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).toHaveBeenCalledTimes(1);
    expect(startLogFix).not.toHaveBeenCalled();
    expect(result.waitingForVerdict).toBe(1);
  });

  test("an error log the investigation found the code at fault in gets its pull request", async () => {
    problems = [
      logProblem({
        insightType: AIInsightType.LogErrorPattern,
        triageAiRunId: ObjectID.generate(),
        triageCompletedAt: new Date(NOW.getTime() - HOUR),
        classification: "code-fault",
      }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).not.toHaveBeenCalled();
    expect(startLogFix).toHaveBeenCalledTimes(1);
    expect(result.fixesStarted).toBe(1);
  });

  test("an error logged on purpose - a refused sign-in - never gets one on its own", async () => {
    for (const classification of [
      "expected-denial",
      "user-error",
      "infrastructure",
      "unknown",
    ]) {
      startLogFix.mockClear();
      problems = [
        logProblem({
          insightType: AIInsightType.LogErrorPattern,
          triageAiRunId: ObjectID.generate(),
          triageCompletedAt: new Date(NOW.getTime() - HOUR),
          classification: classification,
        }),
      ];

      const result: TelemetryAiSweepResult = await sweep();

      expect(startLogFix).not.toHaveBeenCalled();
      expect(result.waitingForVerdict).toBe(0);
    }
  });

  test("the rules' LLM provider is handed to the investigation", async () => {
    rules = [rule({ llmProviderId: new ObjectID(LLM_PROVIDER) })];

    await sweep();

    expect(triage.mock.calls[0]![0].llmProviderId?.toString()).toBe(
      LLM_PROVIDER,
    );
  });
});

/*
 * Metrics' look: the same routing and its own fix starter. Every kind of
 * metric problem is a fact about the code read straight off the data, so
 * no pull request waits for an investigation's verdict.
 */
describe("TelemetryAiRouting.sweepLane - the Metric lane", () => {
  let problems: Array<AIInsight>;
  let rules: Array<AutoRemediationRule> | null;
  let findProblems: SpyInstance<typeof AIInsightService.findBy>;
  let triage: SpyInstance<typeof InsightTriage.enqueueInsightTriage>;
  let startMetricFix: SpyInstance<typeof MetricInsightFix.start>;
  let startTraceFix: SpyInstance<typeof TraceInsightFix.start>;
  let startProfileFix: SpyInstance<typeof ProfileInsightFix.start>;
  let attach: SpyInstance<typeof AIInsightService.updateOneBy>;
  const fixTaskId: ObjectID = ObjectID.generate();

  function metricProblem(overrides: Partial<AIInsight> = {}): AIInsight {
    return problem({
      insightType: AIInsightType.MetricHighCardinality,
      title:
        "http.server.duration in checkout records 47,912 different user.id values an hour",
      ...overrides,
    });
  }

  beforeEach(() => {
    problems = [metricProblem()];
    rules = [];

    findProblems = jest
      .spyOn(AIInsightService, "findBy")
      .mockImplementation(async () => {
        return problems;
      });
    jest.spyOn(TelemetryAiRules, "readRules").mockImplementation(async () => {
      return rules;
    });
    jest.spyOn(TelemetryAiRules, "readServices").mockResolvedValue(new Map());
    triage = jest
      .spyOn(InsightTriage, "enqueueInsightTriage")
      .mockResolvedValue({ triageAiRunId: ObjectID.generate() });
    startMetricFix = jest
      .spyOn(MetricInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    startTraceFix = jest
      .spyOn(TraceInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    startProfileFix = jest
      .spyOn(ProfileInsightFix, "start")
      .mockResolvedValue({ taskId: fixTaskId });
    attach = jest.spyOn(AIInsightService, "updateOneBy").mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function sweep(over?: Project): Promise<TelemetryAiSweepResult> {
    return TelemetryAiRouting.sweepLane({
      project:
        over ||
        project({
          enableAutomaticProfileRemediation: false,
          enableAutomaticTraceRemediation: false,
          enableAutomaticMetricRemediation: true,
        }),
      lane: TelemetryAiLane.Metric,
      now: NOW,
    });
  }

  test("its switch is its own: off, nothing is read, whatever the other lanes' say", async () => {
    await sweep(
      project({
        enableAutomaticProfileRemediation: true,
        enableAutomaticTraceRemediation: true,
        enableAutomaticMetricRemediation: false,
      }),
    );

    expect(findProblems).not.toHaveBeenCalled();
    expect(startMetricFix).not.toHaveBeenCalled();
  });

  test("with Enable AI off, nothing is read even with its switch on", async () => {
    await sweep(
      project({ enableAi: false, enableAutomaticMetricRemediation: true }),
    );

    expect(findProblems).not.toHaveBeenCalled();
  });

  test("reads Metrics' three kinds of finding, and starts Metrics' own fix", async () => {
    const result: TelemetryAiSweepResult = await sweep();

    const query: JSONObject = (
      findProblems.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;

    for (const type of [
      AIInsightType.MetricHighCardinality,
      AIInsightType.MetricHistogramBuckets,
      AIInsightType.MetricMissingMetrics,
    ]) {
      expect(JSON.stringify(query["insightType"])).toContain(type);
    }

    for (const type of [
      AIInsightType.ProfileHotspot,
      AIInsightType.TraceSlowOperation,
      AIInsightType.MetricDrift,
    ]) {
      expect(JSON.stringify(query["insightType"])).not.toContain(type);
    }

    expect(result.fixesStarted).toBe(1);
    expect(startMetricFix).toHaveBeenCalledTimes(1);
    expect(startTraceFix).not.toHaveBeenCalled();
    expect(startProfileFix).not.toHaveBeenCalled();
  });

  test("every kind opens its pull request with its investigation: none waits for a verdict", async () => {
    problems = [
      metricProblem(),
      metricProblem({ insightType: AIInsightType.MetricHistogramBuckets }),
      metricProblem({ insightType: AIInsightType.MetricMissingMetrics }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).toHaveBeenCalledTimes(3);
    expect(startMetricFix).toHaveBeenCalledTimes(3);
    expect(result.investigationsStarted).toBe(3);
    expect(result.fixesStarted).toBe(3);
    expect(result.waitingForVerdict).toBe(0);
  });

  test("the fix is attached to its insight only while the insight has none", async () => {
    await sweep();

    const update: JSONObject = attach.mock
      .calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = update["query"] as JSONObject;

    expect(sqlOf(query["fixAiRunId"])).toContain("IS NULL");
    expect((update["data"] as JSONObject)["fixAiRunId"]).toBe(fixTaskId);
    expect((update["data"] as JSONObject)["status"]).toBe(
      AIInsightStatus.FixOpened,
    );
  });

  test("a problem no longer found is left alone", async () => {
    problems = [
      metricProblem({ lastSeenAt: new Date(NOW.getTime() - 3 * HOUR) }),
    ];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).not.toHaveBeenCalled();
    expect(startMetricFix).not.toHaveBeenCalled();
    expect(result.investigationsStarted).toBe(0);
  });

  test("ask before fixing investigates and opens nothing", async () => {
    rules = [rule({ executionMode: AutoRemediationExecutionMode.Suggest })];

    const result: TelemetryAiSweepResult = await sweep();

    expect(triage).toHaveBeenCalledTimes(1);
    expect(startMetricFix).not.toHaveBeenCalled();
    expect(result.fixesStarted).toBe(0);
  });

  test("a fix that cannot start yet attaches nothing, and is looked at again on the next look", async () => {
    startMetricFix.mockResolvedValue({ skip: undefined });

    const result: TelemetryAiSweepResult = await sweep();

    expect(result.fixesStarted).toBe(0);
    expect(attach).not.toHaveBeenCalled();
  });
});
