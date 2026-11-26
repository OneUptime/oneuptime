import FixPerformanceTaskTrigger, {
  FinishedPerformanceFix,
  MAX_ANALYZED_TRACE_SPANS,
  NO_CONNECTED_REPOSITORY_FOR_PERFORMANCE_FIX_MESSAGE,
  PERFORMANCE_FIX_ALREADY_DONE_MESSAGE,
  PerformanceTraceSpans,
  TracePerformanceFixRepositoryUse,
} from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import CodeTaskAccess from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import { ResolvableRepository } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import CodeTaskRuns from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import { CODE_TASK_PLAN_REQUIRED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeHostAccess from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../Types/AI/CodeTask";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import SpanTreeAnalyzer, {
  AnalyzableSpan,
} from "../../../Utils/Traces/SpanTreeAnalyzer";
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
  MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES,
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  NO_TRACE_PERFORMANCE_FIX_SUGGESTION,
  PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
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
import FixTurnsTable from "../Utils/AI/CodeFix/FixTurnsTable";
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

// A connected repository as the resolver reads it.
function resolvable(
  id: string,
  name?: string | undefined,
): ResolvableRepository {
  return {
    id,
    name: name || `repository-${id.slice(-4)}`,
    organizationName: "acme",
    repositoryName: (name || `repository-${id.slice(-4)}`).toLowerCase(),
    mainBranchName: "main",
    gitHubAppInstallationId: "1234",
  };
}

/*
 * The connected repositories the person who asks may use in Code (#11075):
 * read, and ask OneUptime AI to work in. The gate's one, unless a test says,
 * so the gates a test is about are the only ones in its way.
 */
function personMayUse(
  usable: Array<string> = [GATE_REPOSITORY_ID.toString()],
  connectedCount: number = usable.length,
): jest.SpyInstance {
  let allowance: CodeRepositoryAllowance = EVERY_CODE_REPOSITORY;

  if (usable.length === 0) {
    allowance = NO_CODE_REPOSITORY;
  } else if (usable.length < connectedCount) {
    allowance = {
      isEveryRepository: false,
      repositoryIds: usable.map((id: string): string => {
        return id.toLowerCase();
      }),
    };
  }

  const use: TracePerformanceFixRepositoryUse = {
    connectedCount,
    usable: usable.map((id: string): ResolvableRepository => {
      return resolvable(id);
    }),
    allowance,
  };

  return jest
    .spyOn(FixPerformanceTaskTrigger, "getUsableRepositories")
    .mockResolvedValue(use);
}

/*
 * What one person may do in Code with the project's repositories (#11075),
 * as CodeTaskAccess answers it under their own permissions: of the ones
 * that exist (connected or not), each is theirs to read unless it is
 * `unreadable`, and theirs to ask OneUptime AI to work in unless it is
 * `notAskable`. `asked` holds whose permissions each read was made under.
 */
interface PersonInCode {
  existing: Set<string>;
  unreadable: Set<string>;
  notAskable: Set<string>;
  asked: Array<DatabaseCommonInteractionProps>;
}

function noPersonInCodeYet(): PersonInCode {
  return {
    existing: new Set<string>(),
    unreadable: new Set<string>(),
    notAskable: new Set<string>(),
    asked: [],
  };
}

const keyOfId: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().trim().toLowerCase();
};

function repositoryRow(id: string): CodeRepository {
  const repository: CodeRepository = new CodeRepository();
  repository.id = new ObjectID(id);
  return repository;
}

