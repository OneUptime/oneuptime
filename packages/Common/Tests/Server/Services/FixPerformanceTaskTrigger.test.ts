import FixPerformanceTaskTrigger, {
  FinishedPerformanceFix,
  MAX_ANALYZED_TRACE_SPANS,
  PERFORMANCE_FIX_ALREADY_DONE_MESSAGE,
  PerformanceTraceSpans,
} from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import CodeTaskRuns from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import { CODE_TASK_PLAN_REQUIRED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../Types/AI/CodeTask";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import { AnalyzableSpan } from "../../../Utils/Traces/SpanTreeAnalyzer";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIService, {
  AI_DISABLED_MESSAGE,
} from "../../../Server/Services/AIService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Service from "../../../Models/DatabaseModels/Service";
import Span from "../../../Models/AnalyticsModels/Span";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext, {
  PerformanceFinding,
  PerformanceFindingType,
} from "../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  TRACE_NOT_WORTH_FIXING_MESSAGE,
  TracePerformanceFixSuggestion,
} from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import {
  FAST_REQUEST_WITH_N_PLUS_ONE,
  HEALTH_CHECK,
  NOT_WORTH_FIXING_TRACES,
  SLOW_CHECKOUT_WITH_N_PLUS_ONE,
  TraceFixture,
  WORTH_FIXING_TRACES,
} from "../../Utils/Suggestions/TraceFixtures";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The FixPerformance trigger: the user clicks "Fix performance with AI" on
 * the trace view. The project's one AI switch must be on, the span-tree
 * analysis must find a pattern worth fixing in the trace's spans (the
 * recipe's honesty gate — nothing worth fixing, no task), a GitHub-App
 * repository must exist for the PR, and at most one non-terminal
 * FixPerformance run may exist per trace. Human-triggered, so no per-feature
 * opt-in; runs inside a user-facing endpoint, so every unmet gate must THROW
 * a clear message, not swallow.
 *
 * The trace page asks getSuggestionForTrace first and offers the button only
 * when these same gates would let the click through - "the server agrees
 * with the page" below holds that for every trace, AI setting, repository,
 * run in flight, fix already done and word from Code's gate.
 *
 * A fix for the trace that already did its work is not made a second time
 * (the page links to it), and a person's click is asked what Code's own
 * gate says about the repository the run will be queued on
 * (CodeFixStartGate): the plan, AI credits or an LLM provider, the daily AI
 * limit, a Runner online.
 */

const GATE_REPOSITORY_ID: ObjectID = new ObjectID(
  "50000000-0000-4000-8000-000000000005",
);

// What Code's gate says when the project's AI credits are used up.
const NO_CREDITS: CodeTaskBlocker = {
  type: CodeTaskBlockerType.NoAiCredits,
  message: "This project's AI credits are used up.",
};

// Code's gate, as CodeFixStartGate answers it: nothing in the way.
function gateSays(
  blocker: CodeTaskBlocker | null,
  codeRepositoryId: ObjectID | null = GATE_REPOSITORY_ID,
): jest.SpyInstance {
  return jest
    .spyOn(CodeFixStartGate, "check")
    .mockResolvedValue({ codeRepositoryId, blocker } as CodeFixStart);
}

// No fix for the trace did its work yet.
function noFinishedFix(): void {
  jest
    .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
    .mockResolvedValue(null);
  jest
    .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
    .mockResolvedValue(null);
}

const projectId: ObjectID = ObjectID.generate();
const traceId: string = "abc123trace";
const userId: ObjectID = ObjectID.generate();

function fakeRun(taskContext?: CodeFixTaskContext): AIRun {
  return {
    id: ObjectID.generate(),
    taskContext,
  } as unknown as AIRun;
}

