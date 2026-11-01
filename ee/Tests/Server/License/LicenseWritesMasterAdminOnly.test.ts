import {
  createLicenseClientRouter,
  LICENSE_REFRESH_ROUTE,
  LICENSE_ROUTE,
} from "../../../Server/License/API/LicenseClientAPI";
import LicenseClient from "../../../Server/License/LicenseClient";
import { findRoute, FoundRoute } from "./Helpers/LicenseTestKit";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import Response from "Common/Server/Utils/Response";
import Exception from "Common/Types/Exception/Exception";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Nobody but a master admin changes the license.
 *
 * The license is instance-wide, and its seat limit is what UserService refuses
 * new users against: whoever can write it can raise the ceiling on the whole
 * installation. LicenseClientAPI.test.ts pins that both routes carry the
 * middleware; this runs it. Every kind of caller goes through the REAL
 * MasterAdminAuthorization, on both routes, in the order a request does -
 * only reading the session is stubbed - and everybody but a master admin has
 * to stop there, before anything reaches the license client.
 *
 * The Admin Dashboard's license page offers these to master admins and the
 * edition dialog offers them to nobody, but a client is only a client: this
 * is what actually holds, for a request written by hand.
 */

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/License/LicenseClient", () => {
  return {
    __esModule: true,
    default: {
      normalizePastedToken: (value: unknown): string => {
        return typeof value === "string" ? value.trim() : "";
      },
      activateOffline: jest.fn(),
      validateWithLicenseServer: jest.fn(),
      refreshStoredLicense: jest.fn(),
    },
  };
});

