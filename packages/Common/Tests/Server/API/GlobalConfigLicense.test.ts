import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserService from "../../../Server/Services/UserService";
import Response from "../../../Server/Utils/Response";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import API from "../../../Utils/API";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { beforeEach, afterEach, describe, expect, it } from "@jest/globals";

/*
 * The self-hosted half of the licence: activating a key, refreshing the key
 * the installation already holds, and reporting what the seat limit means
 * right now.
 *
 * Two things brought this suite into being.
 *
 * The seat limit is set on oneuptime.com and changes on any day — a customer
 * buys ten more seats at noon. It reaches the installation through the daily
 * report job, so until now the only way to apply it sooner was for somebody to
 * re-type the licence key into a box that is HIDDEN while the licence is
 * valid. /license/refresh is that missing button, and it exists precisely
 * because the installation now refuses users above the limit: waiting a day to
 * learn about seats you have already paid for is a different feature when the
 * old number is being enforced.
 *
 * And both writes used to run on UserMiddleware.getUserMiddleware, which lets
 * anonymous callers through — it has to, because the GET on the same path
 * serves the signed-out login page. That made the route that decides this
 * installation's seat ceiling reachable without signing in at all.
 */

/*
 * PasswordHash carries a pre-existing TS diagnostic that fails any suite whose
 * require graph reaches it, and BaseAPI's graph still reaches it. Replaced with
 * a factory rather than automocked, because an automock still type-checks the
 * real file.
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

// Same story as PasswordHash: a local-only diagnostic in a module dragged in.
jest.mock("../../../Server/Utils/VerificationCode", () => {
  return {
    __esModule: true,
    default: {
      generate: jest.fn(),
      hashCode: jest.fn(),
      isHashEqual: jest.fn(),
      generateUnusableHash: jest.fn(),
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
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

/*
 * The deployment flags live on globalThis rather than in module-scope
 * variables, and the getters below reference nothing but globalThis.
 *
 * jest hoists the mock factory above every declaration in this file, and
 * BaseAPI's import graph reaches IncidentFeedService, which reads
 * IsBillingEnabled at module scope. That read lands inside these getters
 * during the import — before a `let` in this file has initialised — and a
 * getter that closed over one would throw a temporal-dead-zone
 * ReferenceError before a single test ran. Absent flags read as false, which
 * is a fine thing for an unrelated service to see on its way past.
 *
 * They are also live accessors rather than values: the routes read the flags
 * when they run, and object spread would flatten them at import time.
 */
const BILLING_FLAG_KEY: string = "__oneUptimeTestIsBillingEnabled";
const ENTERPRISE_FLAG_KEY: string = "__oneUptimeTestIsEnterpriseEdition";

type SetDeploymentFlagFunction = (key: string, value: boolean) => void;

const setDeploymentFlag: SetDeploymentFlagFunction = (
  key: string,
  value: boolean,
): void => {
  (globalThis as unknown as Record<string, unknown>)[key] = value;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return (
        (globalThis as unknown as Record<string, unknown>)[
          "__oneUptimeTestIsBillingEnabled"
        ] === true
      );
    },
  });

  Object.defineProperty(mocked, "IsEnterpriseEdition", {
    get: (): boolean => {
      return (
        (globalThis as unknown as Record<string, unknown>)[
          "__oneUptimeTestIsEnterpriseEdition"
        ] === true
      );
    },
  });

  return mocked;
});

/*
 * Factories rather than automocks. An automock still loads the real module to
 * copy its shape, and loading UserService drags in most of the service graph -
 * some of which reads IsBillingEnabled at module scope, before the flags above
 * have initialised. Nothing here needs the real implementations.
 */
