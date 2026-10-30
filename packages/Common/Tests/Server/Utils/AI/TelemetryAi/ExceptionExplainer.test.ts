import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionExplainer, {
  EXCEPTION_EXPLANATION_FEATURE,
  ExceptionExplanationResult,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionExplanation";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import SpanService from "../../../../../Server/Services/SpanService";
import LogService from "../../../../../Server/Services/LogService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import ExceptionInstance from "../../../../../Models/AnalyticsModels/ExceptionInstance";
import Span from "../../../../../Models/AnalyticsModels/Span";
import Log from "../../../../../Models/AnalyticsModels/Log";
import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import Service from "../../../../../Models/DatabaseModels/Service";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import { ExceptionExplanationConfidence } from "../../../../../Types/Telemetry/ExceptionAIExplanation";

/*
 * ExceptionExplainer, with every data source and the model mocked: the
 * exception is read as the caller, the project's AI switch is asked before
 * anything else, each source is read as the caller and best effort, the call
 * goes through AIService.executeWithLogging as an interactive one that keeps
 * no previews, and the answer is checked and kept on the exception. No real
 * AI provider is ever called.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const EXCEPTION_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TRACE_ID: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID: string = "b7ad6b7169203331";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

const STACK_TRACE: string =
  "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)\n    at run (/app/node_modules/x/index.js:1:1)";

const MODEL_ANSWER: string = JSON.stringify({
  summary: "Checkout fails when the cart is empty.",
  rootCause: "`cart.items` is undefined after the 2.3.2 deploy.",
  suggestedFix: "Return early when the cart has no items.",
  confidence: "high",
  category: "code",
  suspectFrames: [
    { file: "/app/src/cart.ts", line: 42, function: "checkout" },
    { file: "/app/src/invented.ts", line: 1, function: "nope" },
  ],
  nextSteps: ["Add a test for an empty cart."],
});

function exceptionRow(
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = EXCEPTION_ID.toString();
  exception.projectId = PROJECT_ID;
  exception.primaryEntityId = SERVICE_ID;
  exception.primaryEntityType = ServiceType.OpenTelemetry;
  exception.fingerprint = "fp-1";
  exception.exceptionType = "TypeError";
  exception.message = "Cannot read properties of undefined (reading 'items')";
  exception.stackTrace = STACK_TRACE;
  exception.occuranceCount = 12;
  exception.firstSeenAt = new Date("2026-10-30T09:00:00.000Z");
  exception.lastSeenAt = new Date("2026-10-30T11:00:00.000Z");
  exception.unhandled = true;
  exception.isResolved = false;
  Object.assign(exception, overrides);
  return exception;
}

let aiRequests: Array<AILogRequest>;
let updates: Array<{ data: unknown; props: unknown }>;
let readProps: Array<{ source: string; props: unknown }>;
let modelAnswer: string;

function recordRead(source: string, props: unknown): void {
  readProps.push({ source, props });
}

beforeEach(() => {
  aiRequests = [];
  updates = [];
  readProps = [];
  modelAnswer = MODEL_ANSWER;

  jest
    .spyOn(TelemetryExceptionService, "findOneById")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("exception", args.props);
      return exceptionRow();
    }) as never);

  jest
    .spyOn(TelemetryExceptionService, "updateOneById")
    .mockImplementation((async (args: { data: unknown; props: unknown }) => {
      updates.push({ data: args.data, props: args.props });
    }) as never);

  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(AIService, "executeWithLogging")
    .mockImplementation((async (request: AILogRequest) => {
      aiRequests.push(request);
      return {
        content: modelAnswer,
        llmLog: new LlmLog(),
      } as AILogResponse;
    }) as never);

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ key: "k", namespace: "n" } as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  jest
    .spyOn(ExceptionInstanceService, "findBy")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("occurrence", args.props);
      const instance: ExceptionInstance = new ExceptionInstance();
      instance.traceId = TRACE_ID;
      instance.spanId = SPAN_ID;
      instance.spanName = "POST /checkout";
      instance.release = "2.3.2";
      instance.time = new Date("2026-10-30T11:00:00.000Z");
      return [instance];
    }) as never);

  jest
    .spyOn(SpanService, "findBy")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("spans", args.props);
      const span: Span = new Span();
      span.spanId = SPAN_ID;
      span.name = "POST /checkout";
      span.durationUnixNano = 1_500_000_000;
      return [span];
    }) as never);

  jest
    .spyOn(SpanService, "findOneBy")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("exception span", args.props);
      const span: Span = new Span();
      span.attributes = {
        "http.route": "/checkout",
        "user.email": "priya@example.com",
      };
      return span;
    }) as never);

  jest
    .spyOn(LogService, "findBy")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("logs", args.props);
      const log: Log = new Log();
      log.body = "cart lookup returned nothing";
      log.time = new Date("2026-10-30T10:59:59.000Z");
      return [log];
    }) as never);

  jest
    .spyOn(ChangeEventService, "findBy")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("changes", args.props);
      const change: ChangeEvent = new ChangeEvent();
      change.time = new Date("2026-10-30T08:55:00.000Z");
      change.eventType = "deployment";
      change.title = "Deploy checkout-api 2.3.2";
      change.attributes = { "service.version": "2.3.2" };
      return [change];
    }) as never);

  jest
    .spyOn(ServiceService, "findOneById")
    .mockImplementation((async (args: { props: unknown }) => {
      recordRead("service", args.props);
      const service: Service = new Service();
      service.name = "checkout-api";
      return service;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function explain(): Promise<ExceptionExplanationResult> {
  return ExceptionExplainer.explain({
    telemetryExceptionId: EXCEPTION_ID,
    props: CALLER,
  });
}

describe("explaining an exception", () => {
  test("writes it from the evidence, as an interactive call that keeps no previews", async () => {
    const result: ExceptionExplanationResult = await explain();

    expect(aiRequests).toHaveLength(1);
    const request: AILogRequest = aiRequests[0]!;

    expect(request.feature).toBe(EXCEPTION_EXPLANATION_FEATURE);
    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(request.userId?.toString()).toBe(USER_ID.toString());
    expect(request.storeContentPreviews).toBe(false);
    expect(request.requestRetries).toBe(0);
    expect(request.temperature).toBe(0.2);
    expect(request.messages[0]!.role).toBe("system");

    const prompt: string = request.messages[1]!.content as string;
    expect(prompt).toContain("Where: checkout-api (OpenTelemetry)");
    expect(prompt).toContain(
      "- POST /checkout (span, unset, 1500 ms) <- the exception was recorded here",
    );
    expect(prompt).toContain("http.route: /checkout");
    // A span attribute that is not on the list never leaves.
    expect(prompt).not.toContain("priya@example.com");
    expect(prompt).toContain("cart lookup returned nothing");
    expect(prompt).toContain("deployment: Deploy checkout-api 2.3.2");

    expect(result.explanation.summary).toBe(
      "Checkout fails when the cart is empty.",
    );
    expect(result.explanation.confidence).toBe(
      ExceptionExplanationConfidence.High,
    );
    // The invented frame is not one of the exception's own.
    expect(result.explanation.suspectFrames).toEqual([
      { file: "/app/src/cart.ts", line: 42, function: "checkout" },
    ]);
  });

  test("keeps the explanation on the exception, as OneUptime", async () => {
    const result: ExceptionExplanationResult = await explain();

    expect(updates).toHaveLength(1);
    expect(updates[0]!.props).toEqual({ isRoot: true });
    expect(updates[0]!.data).toEqual({
      aiExplanation: result.explanation,
      aiExplanationGeneratedAt: result.generatedAt,
    });
  });

  test("reads the exception and every source as the person asking", async () => {
    await explain();

    expect(
      readProps.map((read: { source: string }): string => {
        return read.source;
      }),
    ).toEqual(
      expect.arrayContaining([
        "exception",
        "occurrence",
        "service",
        "changes",
        "spans",
        "exception span",
        "logs",
      ]),
    );

    for (const read of readProps) {
      expect([read.source, read.props]).toEqual([read.source, CALLER]);
    }
  });

  test("with the project's AI off, nothing is read past the exception and no model is called", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException("AI is off") as never);

    await expect(explain()).rejects.toThrow("AI is off");
    expect(aiRequests).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(
      readProps.map((read: { source: string }): string => {
        return read.source;
      }),
    ).toEqual(["exception"]);
  });

  test("an exception the caller may not read is not found", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findOneById")
      .mockResolvedValue(null as never);

    await expect(explain()).rejects.toBeInstanceOf(NotFoundException);
    expect(aiRequests).toHaveLength(0);
  });

  test("a source that fails is left out, and the explanation is still written", async () => {
    jest
      .spyOn(SpanService, "findBy")
      .mockRejectedValue(new Error("no permission to read spans") as never);
    jest
      .spyOn(LogService, "findBy")
      .mockRejectedValue(new Error("clickhouse down") as never);
    jest
      .spyOn(ChangeEventService, "findBy")
      .mockRejectedValue(new Error("no permission") as never);

    const result: ExceptionExplanationResult = await explain();

    const prompt: string = aiRequests[0]!.messages[1]!.content as string;
    expect(prompt).not.toContain("## The trace");
    expect(prompt).not.toContain("## Logs");
    expect(prompt).not.toContain("## Deploys");
    expect(result.explanation.summary).toBeTruthy();
  });

  test("an exception with no occurrence left is explained from itself", async () => {
    jest
      .spyOn(ExceptionInstanceService, "findBy")
      .mockResolvedValue([] as never);

    await explain();

    const prompt: string = aiRequests[0]!.messages[1]!.content as string;
    expect(prompt).not.toContain("## Latest occurrence");
    expect(prompt).toContain("## Stack trace");
  });

  test("an answer with no explanation in it stores nothing and says so", async () => {
    modelAnswer = "Sorry, I cannot help with that.";

    await expect(explain()).rejects.toThrow(
      "OneUptime AI did not return an explanation. Please try again.",
    );
    expect(updates).toHaveLength(0);
  });

  test("the lock is released whatever happens", async () => {
    const release: jest.SpiedFunction<typeof Semaphore.release> = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined as never);
    modelAnswer = "nothing";

    await expect(explain()).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("without Redis to lock on, it is written anyway", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("redis down") as never);

    const result: ExceptionExplanationResult = await explain();

    expect(result.explanation.summary).toBeTruthy();
  });
});