// A trace with a textbook N+1: root + 5 near-identical 100 ms children.
function spansWithNPlusOne(): Array<AnalyzableSpan> {
  const spans: Array<AnalyzableSpan> = [
    {
      spanId: "root",
      name: "GET /orders",
      startMs: 0,
      endMs: 1000,
    },
  ];
  for (let i: number = 0; i < 5; i++) {
    spans.push({
      spanId: `child-${i}`,
      parentSpanId: "root",
      name: `SELECT users ${i}`,
      startMs: i * 100,
      endMs: i * 100 + 100,
      attributes: {
        "db.statement": `SELECT * FROM users WHERE id = ${i}`,
        "code.filepath": "src/orders/loader.ts",
        "code.function": "loadUserForOrder",
        "code.lineno": "42",
      },
    });
  }
  return spans;
}

// A healthy trace: no detector can fire.
function healthySpans(): Array<AnalyzableSpan> {
  return [
    { spanId: "root", name: "GET /home", startMs: 0, endMs: 1000 },
    { spanId: "a", parentSpanId: "root", name: "auth", startMs: 0, endMs: 500 },
    {
      spanId: "b",
      parentSpanId: "root",
      name: "render",
      startMs: 500,
      endMs: 1000,
    },
  ];
}

function aiSwitch(isOn: boolean): void {
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(isOn);
  if (isOn) {
    jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  } else {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException(AI_DISABLED_MESSAGE));
  }
}

