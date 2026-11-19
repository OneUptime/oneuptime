/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

/*
 * The real DatabaseService pulls in the whole server dependency graph. The
 * suite drives BaseAPI.getList with hand-built service stubs instead, so the
 * class is reduced to a mock constructor. getList's stock-hook check compares
 * service.onBeforeFind against DatabaseService.prototype.onBeforeFind BY
 * REFERENCE, so the mock's prototype must carry a real function — a bare
 * jest.fn() constructor's prototype has no onBeforeFind, and every stub would
 * then pass the compare as undefined === undefined, never exercising the
 * inherited-vs-own mechanics the gate relies on. Stock-path stubs inherit the
 * hook (createServiceStub below); override-path stubs shadow it with their
 * own function. The returned instance still needs the methods that concrete
 * services invoke at module load (the require graph instantiates them all),
 * mirroring BaseAPI.test.ts.
 */
jest.mock("../../../Server/Services/DatabaseService", () => {
  const DatabaseServiceMock: jest.Mock = jest.fn().mockImplementation(() => {
    return {
      countBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      deleteOneBy: jest.fn(),
      deleteOneById: jest.fn(),
      updateOneById: jest.fn(),
      updateOneBy: jest.fn(),
      create: jest.fn(),
      hardDeleteItemsOlderThanInDays: jest.fn(),
      keepRowsOnDeleteByQuery: jest.fn(),
    };
  });

  /*
   * The shared stock hook: a named function on the prototype, so the gate's
   * reference compare works against the same shared-function-inheritance
   * shape it sees in production.
   */
  function stockOnBeforeFind(findBy: unknown): Promise<unknown> {
    return Promise.resolve(findBy);
  }

  (
    DatabaseServiceMock as unknown as {
      prototype: { onBeforeFind: unknown };
    }
  ).prototype.onBeforeFind = stockOnBeforeFind;

  return DatabaseServiceMock;
});

jest.mock(
  "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel",
  () => {
    return jest.fn().mockImplementation((initObject: GenericObject) => {
      return {
        ...initObject,
        getCrudApiPath: jest.fn().mockImplementation(() => {
          return "/mock";
        }),
        getTableColumnMetadata: jest.fn().mockImplementation(() => {
          return null;
        }),
        /*
         * BaseAPI asks every model whether its rows make up an ordered list
         * (Types/Database/MoveInList) before it adds the move route. This
         * table's make up none, so it has no move route.
         */
        getListOrder: jest.fn().mockImplementation(() => {
          return null;
        }),
      };
    });
  },
);

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    getCurrentPlan: () => {
      return {
        currentPlan: "Free",
        isSubscriptionUnpaid: false,
      };
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
    LogLevel: "INFO",
    DisableTelemetry: true,
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import { afterEach, describe, expect, it } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GenericObject from "../../../Types/GenericObject";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";

/*
 * A LIST'S COUNT STOPS AT THE CAP IT ASKS FOR (countUpTo).
 *
 * BaseAPI.getList counts every matching record unless the request asks for
 * a cap: then it counts no further than the cap, or the end of the page it
 * reads if that is further (DatabaseService.countBy's upTo, CappedCount),
 * and more than that answers the cap with isCountCapped. Driven here with
 * hand-built service stubs, on both of getList's paths: the parallel one
 * (stock onBeforeFind) and the sequential one (an overridden hook).
 */

// eslint-disable-next-line @typescript-eslint/typedef
const res = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
} as any as ExpressResponse;

type ServiceStub = {
  findBy: jest.Mock;
  countBy: jest.Mock;
  onBeforeFind?: (...args: Array<unknown>) => Promise<unknown>;
};

function createServiceStub(options?: { ownHook?: boolean }): ServiceStub {
  const stub: ServiceStub = Object.create(
    (DatabaseService as unknown as { prototype: Record<string, unknown> })
      .prototype,
  ) as ServiceStub;
  stub.findBy = jest.fn();
  stub.countBy = jest.fn();

  if (options?.ownHook) {
    stub.onBeforeFind = jest.fn() as unknown as (
      ...args: Array<unknown>
    ) => Promise<unknown>;
  }

  return stub;
}

function createApi(
  service: ServiceStub,
): BaseAPI<BaseModel, DatabaseService<BaseModel>> {
  return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
    BaseModel,
    service as unknown as DatabaseService<BaseModel>,
  );
}

function createListRequest(data: {
  body?: JSONObject | undefined;
  query?: JSONObject | undefined;
}): OneUptimeRequest {
  return {
    query: data.query || {},
    headers: {},
    ...(data.body ? { body: data.body } : {}),
  } as unknown as OneUptimeRequest;
}

// What getList asked countBy for.
function countArgsOf(service: ServiceStub): JSONObject {
  return service.countBy.mock.calls[0]?.[0] as JSONObject;
}

const LIST: Array<BaseModel> = [{ id: "row" }] as unknown as Array<BaseModel>;

