import CommonAPI from "../../../Server/API/CommonAPI";
import AIService from "../../../Server/Services/AIService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import FixPerformanceTaskTrigger from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import SubjectCodeFixRun from "../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
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
  parseTracePerformanceFixSuggestion,
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
      aiRunId: null,
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
});