jest.mock("../../../Server/License/LicenseProvider", () => {
  return {
    __esModule: true,
    default: {
      getSnapshot: jest.fn(),
      getSeatUsage: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/API/GlobalConfigAPI", () => {
  return {
    __esModule: true,
    LICENSE_RESPONSE_CONFIG_SELECT: {},
    default: {
      buildLicenseResponse: (): JSONObject => {
        return { status: "valid" };
      },
    },
  };
});

const USER_ID: ObjectID = ObjectID.generate();

type SessionFunction = (isMasterAdmin: boolean) => JSONWebTokenData;

const session: SessionFunction = (isMasterAdmin: boolean): JSONWebTokenData => {
  return {
    userId: USER_ID,
    isMasterAdmin: isMasterAdmin,
  } as unknown as JSONWebTokenData;
};

interface Write {
  name: string;
  route: string;
  body: JSONObject;
}

const WRITES: Array<Write> = [
  {
    name: "activating a key",
    route: LICENSE_ROUTE,
    body: { licenseKey: "stolen-license-key" },
  },
  {
    name: "activating a token offline",
    route: LICENSE_ROUTE,
    body: { licenseToken: "forged.license.token" },
  },
  { name: "refreshing the license", route: LICENSE_REFRESH_ROUTE, body: {} },
];

interface Caller {
  name: string;
  session: RequestSession;
  // Sent as well, for a caller that brings something other than a session.
  headers?: JSONObject | undefined;
  refusal: typeof NotAuthenticatedException | typeof NotAuthorizedException;
  refusalMessage: string;
}

const REFUSED_CALLERS: Array<Caller> = [
  {
    name: "a request with no session",
    session: { kind: "none" },
    refusal: NotAuthenticatedException,
    refusalMessage: "Unauthorized: Access token is required.",
  },
  {
    name: "a request with a token that does not verify",
    session: { kind: "invalid", error: new Error("jwt malformed") },
    refusal: NotAuthenticatedException,
    refusalMessage: "Unauthorized: Invalid or expired access token.",
  },
  {
    name: "a blocked user",
    session: { kind: "blocked", session: session(false) },
    refusal: NotAuthenticatedException,
    refusalMessage: "blocked",
  },
  {
    name: "a blocked master admin, whose token still says master admin",
    session: { kind: "blocked", session: session(true) },
    refusal: NotAuthenticatedException,
    refusalMessage: "blocked",
  },
  {
    name: "a signed-in member of a project",
    session: { kind: "user", session: session(false) },
    refusal: NotAuthorizedException,
    refusalMessage: "Only master admins can perform this action.",
  },
  {
    /*
     * readRequestSession reads the user's row: once another master admin has
     * removed the access, the session it answers says so, whatever the
     * token signed up to 15 minutes ago still claims.
     */
    name: "somebody whose master admin access was removed",
    session: { kind: "user", session: session(false) },
    refusal: NotAuthorizedException,
    refusalMessage: "Only master admins can perform this action.",
  },
  {
    /*
     * The master API key opens read-only master-admin routes. A leaked static
     * key must not be able to swap the license headlessly.
     */
    name: "the master API key, with no session",
    session: { kind: "none" },
    headers: { apikey: ObjectID.generate().toString() },
    refusal: NotAuthenticatedException,
    refusalMessage: "Unauthorized: Access token is required.",
  },
];

// One function on a route, as express calls it.
type RouteStep = (
  request: Record<string, unknown>,
  response: Record<string, unknown>,
  next: (error?: unknown) => void,
) => Promise<void> | void;

let router: ExpressRouter;
let readRequestSession: jest.SpyInstance;

type RunFunction = (
  write: Write,
  caller: Pick<Caller, "session" | "headers">,
) => Promise<void>;

// Goes through the route as a request does: each middleware, then the handler.
const run: RunFunction = async (
  write: Write,
  caller: Pick<Caller, "session" | "headers">,
): Promise<void> => {
  readRequestSession.mockResolvedValue(caller.session as never);

  const route: FoundRoute = findRoute(router, "post", write.route);
  const request: Record<string, unknown> = {
    headers: caller.headers || {},
    query: {},
    cookies: {},
    body: write.body,
  };
  const response: Record<string, unknown> = {};

  for (const middleware of route.middlewares) {
    let isPassed: boolean = false;

    await (middleware as unknown as RouteStep)(request, response, (): void => {
      isPassed = true;
    });

    if (!isPassed) {
      return;
    }
  }

  await (route.handler as unknown as RouteStep)(
    request,
    response,
    (error: unknown): void => {
      throw error;
    },
  );
};

const expectNothingReachedTheLicenseClient: () => void = (): void => {
  expect(LicenseClient.validateWithLicenseServer).not.toHaveBeenCalled();
  expect(LicenseClient.activateOffline).not.toHaveBeenCalled();
  expect(LicenseClient.refreshStoredLicense).not.toHaveBeenCalled();
  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
};

const lastRefusal: () => Exception = (): Exception => {
  const calls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as Exception;
};

beforeEach(() => {
  jest.clearAllMocks();
  router = createLicenseClientRouter();
  readRequestSession = jest.spyOn(UserMiddleware, "readRequestSession");
});

afterEach(() => {
  readRequestSession.mockRestore();
});

describe.each(WRITES)("$name", (write: Write) => {
  it.each(REFUSED_CALLERS)(
    "refuses $name, and nothing reaches the license client",
    async (caller: Caller) => {
      await run(write, caller);

      const refusal: Exception = lastRefusal();

      expect(refusal).toBeInstanceOf(caller.refusal);
      expect(refusal.message).toContain(caller.refusalMessage);
      expectNothingReachedTheLicenseClient();
    },
  );

  it("lets a master admin through (the control: the refusals above are the check's)", async () => {
    await run(write, { session: { kind: "user", session: session(true) } });

    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  it("answers a lookup that failed as a failure, never with the token's word", async () => {
    readRequestSession.mockRejectedValue(new Error("Postgres is down") as never);

    const route: FoundRoute = findRoute(router, "post", write.route);
    const next: jest.Mock = jest.fn();

    await (route.middlewares[0] as unknown as RouteStep)(
      { headers: {}, query: {}, cookies: {}, body: write.body },
      {},
      next as (error?: unknown) => void,
    );

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expectNothingReachedTheLicenseClient();
  });
});

describe("what a master admin's write reaches", () => {
  const masterAdmin: Pick<Caller, "session"> = {
    session: { kind: "user", session: session(true) },
  };

  it("sends a key to the license client as an activation", async () => {
    await run(WRITES[0] as Write, masterAdmin);

    expect(LicenseClient.validateWithLicenseServer).toHaveBeenCalledWith({
      licenseKey: "stolen-license-key",
      mode: "activate",
    });
    expect(LicenseClient.activateOffline).not.toHaveBeenCalled();
    expect(LicenseClient.refreshStoredLicense).not.toHaveBeenCalled();
  });

  it("sends a token to the license client, offline", async () => {
    await run(WRITES[1] as Write, masterAdmin);

    expect(LicenseClient.activateOffline).toHaveBeenCalledWith(
      "forged.license.token",
    );
    expect(LicenseClient.validateWithLicenseServer).not.toHaveBeenCalled();
    expect(LicenseClient.refreshStoredLicense).not.toHaveBeenCalled();
  });

  it("refreshes the stored license", async () => {
    await run(WRITES[2] as Write, masterAdmin);

    expect(LicenseClient.refreshStoredLicense).toHaveBeenCalledTimes(1);
    expect(LicenseClient.validateWithLicenseServer).not.toHaveBeenCalled();
    expect(LicenseClient.activateOffline).not.toHaveBeenCalled();
  });
});
