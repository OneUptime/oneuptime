import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionDigester, {
  EXCEPTION_DIGEST_FEATURE,
  ExceptionDigestResult,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionDigest";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  EXCEPTION_DIGEST_WINDOW_HOURS,
  ExceptionDigestItem,
  ExceptionDigestKind,
  MAX_DIGEST_EXCEPTIONS,
} from "../../../../../Types/Telemetry/ExceptionAIDigest";

/*
 * ExceptionDigester, with the exceptions, the services and the model
 * mocked: the project's AI switch is asked before anything is read, the
 * exceptions are read as the caller (open ones, new or regressed in the
 * last day), nothing is asked of a model when nothing is new, the call goes
 * through AIService.executeWithLogging as an interactive one that keeps no
 * previews, and the answer is mapped back to the exceptions. No real AI
 * provider is ever called.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

function row(
  id: string,
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = id;
  exception.primaryEntityId = SERVICE_ID;
  exception.primaryEntityType = ServiceType.OpenTelemetry;
  exception.exceptionType = "TypeError";
  exception.message = `Message of ${id}`;
  exception.stackTrace =
    "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)";
  exception.occuranceCount = 5;
  exception.firstSeenAt = new Date("2026-10-30T09:00:00.000Z");
  exception.firstSeenInRelease = "2.3.2";
  exception.lastSeenInRelease = "2.3.3";
  exception.unhandled = true;
  Object.assign(exception, overrides);
  return exception;
}

const NEW_ID: string = "10000000-0000-4000-8000-000000000001";
const REGRESSED_ID: string = "10000000-0000-4000-8000-000000000002";

interface FindCall {
  query: Record<string, unknown>;
  props: unknown;
}

let findCalls: Array<FindCall>;
let aiRequests: Array<AILogRequest>;
let newRows: Array<TelemetryException>;
let regressedRows: Array<TelemetryException>;
let modelAnswer: string;
let order: Array<string>;

beforeEach(() => {
  findCalls = [];
  aiRequests = [];
  order = [];
  newRows = [row(NEW_ID)];
  regressedRows = [
    row(REGRESSED_ID, {
      regressedAt: new Date("2026-10-30T10:00:00.000Z"),
    }),
  ];
  modelAnswer = JSON.stringify({
    headline: "Checkout broke after 2.3.2, and the cart bug is back.",
    items: [
      { ref: "E1", summary: "The cart bug is back.", priority: "high" },
      { ref: "E2", summary: "Empty carts crash checkout.", priority: "medium" },
    ],
  });

  jest
    .spyOn(AIService, "assertProjectAIEnabled")
    .mockImplementation((async () => {
      order.push("ai switch");
    }) as never);

  jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
    args: FindCall,
  ) => {
    order.push("exceptions");
    findCalls.push({ query: args.query, props: args.props });
    return "regressedAt" in args.query ? regressedRows : newRows;
  }) as never);

  jest.spyOn(ServiceService, "findBy").mockImplementation((async () => {
    const service: Service = new Service();
    service._id = SERVICE_ID.toString();
    service.name = "checkout";
    return [service];
  }) as never);

  jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);

  jest.spyOn(AIService, "executeWithLogging").mockImplementation((async (
    request: AILogRequest,
  ) => {
    order.push("model");
    aiRequests.push(request);
    return {
      content: modelAnswer,
      llmLog: new LlmLog(),
    } as AILogResponse;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionDigester.digest", () => {
  test("reads open new and regressed exceptions as the caller, then asks the AI switch before the model", async () => {
    await ExceptionDigester.digest({ projectId: PROJECT_ID, props: CALLER });

    /*
     * The caller's own reads come first: someone who may not read the
     * project's exceptions is refused by them, and learns nothing about the
     * project's AI.
     */
    expect(order).toEqual(["exceptions", "exceptions", "ai switch", "model"]);
    expect(findCalls).toHaveLength(2);

    for (const call of findCalls) {
      expect(call.props).toBe(CALLER);
      expect(call.query).toMatchObject({
        projectId: PROJECT_ID,
        isResolved: false,
        isArchived: false,
      });
    }

    expect(
      findCalls.some((call: FindCall): boolean => {
        return "firstSeenAt" in call.query;
      }),
    ).toBe(true);
    expect(
      findCalls.some((call: FindCall): boolean => {
        return "regressedAt" in call.query;
      }),
    ).toBe(true);
  });

  test("writes the digest through executeWithLogging, as an interactive call with no previews", async () => {
    const result: ExceptionDigestResult = await ExceptionDigester.digest({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(aiRequests).toHaveLength(1);
    const request: AILogRequest = aiRequests[0]!;
    expect(request.feature).toBe(EXCEPTION_DIGEST_FEATURE);
    expect(request.projectId).toBe(PROJECT_ID);
    expect(request.userId).toBe(USER_ID);
    expect(request.requestRetries).toBe(0);
    expect(request.storeContentPreviews).toBe(false);

    // Regressed first in the prompt, named by its service.
    const prompt: string = String(request.messages[1]?.content);
    expect(prompt.indexOf("## E1 (regressed")).toBeGreaterThanOrEqual(0);
    expect(prompt).toContain("## E2 (new)");
    expect(prompt).toContain("Where: checkout");
    expect(prompt).toContain("Release: 2.3.3");
    expect(prompt).not.toContain(REGRESSED_ID);

    expect(result.exceptionCount).toBe(2);
    expect(result.windowHours).toBe(EXCEPTION_DIGEST_WINDOW_HOURS);
    expect(result.digest?.headline).toBe(
      "Checkout broke after 2.3.2, and the cart bug is back.",
    );
    expect(
      result.digest?.items.map((item: ExceptionDigestItem) => {
        return [item.telemetryExceptionId, item.kind];
      }),
    ).toEqual([
      [REGRESSED_ID, ExceptionDigestKind.Regressed],
      [NEW_ID, ExceptionDigestKind.New],
    ]);
  });

  test("an exception both new and regressed is listed once, as regressed", async () => {
    newRows = [row(REGRESSED_ID), row(NEW_ID)];

    const result: ExceptionDigestResult = await ExceptionDigester.digest({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(result.exceptionCount).toBe(2);
    expect(result.digest?.items[0]?.kind).toBe(ExceptionDigestKind.Regressed);
  });

  test("at most the most exceptions a digest is written from", async () => {
    newRows = Array.from(
      { length: MAX_DIGEST_EXCEPTIONS },
      (_value: unknown, index: number) => {
        return row(
          `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        );
      },
    );

    const result: ExceptionDigestResult = await ExceptionDigester.digest({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(result.exceptionCount).toBe(MAX_DIGEST_EXCEPTIONS);
  });

  test("nothing new or regressed: no model is asked, no credit spent", async () => {
    newRows = [];
    regressedRows = [];

    const result: ExceptionDigestResult = await ExceptionDigester.digest({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(result.digest).toBe(null);
    expect(result.exceptionCount).toBe(0);
    expect(aiRequests).toHaveLength(0);
  });

  test("AI switched off: refused before any model is asked", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException("AI is off") as never);

    await expect(
      ExceptionDigester.digest({ projectId: PROJECT_ID, props: CALLER }),
    ).rejects.toThrow("AI is off");

    expect(aiRequests).toHaveLength(0);
  });

  test("someone who may not read the exceptions is refused by the read, before the AI switch is asked", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new BadDataException("Not allowed") as never);
    const aiSwitch: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AIService,
      "assertProjectAIEnabled",
    );

    await expect(
      ExceptionDigester.digest({ projectId: PROJECT_ID, props: CALLER }),
    ).rejects.toThrow("Not allowed");

    expect(aiSwitch).not.toHaveBeenCalled();
    expect(aiRequests).toHaveLength(0);
  });

  test("an answer with no digest in it is an error to try again", async () => {
    modelAnswer = "I am not able to summarise these.";

    await expect(
      ExceptionDigester.digest({ projectId: PROJECT_ID, props: CALLER }),
    ).rejects.toThrow(
      "OneUptime AI did not return a summary. Please try again.",
    );
  });

  test("a service the caller may not read leaves the exception unnamed", async () => {
    jest
      .spyOn(ServiceService, "findBy")
      .mockRejectedValue(new Error("not allowed") as never);

    await ExceptionDigester.digest({ projectId: PROJECT_ID, props: CALLER });

    expect(String(aiRequests[0]?.messages[1]?.content)).toContain(
      "Where: unknown resource",
    );
  });
});