describe.each([
  ["the parallel path (stock onBeforeFind)", false],
  ["the sequential path (an overridden onBeforeFind)", true],
])("BaseAPI.getList's count, on %s", (_label: string, ownHook: boolean) => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("counts every record, and answers as before, when the request asks for no cap", async () => {
    const service: ServiceStub = createServiceStub({ ownHook });
    service.findBy.mockResolvedValue(LIST);
    service.countBy.mockResolvedValue(new PositiveNumber(123456));

    const request: OneUptimeRequest = createListRequest({
      body: { query: {}, select: {}, sort: {} },
    });

    await createApi(service).getList(request, res);

    expect(Object.keys(countArgsOf(service))).not.toContain("upTo");
    // The envelope of five arguments, no options: an exact count.
    expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
      request,
      res,
      LIST,
      new PositiveNumber(123456),
      BaseModel,
    );
    expect(
      (Response.sendEntityArrayResponse as jest.Mock).mock.calls[0],
    ).toHaveLength(5);
  });

  it("counts up to the cap, and answers the cap with isCountCapped when more match", async () => {
    const service: ServiceStub = createServiceStub({ ownHook });
    service.findBy.mockResolvedValue(LIST);
    // countBy with upTo answers at most upTo + 1.
    service.countBy.mockResolvedValue(new PositiveNumber(10001));

    const request: OneUptimeRequest = createListRequest({
      body: { query: {}, select: {}, sort: {}, countUpTo: 10000 },
    });

    await createApi(service).getList(request, res);

    expect(countArgsOf(service)["upTo"]).toBe(10000);
    expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
      request,
      res,
      LIST,
      new PositiveNumber(10000),
      BaseModel,
      { isCountCapped: true },
    );
  });

  it.each([
    [0, 0],
    [1, 1],
    [9999, 9999],
    [10000, 10000],
  ])(
    "answers an exact count of %i (no more than the cap matched)",
    async (matched: number, expected: number) => {
      const service: ServiceStub = createServiceStub({ ownHook });
      service.findBy.mockResolvedValue(LIST);
      service.countBy.mockResolvedValue(new PositiveNumber(matched));

      const request: OneUptimeRequest = createListRequest({
        body: { query: {}, select: {}, sort: {}, countUpTo: 10000 },
      });

      await createApi(service).getList(request, res);

      expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
        request,
        res,
        LIST,
        new PositiveNumber(expected),
        BaseModel,
      );
      expect(
        (Response.sendEntityArrayResponse as jest.Mock).mock.calls[0],
      ).toHaveLength(5);
    },
  );

  /*
   * A capped count says records follow the page, so it never stops short of
   * the page's end: a page read far down a long list counts at least to it.
   */
  it.each([
    // countUpTo, skip, limit, the cap countBy is asked for
    [10000, 0, 10, 10000],
    [10000, 9990, 10, 10000],
    [10000, 20000, 10, 20010],
    [10000, 0, 100, 10000],
    // A live read of a capped list: only as far as its own page.
    [1, 0, 10, 10],
    [1, 40, 20, 60],
  ])(
    "countUpTo %i at skip %i, limit %i counts up to %i",
    async (countUpTo: number, skip: number, limit: number, cap: number) => {
      const service: ServiceStub = createServiceStub({ ownHook });
      service.findBy.mockResolvedValue(LIST);
      service.countBy.mockResolvedValue(new PositiveNumber(cap + 1));

      const request: OneUptimeRequest = createListRequest({
        query: { skip: String(skip), limit: String(limit) },
        body: { query: {}, select: {}, sort: {}, countUpTo: countUpTo },
      });

      await createApi(service).getList(request, res);

      expect(countArgsOf(service)["upTo"]).toBe(cap);
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
        request,
        res,
        LIST,
        new PositiveNumber(cap),
        BaseModel,
        { isCountCapped: true },
      );
    },
  );

  it("reads countUpTo from the query string too, as skip and limit are read", async () => {
    const service: ServiceStub = createServiceStub({ ownHook });
    service.findBy.mockResolvedValue(LIST);
    service.countBy.mockResolvedValue(new PositiveNumber(3));

    await createApi(service).getList(
      createListRequest({ query: { countUpTo: "500" } }),
      res,
    );

    expect(countArgsOf(service)["upTo"]).toBe(500);
  });

  it.each([[0], [-1], [1.5], ["abc"], ["12abc"], [true], [{}], [Infinity]])(
    "refuses countUpTo %p, before anything is read",
    async (countUpTo: unknown) => {
      const service: ServiceStub = createServiceStub({ ownHook });
      service.findBy.mockResolvedValue(LIST);
      service.countBy.mockResolvedValue(new PositiveNumber(0));

      await expect(
        createApi(service).getList(
          createListRequest({
            body: {
              query: {},
              select: {},
              sort: {},
              countUpTo: countUpTo as never,
            },
          }),
          res,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(service.findBy).not.toHaveBeenCalled();
      expect(service.countBy).not.toHaveBeenCalled();
    },
  );

  it("treats an empty or null countUpTo as none asked for", async () => {
    for (const countUpTo of ["", null]) {
      const service: ServiceStub = createServiceStub({ ownHook });
      service.findBy.mockResolvedValue(LIST);
      service.countBy.mockResolvedValue(new PositiveNumber(7));

      await createApi(service).getList(
        createListRequest({
          body: { query: {}, select: {}, sort: {}, countUpTo: countUpTo },
        }),
        res,
      );

      expect(Object.keys(countArgsOf(service))).not.toContain("upTo");
      jest.clearAllMocks();
    }
  });
});

describe("BaseAPI.getCountUpTo", () => {
  it.each([
    [{ body: { countUpTo: 10000 } }, 10000],
    [{ body: { countUpTo: "250" } }, 250],
    [{ body: { countUpTo: " 7 " } }, 7],
    [{ query: { countUpTo: "1" } }, 1],
    [{ query: { countUpTo: "30" }, body: { countUpTo: 40 } }, 30],
    [{ body: {} }, undefined],
    [{}, undefined],
  ])("%j asks for %p", (data: JSONObject, expected: number | undefined) => {
    expect(
      BaseAPI.getCountUpTo(
        createListRequest({
          body: data["body"] as JSONObject | undefined,
          query: data["query"] as JSONObject | undefined,
        }),
      ),
    ).toBe(expected);
  });
});
