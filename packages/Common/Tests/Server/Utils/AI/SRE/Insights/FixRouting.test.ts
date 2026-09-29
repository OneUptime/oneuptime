import AIInsight from "../../../../../../Models/DatabaseModels/AIInsight";
import AIRun from "../../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../../Models/DatabaseModels/Project";
import AIInsightType from "../../../../../../Types/AI/AIInsightType";
import CodeFixTaskType from "../../../../../../Types/AI/CodeFixTaskType";
import ObjectID from "../../../../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../../../../MockType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Fix routing decides, with no LLM in the loop, whether a newly detected
 * insight is allowed to open a pull request on someone's repository. Every
 * gate here is one that must fail CLOSED, and none of them had a test:
 *
 *   - the project's AI master switch,
 *   - the per-feature opt-in, which defaults to false and must never be
 *     read as "on" when it is merely unset,
 *   - the insight types that carry code-level evidence (nothing else),
 *   - the evidence itself being present,
 *   - the daily fix-run budget,
 *   - readiness (payable provider, resolvable repository, live agent).
 *
 * And one behavioural promise: this runs inside the scanner's per-insight
 * loop, so it never throws - a failure leaves the insight on the human path.
 */

const budgetStatusMock: MockFunction = getJestMockFunction();
const describeRejectionMock: MockFunction = getJestMockFunction();
const readinessMock: MockFunction = getJestMockFunction();
const createExceptionRunMock: MockFunction = getJestMockFunction();
const createPerformanceRunMock: MockFunction = getJestMockFunction();
const updateRunMock: MockFunction = getJestMockFunction();

jest.mock("../../../../../../Server/Utils/AI/CodeFix/FixRunBudget", () => {
  return {
    __esModule: true,
    default: {
      getBudgetStatus: (...args: Array<unknown>): unknown => {
        return budgetStatusMock(...args);
      },
      describeRejection: (...args: Array<unknown>): unknown => {
        return describeRejectionMock(...args);
      },
    },
  };
});