describe("FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace", () => {
  beforeEach(() => {
    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    aiSwitch(true);
    noFinishedFix();
    gateSays(null, null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a traceId-less call is rejected before any query", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId: "",
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(BadDataException);

    expect(countBy).not.toHaveBeenCalled();
  });

  test("a span-less trace is rejected before any query", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: [],
        userId,
      }),
    ).rejects.toThrow(/no spans/);

    expect(countBy).not.toHaveBeenCalled();
  });

  test("AI switched off for the project: refused in the switch's own words, before any analysis or repository read", async () => {
    aiSwitch(false);
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(AI_DISABLED_MESSAGE);

    expect(AIService.assertProjectAIEnabled).toHaveBeenCalledWith(projectId);
    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("no finding at all → reject with the rule, nothing queried or enqueued", async () => {
    const countBy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "countBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: healthySpans(),
        userId,
      }),
    ).rejects.toThrow(TRACE_NOT_WORTH_FIXING_MESSAGE);

    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a fast request with five 2 ms queries in a loop",
      FAST_REQUEST_WITH_N_PLUS_ONE,
    ],
    ["a 3 ms health check", HEALTH_CHECK],
  ])(
    "a pattern that costs too little (%s) is refused the same way",
    async (_label: string, trace: TraceFixture) => {
      const countBy: jest.SpyInstance = jest.spyOn(
        CodeRepositoryService,
        "countBy",
      );

      await expect(
        FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
          projectId,
          traceId,
          spans: trace.spans,
          userId,
        }),
      ).rejects.toThrow(TRACE_NOT_WORTH_FIXING_MESSAGE);

      expect(countBy).not.toHaveBeenCalled();
    },
  );

  test("no connected repository, on any host → reject, nothing enqueued", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    // No repository connected through GitLab, Forgejo, Gitea or Git either.
    jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(/^No connected repository exists for this project/);

    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe: a live FixPerformance run for the SAME trace blocks a second one", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const findBy: jest.SpyInstance = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([fakeRun({ traceId })]);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(/already queued or running/);

    // The dedupe scan is scoped to non-terminal FixPerformance runs.
    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixPerformance,
        }),
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe is per-trace: a live run for a DIFFERENT trace does not block", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([fakeRun({ traceId: "some-other-trace" })]);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans: spansWithNPlusOne(),
      userId,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  test("happy path: enqueues a Queued FixPerformance run whose taskContext carries the evidence", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const createdRun: AIRun = fakeRun();
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(createdRun);

    const run: AIRun =
      await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        serviceName: "orders-service",
        userId,
      });

    expect(run).toBe(createdRun);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixPerformance,
          status: AIRunStatus.Queued,
          // Attribution: the user who clicked the button.
          userId: userId,
          // No subject row — the evidence IS the context.
          triggeredByIncidentId: undefined,
          triggeredByAlertId: undefined,
          taskContext: expect.objectContaining({
            traceId: traceId,
            serviceName: "orders-service",
          }),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    // The stored findings are the deterministic N+1 evidence.
    const storedContext: CodeFixTaskContext = (
      create.mock.calls[0]![0] as { data: AIRun }
    ).data.taskContext!;
    expect(storedContext.performanceFindings).toHaveLength(1);
    expect(storedContext.performanceFindings![0]!.spanCount).toBe(5);

    // code.* attributes of implicated spans become resolver locations.
    expect(storedContext.codeLocations).toEqual([
      {
        filePath: "src/orders/loader.ts",
        functionName: "loadUserForOrder",
        lineNumber: 42,
      },
    ]);
  });

  test("only the findings worth fixing ground the pull request", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(fakeRun());

    /*
     * The checkout's 840 ms N+1, plus a small 3-call loop of 9 ms in a
     * render step: both are patterns, only the first is worth fixing.
     */
    const spans: Array<AnalyzableSpan> = [
      ...SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans,
      ...[0, 1, 2].map((index: number): AnalyzableSpan => {
        return {
          spanId: `icon-${index}`,
          parentSpanId: "render",
          name: "load icon",
          startMs: 1100 + index * 3,
          endMs: 1103 + index * 3,
        };
      }),
    ];

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans,
      userId,
    });

    const storedContext: CodeFixTaskContext = (
      create.mock.calls[0]![0] as { data: AIRun }
    ).data.taskContext!;
    expect(
      storedContext.performanceFindings!.map((finding: PerformanceFinding) => {
        return finding.findingType;
      }),
    ).toEqual([PerformanceFindingType.NPlusOneQuery]);
    expect(storedContext.performanceFindings![0]!.spanCount).toBe(14);
  });

  function connected(): void {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
  }

  test("a fix for this trace already did its work: refused, pointing at its task - no second pull request", async () => {
    connected();
    jest
      .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
      .mockResolvedValue(fakeRun({ traceId }));
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(PERFORMANCE_FIX_ALREADY_DONE_MESSAGE);

    expect(
      SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace,
    ).toHaveBeenCalledWith({ projectId, traceId });
    // Refused before Code's gate is asked, and nothing is queued.
    expect(CodeFixStartGate.check).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("Code's gate says the credits are used up: refused in its words, nothing queued", async () => {
    connected();
    gateSays(NO_CREDITS);
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(new BadDataException(NO_CREDITS.message));

    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the plan does not include AI in Code: refused as a payment, the way Code refuses it", async () => {
    connected();
    gateSays({
      type: CodeTaskBlockerType.PlanRequired,
      message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
    });

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(PaymentRequiredException);
  });

  test("Code's gate is asked about the run as it will be queued: its recipe and the trace's evidence", async () => {
    connected();
    const check: jest.SpyInstance = gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans: spansWithNPlusOne(),
      serviceName: "orders-service",
      userId,
    });

    expect(check).toHaveBeenCalledTimes(1);
    const asked: {
      projectId: ObjectID;
      taskType: CodeFixTaskType;
      taskContext: CodeFixTaskContext;
    } = check.mock.calls[0]![0];
    expect(asked.projectId).toBe(projectId);
    expect(asked.taskType).toBe(CodeFixTaskType.FixPerformance);
    expect(asked.taskContext.traceId).toBe(traceId);
    expect(asked.taskContext.serviceName).toBe("orders-service");
    expect(asked.taskContext.performanceFindings).toHaveLength(1);
    expect(asked.taskContext.codeLocations).toEqual([
      {
        filePath: "src/orders/loader.ts",
        functionName: "loadUserForOrder",
        lineNumber: 42,
      },
    ]);
  });

  test("the run is queued on the repository Code's gate was asked about, so its Runner takes it", async () => {
    connected();
    gateSays(null, GATE_REPOSITORY_ID);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans: spansWithNPlusOne(),
      userId,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixPerformance,
        codeRepositoryId: GATE_REPOSITORY_ID,
        userId,
      }),
    );
  });

  test("no repository resolves for the gate: queued without one, as the run then finds its own", async () => {
    connected();
    gateSays(null, null);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans: spansWithNPlusOne(),
      userId,
    });

    expect(enqueue.mock.calls[0]![0]).toMatchObject({ codeRepositoryId: null });
  });

  test("a run in flight is said before what Code's gate says: the page links to it", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(fakeRun({ traceId }));
    gateSays(NO_CREDITS);

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(CodeFixStartGate.check).not.toHaveBeenCalled();
  });
});

