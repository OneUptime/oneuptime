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
 * class is reduced to a bare mock constructor — its (empty) prototype is
 * exactly what getList's stock-hook check compares against. The returned
 * instance still needs the methods that concrete services invoke at module
 * load (the require graph instantiates them all), mirroring BaseAPI.test.ts.
 */
jest.mock("../../../Server/Services/DatabaseService", () => {
  return jest.fn().mockImplementation(() => {
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
    };
  });
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
import { JSONObject } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";

// eslint-disable-next-line @typescript-eslint/typedef
const res = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
} as any as ExpressResponse;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | null = null;
  let rejectFn: ((error: Error) => void) | null = null;

  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (error: Error) => void) => {
      resolveFn = resolve;
      rejectFn = reject;
    },
  );

  return {
    promise,
    resolve: resolveFn!,
    reject: rejectFn!,
  };
}

/*
 * getList awaits a handful of internal steps (onBeforeList, the common-props
 * builder) before dispatching the service calls; draining a generous number
 * of microtask turns lets every already-startable step run without ever
 * resolving the deferred service promises.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await Promise.resolve();
  }
}

type ServiceStub = {
  findBy: jest.Mock;
  countBy: jest.Mock;
  onBeforeFind?: (...args: Array<unknown>) => Promise<unknown>;
};

function createServiceStub(): ServiceStub {
  return {
    findBy: jest.fn(),
    countBy: jest.fn(),
  };
}

function createApi(
  service: ServiceStub,
): BaseAPI<BaseModel, DatabaseService<BaseModel>> {
  return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
    BaseModel,
    service as unknown as DatabaseService<BaseModel>,
  );
}

function createListRequest(body?: JSONObject): OneUptimeRequest {
  return {
    query: {},
    headers: {},
    ...(body ? { body } : {}),
  } as unknown as OneUptimeRequest;
}

describe("BaseAPI.getList findBy/countBy parallel dispatch", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("service with the stock onBeforeFind hook (parallel path)", () => {
    it("starts countBy before findBy has resolved, and sends the unchanged response envelope", async () => {
      const service: ServiceStub = createServiceStub();
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findDeferred: Deferred<Array<BaseModel>> =
        createDeferred<Array<BaseModel>>();
      const countDeferred: Deferred<PositiveNumber> =
        createDeferred<PositiveNumber>();

      service.findBy.mockReturnValue(findDeferred.promise);
      service.countBy.mockReturnValue(countDeferred.promise);

      const request: OneUptimeRequest = createListRequest();
      const pending: Promise<void> = api.getList(request, res);

      await flushMicrotasks();

      /*
       * The core of the change: with findBy still pending, countBy must
       * already have been dispatched. The old sequential code awaited findBy
       * to completion first, so countBy would not have been called here.
       */
      expect(service.findBy).toHaveBeenCalledTimes(1);
      expect(service.countBy).toHaveBeenCalledTimes(1);

      const list: Array<BaseModel> = [
        { id: "mock" },
      ] as unknown as Array<BaseModel>;
      const count: PositiveNumber = new PositiveNumber(42);

      findDeferred.resolve(list);
      countDeferred.resolve(count);
      await pending;

      // Same envelope as before: (req, res, list, count, entityType).
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
        request,
        res,
        list,
        count,
        BaseModel,
      );
    });

    it("gives countBy its own copies of query and props so neither call can see the other's in-place edits", async () => {
      const service: ServiceStub = createServiceStub();
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      service.findBy.mockResolvedValue([]);
      service.countBy.mockResolvedValue(new PositiveNumber(0));

      const request: OneUptimeRequest = createListRequest({
        query: { name: "zeta" },
        select: { name: true },
        sort: {},
      });

      await api.getList(request, res);

      // eslint-disable-next-line @typescript-eslint/typedef
      const findArgs = service.findBy.mock.calls[0]?.[0] as {
        query: JSONObject;
        props: JSONObject;
      };
      // eslint-disable-next-line @typescript-eslint/typedef
      const countArgs = service.countBy.mock.calls[0]?.[0] as {
        query: JSONObject;
        props: JSONObject;
      };

      // Same effective query and props for both calls...
      expect(countArgs.query).toEqual(findArgs.query);
      expect(countArgs.query).toEqual({ name: "zeta" });
      expect(countArgs.props).toEqual(findArgs.props);

      // ...but distinct objects, so concurrent mutation cannot leak across.
      expect(countArgs.query).not.toBe(findArgs.query);
      expect(countArgs.props).not.toBe(findArgs.props);
    });

    it("rejects with findBy's error when findBy fails", async () => {
      const service: ServiceStub = createServiceStub();
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findDeferred: Deferred<Array<BaseModel>> =
        createDeferred<Array<BaseModel>>();
      const countDeferred: Deferred<PositiveNumber> =
        createDeferred<PositiveNumber>();

      service.findBy.mockReturnValue(findDeferred.promise);
      service.countBy.mockReturnValue(countDeferred.promise);

      const pending: Promise<void> = api.getList(createListRequest(), res);
      const findError: Error = new Error("findBy failed");
      const rejection: Promise<void> = expect(pending).rejects.toBe(findError);

      await flushMicrotasks();
      findDeferred.reject(findError);
      countDeferred.resolve(new PositiveNumber(0));

      await rejection;
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
    });

    it("rejects with countBy's error when countBy fails", async () => {
      const service: ServiceStub = createServiceStub();
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findDeferred: Deferred<Array<BaseModel>> =
        createDeferred<Array<BaseModel>>();
      const countDeferred: Deferred<PositiveNumber> =
        createDeferred<PositiveNumber>();

      service.findBy.mockReturnValue(findDeferred.promise);
      service.countBy.mockReturnValue(countDeferred.promise);

      const pending: Promise<void> = api.getList(createListRequest(), res);
      const countError: Error = new Error("countBy failed");
      const rejection: Promise<void> = expect(pending).rejects.toBe(countError);

      await flushMicrotasks();
      countDeferred.reject(countError);
      findDeferred.resolve([]);

      await rejection;
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
    });

    it("keeps findBy's error priority when both calls fail, even if countBy fails first", async () => {
      const service: ServiceStub = createServiceStub();
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findDeferred: Deferred<Array<BaseModel>> =
        createDeferred<Array<BaseModel>>();
      const countDeferred: Deferred<PositiveNumber> =
        createDeferred<PositiveNumber>();

      service.findBy.mockReturnValue(findDeferred.promise);
      service.countBy.mockReturnValue(countDeferred.promise);

      const pending: Promise<void> = api.getList(createListRequest(), res);
      const findError: Error = new Error("findBy failed");
      const countError: Error = new Error("countBy failed");

      /*
       * Sequentially, a double failure always surfaced findBy's error
       * (countBy never even ran). The parallel path must keep that outcome
       * regardless of which call happens to fail first.
       */
      const rejection: Promise<void> = expect(pending).rejects.toBe(findError);

      await flushMicrotasks();
      countDeferred.reject(countError);
      await flushMicrotasks();
      findDeferred.reject(findError);

      await rejection;
    });
  });

  describe("service with an overridden onBeforeFind hook (sequential fallback)", () => {
    /*
     * Some services (ProjectService, the incident/alert privacy filters)
     * mutate the shared query/props objects in place inside onBeforeFind, and
     * the count has always inherited those mutations by running afterwards.
     * For such services the pre-change sequential order — and the shared
     * object identity that carries the mutations — must be preserved.
     */
    it("does not start countBy until findBy resolves, and shares the query/props objects between the calls", async () => {
      const service: ServiceStub = createServiceStub();
      service.onBeforeFind = jest.fn() as unknown as (
        ...args: Array<unknown>
      ) => Promise<unknown>;
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findDeferred: Deferred<Array<BaseModel>> =
        createDeferred<Array<BaseModel>>();
      const countDeferred: Deferred<PositiveNumber> =
        createDeferred<PositiveNumber>();

      service.findBy.mockReturnValue(findDeferred.promise);
      service.countBy.mockReturnValue(countDeferred.promise);

      const request: OneUptimeRequest = createListRequest({
        query: { name: "zeta" },
        select: { name: true },
        sort: {},
      });
      const pending: Promise<void> = api.getList(request, res);

      await flushMicrotasks();

      expect(service.findBy).toHaveBeenCalledTimes(1);
      expect(service.countBy).not.toHaveBeenCalled();

      const list: Array<BaseModel> = [] as Array<BaseModel>;
      findDeferred.resolve(list);
      await flushMicrotasks();

      expect(service.countBy).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line @typescript-eslint/typedef
      const findArgs = service.findBy.mock.calls[0]?.[0] as {
        query: JSONObject;
        props: JSONObject;
      };
      // eslint-disable-next-line @typescript-eslint/typedef
      const countArgs = service.countBy.mock.calls[0]?.[0] as {
        query: JSONObject;
        props: JSONObject;
      };

      // Identity, not just equality: in-place hook mutations must carry over.
      expect(countArgs.query).toBe(findArgs.query);
      expect(countArgs.props).toBe(findArgs.props);

      const count: PositiveNumber = new PositiveNumber(0);
      countDeferred.resolve(count);
      await pending;

      expect(Response.sendEntityArrayResponse).toHaveBeenCalledWith(
        request,
        res,
        list,
        count,
        BaseModel,
      );
    });

    it("never starts countBy when findBy fails", async () => {
      const service: ServiceStub = createServiceStub();
      service.onBeforeFind = jest.fn() as unknown as (
        ...args: Array<unknown>
      ) => Promise<unknown>;
      const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = createApi(
        service,
      );

      const findError: Error = new Error("findBy failed");
      service.findBy.mockRejectedValue(findError);
      service.countBy.mockResolvedValue(new PositiveNumber(0));

      await expect(api.getList(createListRequest(), res)).rejects.toBe(
        findError,
      );
      expect(service.countBy).not.toHaveBeenCalled();
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
    });
  });
});