// CodeTaskAccess, answering for one person from a world of their permissions.
function fakePersonInCode(): PersonInCode {
  const person: PersonInCode = noPersonInCodeYet();

  const mayRead: (id: string) => boolean = (id: string): boolean => {
    return person.existing.has(id) && !person.unreadable.has(id);
  };

  const mayAsk: (id: string) => boolean = (id: string): boolean => {
    return person.existing.has(id) && !person.notAskable.has(id);
  };

  jest
    .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
    .mockImplementation(
      async (data: {
        props: DatabaseCommonInteractionProps;
        repositoryIds: Array<ObjectID | string>;
      }): Promise<Array<CodeRepository>> => {
        person.asked.push(data.props);

        return data.repositoryIds
          .map(keyOfId)
          .filter(mayRead)
          .map(repositoryRow);
      },
    );
  jest
    .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
    .mockImplementation(
      async (data: {
        props: DatabaseCommonInteractionProps;
        repositoryIds: Array<ObjectID | string>;
      }): Promise<Set<string>> => {
        person.asked.push(data.props);

        return new Set<string>(data.repositoryIds.map(keyOfId).filter(mayAsk));
      },
    );
  jest
    .spyOn(CodeTaskAccess, "findReadableRepository")
    .mockImplementation(
      async (data: {
        props: DatabaseCommonInteractionProps;
        repositoryId: ObjectID;
      }): Promise<CodeRepository | null> => {
        person.asked.push(data.props);
        const id: string = keyOfId(data.repositoryId);

        return mayRead(id) ? repositoryRow(id) : null;
      },
    );
  jest
    .spyOn(CodeTaskAccess, "canAskInRepository")
    .mockImplementation(
      async (data: {
        props: DatabaseCommonInteractionProps;
        repositoryId: ObjectID;
      }): Promise<boolean> => {
        person.asked.push(data.props);

        return mayAsk(keyOfId(data.repositoryId));
      },
    );

  return person;
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

// Who reads the trace page: a member, who may read the fix's task unless a test says.
const READER: DatabaseCommonInteractionProps = {
  userId: userId,
  tenantId: projectId,
};

function fakeRun(taskContext?: CodeFixTaskContext): AIRun {
  return {
    id: ObjectID.generate(),
    taskContext,
  } as unknown as AIRun;
}

/*
 * The project's runs: a performance fix still working for each trace named,
 * read by the one rule every fix holds to (CodeFixOnItsWay, FixTurnsTable).
 */
function runsWorking(traceIds: Array<string>): FixTurnsTable {
  const table: FixTurnsTable = new FixTurnsTable(projectId);

  for (const workingTraceId of traceIds) {
    table.addFirstTurn({
      codeFixTaskType: CodeFixTaskType.FixPerformance,
      status: AIRunStatus.Running,
      taskContext: { traceId: workingTraceId },
    });
  }

  table.install();

  return table;
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
    // Who may start one has its own describe below (#11075).
    personMayUse();
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
        props: READER,
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
        props: READER,
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
        props: READER,
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
        props: READER,
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
          props: READER,
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
        props: READER,
      }),
    ).rejects.toThrow(/^No connected repository exists for this project/);

    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe: a live FixPerformance run for the SAME trace blocks a second one", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const runs: FixTurnsTable = runsWorking([traceId]);
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
        props: READER,
      }),
    ).rejects.toThrow(
      "A performance fix task is already queued or running for this trace. Track its progress in Code.",
    );

    // The dedupe asks of FixPerformance tasks of the project with this trace.
    expect(runs.statements[0]!.parameters[0]).toBe(projectId.toString());
    expect(runs.statements[0]!.parameters[3]).toEqual([
      CodeFixTaskType.FixPerformance,
    ]);
    expect(JSON.parse(String(runs.statements[0]!.parameters[4]))).toEqual({
      traceId,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe: a reply working in Code on the trace's fix whose first turn failed blocks a second one", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    const runs: FixTurnsTable = runsWorking([]);
    runs.addReply(
      runs.addFirstTurn({
        codeFixTaskType: CodeFixTaskType.FixPerformance,
        status: AIRunStatus.Error,
        taskContext: { traceId },
      }),
      AIRunStatus.Running,
    );
    const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");

    await expect(
      FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
        props: READER,
      }),
    ).rejects.toThrow(/already queued or running/);

    expect(create).not.toHaveBeenCalled();
  });

  test("dedupe is per-trace: a live run for a DIFFERENT trace does not block", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    runsWorking(["some-other-trace"]);
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(fakeRun());

    await FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
      projectId,
      traceId,
      spans: spansWithNPlusOne(),
      userId,
      props: READER,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  test("happy path: enqueues a Queued FixPerformance run whose taskContext carries the evidence", async () => {
    jest
      .spyOn(CodeRepositoryService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    runsWorking([]);
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
        props: READER,
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
    runsWorking([]);
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
      props: READER,
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
        props: READER,
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
        props: READER,
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
        props: READER,
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
      props: READER,
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
      props: READER,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: CodeFixTaskType.FixPerformance,
        codeRepositoryId: GATE_REPOSITORY_ID,
        userId,
      }),
    );
    // And held to it when it starts: the repository the person may use.
    expect(
      (enqueue.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
        .taskContext.pickedCodeRepositoryId,
    ).toBe(GATE_REPOSITORY_ID.toString());
  });

  /*
   * #11075: a run queued without a repository found its own when it
   * started, among every connected one - one the person may not use
   * included. The only repository the person may use is the one it works in.
   */
  test("no repository resolves for the gate, and the person may use one: the run is made in it, and held to it when it starts", async () => {
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
      props: READER,
    });

    const queued: {
      codeRepositoryId?: ObjectID | null;
      taskContext: CodeFixTaskContext;
    } = enqueue.mock.calls[0]![0];
    expect(queued.codeRepositoryId?.toString()).toBe(
      GATE_REPOSITORY_ID.toString(),
    );
    expect(queued.taskContext.pickedCodeRepositoryId).toBe(
      GATE_REPOSITORY_ID.toString(),
    );
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
        props: READER,
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

  // The reader may read the fix's task, unless a test says otherwise.
  let hiddenFrom: jest.SpyInstance;

  beforeEach(() => {
    hiddenFrom = jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());
    // Who may start one has its own describe (#11075).
    personMayUse();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A fix whose task a reply carried a private incident or alert into,
   * which the reader may not open, read as its task's own page reads it:
   * it is there - Done, Hidden, no second fix offered - and nothing of how
   * it stands, nor where it is.
   */
  test.each([
    ["on its way", true],
    ["done", false],
  ])(
    "a fix %s in a task hidden from the reader: there, with no state and no link",
    async (_name: string, isActive: boolean) => {
      aiSwitch(true);
      const fix: AIRun = fakeRun({ traceId });
      jest
        .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
        .mockResolvedValue(isActive ? fix : null);
      jest
        .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
        .mockResolvedValue(
          isActive
            ? null
            : {
                aiRunId: fix.id!.toString(),
                outcome: FinishedFixOutcome.Fixed,
              },
        );
      hiddenFrom.mockResolvedValue(
        new Set<string>([fix.id!.toString().toLowerCase()]),
      );
      const repository: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "hasConnectedRepository",
      );

      const suggestion: TracePerformanceFixSuggestion =
        await FixPerformanceTaskTrigger.getSuggestionForTrace({
          reader: READER,
          projectId,
          traceId,
          loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
        });

      expect(suggestion.offer).toBe(SuggestionOffer.Done);
      expect(suggestion.fixOutcome).toBe(FinishedFixOutcome.Hidden);
      expect(suggestion.aiRunId).toBeNull();
      expect(suggestion.repositories).toEqual([]);
      expect(suggestion.finding).not.toBeNull();
      expect(JSON.stringify(suggestion)).not.toContain(fix.id!.toString());
      expect(repository).not.toHaveBeenCalled();
      expect(hiddenFrom).toHaveBeenCalledWith({
        projectId,
        taskIds: [fix.id!.toString()],
        reader: READER,
      });
    },
  );

  test("no fix: the reader's sight of a task is never asked", async () => {
    aiSwitch(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
      .mockResolvedValue(null);
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    await FixPerformanceTaskTrigger.getSuggestionForTrace({
      reader: READER,
      projectId,
      traceId,
      loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
    });

    expect(hiddenFrom).not.toHaveBeenCalled();
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
        reader: READER,
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
          reader: READER,
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
          reader: READER,
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
          reader: READER,
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
        reader: READER,
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
        reader: READER,
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
          reader: READER,
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
      reader: READER,
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
          reader: READER,
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
        reader: READER,
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
        reader: READER,
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
        reader: READER,
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
  beforeEach(() => {
    jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const traces: Array<TraceFixture> = [
    ...WORTH_FIXING_TRACES,
    ...NOT_WORTH_FIXING_TRACES,
  ];

  /*
   * Which of the connected repositories the person may use in Code
   * (#11075): every one, none of them, or - the rows counted, but none
   * OneUptime AI can reach - nothing to use at all.
   */
  type PersonUse = "may use every one" | "may use none" | "none reachable";

  const uses: Array<PersonUse> = [
    "may use every one",
    "may use none",
    "none reachable",
  ];

  const cases: Array<
    [
      string,
      TraceFixture,
      boolean,
      boolean,
      boolean,
      boolean,
      boolean,
      PersonUse,
    ]
  > = [];
  for (const trace of traces) {
    for (const isAiOn of [true, false]) {
      for (const hasRepository of [true, false]) {
        for (const hasActiveRun of [true, false]) {
          for (const hasFinishedFix of [true, false]) {
            for (const isBlocked of [true, false]) {
              for (const use of uses) {
                cases.push([
                  `${trace.title}, AI ${isAiOn ? "on" : "off"}, ${hasRepository ? "a repository" : "no repository"}, ${hasActiveRun ? "a fix in flight" : "no fix in flight"}, ${hasFinishedFix ? "a fix done" : "none done"}, ${isBlocked ? "Code's gate says no" : "nothing in the way"}, the person ${use}`,
                  trace,
                  isAiOn,
                  hasRepository,
                  hasActiveRun,
                  hasFinishedFix,
                  isBlocked,
                  use,
                ]);
              }
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
      use: PersonUse,
    ) => {
      aiSwitch(isAiOn);
      if (use === "may use every one") {
        personMayUse();
      } else if (use === "may use none") {
        personMayUse([], 1);
      } else {
        personMayUse([], 0);
      }
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
          reader: READER,
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
          props: READER,
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

/*
 * A REPOSITORY PICKER FOR FIX PERFORMANCE WITH AI (the follow-up #5273
 * listed). With several repositories connected and none found to hold the
 * trace's code for certain, the run used to be queued anyway and to find no
 * repository when it started. Now the page asks the person which repository
 * holds the code (as a telemetry finding's Fix with AI does), the create
 * route takes the pick - held to the project's connected repositories -
 * and the run works in it, when it is queued and when it starts. Without a
 * pick where one is needed, the click is refused in the words of the step
 * that is missing.
 */
describe("a repository to pick for a fix no repository was found for", () => {
  const REPOSITORIES: Array<{ id: string; name: string }> = [
    { id: "51000000-0000-4000-8000-000000000003", name: "web-storefront" },
    { id: "51000000-0000-4000-8000-000000000001", name: "Checkout-API" },
    { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
  ];

  /*
   * The project's connected repositories: the list a suggestion reads
   * (getResolvableRepositories), and whether one is connected, as a pick
   * is checked (CodeHostAccess, through CodeTaskGate.isRepositoryReachable).
   */
  let reachableAsked: Array<Array<string>> = [];

  // What the person may do in Code with the project's repositories (#11075).
  let person: PersonInCode = noPersonInCodeYet();

  function connectedRepositories(
    repositories: Array<{ id: string; name: string }> = REPOSITORIES,
  ): jest.SpyInstance {
    const connected: Set<string> = new Set<string>(
      repositories.map((repository: { id: string; name: string }): string => {
        return repository.id.toLowerCase();
      }),
    );

    for (const id of connected) {
      person.existing.add(id);
    }

    reachableAsked = [];
    jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        const ids: Array<string> = data.repositoryIds.map(
          (id: ObjectID): string => {
            return id.toString();
          },
        );

        reachableAsked.push(ids);

        return new Set<string>(
          ids.filter((id: string): boolean => {
            return connected.has(id);
          }),
        );
      });

    return jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue(
        repositories.map((repository: { id: string; name: string }) => {
          return {
            id: repository.id,
            name: repository.name,
            organizationName: "acme",
            repositoryName: repository.name.toLowerCase(),
            mainBranchName: "main",
            gitHubAppInstallationId: "1234",
          };
        }),
      );
  }

  // More connected repositories than a suggestion lists, by name.
  function manyRepositories(
    count: number,
  ): Array<{ id: string; name: string }> {
    return Array.from(
      { length: count },
      (_: unknown, index: number): { id: string; name: string } => {
        const number: string = String(index + 1).padStart(6, "0");

        return {
          id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          name: `ap-${number}`,
        };
      },
    );
  }

  function noFixYet(): void {
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
  }

  function loadOf(spans: Array<AnalyzableSpan>): jest.Mock {
    return jest.fn(async (): Promise<PerformanceTraceSpans> => {
      return { spans, dominantEntityId: null };
    });
  }

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    aiSwitch(true);
    noFinishedFix();
    noFixYet();
    person = fakePersonInCode();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what the trace page offers", () => {
    async function suggest(): Promise<TracePerformanceFixSuggestion> {
      return FixPerformanceTaskTrigger.getSuggestionForTrace({
        reader: READER,
        projectId,
        traceId,
        loadTrace: loadOf(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans),
      });
    }

    test("none resolves, several connected: the fix, with the repositories to pick from, by name", async () => {
      gateSays(null, null);
      connectedRepositories();

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.Act);
      expect(suggestion.repositories).toEqual([
        { id: "51000000-0000-4000-8000-000000000002", name: "billing" },
        { id: "51000000-0000-4000-8000-000000000001", name: "Checkout-API" },
        { id: "51000000-0000-4000-8000-000000000003", name: "web-storefront" },
      ]);
    });

    test("the trace's facts resolve a repository: no pick, the fix works in it", async () => {
      const gate: jest.SpyInstance = gateSays(null, GATE_REPOSITORY_ID);
      const list: jest.SpyInstance = connectedRepositories();

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.Act);
      expect(suggestion.repositories).toEqual([]);
      // Read once, to weigh which the reader may use (#11075) - no list to pick from.
      expect(list).toHaveBeenCalledTimes(1);
      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual(EVERY_CODE_REPOSITORY);
    });

    test("one repository is no choice: no pick", async () => {
      gateSays(null, null);
      connectedRepositories(REPOSITORIES.slice(0, 1));

      expect((await suggest()).repositories).toEqual([]);
    });

    test("past the first 200: the answer lists the first 200 by name - enough to say a pick is asked for, which the page searches for", async () => {
      gateSays(null, null);
      connectedRepositories(
        manyRepositories(MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES + 50),
      );

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.Act);
      expect(suggestion.repositories).toHaveLength(
        MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES,
      );
      expect(suggestion.repositories[0]!.name).toBe("ap-000001");
    });

    test("Code's gate says a step is missing: that step, and no pick", async () => {
      gateSays(NO_CREDITS, null);
      connectedRepositories();

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
      expect(suggestion.repositories).toEqual([]);
    });

    /*
     * #11075: with no list, who may start the fix cannot be told - and a
     * fix offered then could be one the person may not start. The route
     * answers the error, and the page offers nothing for it (any failure
     * there means no suggestion).
     */
    test("a list that cannot be read: no fix is offered as if it could start", async () => {
      gateSays(null, null);
      jest
        .spyOn(CodeRepositoryService, "getResolvableRepositories")
        .mockRejectedValue(new Error("connection refused"));

      await expect(suggest()).rejects.toThrow("connection refused");
    });

    test("a repository with no name of its own is named by its organization and repository", async () => {
      gateSays(null, null);
      person.existing.add("51000000-0000-4000-8000-000000000009");
      person.existing.add("51000000-0000-4000-8000-000000000001");
      jest
        .spyOn(CodeRepositoryService, "getResolvableRepositories")
        .mockResolvedValue([
          {
            id: "51000000-0000-4000-8000-000000000009",
            name: "  ",
            organizationName: "acme",
            repositoryName: "ledger",
            mainBranchName: "main",
            gitHubAppInstallationId: "1234",
          },
          {
            id: "51000000-0000-4000-8000-000000000001",
            name: "checkout",
            organizationName: "acme",
            repositoryName: "checkout",
            mainBranchName: "main",
            gitHubAppInstallationId: "1234",
          },
        ]);

      expect((await suggest()).repositories).toEqual([
        { id: "51000000-0000-4000-8000-000000000009", name: "acme/ledger" },
        { id: "51000000-0000-4000-8000-000000000001", name: "checkout" },
      ]);
    });
  });

  describe("what a click does", () => {
    async function click(repositoryId?: ObjectID | undefined): Promise<AIRun> {
      return FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        serviceName: "orders-service",
        userId,
        props: READER,
        ...(repositoryId ? { repositoryId } : {}),
      });
    }

    test("a pick: recorded on the run, Code's gate asked with it, and the run queued on it", async () => {
      connectedRepositories();
      const picked: ObjectID = new ObjectID(REPOSITORIES[2]!.id);
      const gate: jest.SpyInstance = gateSays(null, picked);
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click(new ObjectID(REPOSITORIES[2]!.id.toUpperCase()));

      const gateContext: CodeFixTaskContext = (
        gate.mock.calls[0]![0] as { taskContext: CodeFixTaskContext }
      ).taskContext;
      expect(gateContext.pickedCodeRepositoryId).toBe(REPOSITORIES[2]!.id);

      const queued: {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
      } = enqueue.mock.calls[0]![0] as {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
      };
      expect(queued.codeRepositoryId?.toString()).toBe(REPOSITORIES[2]!.id);
      expect(queued.taskContext.pickedCodeRepositoryId).toBe(
        REPOSITORIES[2]!.id,
      );
      // The trace's evidence still travels with it.
      expect(queued.taskContext.traceId).toBe(traceId);
    });

    test("a pick that is none of the project's repositories is refused as not found - never said to exist - nothing queued", async () => {
      connectedRepositories();
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      const refusal: unknown = await click(ObjectID.generate()).catch(
        (error: unknown) => {
          return error;
        },
      );

      expect(refusal).toBeInstanceOf(NotFoundException);
      expect((refusal as Error).message).toBe(
        PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("a pick the person may use that is not connected is refused as not connected, nothing queued", async () => {
      connectedRepositories();
      // Theirs to read and ask in, but OneUptime cannot reach it.
      const disconnected: string = "51000000-0000-4000-8000-0000000000dd";
      person.existing.add(disconnected);
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      const refusal: unknown = await click(new ObjectID(disconnected)).catch(
        (error: unknown) => {
          return error;
        },
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
      );
      expect(reachableAsked).toEqual([[disconnected]]);
      expect(enqueue).not.toHaveBeenCalled();
    });

    /*
     * #10921: the pick was checked against the first 200 connected
     * repositories by name, so one past them - which the page's search
     * finds - was refused as not connected.
     */
    test("a pick past the first 200 connected repositories by name is taken: checked by itself, never against a list", async () => {
      const repositories: Array<{ id: string; name: string }> =
        manyRepositories(MAX_TRACE_PERFORMANCE_FIX_REPOSITORIES + 50);
      const last: { id: string; name: string } =
        repositories[repositories.length - 1]!;
      const list: jest.SpyInstance = connectedRepositories(repositories);
      const gate: jest.SpyInstance = gateSays(null, new ObjectID(last.id));
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click(new ObjectID(last.id));

      // Only that one repository was asked about - no list was read.
      expect(reachableAsked).toEqual([[last.id]]);
      expect(list).not.toHaveBeenCalled();
      expect(
        (gate.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
          .taskContext.pickedCodeRepositoryId,
      ).toBe(last.id);
      expect(
        (enqueue.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
          .taskContext.pickedCodeRepositoryId,
      ).toBe(last.id);
    });

    test("a pick in another letter case is asked about as the database writes an id", async () => {
      connectedRepositories();
      gateSays(null, new ObjectID(REPOSITORIES[1]!.id));
      jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click(new ObjectID(REPOSITORIES[1]!.id.toUpperCase()));

      expect(reachableAsked).toEqual([[REPOSITORIES[1]!.id]]);
    });

    test("nothing picked, or no id, is no choice", async () => {
      connectedRepositories();

      expect(
        await FixPerformanceTaskTrigger.isRepositoryChoice({
          projectId,
          props: READER,
        }),
      ).toBe(false);
      expect(
        await FixPerformanceTaskTrigger.isRepositoryChoice({
          projectId,
          pickedRepositoryId: new ObjectID("not-an-id"),
          props: READER,
        }),
      ).toBe(false);
      // Refused before anything is read.
      expect(reachableAsked).toEqual([]);
      expect(person.asked).toEqual([]);
      expect(
        await FixPerformanceTaskTrigger.isRepositoryChoice({
          projectId,
          pickedRepositoryId: new ObjectID(REPOSITORIES[0]!.id),
          props: READER,
        }),
      ).toBe(true);
    });

    test("none resolves, several connected, no pick: refused in the words of the missing step, nothing queued", async () => {
      connectedRepositories();
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      await expect(click()).rejects.toThrow(
        PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    /*
     * #11075: it was queued without a repository, to find its own when it
     * started - among every connected repository, one the person may not
     * use included. The only one is the one it works in now.
     */
    test("none resolves and there is no choice to make: the run is made in the one repository, and held to it", async () => {
      connectedRepositories(REPOSITORIES.slice(0, 1));
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click();

      expect(enqueue).toHaveBeenCalledTimes(1);
      const queued: {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
      } = enqueue.mock.calls[0]![0];
      expect(queued.taskContext.pickedCodeRepositoryId).toBe(
        REPOSITORIES[0]!.id,
      );
      expect(queued.codeRepositoryId?.toString()).toBe(REPOSITORIES[0]!.id);
    });

    test("the trace's facts resolve a repository: no pick needed, queued on it", async () => {
      const list: jest.SpyInstance = connectedRepositories();
      gateSays(null, GATE_REPOSITORY_ID);
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click();

      expect(
        (
          enqueue.mock.calls[0]![0] as { codeRepositoryId?: ObjectID }
        ).codeRepositoryId?.toString(),
      ).toBe(GATE_REPOSITORY_ID.toString());
      // Read once, to weigh which the person may use (#11075).
      expect(list).toHaveBeenCalledTimes(1);
    });

    test("Code's gate refuses the picked repository (its Runner is offline): refused in its words", async () => {
      connectedRepositories();
      const offline: CodeTaskBlocker = {
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: "The Runner this repository picks, build-box, is not online.",
        runnerName: "build-box",
      };
      gateSays(offline, new ObjectID(REPOSITORIES[0]!.id));
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      await expect(click(new ObjectID(REPOSITORIES[0]!.id))).rejects.toThrow(
        offline.message,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("the automatic routing never asks for a pick: queued as before", async () => {
      connectedRepositories();
      jest
        .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
        .mockResolvedValue(null);
      const gate: jest.SpyInstance = gateSays(null, null);
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId,
        findings: SpanTreeAnalyzer.analyzeTrace(spansWithNPlusOne()),
        codeLocations: [],
      });

      expect(gate).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * WHO MAY START A TRACE'S FIX, AND IN WHICH REPOSITORY (#11075).
 *
 * The trace page's picker offered only the connected repositories the
 * person could read, but the create route checked a pick only for being
 * connected, as OneUptime: a request naming any connected repository of
 * the project was taken - one the person may not read, or may not ask
 * OneUptime AI to work in. Every other Fix with AI (a Data Security issue,
 * a telemetry finding, a profile) holds its repository to the person's own
 * permissions in Code, and a trace's fix does now: the person reads the
 * trace, and may read the repository and ask OneUptime AI to work in it.
 *
 * Four connected repositories, each the person's to use or not:
 *
 *   checkout-api   read, and ask in: theirs to use
 *   billing        read, and ask in: theirs to use
 *   ledger         read only: AI is not theirs to ask in it
 *   vault          neither: not theirs to see at all
 */
describe("who may start a trace's fix, and in which repository (#11075)", () => {
  const CHECKOUT: string = "11075000-0000-4000-8000-00000000c001";
  const BILLING: string = "11075000-0000-4000-8000-00000000c002";
  const LEDGER: string = "11075000-0000-4000-8000-00000000c003";
  const VAULT: string = "11075000-0000-4000-8000-00000000c004";
  // The person's to use, but OneUptime cannot reach it.
  const HARBOUR: string = "11075000-0000-4000-8000-00000000c005";

  const NAMES: Record<string, string> = {
    [CHECKOUT]: "checkout-api",
    [BILLING]: "billing",
    [LEDGER]: "ledger",
    [VAULT]: "vault",
  };

  const CONNECTED: Array<string> = [CHECKOUT, LEDGER, VAULT, BILLING];

  let person: PersonInCode = noPersonInCodeYet();
  let reachableAsked: Array<Array<string>> = [];

  /*
   * The project's connected repositories OneUptime AI can work in, as the
   * resolver reads them, and whether one is reachable, as a pick is checked.
   */
  function connect(ids: Array<string> = CONNECTED): jest.SpyInstance {
    const reachable: Set<string> = new Set<string>(ids);

    reachableAsked = [];
    jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        const asked: Array<string> = data.repositoryIds.map(keyOfId);

        reachableAsked.push(asked);

        return new Set<string>(
          asked.filter((id: string): boolean => {
            return reachable.has(id);
          }),
        );
      });

    return jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue(
        ids.map((id: string): ResolvableRepository => {
          return resolvable(id, NAMES[id]);
        }),
      );
  }

  function refusalOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => {
        return null;
      },
      (error: unknown) => {
        return error;
      },
    );
  }

  beforeEach(() => {
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    aiSwitch(true);
    noFinishedFix();
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(true);
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue(null);
    jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(new Set<string>());

    person = fakePersonInCode();
    for (const id of [...CONNECTED, HARBOUR]) {
      person.existing.add(id);
    }
    person.unreadable.add(VAULT);
    person.notAskable.add(VAULT);
    person.notAskable.add(LEDGER);

    connect();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the repositories a person may use", () => {
    async function useOf(): Promise<TracePerformanceFixRepositoryUse> {
      return await FixPerformanceTaskTrigger.getUsableRepositories({
        projectId,
        props: READER,
      });
    }

    test("of the connected ones, those the person may read and ask OneUptime AI to work in - in the list's order", async () => {
      const use: TracePerformanceFixRepositoryUse = await useOf();

      expect(
        use.usable.map((repository: ResolvableRepository): string => {
          return repository.id;
        }),
      ).toEqual([CHECKOUT, BILLING]);
      expect(use.connectedCount).toBe(4);
      // The fix is held to them alone.
      expect(use.allowance).toEqual({
        isEveryRepository: false,
        repositoryIds: [CHECKOUT, BILLING],
      });
    });

    test("weighed under the person's own permissions, never OneUptime's", async () => {
      await useOf();

      expect(person.asked.length).toBeGreaterThan(0);
      for (const props of person.asked) {
        expect(props).toBe(READER);
        expect(props.isRoot).toBeUndefined();
      }
    });

    test("only the ones they may read are asked whether AI is theirs to ask in", async () => {
      const askable: jest.SpyInstance = jest.mocked(
        CodeTaskAccess.listAskableRepositoryIds,
      ) as unknown as jest.SpyInstance;

      await useOf();

      const asked: Array<string> = (
        askable.mock.calls[0]![0] as { repositoryIds: Array<string> }
      ).repositoryIds.map(keyOfId);
      expect(asked.sort()).toEqual([BILLING, CHECKOUT, LEDGER].sort());
    });

    test("a person who may use every one: every connected repository, and the fix is held to none of them in particular", async () => {
      person.unreadable.clear();
      person.notAskable.clear();

      const use: TracePerformanceFixRepositoryUse = await useOf();

      expect(use.usable).toHaveLength(4);
      expect(use.allowance).toEqual(EVERY_CODE_REPOSITORY);
    });

    test("a person who may use none: none, and the fix is held to none", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);

      const use: TracePerformanceFixRepositoryUse = await useOf();

      expect(use.usable).toEqual([]);
      expect(use.connectedCount).toBe(4);
      expect(use.allowance).toEqual(NO_CODE_REPOSITORY);
    });

    test("no repository OneUptime AI can work in: nothing is weighed under the person's permissions", async () => {
      connect([]);

      const use: TracePerformanceFixRepositoryUse = await useOf();

      expect(use).toEqual({
        connectedCount: 0,
        usable: [],
        allowance: NO_CODE_REPOSITORY,
      });
      expect(person.asked).toEqual([]);
    });

    test("past the project's first 10,000 connected repositories: every one is weighed, and the one past them the person may use is theirs", async () => {
      const ids: Array<string> = Array.from(
        { length: 10050 },
        (_: unknown, index: number): string => {
          return `11075000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        },
      );
      const last: string = ids[ids.length - 1]!;

      for (const id of ids) {
        person.existing.add(id);
        if (id !== last) {
          person.notAskable.add(id);
        }
      }
      connect(ids);

      const use: TracePerformanceFixRepositoryUse = await useOf();

      expect(
        use.usable.map((repository: ResolvableRepository): string => {
          return repository.id;
        }),
      ).toEqual([last]);
      expect(use.connectedCount).toBe(10050);
      expect(use.allowance).toEqual({
        isEveryRepository: false,
        repositoryIds: [last],
      });

      const readable: jest.SpyInstance = jest.mocked(
        CodeTaskAccess.listReadableRepositoriesByIds,
      ) as unknown as jest.SpyInstance;
      expect(
        (readable.mock.calls[0]![0] as { repositoryIds: Array<string> })
          .repositoryIds,
      ).toHaveLength(10050);
    });
  });

  describe("a pick, checked by itself", () => {
    test.each([
      ["one they may read and ask OneUptime AI to work in", CHECKOUT, null, ""],
      [
        "one they may read but not ask AI in",
        LEDGER,
        NotAuthorizedException,
        PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
      ],
      [
        "one they may not read",
        VAULT,
        NotFoundException,
        PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
      ],
      [
        "no repository of the project at all",
        "11075000-0000-4000-8000-00000000ffff",
        NotFoundException,
        PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
      ],
      [
        "one they may use that OneUptime cannot reach",
        HARBOUR,
        BadDataException,
        PICKED_REPOSITORY_NOT_CONNECTED_MESSAGE,
      ],
    ])(
      "%s",
      async (
        _name: string,
        repositoryId: string,
        exceptionType: unknown,
        message: string,
      ) => {
        const refusal: Error | null =
          (await FixPerformanceTaskTrigger.checkRepositoryPick({
            projectId,
            pickedRepositoryId: new ObjectID(repositoryId),
            props: READER,
          })) as Error | null;

        if (!exceptionType) {
          expect(refusal).toBeNull();
          return;
        }

        expect(refusal).toBeInstanceOf(exceptionType as typeof Error);
        expect(refusal!.message).toBe(message);
      },
    );

    test("one they may not read is refused as not found, and nothing more is asked of it - not whether it is connected", async () => {
      await FixPerformanceTaskTrigger.checkRepositoryPick({
        projectId,
        pickedRepositoryId: new ObjectID(VAULT),
        props: READER,
      });

      expect(CodeTaskAccess.canAskInRepository).not.toHaveBeenCalled();
      expect(reachableAsked).toEqual([]);
    });

    test("asked under the person's own permissions, in the letter case the database writes", async () => {
      await FixPerformanceTaskTrigger.checkRepositoryPick({
        projectId,
        pickedRepositoryId: new ObjectID(CHECKOUT.toUpperCase()),
        props: READER,
      });

      expect(person.asked).toEqual([READER, READER]);
      expect(
        jest
          .mocked(CodeTaskAccess.findReadableRepository)
          .mock.calls[0]![0].repositoryId.toString(),
      ).toBe(CHECKOUT);
      expect(reachableAsked).toEqual([[CHECKOUT]]);
    });
  });

  describe("a click with a pick", () => {
    async function click(repositoryId: string): Promise<AIRun> {
      return FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
        props: READER,
        repositoryId: new ObjectID(repositoryId),
      });
    }

    test("a pick the person may not ask OneUptime AI to work in is refused in a sentence that says so - nothing queued", async () => {
      const gate: jest.SpyInstance = gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      const refusal: unknown = await refusalOf(click(LEDGER));

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
      );
      // Code's gate is asked of no repository: only what stops everyone.
      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual(NO_CODE_REPOSITORY);
      expect(
        (gate.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
          .taskContext.pickedCodeRepositoryId,
      ).toBeUndefined();
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("a pick the person may not read is refused as not found - nothing queued", async () => {
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      const refusal: unknown = await refusalOf(click(VAULT));

      expect(refusal).toBeInstanceOf(NotFoundException);
      expect((refusal as Error).message).toBe(
        PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("a pick the person may use is taken: the run is made in it, and held to it when it starts", async () => {
      const gate: jest.SpyInstance = gateSays(null, new ObjectID(CHECKOUT));
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click(CHECKOUT);

      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual({ isEveryRepository: false, repositoryIds: [CHECKOUT] });

      const queued: {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
        userId?: ObjectID;
      } = enqueue.mock.calls[0]![0];
      expect(queued.codeRepositoryId?.toString()).toBe(CHECKOUT);
      expect(queued.taskContext.pickedCodeRepositoryId).toBe(CHECKOUT);
      expect(queued.userId).toBe(userId);
    });

    test.each([
      [
        "the plan has no AI in Code",
        {
          type: CodeTaskBlockerType.PlanRequired,
          message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
        },
      ],
      [
        "the subscription is unpaid",
        {
          type: CodeTaskBlockerType.SubscriptionUnpaid,
          message: "This project's subscription is unpaid.",
        },
      ],
    ])(
      "what stops everyone comes first: %s - said, not that the pick is not the person's",
      async (_name: string, blocker: CodeTaskBlocker) => {
        gateSays(blocker, null);

        const refusal: unknown = await refusalOf(click(LEDGER));

        expect(refusal).toBeInstanceOf(PaymentRequiredException);
        expect((refusal as Error).message).toBe(blocker.message);
      },
    );

    test("anything else Code's gate says waits: the person's own refusal comes first, as Code's request box says it", async () => {
      gateSays(NO_CREDITS, null);

      const refusal: unknown = await refusalOf(click(LEDGER));

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
      );
    });

    test("a pick the person may use, that Code's gate says cannot run now, is refused in the gate's words", async () => {
      gateSays(NO_CREDITS, new ObjectID(CHECKOUT));

      const refusal: unknown = await refusalOf(click(CHECKOUT));

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(NO_CREDITS.message);
    });
  });

  describe("a click without a pick", () => {
    async function click(): Promise<AIRun> {
      return FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
        projectId,
        traceId,
        spans: spansWithNPlusOne(),
        userId,
        props: READER,
      });
    }

    test("the trace's facts are resolved among the connected repositories the person may use - never another - and the run is held to the one found", async () => {
      const gate: jest.SpyInstance = gateSays(null, new ObjectID(BILLING));
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click();

      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual({
        isEveryRepository: false,
        repositoryIds: [CHECKOUT, BILLING],
      });

      const queued: {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
      } = enqueue.mock.calls[0]![0];
      expect(queued.codeRepositoryId?.toString()).toBe(BILLING);
      expect(queued.taskContext.pickedCodeRepositoryId).toBe(BILLING);
    });

    test("several the person may use, and the facts match none: a pick is asked for - nothing queued", async () => {
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      await expect(click()).rejects.toThrow(
        PICK_A_REPOSITORY_FOR_THE_FIX_MESSAGE,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("one the person may use, of several connected: the run is made in it, though the facts matched none", async () => {
      person.notAskable.add(BILLING);
      gateSays(null, null);
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click();

      const queued: {
        codeRepositoryId?: ObjectID | null;
        taskContext: CodeFixTaskContext;
      } = enqueue.mock.calls[0]![0];
      expect(queued.codeRepositoryId?.toString()).toBe(CHECKOUT);
      expect(queued.taskContext.pickedCodeRepositoryId).toBe(CHECKOUT);
    });

    test("none the person may use: refused in a sentence that says why, and who can help - nothing queued", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);
      const gate: jest.SpyInstance = gateSays(null, null);
      const enqueue: jest.SpyInstance = jest.spyOn(
        SubjectCodeFixRun,
        "enqueueSubjectCodeFixRun",
      );

      const refusal: unknown = await refusalOf(click());

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
      );
      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual(NO_CODE_REPOSITORY);
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("none the person may use, and the plan has no AI in Code: the plan's words first", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);
      gateSays(
        {
          type: CodeTaskBlockerType.PlanRequired,
          message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
        },
        null,
      );

      const refusal: unknown = await refusalOf(click());

      expect(refusal).toBeInstanceOf(PaymentRequiredException);
      expect((refusal as Error).message).toBe(CODE_TASK_PLAN_REQUIRED_MESSAGE);
    });

    test("none OneUptime AI can work in, though rows are counted: a repository to connect - not a permission to ask for", async () => {
      connect([]);
      gateSays(null, null);

      const refusal: unknown = await refusalOf(click());

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(
        NO_CONNECTED_REPOSITORY_FOR_PERFORMANCE_FIX_MESSAGE,
      );
    });

    test("a person who may use every repository is held to none in particular: the facts pick among all", async () => {
      person.unreadable.clear();
      person.notAskable.clear();
      const gate: jest.SpyInstance = gateSays(null, new ObjectID(LEDGER));
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await click();

      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual(EVERY_CODE_REPOSITORY);
      expect(
        (enqueue.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
          .taskContext.pickedCodeRepositoryId,
      ).toBe(LEDGER);
    });

    test("the automatic routing is OneUptime's own: never held to a person, never asked whose permissions", async () => {
      const gate: jest.SpyInstance = gateSays(null, null);
      const usable: jest.SpyInstance = jest.spyOn(
        FixPerformanceTaskTrigger,
        "getUsableRepositories",
      );
      const enqueue: jest.SpyInstance = jest
        .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
        .mockResolvedValue(fakeRun());

      await FixPerformanceTaskTrigger.createPerformanceFixTaskFromFindings({
        projectId,
        traceId,
        findings: SpanTreeAnalyzer.analyzeTrace(spansWithNPlusOne()),
        codeLocations: [],
      });

      expect(usable).not.toHaveBeenCalled();
      expect(person.asked).toEqual([]);
      expect(gate).not.toHaveBeenCalled();
      expect(
        (enqueue.mock.calls[0]![0] as { taskContext: CodeFixTaskContext })
          .taskContext.pickedCodeRepositoryId,
      ).toBeUndefined();
    });
  });

  describe("what the trace page offers the person", () => {
    async function suggest(): Promise<TracePerformanceFixSuggestion> {
      return FixPerformanceTaskTrigger.getSuggestionForTrace({
        reader: READER,
        projectId,
        traceId,
        loadTrace: async (): Promise<PerformanceTraceSpans> => {
          return {
            spans: SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans,
            dominantEntityId: null,
          };
        },
      });
    }

    test("may use none of the connected repositories: nothing is offered - a click would be refused", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);
      gateSays(null, null);

      expect(await suggest()).toEqual(NO_TRACE_PERFORMANCE_FIX_SUGGESTION);
    });

    test("may use none, and the plan has no AI in Code: the plan's step, as Code says it", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);
      gateSays(
        {
          type: CodeTaskBlockerType.PlanRequired,
          message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
        },
        null,
      );

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
      expect(suggestion.blocker?.type).toBe(CodeTaskBlockerType.PlanRequired);
      expect(suggestion.repositories).toEqual([]);
    });

    test("may use none, and the credits are used up: nothing - the credits would not let them start it either", async () => {
      person.notAskable.add(CHECKOUT);
      person.notAskable.add(BILLING);
      gateSays(NO_CREDITS, null);

      expect(await suggest()).toEqual(NO_TRACE_PERFORMANCE_FIX_SUGGESTION);
    });

    test("may use some: the pick is offered from those alone, by name", async () => {
      gateSays(null, null);

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.Act);
      expect(suggestion.repositories).toEqual([
        { id: BILLING, name: "billing" },
        { id: CHECKOUT, name: "checkout-api" },
      ]);
    });

    test("the page's answer is resolved among the person's repositories, as the click is", async () => {
      const gate: jest.SpyInstance = gateSays(null, new ObjectID(CHECKOUT));

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.Act);
      expect(suggestion.repositories).toEqual([]);
      expect(
        (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
          .allowance,
      ).toEqual({
        isEveryRepository: false,
        repositoryIds: [CHECKOUT, BILLING],
      });
    });

    test("none OneUptime AI can work in: a repository to connect, and Code's gate is not asked", async () => {
      connect([]);
      const gate: jest.SpyInstance = gateSays(null, null);

      const suggestion: TracePerformanceFixSuggestion = await suggest();

      expect(suggestion.offer).toBe(SuggestionOffer.SetUp);
      expect(suggestion.blocker).toBeNull();
      expect(gate).not.toHaveBeenCalled();
    });

    test("weighed under the reader's own permissions", async () => {
      gateSays(null, null);

      await suggest();

      expect(person.asked.length).toBeGreaterThan(0);
      for (const props of person.asked) {
        expect(props).toBe(READER);
      }
    });

    /*
     * The page and the server agree for each kind of person: what the page
     * offers, a click is let through - and what it does not, refused.
     */
    test.each([
      ["may use two", [], true],
      ["may use one", [BILLING], true],
      ["may use none", [CHECKOUT, BILLING], false],
    ])(
      "the person %s: offered exactly when a click would start it",
      async (
        _name: string,
        alsoNotAskable: Array<string>,
        isOffered: boolean,
      ) => {
        for (const id of alsoNotAskable) {
          person.notAskable.add(id);
        }
        gateSays(null, new ObjectID(CHECKOUT));
        jest
          .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
          .mockResolvedValue(fakeRun());

        const suggestion: TracePerformanceFixSuggestion = await suggest();
        const refusal: unknown = await refusalOf(
          FixPerformanceTaskTrigger.createPerformanceFixTaskFromTrace({
            projectId,
            traceId,
            spans: SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans,
            userId,
            props: READER,
          }),
        );

        expect(suggestion.offer === SuggestionOffer.Act).toBe(isOffered);
        expect(refusal === null).toBe(isOffered);
      },
    );
  });
});