describe("FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings (insight fix routing)", () => {
  function worthFixing(): PerformanceFinding {
    return {
      findingType: PerformanceFindingType.NPlusOneQuery,
      headline: 'N+1: 12× "SELECT users"',
      evidence: "12 near-identical sibling spans under one parent",
      spanCount: 12,
      combinedDurationMs: 480,
      traceDurationMs: 600,
      percentOfTrace: 80,
      normalizedSpanName: "SELECT users",
      implicatedSpans: [{ spanId: "s1", name: "SELECT users", durationMs: 40 }],
    };
  }

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    aiSwitch(true);
    noFinishedFix();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the automatic routing does not ask Code's gate: its run is queued to wait for a Runner, as before", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    const check: jest.SpyInstance = gateSays(NO_CREDITS);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
      projectId,
      traceId,
      findings: [worthFixing()],
      codeLocations: [],
    });

    expect(check).not.toHaveBeenCalled();
    // The run decides its repository itself, as every automatic run does.
    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("codeRepositoryId");
  });

  test("a trace whose fix already did its work is not fixed again by the routing either", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
      .mockResolvedValue(fakeRun({ traceId }));
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId,
        findings: [worthFixing()],
        codeLocations: [],
      }),
    ).rejects.toThrow(PERFORMANCE_FIX_ALREADY_DONE_MESSAGE);

    expect(enqueue).not.toHaveBeenCalled();
  });

  test("AI off: refused before the repository gate", async () => {
    aiSwitch(false);
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId,
        findings: [worthFixing()],
        codeLocations: [],
      }),
    ).rejects.toThrow(AI_DISABLED_MESSAGE);

    expect(repository).not.toHaveBeenCalled();
  });

  test("findings not worth fixing are refused by the same rule as the trace page", async () => {
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId,
        findings: [{ ...worthFixing(), combinedDurationMs: 20 }],
        codeLocations: [],
      }),
    ).rejects.toThrow(TRACE_NOT_WORTH_FIXING_MESSAGE);

    expect(repository).not.toHaveBeenCalled();
  });

  test("of a mix, only the findings worth fixing are enqueued", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue(fakeRun());
    const finding: PerformanceFinding = worthFixing();

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
      projectId,
      traceId,
      findings: [finding, { ...worthFixing(), combinedDurationMs: 20 }],
      codeLocations: [],
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixPerformance,
        taskContext: expect.objectContaining({
          performanceFindings: [finding],
        }),
      }),
    );
  });
});