jest.mock("../../../Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

const LICENSE_ROUTE: string = "/global-config/license";
const REFRESH_ROUTE: string = "/global-config/license/refresh";

const STORED_LICENSE_KEY: string = "acme-stored-license-key";
const INSTANCE_ID: ObjectID = ObjectID.generate();

type MakeStoredConfigFunction = (
  overrides?: Record<string, unknown>,
) => GlobalConfig;

const makeStoredConfig: MakeStoredConfigFunction = (
  overrides?: Record<string, unknown>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  config.id = ObjectID.getZeroObjectID();
  config.instanceId = INSTANCE_ID;
  config.enterpriseLicenseKey = STORED_LICENSE_KEY;

  return Object.assign(config, overrides || {});
};

type LicenseServerPayloadFunction = (
  overrides?: Record<string, unknown>,
) => JSONObject;

const licenseServerPayload: LicenseServerPayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return {
    companyName: "Acme Inc",
    expiresAt: "2030-01-01T00:00:00.000Z",
    licenseKey: STORED_LICENSE_KEY,
    token: "signed.jwt.token",
    isEvaluationLicense: false,
    userLimit: 150,
    currentUserCount: 42,
    userCountUpdatedAt: "2026-01-01T00:00:00.000Z",
    instances: [],
    ...overrides,
  };
};

type GetResponseBodyFunction = () => JSONObject;

const getResponseBody: GetResponseBodyFunction = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as JSONObject;
};

type GetStoredUpdateFunction = () => JSONObject;

const getStoredUpdate: GetStoredUpdateFunction = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    GlobalConfigService.updateOneById as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  return (calls[0]![0] as Record<string, unknown>)["data"] as JSONObject;
};

