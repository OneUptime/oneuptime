import CommonAPI from "../../../Server/API/CommonAPI";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionUnmergeOutcome,
} from "../../../Server/Utils/Telemetry/TelemetryExceptionMerge";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
 * POST /telemetry-exception/merge/:id and /telemetry-exception/unmerge/:id:
 * the survivor's id from the path, the exceptions to merge from the body,
 * and the caller, handed to TelemetryExceptionMerge, which checks the edit
 * on every exception involved. A malformed request never reaches it.
 */

const MERGE_ROUTE: string = "/telemetry-exception/merge/:telemetryExceptionId";
const UNMERGE_ROUTE: string =
  "/telemetry-exception/unmerge/:telemetryExceptionId";
const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};

let sent: Array<JSONObject>;

async function post(
  route: string,
  id: string,
  body: unknown = {},
): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: { telemetryExceptionId: id },
    headers: {},
    query: {},
    body,
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("POST", route)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function refusal(next: NextFunction): unknown {
  return (next as unknown as jest.Mock).mock.calls[0]?.[0];
}

describe("the merge routes", () => {
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

  test("merge: the path's exception survives, the body's are merged into it, as the caller", async () => {
    const merge: SpyInstance<typeof TelemetryExceptionMerge.merge> = jest
      .spyOn(TelemetryExceptionMerge, "merge")
      .mockResolvedValue({
        telemetryExceptionId: A,
        merged: [
          { telemetryExceptionId: B, outcome: ExceptionMergeOutcome.Merged },
        ],
      });

    const next: NextFunction = await post(MERGE_ROUTE, A, {
      mergedTelemetryExceptionIds: [B],
    });

    expect(next).not.toHaveBeenCalled();
    const args: Parameters<typeof TelemetryExceptionMerge.merge>[0] =
      merge.mock.calls[0]![0];
    expect(args.props).toBe(CALLER);
    expect(args.telemetryExceptionId.toString()).toBe(A);
    expect(
      args.mergedTelemetryExceptionIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([B]);
    expect(sent).toEqual([
      {
        telemetryExceptionId: A,
        merged: [{ telemetryExceptionId: B, outcome: "merged" }],
      },
    ]);
  });

  test("unmerge: the path's exception, as the caller", async () => {
    const unmerge: SpyInstance<typeof TelemetryExceptionMerge.unmerge> = jest
      .spyOn(TelemetryExceptionMerge, "unmerge")
      .mockResolvedValue({
        telemetryExceptionId: B,
        unmergedFromTelemetryExceptionId: A,
        outcome: ExceptionUnmergeOutcome.Unmerged,
      });

    await post(UNMERGE_ROUTE, B);

    expect(unmerge.mock.calls[0]![0].props).toBe(CALLER);
    expect(unmerge.mock.calls[0]![0].telemetryExceptionId.toString()).toBe(B);
    expect(sent).toEqual([
      {
        telemetryExceptionId: B,
        unmergedFromTelemetryExceptionId: A,
        outcome: "unmerged",
      },
    ]);
  });

  test.each([
    [
      "a malformed survivor id",
      MERGE_ROUTE,
      "nope",
      { mergedTelemetryExceptionIds: [B] },
    ],
    ["no exceptions to merge", MERGE_ROUTE, A, {}],
    ["an empty list", MERGE_ROUTE, A, { mergedTelemetryExceptionIds: [] }],
    [
      "a malformed merged id",
      MERGE_ROUTE,
      A,
      { mergedTelemetryExceptionIds: ["x"] },
    ],
    ["a malformed id to unmerge", UNMERGE_ROUTE, "nope", {}],
  ])(
    "%s is refused before anything is read",
    async (_name: string, route: string, id: string, body: unknown) => {
      const merge: SpyInstance<typeof TelemetryExceptionMerge.merge> =
        jest.spyOn(TelemetryExceptionMerge, "merge");
      const unmerge: SpyInstance<typeof TelemetryExceptionMerge.unmerge> =
        jest.spyOn(TelemetryExceptionMerge, "unmerge");

      const next: NextFunction = await post(route, id, body);

      expect(refusal(next)).toBeInstanceOf(BadDataException);
      expect(merge).not.toHaveBeenCalled();
      expect(unmerge).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    },
  );

  test("a refusal of the merge itself is passed on, as it was raised", async () => {
    jest
      .spyOn(TelemetryExceptionMerge, "merge")
      .mockRejectedValue(
        new NotAuthorizedException("You do not have permission"),
      );

    const next: NextFunction = await post(MERGE_ROUTE, A, {
      mergedTelemetryExceptionIds: [B],
    });

    expect(refusal(next)).toBeInstanceOf(NotAuthorizedException);
    expect(sent).toHaveLength(0);
  });
});