describe("FixPerformanceTaskTrigger.getSuggestionForTrace (what the trace page offers)", () => {
  function loadOf(spans: Array<AnalyzableSpan>): jest.Mock {
    return jest.fn(async (): Promise<PerformanceTraceSpans> => {
      return { spans, dominantEntityId: null };
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("AI off: nothing, and the spans are never read", async () => {
    aiSwitch(false);
    const loadTrace: jest.Mock = loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans);
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace,
      });

    expect(suggestion.offer).toBe(SuggestionOffer.None);
    expect(suggestion.finding).toBeNull();
    expect(loadTrace).not.toHaveBeenCalled();
    expect(repository).not.toHaveBeenCalled();
  });

  test("no trace id: nothing, nothing read", async () => {
    const isEnabled: jest.SpyInstance = jest.spyOn(
      AIService,
      "isProjectAIEnabled",
    );
    const loadTrace: jest.Mock = loadOf([]);

    expect(
      (
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId: "",
          loadTrace,
        })
      ).offer,
    ).toBe(SuggestionOffer.None);
    expect(isEnabled).not.toHaveBeenCalled();
    expect(loadTrace).not.toHaveBeenCalled();
  });

  test("a trace the caller cannot see (no spans): nothing", async () => {
    aiSwitch(true);

    expect(
      (
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: loadOf([]),
        })
      ).offer,
    ).toBe(SuggestionOffer.None);
  });

  test.each(
    NOT_WORTH_FIXING_TRACES.map(
      (trace: TraceFixture): [string, TraceFixture] => {
        return [trace.title, trace];
      },
    ),
  )(
    "not worth fixing (%s): nothing, and no repository or run is read",
    async (_title: string, trace: TraceFixture) => {
      aiSwitch(true);
      const repository: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "hasConnectedRepository",
      );
      const run: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "findNonTerminalPerformanceFixRunForTrace",
      );

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: loadOf(trace.spans),
        });

      expect(suggestion.offer).toBe(SuggestionOffer.None);
      expect(repository).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    },
  );

  test("worth fixing, a repository, no fix yet: the fix, naming the N+1", async () => {
    aiSwitch(true);
    noFinishedFix();
    gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });

    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.finding?.findingType).toBe(
      PerformanceFindingType.NPlusOneQuery,
    );
    expect(suggestion.finding?.spanCount).toBe(14);
    expect(suggestion.finding?.parentSpanName).toBe("POST /api/v1/checkout");
    expect(suggestion.findingCount).toBe(1);
    expect(suggestion.aiRunId).toBeNull();
    expect(suggestion.fixOutcome).toBeNull();
    expect(suggestion.blocker).toBeNull();
  });

  test("worth fixing, no repository: a quiet way to connect one, and Code's gate is not asked", async () => {
    aiSwitch(true);
    noFinishedFix();
    const check: jest.SpyInstance = gateSays(NO_CREDITS);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });

    expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
    expect(suggestion.finding?.spanCount).toBe(14);
    expect(suggestion.blocker).toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the AI credits are used up",
      NO_CREDITS,
      { type: NO_CREDITS.type, message: NO_CREDITS.message },
    ],
    [
      "the repository's Runner is not online",
      {
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: 'The Runner "build-box" this repository picks is not online.',
        runnerName: "build-box",
      },
      {
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: 'The Runner "build-box" this repository picks is not online.',
        runnerName: "build-box",
      },
    ],
  ])(
    "Code's gate says %s: the step that clears it, naming the repository it was asked about",
    async (
      _label: string,
      blocker: CodeTaskBlocker,
      said: Record<string, unknown>,
    ) => {
      aiSwitch(true);
      noFinishedFix();
      gateSays(blocker, GATE_REPOSITORY_ID);
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
        .mockResolvedValue(null);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(true);

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
        });

      expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
      expect(suggestion.blocker).toEqual({
        ...said,
        repositoryId: GATE_REPOSITORY_ID.toString(),
      });
      expect(suggestion.finding?.spanCount).toBe(14);
      expect(suggestion.aiRunId).toBeNull();
    },
  );

  test("Code's gate is asked about the run the click would queue: the trace's evidence and its service", async () => {
    aiSwitch(true);
    noFinishedFix();
    const check: jest.SpyInstance = gateSays(null);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    const serviceName: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "getServiceName")
      .mockResolvedValue("checkout");

    await FixPerformanceTaskTrigger.getSuggestionForTrace({
      projectId,
      traceId,
      loadTrace: async (): Promise<PerformanceTraceSpans> => {
        return {
          spans: SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans,
          dominantEntityId: "a0000000-0000-4000-8000-000000000001",
        };
      },
    });

    expect(serviceName).toHaveBeenCalledWith(
      "a0000000-0000-4000-8000-000000000001",
    );
    const asked: {
      taskType: CodeFixTaskType;
      taskContext: CodeFixTaskContext;
    } = check.mock.calls[0]![0];
    expect(asked.taskType).toBe(CodeFixTaskType.FixPerformance);
    expect(asked.taskContext.traceId).toBe(traceId);
    expect(asked.taskContext.serviceName).toBe("checkout");
    // Only the findings worth fixing, as the run would carry them.
    expect(asked.taskContext.performanceFindings).toHaveLength(1);
    expect(asked.taskContext.performanceFindings![0]!.spanCount).toBe(14);
  });

  test.each([
    FinishedFixOutcome.Fixed,
    FinishedFixOutcome.NothingToChange,
    FinishedFixOutcome.WaitingForYou,
  ])(
    "a fix for this trace already did its work (%s): how it came out and a link to its task - no second fix, nothing else asked",
    async (outcome: FinishedFixOutcome) => {
      aiSwitch(true);
      const finished: FinishedPerformanceFix = {
        aiRunId: "70000000-0000-4000-8000-000000000010",
        outcome,
      };
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
        .mockResolvedValue(null);
      jest
        .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
        .mockResolvedValue(finished);
      const repository: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "hasConnectedRepository",
      );
      const check: jest.SpyInstance = gateSays(NO_CREDITS);

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
        });

      expect(suggestion.offer).toBe(SuggestionOffer.Done);
      expect(suggestion.fixOutcome).toBe(outcome);
      expect(suggestion.aiRunId).toBe(finished.aiRunId);
      expect(suggestion.finding?.spanCount).toBe(14);
      expect(suggestion.blocker).toBeNull();
      expect(FixPerformanceTaskTrigger.findFinishedFix).toHaveBeenCalledWith({
        projectId,
        traceId,
      });
      expect(repository).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
    },
  );

  test("someone replied to the finished fix in Code and it is working again: a link to it as work in progress", async () => {
    aiSwitch(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest.spyOn(FixPerformanceTaskTrigger, "findFinishedFix").mockResolvedValue({
      aiRunId: "70000000-0000-4000-8000-000000000010",
      outcome: null,
    });

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe("70000000-0000-4000-8000-000000000010");
    expect(suggestion.fixOutcome).toBeNull();
  });

  test("a fix in flight is linked without asking about a finished one", async () => {
    aiSwitch(true);
    const activeRun: AIRun = fakeRun({ traceId });
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(activeRun);
    const finished: jest.SpyInstance = jest.spyOn(
      FixPerformanceTaskTrigger,
      "findFinishedFix",
    );

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe(activeRun.id!.toString());
    expect(finished).not.toHaveBeenCalled();
  });

  test("a fix already on its way: a link to that run, and the repository is not asked about", async () => {
    aiSwitch(true);
    const activeRun: AIRun = fakeRun({ traceId });
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(activeRun);
    const repository: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "hasConnectedRepository",
    );

    const suggestion: TracePerformanceFixSuggestion =
      await FixPerformanceTaskTrigger.getSuggestionForTrace({
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });

    expect(suggestion.offer).toBe(SuggestionOffer.InProgress);
    expect(suggestion.aiRunId).toBe(activeRun.id!.toString());
    expect(repository).not.toHaveBeenCalled();
    expect(
      SubjectCodeFixRun.findNonTerminalPerformanceFixRunForTrace,
    ).toHaveBeenCalledWith({ projectId, traceId });
  });
});

