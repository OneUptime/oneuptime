import CommonAPI from "../../../Server/API/CommonAPI";
import AIService from "../../../Server/Services/AIService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import FixPerformanceTaskTrigger from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import CodeFixStartGate, {
  CodeFixStart,
} from "../../../Server/Utils/AI/CodeFix/CodeFixStartGate";
import FixRunBudget from "../../../Server/Utils/AI/CodeFix/FixRunBudget";
import CodeTaskThread from "../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import CodeTaskAccess from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import { CODE_TASK_PLAN_REQUIRED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeHostAccess from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { FinishedFixOutcome } from "../../../Utils/Suggestions/CodeFixSuggestion";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Service from "../../../Models/DatabaseModels/Service";
import Span from "../../../Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
  parseTracePerformanceFixSuggestion,
  PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
  PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
  TracePerformanceFixSuggestion,
} from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import { AnalyzableSpan } from "../../../Utils/Traces/SpanTreeAnalyzer";
import {
  HEALTH_CHECK,
  SLOW_CHECKOUT_WITH_N_PLUS_ONE,
  TraceFixture,
} from "../../Utils/Suggestions/TraceFixtures";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * The two routes behind the trace page's "Fix performance with AI":
 *
 *   POST /ai-investigation/performance-fix-suggestion - what the page draws
 *   POST /ai-investigation/create-performance-fix-task - what a click does
 *
 * Both read the trace's spans under the signed-in user's permissions and run
 * the same analysis and gates (FixPerformanceTaskTrigger), so what the first
 * offers is what the second accepts. These tests drive the real handlers
 * with the span store, the AI switch and the repository/run lookups stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
// The project's connected repositories, by what the member may do in them.
const CHECKOUT_REPOSITORY_ID: string = "11075000-0000-4000-8000-0000000000a1";
const LEDGER_REPOSITORY_ID: string = "11075000-0000-4000-8000-0000000000a2";
const VAULT_REPOSITORY_ID: string = "11075000-0000-4000-8000-0000000000a3";

function memberProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
  };
}

// The fixture's spans as the span store returns them (nanoseconds).
function storedSpans(trace: TraceFixture): Array<Span> {
  return trace.spans.map((span: AnalyzableSpan): Span => {
    return {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId || "",
      name: span.name,
      startTimeUnixNano: (span.startMs || 0) * 1_000_000,
      endTimeUnixNano: (span.endMs || 0) * 1_000_000,
      durationUnixNano: ((span.endMs || 0) - (span.startMs || 0)) * 1_000_000,
      attributes: span.attributes || {},
      primaryEntityId: new ObjectID(SERVICE_ID),
    } as unknown as Span;
  });
}

type Call = { thrown: unknown; json: JSONObject | undefined };

async function post(uri: string, body: JSONObject): Promise<Call> {
  const req: ExpressRequest = {
    body,
    headers: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sent: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    json: sent.mock.calls[0]
      ? (sent.mock.calls[0][2] as JSONObject)
      : undefined,
  };
}

const SUGGESTION_ROUTE: string = "/ai-investigation/performance-fix-suggestion";
const CREATE_ROUTE: string = "/ai-investigation/create-performance-fix-task";

