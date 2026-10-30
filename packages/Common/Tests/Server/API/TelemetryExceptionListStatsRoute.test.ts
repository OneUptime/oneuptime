import CommonAPI from "../../../Server/API/CommonAPI";
import ExceptionListStatsReader from "../../../Server/Utils/Telemetry/ExceptionListStatsReader";
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
  MAX_EXCEPTION_LIST_STATS_IDS,
  emptyExceptionTrend,
} from "../../../Types/Telemetry/ExceptionListStats";
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
 * POST /telemetry-exception/list-stats - the numbers beside each row of the
 * exceptions list. The ids, the range and the caller go to the reader,
 * which reads as the caller; a malformed request never reaches it.
 */

const ROUTE: string = "/telemetry-exception/list-stats";
const E1: string = "30000000-0000-4000-8000-000000000001";
const E2: string = "30000000-0000-4000-8000-000000000002";
const START: string = "2026-10-29T12:00:00.000Z";
const END: string = "2026-10-30T12:00:00.000Z";
const CALLER: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};

let sent: Array<JSONObject>;

async function post(body: unknown): Promise<NextFunction> {
  const req: ExpressRequest = {
    params: {},
    headers: {},
    query: {},
    body: body,
  } as unknown as ExpressRequest;
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function refusal(next: NextFunction): unknown {
  return (next as unknown as jest.Mock).mock.calls[0]?.[0];
}

describe("the exceptions list's stats route", () => {
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

  test("reads the page's exceptions over its range, as the caller, and answers with each one's numbers", async () => {
    const trend: Array<number> = emptyExceptionTrend();
    trend[5] = 2;
    const read: SpyInstance<typeof ExceptionListStatsReader.read> = jest
      .spyOn(ExceptionListStatsReader, "read")
      .mockResolvedValue({
        items: [{ telemetryExceptionId: E1, affectedUsers: 3, trend }],
        bucketSizeInSeconds: 3600,
        startTime: START,
        endTime: END,
      });

    const next: NextFunction = await post({
      telemetryExceptionIds: [E1, E2],
      startTime: START,
      endTime: END,
    });

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    const args: Parameters<typeof ExceptionListStatsReader.read>[0] =
      read.mock.calls[0]![0];
    expect(args.props).toBe(CALLER);
    expect(
      args.telemetryExceptionIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([E1, E2]);
    expect(args.startTime.toISOString()).toBe(START);
    expect(args.endTime.toISOString()).toBe(END);
    expect(sent).toEqual([
      {
        stats: [{ telemetryExceptionId: E1, affectedUsers: 3, trend }],
        bucketSizeInSeconds: 3600,
        startTime: START,
        endTime: END,
      },
    ]);
  });

  test.each([
    ["no ids", { startTime: START, endTime: END }],
    [
      "a malformed id",
      { telemetryExceptionIds: ["x"], startTime: START, endTime: END },
    ],
    [
      "more ids than a page holds",
      {
        telemetryExceptionIds: new Array(MAX_EXCEPTION_LIST_STATS_IDS + 1).fill(
          E1,
        ),
        startTime: START,
        endTime: END,
      },
    ],
    ["no start", { telemetryExceptionIds: [E1], endTime: END }],
    [
      "a start that is not a time",
      { telemetryExceptionIds: [E1], startTime: "yesterday", endTime: END },
    ],
    [
      "an end before the start",
      { telemetryExceptionIds: [E1], startTime: END, endTime: START },
    ],
    ["no body at all", undefined],
  ])(
    "%s is refused before anything is read",
    async (_name: string, body: unknown) => {
      const read: SpyInstance<typeof ExceptionListStatsReader.read> =
        jest.spyOn(ExceptionListStatsReader, "read");
      const props: SpyInstance<
        typeof CommonAPI.getDatabaseCommonInteractionProps
      > = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");

      const next: NextFunction = await post(body);

      expect(refusal(next)).toBeInstanceOf(BadDataException);
      expect(read).not.toHaveBeenCalled();
      expect(props).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    },
  );

  test("a reader refusal is passed on", async () => {
    jest
      .spyOn(ExceptionListStatsReader, "read")
      .mockRejectedValue(new BadDataException("Project ID is required"));

    const next: NextFunction = await post({
      telemetryExceptionIds: [E1],
      startTime: START,
      endTime: END,
    });

    expect(refusal(next)).toBeInstanceOf(BadDataException);
    expect(sent).toHaveLength(0);
  });
});