/*
 * The promise the page rests on: the button is drawn exactly when the
 * create route would accept the click. For every trace fixture, with AI on
 * or off, a repository or none, a fix in flight or not, the suggestion
 * offers Act if and only if creating the task succeeds.
 */
describe("the server agrees with the page", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const traces: Array<TraceFixture> = [
    ...WORTH_FIXING_TRACES,
    ...NOT_WORTH_FIXING_TRACES,
  ];

  const cases: Array<
    [string, TraceFixture, boolean, boolean, boolean, boolean, boolean]
  > = [];
  for (const trace of traces) {
    for (const isAiOn of [true, false]) {
      for (const hasRepository of [true, false]) {
        for (const hasActiveRun of [true, false]) {
          for (const hasFinishedFix of [true, false]) {
            for (const isBlocked of [true, false]) {
              cases.push([
                `${trace.title}, AI ${isAiOn ? "on" : "off"}, ${hasRepository ? "a repository" : "no repository"}, ${hasActiveRun ? "a fix in flight" : "no fix in flight"}, ${hasFinishedFix ? "a fix done" : "none done"}, ${isBlocked ? "Code's gate says no" : "nothing in the way"}`,
                trace,
                isAiOn,
                hasRepository,
                hasActiveRun,
                hasFinishedFix,
                isBlocked,
              ]);
            }
          }
        }
      }
    }
  }

  test.each(cases)(
    "%s",
    async (
      _title: string,
      trace: TraceFixture,
      isAiOn: boolean,
      hasRepository: boolean,
      hasActiveRun: boolean,
      hasFinishedFix: boolean,
      isBlocked: boolean,
    ) => {
      aiSwitch(isAiOn);
      jest
        .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
        .mockResolvedValue(hasRepository);
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
        .mockResolvedValue(hasActiveRun ? fakeRun({ traceId }) : null);
      // The page's reading of a finished fix and the create path's agree.
      jest
        .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
        .mockResolvedValue(
          hasFinishedFix
            ? {
                aiRunId: "70000000-0000-4000-8000-000000000010",
                outcome: FinishedFixOutcome.Fixed,
              }
            : null,
        );
      jest
        .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
        .mockResolvedValue(hasFinishedFix ? fakeRun({ traceId }) : null);
      gateSays(isBlocked ? NO_CREDITS : null);
      jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          projectId,
          traceId,
          loadTrace: async (): Promise<PerformanceTraceSpans> => {
            return { spans: trace.spans, dominantEntityId: null };
          },
        });

      let created: boolean = true;
      try {
        await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
          projectId,
          traceId,
          spans: trace.spans,
          userId,
        });
      } catch {
        created = false;
      }

      expect(suggestion.offer === SuggestionOffer.Act).toBe(created);
    },
  );
});