beforeAll(async () => {
  mockRouter.routes.length = 0;
  await import("../../../Server/API/AIInvestigationAPI");
});

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(memberProps());
  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue();
  jest
    .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
    .mockResolvedValue(null);
  jest
    .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
    .mockResolvedValue(true);
  // No fix for the trace did its work yet, and Code's gate says nothing.
  jest
    .spyOn(FixPerformanceTaskTrigger, "findFinishedFix")
    .mockResolvedValue(null);
  jest
    .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
    .mockResolvedValue(null);
  jest
    .spyOn(CodeFixStartGate, "check")
    .mockResolvedValue({ codeRepositoryId: null, blocker: null });
  jest
    .spyOn(ServiceService, "findOneById")
    .mockResolvedValue({ name: "checkout-service" } as unknown as Service);
  // The member may read the fix's task, unless a test says otherwise.
  jest
    .spyOn(CodeTaskThread, "findTasksHiddenFrom")
    .mockResolvedValue(new Set<string>());
  /*
   * The member may use the project's one connected repository in Code,
   * unless a test says otherwise: who may start a trace's fix has its own
   * tests below (#11075).
   */
  jest
    .spyOn(FixPerformanceTaskTrigger, "getUsableRepositories")
    .mockResolvedValue({
      connectedCount: 1,
      usable: [
        {
          id: CHECKOUT_REPOSITORY_ID,
          name: "checkout",
          organizationName: "acme",
          repositoryName: "checkout",
          mainBranchName: "main",
          gitHubAppInstallationId: "1234",
        },
      ],
      allowance: EVERY_CODE_REPOSITORY,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-investigation/performance-fix-suggestion", () => {
  test("a traceId is required, before anything is read", async () => {
    const isEnabled: jest.SpyInstance = jest.spyOn(
      AIService,
      "isProjectAIEnabled",
    );
    const spans: jest.SpyInstance = jest.spyOn(SpanService, "findBy");

    const call: Call = await post(SUGGESTION_ROUTE, {});

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as Error).message).toBe("traceId is required.");
    expect(isEnabled).not.toHaveBeenCalled();
    expect(spans).not.toHaveBeenCalled();
  });

  test("a project scope is required", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ ...memberProps(), tenantId: undefined });

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect((call.thrown as Error).message).toBe("A project scope is required.");
  });

  test("a slow checkout with an N+1: offers the fix and names what it found, reading the spans as the user", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { traceId: TRACE_ID },
        props: memberProps(),
      }),
    );

    const suggestion: TracePerformanceFixSuggestion =
      parseTracePerformanceFixSuggestion(call.json);

    expect(suggestion.offer).toBe(SuggestionOffer.Act);
    expect(suggestion.finding?.spanCount).toBe(14);
    expect(suggestion.finding?.combinedDurationMs).toBe(840);
    expect(suggestion.finding?.parentSpanName).toBe("POST /api/v1/checkout");
    expect(call.json).toEqual(
      expect.objectContaining({
        offer: "Act",
        findingCount: 1,
        aiRunId: null,
      }),
    );
  });

  test("a 3 ms health check: no suggestion, answered as JSON, not an error", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(HEALTH_CHECK));

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json).toEqual({
      offer: "None",
      finding: null,
      findingCount: 0,
      fixOutcome: null,
      blocker: null,
      aiRunId: null,
      repositories: [],
    });
  });

  test("AI off: no suggestion, and the spans are never read", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);
    const findBy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.json?.["offer"]).toBe("None");
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a trace the user cannot read: no suggestion", async () => {
    jest.spyOn(SpanService, "findBy").mockResolvedValue([]);

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json?.["offer"]).toBe("None");
  });

  test("no repository: SetUp, with the finding", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest
      .spyOn(SubjectCodeFixRun, "hasConnectedRepository")
      .mockResolvedValue(false);

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(parseTracePerformanceFixSuggestion(call.json).offer).toBe(
      SuggestionOffer.SetUp,
    );
  });

  test("a fix already on its way: InProgress with its run id", async () => {
    const runId: ObjectID = ObjectID.generate();
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest
      .spyOn(SubjectCodeFixRun, "findNonTerminalPerformanceFixRunForTrace")
      .mockResolvedValue({ id: runId } as unknown as AIRun);

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(parseTracePerformanceFixSuggestion(call.json)).toEqual(
      expect.objectContaining({
        offer: SuggestionOffer.InProgress,
        aiRunId: runId.toString(),
      }),
    );
  });

  test("a fix that already did its work: Done, with its run and how it came out", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(FixPerformanceTaskTrigger, "findFinishedFix").mockResolvedValue({
      aiRunId: "70000000-0000-4000-8000-000000000010",
      outcome: FinishedFixOutcome.NothingToChange,
    });

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json).toEqual(
      expect.objectContaining({
        offer: "Done",
        fixOutcome: "NothingToChange",
        blocker: null,
        aiRunId: "70000000-0000-4000-8000-000000000010",
      }),
    );
    expect(parseTracePerformanceFixSuggestion(call.json).offer).toBe(
      SuggestionOffer.Done,
    );
  });

  /*
   * A fix whose task a reply carried a private incident or alert into,
   * which the person may not open: the trace says it is there, and nothing
   * of how it stands or where it is - the run is asked about for this
   * person, in the project they asked in.
   */
  test("a fix in a task hidden from the reader: Done, Hidden, with no run", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(FixPerformanceTaskTrigger, "findFinishedFix").mockResolvedValue({
      aiRunId: "70000000-0000-4000-8000-000000000010",
      outcome: FinishedFixOutcome.Fixed,
    });
    const hiddenFrom: jest.SpyInstance = jest
      .spyOn(CodeTaskThread, "findTasksHiddenFrom")
      .mockResolvedValue(
        new Set<string>(["70000000-0000-4000-8000-000000000010"]),
      );

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json).toEqual(
      expect.objectContaining({
        offer: "Done",
        fixOutcome: "Hidden",
        aiRunId: null,
      }),
    );
    expect(JSON.stringify(call.json)).not.toContain(
      "70000000-0000-4000-8000-000000000010",
    );
    expect(parseTracePerformanceFixSuggestion(call.json)).toEqual(
      expect.objectContaining({
        offer: SuggestionOffer.Done,
        fixOutcome: FinishedFixOutcome.Hidden,
        aiRunId: null,
      }),
    );

    const asked: { reader: DatabaseCommonInteractionProps } = hiddenFrom.mock
      .calls[0]![0] as never;
    expect(asked.reader.userId).toEqual(USER_ID);
    expect(asked.reader.isRoot).toBeUndefined();
  });

  test("Code's gate says the plan does not include AI in Code: SetUp, with the blocker as the page draws it", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID("50000000-0000-4000-8000-000000000005"),
      blocker: {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
    } as CodeFixStart);

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json?.["offer"]).toBe("SetUp");
    expect(call.json?.["blocker"]).toEqual({
      type: CodeTaskBlockerType.PlanRequired,
      message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      repositoryId: "50000000-0000-4000-8000-000000000005",
    });
    expect(parseTracePerformanceFixSuggestion(call.json).blocker?.type).toBe(
      CodeTaskBlockerType.PlanRequired,
    );
    // The gate was asked about the trace's service, read as OneUptime.
    expect(ServiceService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });
});

