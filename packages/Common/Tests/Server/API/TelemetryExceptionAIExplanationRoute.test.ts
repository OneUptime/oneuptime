import CommonAPI from "../../../Server/API/CommonAPI";
import ExceptionExplainer from "../../../Server/Utils/AI/TelemetryAi/ExceptionExplanation";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  ExceptionExplanationCategory,
  ExceptionExplanationConfidence,
} from "../../../Types/Telemetry/ExceptionAIExplanation";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * POST /telemetry-exception/ai-explanation/:telemetryExceptionId - the
 * Overview's What happened card asks OneUptime AI here. The route reads the
 * caller and hands the exception to ExceptionExplainer, which reads it as the
 * caller (so one they may not read is not found) and honours the project's AI
 * switch, credits and limits; a malformed id never reaches it.
 */

const ROUTE: string =
  "/telemetry-exception/ai-explanation/:telemetryExceptionId";
const EXCEPTION_ID: ObjectID = ObjectID.generate();
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};
const GENERATED_AT: Date = new Date("2026-10-30T12:00:00.000Z");

let sent: Array<JSONObject>;

async function post(id: string): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: { telemetryExceptionId: id },
    headers: {},
    query: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

describe("POST ai-explanation", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    const module: { default: new () => unknown } = await import(
      "../../../Server/API/TelemetryExceptionAPI"
    );
    new module.default();
  });

  beforeEach(() => {
    sent = [];
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(CALLER);
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(((
      _req: ExpressRequest,
      _res: ExpressResponse,
      json: JSONObject,
    ) => {
      sent.push(json);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("explains the exception as the caller, and answers with the explanation and its time", async () => {
    const explain: jest.SpiedFunction<typeof ExceptionExplainer.explain> = jest
      .spyOn(ExceptionExplainer, "explain")
      .mockResolvedValue({
        explanation: {
          version: 1,
          summary: "Checkout fails when the cart is empty.",
          rootCause: "r",
          suggestedFix: "f",
          confidence: ExceptionExplanationConfidence.High,
          category: ExceptionExplanationCategory.Code,
          suspectFrames: [],
          nextSteps: [],
        },
        generatedAt: GENERATED_AT,
      });

    const next: NextFunction = await post(EXCEPTION_ID.toString());

    expect(next).not.toHaveBeenCalled();
    expect(explain).toHaveBeenCalledTimes(1);
    const args: Parameters<typeof ExceptionExplainer.explain>[0] =
      explain.mock.calls[0]![0];
    expect(args.telemetryExceptionId.toString()).toBe(EXCEPTION_ID.toString());
    expect(args.props).toBe(CALLER);

    expect(sent).toHaveLength(1);
    expect(sent[0]!["generatedAt"]).toBe(GENERATED_AT.toISOString());
    expect(
      (sent[0]!["explanation"] as JSONObject)["summary"],
    ).toBe("Checkout fails when the cart is empty.");
  });

  test("a malformed id is refused before anything is read", async () => {
    const explain: jest.SpiedFunction<typeof ExceptionExplainer.explain> =
      jest.spyOn(ExceptionExplainer, "explain");

    const next: NextFunction = await post("not-an-id");

    expect(explain).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((next as unknown as jest.Mock).mock.calls[0]![0]).toBeInstanceOf(
      BadDataException,
    );
    expect(sent).toHaveLength(0);
  });

  test("a refusal - AI off, no credits, not found - reaches the caller as it was said", async () => {
    jest
      .spyOn(ExceptionExplainer, "explain")
      .mockRejectedValue(
        new BadDataException("AI is turned off for this project."),
      );

    const next: NextFunction = await post(EXCEPTION_ID.toString());

    const error: unknown = (next as unknown as jest.Mock).mock.calls[0]![0];
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe("AI is turned off for this project.");
    expect(sent).toHaveLength(0);
  });
});