jest.mock("../../../../../../Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: {
      getAIFixReadiness: (...args: Array<unknown>): unknown => {
        return readinessMock(...args);
      },
      createCodeFixRunForException: (...args: Array<unknown>): unknown => {
        return createExceptionRunMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger",
  () => {
    return {
      __esModule: true,
      default: {
        createPerformanceFixTaskFromFindings: (
          ...args: Array<unknown>
        ): unknown => {
          return createPerformanceRunMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../../../../Server/Services/AIRunService", () => {
  return {
    __esModule: true,
    default: {
      updateOneById: (...args: Array<unknown>): unknown => {
        return updateRunMock(...args);
      },
    },
  };
});

/* Imported after the mocks above are registered, so it sees them. */
import InsightFixRouting from "../../../../../../Server/Utils/AI/SRE/Insights/FixRouting";

/*
 * evidence is an optional column and the project compiles with
 * exactOptionalPropertyTypes, so it is written through one cast here rather
 * than at each of the four call sites.
 */
function setEvidence(
  insight: AIInsight,
  evidence: Record<string, unknown>,
): void {
  (insight as unknown as Record<string, unknown>)["evidence"] = evidence;
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const EXCEPTION_ID: ObjectID = ObjectID.generate();

function makeProject(overrides?: Partial<Project>): Project {
  const project: Project = new Project();

  project.id = PROJECT_ID;
  project.enableAi = true;
  project.enableInsightFixTasks = true;

  return Object.assign(project, overrides || {});
}

function makeExceptionInsight(overrides?: Partial<AIInsight>): AIInsight {
  const insight: AIInsight = new AIInsight();

  insight.id = ObjectID.generate();
  insight.projectId = PROJECT_ID;
  insight.insightType = AIInsightType.NewException;
  insight.telemetryExceptionId = EXCEPTION_ID;

  return Object.assign(insight, overrides || {});
}

function makeLatencyInsight(overrides?: Partial<AIInsight>): AIInsight {
  const insight: AIInsight = new AIInsight();

  insight.id = ObjectID.generate();
  insight.projectId = PROJECT_ID;
  insight.insightType = AIInsightType.TraceLatencyRegression;
  insight.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  insight.serviceName = "checkout";
  setEvidence(insight, {
    latency: {
      performanceFindings: [
        { kind: "n-plus-one", detail: "42 identical queries" },
      ],
      codeLocations: [{ filePath: "src/checkout.ts", lineNumber: 88 }],
    },
  });

  return Object.assign(insight, overrides || {});
}

function makeRun(): AIRun {
  const run: AIRun = new AIRun();

  run.id = ObjectID.generate();

  return run;
}

function route(
  insight: AIInsight,
  project: Project,
): Promise<{
  fixAiRunId?: ObjectID | undefined;
}> {
  return InsightFixRouting.routeInsightFix({ insight, project });
}

beforeEach(() => {
  budgetStatusMock.mockReset();
  describeRejectionMock.mockReset();
  readinessMock.mockReset();
  createExceptionRunMock.mockReset();
  createPerformanceRunMock.mockReset();
  updateRunMock.mockReset();

  budgetStatusMock.mockResolvedValue({ allowed: true } as never);
  describeRejectionMock.mockReturnValue("over budget");
  readinessMock.mockResolvedValue({ ready: true } as never);
  createExceptionRunMock.mockResolvedValue(makeRun() as never);
  createPerformanceRunMock.mockResolvedValue(makeRun() as never);
  updateRunMock.mockResolvedValue(undefined as never);
});

describe("InsightFixRouting - the project-level gates", () => {
  test("AI switched off for the project opens nothing, whatever the feature flag says", async () => {
    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject({ enableAi: false, enableInsightFixTasks: true }),
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });

  test("the master switch is only 'off' when it is explicitly false, because the column defaults to true", async () => {
    const project: Project = makeProject();

    delete (project as unknown as Record<string, unknown>)["enableAi"];

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      project,
    );

    expect(result.fixAiRunId).toBeDefined();
  });

  test("the per-feature opt-in must be explicitly true: unset never opens a pull request", async () => {
    const project: Project = makeProject();

    delete (project as unknown as Record<string, unknown>)[
      "enableInsightFixTasks"
    ];

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      project,
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });

  test("the per-feature opt-in set to false opens nothing", async () => {
    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject({ enableInsightFixTasks: false }),
    );

    expect(result.fixAiRunId).toBeUndefined();
  });

  test("an insight with no id or no projectId is ignored rather than routed", async () => {
    const noId: AIInsight = makeExceptionInsight();

    /*
     * `id` is a getter over the model's _id, and its setter ignores null -
     * so an unsaved row is made by clearing _id, not by deleting id.
     */
    (noId as unknown as Record<string, unknown>)["_id"] = undefined;

    expect(noId.id).toBeNull();
    expect((await route(noId, makeProject())).fixAiRunId).toBeUndefined();

    const noProject: AIInsight = makeExceptionInsight();

    delete (noProject as unknown as Record<string, unknown>)["projectId"];

    expect((await route(noProject, makeProject())).fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });
});

describe("InsightFixRouting - which insight types are fixable", () => {
  test("insight types with no code-level evidence are never auto-fixed", async () => {
    for (const insightType of [
      AIInsightType.ErrorLogSpike,
      AIInsightType.MetricDrift,
    ]) {
      const result: { fixAiRunId?: ObjectID | undefined } = await route(
        makeExceptionInsight({ insightType }),
        makeProject(),
      );

      expect(result.fixAiRunId).toBeUndefined();
    }

    expect(createExceptionRunMock).not.toHaveBeenCalled();
    expect(createPerformanceRunMock).not.toHaveBeenCalled();
  });

  test("both exception insight types route to the exception path", async () => {
    for (const insightType of [
      AIInsightType.NewException,
      AIInsightType.ExceptionSpike,
    ]) {
      createExceptionRunMock.mockResolvedValue(makeRun() as never);

      const result: { fixAiRunId?: ObjectID | undefined } = await route(
        makeExceptionInsight({ insightType }),
        makeProject(),
      );

      expect(result.fixAiRunId).toBeDefined();
    }

    expect(createExceptionRunMock).toHaveBeenCalledTimes(2);
    expect(createPerformanceRunMock).not.toHaveBeenCalled();
  });

  test("an exception insight with no exception row to fix is skipped", async () => {
    const insight: AIInsight = makeExceptionInsight();

    delete (insight as unknown as Record<string, unknown>)[
      "telemetryExceptionId"
    ];

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      insight,
      makeProject(),
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });
});

describe("InsightFixRouting - latency evidence", () => {
  test("span-tree findings and a trace id route to the performance path", async () => {
    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeLatencyInsight(),
      makeProject(),
    );

    expect(result.fixAiRunId).toBeDefined();
    expect(createPerformanceRunMock).toHaveBeenCalledTimes(1);

    const args: Record<string, unknown> = createPerformanceRunMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(args["serviceName"]).toBe("checkout");
    expect((args["findings"] as Array<unknown>).length).toBe(1);
  });

  test("no findings means no grounded recipe, so nothing is queued", async () => {
    const insight: AIInsight = makeLatencyInsight();

    setEvidence(insight, {
      latency: { performanceFindings: [], codeLocations: [] },
    });

    expect((await route(insight, makeProject())).fixAiRunId).toBeUndefined();
    expect(createPerformanceRunMock).not.toHaveBeenCalled();
  });

  test("no trace id anywhere means nothing is queued", async () => {
    const insight: AIInsight = makeLatencyInsight();

    delete (insight as unknown as Record<string, unknown>)["traceId"];
    setEvidence(insight, {
      latency: {
        performanceFindings: [{ kind: "n-plus-one" }],
        codeLocations: [],
      },
    });

    expect((await route(insight, makeProject())).fixAiRunId).toBeUndefined();
  });

  test("the sample trace on the evidence stands in for a missing traceId", async () => {
    const insight: AIInsight = makeLatencyInsight();

    delete (insight as unknown as Record<string, unknown>)["traceId"];
    setEvidence(insight, {
      latency: {
        performanceFindings: [{ kind: "n-plus-one" }],
        codeLocations: [],
        sampleTraceId: "0af7651916cd43dd8448eb211c80319c",
      },
    });

    expect((await route(insight, makeProject())).fixAiRunId).toBeDefined();

    const args: Record<string, unknown> = createPerformanceRunMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["traceId"]).toBe("0af7651916cd43dd8448eb211c80319c");
  });
});

describe("InsightFixRouting - budget and readiness", () => {
  test("over the daily budget is a quiet skip, not a failure", async () => {
    budgetStatusMock.mockResolvedValue({ allowed: false } as never);

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject(),
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });

  test("the budget is checked for the insight's own project", async () => {
    await route(makeExceptionInsight(), makeProject());

    expect(budgetStatusMock).toHaveBeenCalledTimes(1);
    expect((budgetStatusMock.mock.calls[0]![0] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("an unready project is skipped without creating a run", async () => {
    readinessMock.mockResolvedValue({ ready: false } as never);

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject(),
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(createExceptionRunMock).not.toHaveBeenCalled();
  });

  test("readiness is not consulted for the latency path, which has its own gates", async () => {
    await route(makeLatencyInsight(), makeProject());

    expect(readinessMock).not.toHaveBeenCalled();
  });
});

describe("InsightFixRouting - the run it creates", () => {
  test("an exception fix is created as a system run, with the FixException task type", async () => {
    await route(makeExceptionInsight(), makeProject());

    const args: Record<string, unknown> = createExceptionRunMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["taskType"]).toBe(CodeFixTaskType.FixException);
    expect(args["props"]).toEqual({ isRoot: true });
    /* No userId: the run stays system-authored. */
    expect(args["props"]).not.toHaveProperty("userId");
  });

  test("the created run is stamped with the insight that opened it", async () => {
    const insight: AIInsight = makeExceptionInsight();
    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      insight,
      makeProject(),
    );

    expect(updateRunMock).toHaveBeenCalledTimes(1);

    const args: Record<string, unknown> = updateRunMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect((args["id"] as ObjectID).toString()).toBe(
      result.fixAiRunId!.toString(),
    );
    expect(
      (
        (args["data"] as Record<string, ObjectID>)[
          "triggeredByAiInsightId"
        ] as ObjectID
      ).toString(),
    ).toBe(insight.id!.toString());
  });

  test("a failed stamp does not lose the run: the id still comes back", async () => {
    updateRunMock.mockRejectedValue(new Error("write conflict") as never);

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject(),
    );

    expect(result.fixAiRunId).toBeDefined();
  });

  test("a creation path that returns a run with no id yields no fix id", async () => {
    createExceptionRunMock.mockResolvedValue(new AIRun() as never);

    const result: { fixAiRunId?: ObjectID | undefined } = await route(
      makeExceptionInsight(),
      makeProject(),
    );

    expect(result.fixAiRunId).toBeUndefined();
    expect(updateRunMock).not.toHaveBeenCalled();
  });
});

describe("InsightFixRouting - it never throws", () => {
  test("a creation path that rejects (dedupe, a raced gate) is swallowed", async () => {
    createExceptionRunMock.mockRejectedValue(
      new Error("a fix run already exists for this exception") as never,
    );

    await expect(route(makeExceptionInsight(), makeProject())).resolves.toEqual(
      {},
    );
  });

  test("a budget lookup that rejects is swallowed", async () => {
    budgetStatusMock.mockRejectedValue(new Error("clickhouse down") as never);

    await expect(route(makeExceptionInsight(), makeProject())).resolves.toEqual(
      {},
    );
  });

  test("a readiness check that rejects is swallowed", async () => {
    readinessMock.mockRejectedValue(new Error("provider unreachable") as never);

    await expect(route(makeExceptionInsight(), makeProject())).resolves.toEqual(
      {},
    );
  });
});