describe("POST /ai-investigation/create-performance-fix-task", () => {
  test("a trace the user cannot read is 'not found'", async () => {
    jest.spyOn(SpanService, "findBy").mockResolvedValue([]);
    const create: jest.SpyInstance = jest.spyOn(
      FixPerformanceTaskTrigger,
      "createPerformanceFixTaskFromTrace",
    );

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect((call.thrown as Error).message).toBe(
      "Trace not found (or you do not have access to it).",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("creates the task from the user's spans, attributed to the user and the trace's service", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "checkout-service" } as unknown as Service);
    const runId: ObjectID = ObjectID.generate();
    const create: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromTrace")
      .mockResolvedValue({ id: runId } as unknown as AIRun);

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(call.json).toEqual({ aiRunId: runId.toString() });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        serviceName: "checkout-service",
        userId: USER_ID,
        // Whose repositories the fix may use: the caller's own (#11075).
        props: memberProps(),
      }),
    );
    expect(
      (create.mock.calls[0]![0] as { spans: Array<AnalyzableSpan> }).spans,
    ).toHaveLength(SLOW_CHECKOUT_WITH_N_PLUS_ONE.spans.length);
  });

  test("a trace not worth fixing is refused with the rule, as the page would never have offered it", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(HEALTH_CHECK));
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect((call.thrown as Error).message).toMatch(
      /^Nothing in this trace is worth an AI performance fix\./,
    );
  });

  /*
   * The real trigger behind the route, with only its reads stubbed: what
   * the suggestion would have said as a set-up step, the click is refused
   * with - as the error of its kind, so a plan below Growth is a 402 the
   * way Code refuses it.
   */
  test("Code's gate says the plan does not include AI in Code: refused as a payment, nothing queued", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: null,
      blocker: {
        type: CodeTaskBlockerType.PlanRequired,
        message: CODE_TASK_PLAN_REQUIRED_MESSAGE,
      },
    } as CodeFixStart);
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeInstanceOf(PaymentRequiredException);
    expect((call.thrown as Error).message).toBe(
      CODE_TASK_PLAN_REQUIRED_MESSAGE,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the repository the person picked is handed to the trigger", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);
    const repositoryId: ObjectID = ObjectID.generate();
    const create: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromTrace")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    const call: Call = await post(CREATE_ROUTE, {
      traceId: TRACE_ID,
      repositoryId: repositoryId.toString(),
    });

    expect(call.thrown).toBeUndefined();
    expect(
      (
        create.mock.calls[0]![0] as { repositoryId?: ObjectID }
      ).repositoryId?.toString(),
    ).toBe(repositoryId.toString());
  });

  test("no pick: the trigger is asked without one", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);
    const create: jest.SpyInstance = jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromTrace")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    await post(CREATE_ROUTE, { traceId: TRACE_ID, repositoryId: null });

    expect(
      (create.mock.calls[0]![0] as { repositoryId?: ObjectID }).repositoryId,
    ).toBeUndefined();
  });

  test.each([
    ["a name", "checkout-api"],
    ["a number", 7],
    ["an id that is no uuid", "repo-1"],
  ])(
    "a pick that is %s is refused before the trace is read",
    async (_name: string, repositoryId: string | number) => {
      const findBy: jest.SpyInstance = jest.spyOn(SpanService, "findBy");
      jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);
      findBy.mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
      findBy.mockClear();
      const create: jest.SpyInstance = jest.spyOn(
        FixPerformanceTaskTrigger,
        "createPerformanceFixTaskFromTrace",
      );

      const call: Call = await post(CREATE_ROUTE, {
        traceId: TRACE_ID,
        repositoryId,
      });

      expect((call.thrown as Error).message).toBe(
        "repositoryId must be a repository's ID.",
      );
      expect(create).not.toHaveBeenCalled();
      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("a fix for the trace already did its work: refused, pointing at its task", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest
      .spyOn(SubjectCodeFixRun, "findFinishedPerformanceFixRunForTrace")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect((call.thrown as Error).message).toMatch(
      /^OneUptime AI already worked on a fix for this trace\./,
    );
  });
});

