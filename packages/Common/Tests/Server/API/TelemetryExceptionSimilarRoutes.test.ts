import CommonAPI from "../../../Server/API/CommonAPI";
import ExceptionDuplicateChecker from "../../../Server/Utils/AI/TelemetryAi/ExceptionDuplicateCheck";
import SimilarExceptionsReader from "../../../Server/Utils/Telemetry/SimilarExceptionsReader";
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
  DuplicateVerdictKind,
  SimilarException,
  SimilarExceptionReason,
} from "../../../Types/Telemetry/SimilarExceptions";
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
 * POST /telemetry-exception/similar/:id and
 * POST /telemetry-exception/similar-ai-check/:id - the Overview's Similar
 * exceptions card. Both hand the exception and the caller on (the readers
 * read as the caller); a malformed id never reaches them.
 */

const EXCEPTION_ID: ObjectID = ObjectID.generate();
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};
const SIMILAR: SimilarException = {
  telemetryExceptionId: "s1",
  exceptionType: "TypeError",
  message: "m",
  occurrenceCount: 2,
  isResolved: false,
  isArchived: false,
  reason: SimilarExceptionReason.SameMessage,
};

let sent: Array<JSONObject>;

async function post(route: string, id: string): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: { telemetryExceptionId: id },
    headers: {},
    query: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("POST", route)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

describe("the Similar exceptions routes", () => {
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

  test("similar: finds them as the caller", async () => {
    const find: SpyInstance<typeof SimilarExceptionsReader.find> = jest
      .spyOn(SimilarExceptionsReader, "find")
      .mockResolvedValue([SIMILAR]);

    const next: NextFunction = await post(
      "/telemetry-exception/similar/:telemetryExceptionId",
      EXCEPTION_ID.toString(),
    );

    expect(next).not.toHaveBeenCalled();
    expect(find.mock.calls[0]![0].props).toBe(CALLER);
    expect(find.mock.calls[0]![0].telemetryExceptionId.toString()).toBe(
      EXCEPTION_ID.toString(),
    );
    expect(sent).toEqual([{ similar: [SIMILAR] }]);
  });

  test("the AI check: asks as the caller, and answers with the similar exceptions and the verdicts", async () => {
    const generatedAt: Date = new Date("2026-10-30T12:00:00.000Z");
    const check: SpyInstance<typeof ExceptionDuplicateChecker.check> = jest
      .spyOn(ExceptionDuplicateChecker, "check")
      .mockResolvedValue({
        similar: [SIMILAR],
        verdicts: [
          {
            telemetryExceptionId: "s1",
            verdict: DuplicateVerdictKind.Duplicate,
            reason: "Same frame.",
          },
        ],
        generatedAt,
      });

    await post(
      "/telemetry-exception/similar-ai-check/:telemetryExceptionId",
      EXCEPTION_ID.toString(),
    );

    expect(check.mock.calls[0]![0].props).toBe(CALLER);
    expect(sent[0]!["generatedAt"]).toBe(generatedAt.toISOString());
    expect(sent[0]!["verdicts"]).toEqual([
      {
        telemetryExceptionId: "s1",
        verdict: "duplicate",
        reason: "Same frame.",
      },
    ]);
  });

  test("a malformed id is refused before anything is read, on both", async () => {
    const find: SpyInstance<typeof SimilarExceptionsReader.find> = jest.spyOn(
      SimilarExceptionsReader,
      "find",
    );
    const check: SpyInstance<typeof ExceptionDuplicateChecker.check> =
      jest.spyOn(ExceptionDuplicateChecker, "check");

    for (const route of [
      "/telemetry-exception/similar/:telemetryExceptionId",
      "/telemetry-exception/similar-ai-check/:telemetryExceptionId",
    ]) {
      const next: NextFunction = await post(route, "not-an-id");
      expect((next as unknown as jest.Mock).mock.calls[0]![0]).toBeInstanceOf(
        BadDataException,
      );
    }

    expect(find).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