/*
 * The fix for a trace that already did its work, as the page links to it:
 * read from its task's latest turn, so a reply someone sent in Code is
 * work under way, and a question is waiting for an answer.
 */
describe("the fix a trace already had", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function fix(status: AIRunStatus, needsUserInput: boolean = false): AIRun {
    return {
      id: new ObjectID("70000000-0000-4000-8000-000000000010"),
      status,
      needsUserInput,
    } as unknown as AIRun;
  }

  test("none did its work: none", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    const latestTurn: jest.SpyInstance = jest.spyOn(
      CodeTaskRuns,
      "getLatestTurn",
    );

    expect(
      await FixPerformanceTaskTrigger.findFinishedFix({ projectId, traceId }),
    ).toBeNull();
    expect(latestTurn).not.toHaveBeenCalled();
  });

  test.each([
    [AIRunStatus.Completed, false, FinishedFixOutcome.Fixed],
    [AIRunStatus.NoFixFound, false, FinishedFixOutcome.NothingToChange],
    [AIRunStatus.Completed, true, FinishedFixOutcome.WaitingForYou],
  ])(
    "nobody replied to a %s fix (asked a question: %s): %s, linked to the fix's own task",
    async (
      status: AIRunStatus,
      needsUserInput: boolean,
      outcome: FinishedFixOutcome,
    ) => {
      const run: AIRun = fix(status, needsUserInput);
      jest
        .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
        .mockResolvedValue(run);
      const latestTurn: jest.SpyInstance = jest
        .spyOn(CodeTaskRuns, "getLatestTurn")
        .mockResolvedValue(run);

      expect(
        await FixPerformanceTaskTrigger.findFinishedFix({ projectId, traceId }),
      ).toEqual({
        aiRunId: "70000000-0000-4000-8000-000000000010",
        outcome,
      });
      expect(
        SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace,
      ).toHaveBeenCalledWith({ projectId, traceId });
      expect(latestTurn).toHaveBeenCalledWith({ projectId, task: run });
    },
  );

  test("a reply is under way in Code: no outcome yet - the page says work in progress", async () => {
    jest
      .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
      .mockResolvedValue(fix(AIRunStatus.Completed, true));
    jest
      .spyOn(CodeTaskRuns, "getLatestTurn")
      .mockResolvedValue(fix(AIRunStatus.Running));

    expect(
      await FixPerformanceTaskTrigger.findFinishedFix({ projectId, traceId }),
    ).toEqual({
      aiRunId: "70000000-0000-4000-8000-000000000010",
      outcome: null,
    });
  });
});