/*
 * WHO MAY START A TRACE'S FIX: THE ROUTE HOLDS THE REPOSITORY TO THE
 * CALLER'S OWN PERMISSIONS IN CODE (#11075).
 *
 * The route took any repository the project connected, checked as
 * OneUptime, so a request could name one the caller may not read, or may
 * not ask OneUptime AI to work in - the page's picker was all that held it
 * back. These drive the real route and the real trigger, with only the
 * reads below Code's permission checks stubbed: the member reads
 * checkout and may ask AI in it, reads ledger but may not ask in it, and
 * may not read vault at all.
 */
describe("POST /ai-investigation/create-performance-fix-task holds the repository to the caller (#11075)", () => {
  // Whose permissions each check of the member's repositories was asked under.
  let asked: Array<DatabaseCommonInteractionProps> = [];

  const mayRead: (id: string) => boolean = (id: string): boolean => {
    return id !== VAULT_REPOSITORY_ID;
  };
  const mayAsk: (id: string) => boolean = (id: string): boolean => {
    return id === CHECKOUT_REPOSITORY_ID;
  };

  const rowOf: (id: string) => CodeRepository = (
    id: string,
  ): CodeRepository => {
    const repository: CodeRepository = new CodeRepository();
    repository.id = new ObjectID(id);
    return repository;
  };

  beforeEach(() => {
    asked = [];
    // The real weighing of the member's repositories, below the outer default.
    jest.mocked(FixPerformanceTaskTrigger.getUsableRepositories).mockRestore();

    jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue(storedSpans(SLOW_CHECKOUT_WITH_N_PLUS_ONE));
    jest.spyOn(FixRunBudget, "assertWithinBudget").mockResolvedValue();
    jest
      .spyOn(CodeRepositoryService, "getResolvableRepositories")
      .mockResolvedValue(
        [CHECKOUT_REPOSITORY_ID, LEDGER_REPOSITORY_ID, VAULT_REPOSITORY_ID].map(
          (id: string) => {
            return {
              id,
              name: `repository-${id.slice(-2)}`,
              organizationName: "acme",
              repositoryName: `repository-${id.slice(-2)}`,
              mainBranchName: "main",
              gitHubAppInstallationId: "1234",
            };
          },
        ),
      );
    // Every one of them is connected.
    jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        return new Set<string>(
          data.repositoryIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
      });
    jest
      .spyOn(CodeTaskAccess, "findReadableRepository")
      .mockImplementation(
        async (data: {
          props: DatabaseCommonInteractionProps;
          repositoryId: ObjectID;
        }): Promise<CodeRepository | null> => {
          asked.push(data.props);
          const id: string = data.repositoryId.toString();
          return mayRead(id) ? rowOf(id) : null;
        },
      );
    jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockImplementation(
        async (data: {
          props: DatabaseCommonInteractionProps;
          repositoryId: ObjectID;
        }): Promise<boolean> => {
          asked.push(data.props);
          return mayAsk(data.repositoryId.toString());
        },
      );
    jest
      .spyOn(CodeTaskAccess, "listReadableRepositoriesByIds")
      .mockImplementation(
        async (data: {
          props: DatabaseCommonInteractionProps;
          repositoryIds: Array<ObjectID | string>;
        }): Promise<Array<CodeRepository>> => {
          asked.push(data.props);
          return data.repositoryIds
            .map((id: ObjectID | string): string => {
              return id.toString();
            })
            .filter(mayRead)
            .map(rowOf);
        },
      );
    jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockImplementation(
        async (data: {
          props: DatabaseCommonInteractionProps;
          repositoryIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          asked.push(data.props);
          return new Set<string>(
            data.repositoryIds
              .map((id: ObjectID | string): string => {
                return id.toString();
              })
              .filter(mayAsk),
          );
        },
      );
  });

  test("a pick the caller may read but not ask OneUptime AI to work in: refused, in a sentence that says so, as a 403 - nothing queued", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    const call: Call = await post(CREATE_ROUTE, {
      traceId: TRACE_ID,
      repositoryId: LEDGER_REPOSITORY_ID,
    });

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((call.thrown as Error).message).toBe(
      PICKED_REPOSITORY_NOT_ASKABLE_MESSAGE,
    );
    expect(call.json).toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a pick the caller may not read: refused as not found, as a 404 - never said to exist - nothing queued", async () => {
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    const call: Call = await post(CREATE_ROUTE, {
      traceId: TRACE_ID,
      repositoryId: VAULT_REPOSITORY_ID,
    });

    expect(call.thrown).toBeInstanceOf(NotFoundException);
    expect((call.thrown as Error).message).toBe(
      PICKED_REPOSITORY_NOT_FOUND_MESSAGE,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a pick the caller may use: taken, and the fix is made in it - checked under the caller's own permissions", async () => {
    jest.spyOn(CodeFixStartGate, "check").mockResolvedValue({
      codeRepositoryId: new ObjectID(CHECKOUT_REPOSITORY_ID),
      blocker: null,
    });
    const runId: ObjectID = ObjectID.generate();
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: runId } as unknown as AIRun);

    const call: Call = await post(CREATE_ROUTE, {
      traceId: TRACE_ID,
      repositoryId: CHECKOUT_REPOSITORY_ID,
    });

    expect(call.thrown).toBeUndefined();
    expect(call.json).toEqual({ aiRunId: runId.toString() });
    const queued: {
      codeRepositoryId?: ObjectID | null;
      taskContext: { pickedCodeRepositoryId?: string };
    } = enqueue.mock.calls[0]![0];
    expect(queued.codeRepositoryId?.toString()).toBe(CHECKOUT_REPOSITORY_ID);
    expect(queued.taskContext.pickedCodeRepositoryId).toBe(
      CHECKOUT_REPOSITORY_ID,
    );
    expect(asked.length).toBeGreaterThan(0);
    for (const props of asked) {
      expect(props).toEqual(memberProps());
    }
  });

  test("no pick, and the trace's facts would find the repository the caller may not ask in: the fix is held to theirs", async () => {
    const gate: jest.SpyInstance = jest
      .spyOn(CodeFixStartGate, "check")
      .mockResolvedValue({
        codeRepositoryId: new ObjectID(CHECKOUT_REPOSITORY_ID),
        blocker: null,
      });
    const enqueue: jest.SpyInstance = jest
      .spyOn(SubjectCodeFixRun, "enqueueSubjectCodeFixRun")
      .mockResolvedValue({ id: ObjectID.generate() } as unknown as AIRun);

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    // Resolved among checkout alone, the one repository the member may use.
    expect(
      (gate.mock.calls[0]![0] as { allowance: CodeRepositoryAllowance })
        .allowance,
    ).toEqual({
      isEveryRepository: false,
      repositoryIds: [CHECKOUT_REPOSITORY_ID],
    });
    expect(
      (
        enqueue.mock.calls[0]![0] as {
          taskContext: { pickedCodeRepositoryId?: string };
        }
      ).taskContext.pickedCodeRepositoryId,
    ).toBe(CHECKOUT_REPOSITORY_ID);
  });

  test("no pick, and none of the connected repositories is the caller's to ask in: refused, saying why and who can help - nothing queued", async () => {
    jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockResolvedValue(new Set<string>());
    const enqueue: jest.SpyInstance = jest.spyOn(
      SubjectCodeFixRun,
      "enqueueSubjectCodeFixRun",
    );

    const call: Call = await post(CREATE_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((call.thrown as Error).message).toBe(
      NO_REPOSITORY_YOU_MAY_USE_MESSAGE,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("the suggestion the page draws for that caller offers nothing, so the page never shows a fix the route refuses", async () => {
    jest
      .spyOn(CodeTaskAccess, "listAskableRepositoryIds")
      .mockResolvedValue(new Set<string>());

    const call: Call = await post(SUGGESTION_ROUTE, { traceId: TRACE_ID });

    expect(call.thrown).toBeUndefined();
    expect(
      parseTracePerformanceFixSuggestion(call.json as JSONObject).offer,
    ).toBe(SuggestionOffer.None);
  });
});
