import FixPerformanceTaskTrigger from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import { AnalyzableSpan } from "../../../Server/Utils/AI/PerfEvidence/SpanTreeAnalyzer";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunType from "../../../Types/AI/AIRunType";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The FixPerformance trigger: the user clicks "Fix performance with AI" on
 * the trace view, the SpanTreeAnalyzer must find a deterministic pattern in
 * the trace's spans (the recipe's honesty gate — no finding, no task), a
 * GitHub-App repository must exist for the PR, and at most one non-terminal
 * FixPerformance run may exist per trace. Human-triggered, so no project
 * opt-in flag; runs inside a user-facing endpoint, so every unmet gate must
 * THROW a clear message, not swallow.
 */

const projectId: ObjectID = ObjectID.generate();
const traceId: string = "abc123trace";
const userId: ObjectID = ObjectID.generate();

function fakeRun(taskContext?: CodeFixTaskContext): AIRun {
  return {
    id: ObjectID.generate(),
    taskContext,
  } as unknown as AIRun;
}

// A trace with a textbook N+1: root + 5 near-identical children.
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

describe("FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace", () => {
  beforeEach(() => {
    // The daily fix-run budget has its own suite (FixRunBudget.test.ts).
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
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

  test("no deterministic finding → reject with a clear message, nothing queried or enqueued", async () => {
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
    ).rejects.toThrow(/No deterministic performance pattern/);

    expect(countBy).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("no GitHub-App repository → reject, nothing enqueued", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
      }),
    ).rejects.toThrow(/GitHub/);

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
});