describe("loading a trace for the analysis", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userId,
  };

  function span(data: {
    spanId: string;
    parentSpanId?: string;
    entityId?: string;
    attributes?: Record<string, unknown>;
  }): Span {
    return {
      spanId: data.spanId,
      parentSpanId: data.parentSpanId || "",
      name: `op ${data.spanId}`,
      startTimeUnixNano: 2_000_000,
      endTimeUnixNano: 7_500_000,
      durationUnixNano: 5_500_000,
      attributes: data.attributes || {},
      primaryEntityId: data.entityId ? new ObjectID(data.entityId) : undefined,
    } as unknown as Span;
  }

  test("reads the trace's spans under the caller's permissions, at most the analysis' cap, and converts them for the analyzer", async () => {
    const serviceA: string = "a0000000-0000-4000-8000-000000000001";
    const serviceB: string = "b0000000-0000-4000-8000-000000000002";
    const findBy: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue([
        span({ spanId: "root", entityId: serviceA }),
        span({
          spanId: "child",
          parentSpanId: "root",
          entityId: serviceB,
          attributes: { "db.statement": "SELECT 1", "db.rows": 3, empty: null },
        }),
        span({ spanId: "child-2", parentSpanId: "root", entityId: serviceB }),
      ]);

    const trace: PerformanceTraceSpans =
      await FixPerformanceTaskTrigger.loadTraceSpans({ traceId, props });

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { traceId },
        limit: MAX_ANALYZED_TRACE_SPANS,
        skip: 0,
        props,
      }),
    );
    expect(MAX_ANALYZED_TRACE_SPANS).toBe(500);
    expect(trace.dominantEntityId).toBe(serviceB);
    expect(trace.spans[1]).toEqual({
      spanId: "child",
      parentSpanId: "root",
      name: "op child",
      startMs: 2,
      endMs: 7.5,
      durationMs: 5.5,
      attributes: { "db.statement": "SELECT 1", "db.rows": "3" },
    });
    expect(trace.spans[0]!.parentSpanId).toBeUndefined();
  });

  test("a trace with no attributed spans has no dominant entity", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue([span({ spanId: "x" })]);

    expect(
      (await FixPerformanceTaskTrigger.loadTraceSpans({ traceId, props }))
        .dominantEntityId,
    ).toBeNull();
  });

  test("the service name comes from the dominant entity when it is a Service, and is left out otherwise", async () => {
    const findOneById: jest.SpyInstance = jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValueOnce({ name: "checkout" } as unknown as Service)
      .mockResolvedValueOnce(null);

    expect(
      await FixPerformanceTaskTrigger.getServiceName(
        "a0000000-0000-4000-8000-000000000001",
      ),
    ).toBe("checkout");
    expect(
      await FixPerformanceTaskTrigger.getServiceName(
        "a0000000-0000-4000-8000-000000000001",
      ),
    ).toBeUndefined();
    expect(
      await FixPerformanceTaskTrigger.getServiceName(null),
    ).toBeUndefined();
    expect(findOneById).toHaveBeenCalledTimes(2);
  });
});
