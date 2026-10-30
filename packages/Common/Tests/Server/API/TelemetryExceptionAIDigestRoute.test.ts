import CommonAPI from "../../../Server/API/CommonAPI";
import ExceptionDigester from "../../../Server/Utils/AI/TelemetryAi/ExceptionDigest";
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
  ExceptionDigestKind,
  ExceptionDigestPriority,
} from "../../../Types/Telemetry/ExceptionAIDigest";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * POST /telemetry-exception/ai-digest - Insights' What's new card asks
 * OneUptime AI here. The route reads the caller and hands their project to
 * ExceptionDigester, which reads the exceptions as the caller and honours
 * the project's AI switch, credits and limits. A call with no project is
 * refused before anything is read.
 */

const ROUTE: string = "/telemetry-exception/ai-digest";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: PROJECT_ID,
};
const GENERATED_AT: Date = new Date("2026-10-30T12:00:00.000Z");

let sent: Array<JSONObject>;

async function post(): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: {},
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

describe("POST ai-digest", () => {
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

  test("sums up the caller's project as the caller, and answers with the digest", async () => {
    const digest: SpyInstance<typeof ExceptionDigester.digest> = jest
      .spyOn(ExceptionDigester, "digest")
      .mockResolvedValue({
        digest: {
          version: 1,
          headline: "Checkout broke after 2.3.2.",
          items: [
            {
              telemetryExceptionId: "e1",
              kind: ExceptionDigestKind.New,
              exceptionType: "TypeError",
              summary: "Empty carts crash checkout.",
              priority: ExceptionDigestPriority.High,
            },
          ],
        },
        exceptionCount: 1,
        generatedAt: GENERATED_AT,
        windowHours: 24,
      });

    const next: NextFunction = await post();

    expect(next).not.toHaveBeenCalled();
    expect(digest).toHaveBeenCalledTimes(1);
    const args: Parameters<typeof ExceptionDigester.digest>[0] =
      digest.mock.calls[0]![0];
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.props).toBe(CALLER);

    expect(sent).toEqual([
      {
        digest: {
          version: 1,
          headline: "Checkout broke after 2.3.2.",
          items: [
            {
              telemetryExceptionId: "e1",
              kind: "new",
              exceptionType: "TypeError",
              summary: "Empty carts crash checkout.",
              priority: "high",
            },
          ],
        },
        exceptionCount: 1,
        generatedAt: GENERATED_AT.toISOString(),
        windowHours: 24,
      },
    ]);
  });

  test("no project, no digest: refused before anything is read", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ userId: ObjectID.generate() });
    const digest: SpyInstance<typeof ExceptionDigester.digest> = jest.spyOn(
      ExceptionDigester,
      "digest",
    );

    const next: NextFunction = await post();

    expect(digest).not.toHaveBeenCalled();
    expect((next as unknown as jest.Mock).mock.calls[0]![0]).toBeInstanceOf(
      BadDataException,
    );
    expect(sent).toHaveLength(0);
  });

  test("a refusal - AI off, no credits, no read access - reaches the caller as it was said", async () => {
    jest
      .spyOn(ExceptionDigester, "digest")
      .mockRejectedValue(
        new BadDataException("AI is turned off for this project."),
      );

    const next: NextFunction = await post();

    const error: unknown = (next as unknown as jest.Mock).mock.calls[0]![0];
    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe("AI is turned off for this project.");
    expect(sent).toHaveLength(0);
  });
});