describe("GlobalConfigAPI licence routes", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  type CallRouteFunction = (route: string) => Promise<void>;

  const callRoute: CallRouteFunction = async (route: string): Promise<void> => {
    await mockRouter
      .match("post", route)
      .handlerFunction(mockRequest, mockResponse, nextFunction);
  };

  type NextErrorFunction = () => Error;

  const nextError: NextErrorFunction = (): Error => {
    const calls: Array<Array<unknown>> = (nextFunction as unknown as jest.Mock)
      .mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return calls[0]![0] as Error;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes = [];
    setDeploymentFlag(BILLING_FLAG_KEY, false);
    setDeploymentFlag(ENTERPRISE_FLAG_KEY, true);

    new GlobalConfigAPI();

    GlobalConfigService.findOneById = jest
      .fn()
      .mockResolvedValue(makeStoredConfig());
    GlobalConfigService.updateOneById = jest.fn().mockResolvedValue(undefined);
    GlobalConfigService.create = jest.fn().mockResolvedValue(undefined);

    UserService.countBy = jest.fn().mockResolvedValue(new PositiveNumber(42));

    (API.post as unknown as jest.Mock) = jest
      .fn()
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, licenseServerPayload(), {}),
      );

    mockRequest = {
      body: {},
    } as unknown as OneUptimeRequest;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("who is allowed to write the licence", () => {
    /*
     * The seat limit these routes store is the number UserService refuses new
     * users against. UserMiddleware.getUserMiddleware — which the GET on the
     * same path uses, and has to, because it serves the signed-out login page —
     * lets anonymous callers straight through, so it is not a guard here.
     */
    it.each([
      ["activating a licence key", LICENSE_ROUTE],
      ["refreshing the stored licence", REFRESH_ROUTE],
    ])("requires a master admin for %s", (_label: string, route: string) => {
      expect(mockRouter.match("post", route).middlewares).toContain(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    it("still serves the licence GET to anyone, so the login page keeps working", () => {
      expect(mockRouter.match("get", LICENSE_ROUTE).middlewares).not.toContain(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });
  });

  describe("POST /global-config/license - activating a key", () => {
    it("rejects a request with no licence key", async () => {
      mockRequest.body = {};

      await callRoute(LICENSE_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(API.post).not.toHaveBeenCalled();
    });

    it("rejects a licence key that is only whitespace", async () => {
      mockRequest.body = { licenseKey: "   " };

      await callRoute(LICENSE_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
    });

    it("validates the supplied key against oneuptime.com", async () => {
      mockRequest.body = { licenseKey: "  a-new-key  " };

      await callRoute(LICENSE_ROUTE);

      const sent: JSONObject = (
        (API.post as unknown as jest.Mock).mock.calls[0]![0] as Record<
          string,
          JSONObject
        >
      )["data"] as JSONObject;

      expect(sent["licenseKey"]).toBe("a-new-key");
      expect(sent["instanceId"]).toBe(INSTANCE_ID.toString());
    });

    it("stores the seat limit the licence server reported", async () => {
      mockRequest.body = { licenseKey: STORED_LICENSE_KEY };

      await callRoute(LICENSE_ROUTE);

      expect(getStoredUpdate()["enterpriseLicenseUserLimit"]).toBe(150);
    });
  });

  describe("POST /global-config/license/refresh", () => {
    /*
     * The whole point of the route: no key in the body. A refresh that
     * accepted one would be an activation with a friendlier name, and a
     * mistyped key would be able to replace a working licence by accident.
     */
    it("refreshes using the stored key and ignores anything in the body", async () => {
      mockRequest.body = { licenseKey: "somebody-elses-key" };

      await callRoute(REFRESH_ROUTE);

      const sent: JSONObject = (
        (API.post as unknown as jest.Mock).mock.calls[0]![0] as Record<
          string,
          JSONObject
        >
      )["data"] as JSONObject;

      expect(sent["licenseKey"]).toBe(STORED_LICENSE_KEY);
    });

    it("refuses to refresh an installation that has no licence key yet", async () => {
      GlobalConfigService.findOneById = jest
        .fn()
        .mockResolvedValue(
          makeStoredConfig({ enterpriseLicenseKey: undefined }),
        );

      await callRoute(REFRESH_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(API.post).not.toHaveBeenCalled();
    });

    it("refuses to refresh when there is no config row at all", async () => {
      GlobalConfigService.findOneById = jest.fn().mockResolvedValue(null);

      await callRoute(REFRESH_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(API.post).not.toHaveBeenCalled();
    });

    /*
     * The reason the button exists. The customer raised the limit on
     * oneuptime.com; the stored 50 is what this installation is refusing users
     * against until something writes the new number down.
     */
    it("applies a seat limit that has been raised on oneuptime.com", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ userLimit: 500 }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      expect(getStoredUpdate()["enterpriseLicenseUserLimit"]).toBe(500);
      expect(getResponseBody()["userLimit"]).toBe(500);
    });

    it("applies a seat limit that has been lowered on oneuptime.com", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ userLimit: 5 }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      expect(getStoredUpdate()["enterpriseLicenseUserLimit"]).toBe(5);
    });

    it("clears the seat limit when the licence no longer carries one", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ userLimit: null }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      expect(getStoredUpdate()["enterpriseLicenseUserLimit"]).toBeNull();
    });

    it("refreshes the expiry as well as the seat limit", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ expiresAt: "2031-06-01T00:00:00.000Z" }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      expect(
        (
          getStoredUpdate()["enterpriseLicenseExpiresAt"] as unknown as Date
        ).toISOString(),
      ).toBe("2031-06-01T00:00:00.000Z");
    });

    /*
     * An installation that cannot reach oneuptime.com must be told so rather
     * than quietly keeping the old terms and reporting success — the
     * administrator pressed this button precisely because they believe the old
     * terms are wrong.
     */
    it("surfaces a failure from the licence server instead of storing anything", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPErrorResponse(500, { message: "License key is invalid" }, {}),
      );

      await callRoute(REFRESH_ROUTE);

      const error: Error = nextError();

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe("License key is invalid");
      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
    });

    it("does not store anything when the returned expiry is not a date", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ expiresAt: "the-first-of-never" }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      expect(nextError()).toBeInstanceOf(BadDataException);
      expect(GlobalConfigService.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("the seat enforcement the response reports", () => {
    it("reports the seats in use against the freshly refreshed limit", async () => {
      UserService.countBy = jest.fn().mockResolvedValue(new PositiveNumber(42));

      await callRoute(REFRESH_ROUTE);

      const body: JSONObject = getResponseBody();

      expect(body["isSeatLimitEnforced"]).toBe(true);
      expect(body["seatsInUse"]).toBe(42);
      expect(body["seatsRemaining"]).toBe(108);
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    /*
     * The live count is what enforcement uses, and it is allowed to be higher
     * than the licence-wide figure oneuptime.com last computed — that figure is
     * up to a day old.
     */
    it("prefers the live user count over the licence server's stale one", async () => {
      UserService.countBy = jest
        .fn()
        .mockResolvedValue(new PositiveNumber(150));

      await callRoute(REFRESH_ROUTE);

      const body: JSONObject = getResponseBody();

      expect(body["seatsInUse"]).toBe(150);
      expect(body["seatsRemaining"]).toBe(0);
      expect(body["canAddMoreUsers"]).toBe(false);
    });

    it("says the limit is not enforced when the licence has none", async () => {
      (API.post as unknown as jest.Mock).mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          licenseServerPayload({ userLimit: null }),
          {},
        ),
      );

      await callRoute(REFRESH_ROUTE);

      const body: JSONObject = getResponseBody();

      expect(body["isSeatLimitEnforced"]).toBe(false);
      expect(body["seatsInUse"]).toBeNull();
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    it("says the limit is not enforced on Community Edition", async () => {
      setDeploymentFlag(ENTERPRISE_FLAG_KEY, false);

      await callRoute(REFRESH_ROUTE);

      const body: JSONObject = getResponseBody();

      expect(body["isSeatLimitEnforced"]).toBe(false);
      expect(body["canAddMoreUsers"]).toBe(true);
      expect(UserService.countBy).not.toHaveBeenCalled();
    });
  });

  describe("GET /global-config/license", () => {
    type CallGetFunction = () => Promise<void>;

    const callGet: CallGetFunction = async (): Promise<void> => {
      await mockRouter
        .match("get", LICENSE_ROUTE)
        .handlerFunction(mockRequest, mockResponse, nextFunction);
    };

    beforeEach(() => {
      GlobalConfigService.findOneById = jest.fn().mockResolvedValue(
        makeStoredConfig({
          enterpriseLicenseUserLimit: 150,
          enterpriseLicenseCurrentUserCount: 42,
          enterpriseLicenseInstances: [],
        }),
      );
    });

    it("tells a signed-in administrator how close the installation is to refusing users", async () => {
      (mockRequest as unknown as Record<string, unknown>)["userAuthorization"] =
        {
          userId: ObjectID.generate(),
        };
      UserService.countBy = jest
        .fn()
        .mockResolvedValue(new PositiveNumber(149));

      await callGet();

      const body: JSONObject = getResponseBody();

      expect(body["isSeatLimitEnforced"]).toBe(true);
      expect(body["seatsInUse"]).toBe(149);
      expect(body["seatsRemaining"]).toBe(1);
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    /*
     * The same route serves the signed-out login page. How near this server is
     * to refusing new accounts is operational detail, and counting its users
     * for an anonymous visitor would be a free query on an unauthenticated
     * endpoint besides.
     */
    it("tells an anonymous visitor nothing about seat enforcement", async () => {
      await callGet();

      const body: JSONObject = getResponseBody();

      expect(body["isSeatLimitEnforced"]).toBe(false);
      expect(body["seatsInUse"]).toBeNull();
      expect(body["seatsRemaining"]).toBeNull();
      expect(body["canAddMoreUsers"]).toBe(true);
      expect(UserService.countBy).not.toHaveBeenCalled();
    });
  });
});
