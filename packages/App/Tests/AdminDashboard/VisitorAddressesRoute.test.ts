import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, Server } from "http";
import type { MockedFunction } from "jest-mock";
import { AddressInfo } from "net";

/*
 * GET /api/admin/health/visitor-addresses: where people sign in from, for the
 * Health page's card that says when OneUptime sees several people at one
 * private network address (VisitorAddressesSummary).
 *
 * Real HTTP through the real AdminHealth router and the real master-admin
 * middleware, with the session it reads (UserMiddleware.readRequestSession)
 * and the report (getSharedVisitorAddresses) stood in for:
 *
 *   - only a master admin's own session reaches it: no session, a token
 *     that is not one, a blocked user, a user who is not a master admin
 *     and the instance's master API key are all refused, and nothing is
 *     read for them;
 *   - a master admin gets the report as it was made - the addresses, how
 *     many people each, the window and the hop count - and nothing more;
 *   - a report that fails is an error, never an answer that all is well.
 */

jest.mock("Common/Server/Utils/InstanceHealth/SharedVisitorAddresses", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "Common/Server/Utils/InstanceHealth/SharedVisitorAddresses",
    ) as Record<string, unknown>),
    getSharedVisitorAddresses: jest.fn(),
  };
});

import AdminHealthRouter from "../../API/AdminHealth";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  getSharedVisitorAddresses,
  SharedVisitorAddressesReport,
} from "Common/Server/Utils/InstanceHealth/SharedVisitorAddresses";
import logger from "Common/Server/Utils/Logger";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

interface HttpResult {
  status: number;
  body: JSONObject;
}

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

const REPORT: SharedVisitorAddressesReport = {
  checked: true,
  windowDays: 30,
  minimumPeople: 2,
  trustedProxyHops: 1,
  addressCount: 3,
  addresses: [
    {
      address: "172.18.0.1",
      people: 6,
      lastSeenAt: "2026-10-19T08:00:00.000Z",
    },
    {
      address: "10.244.1.1",
      people: 2,
      lastSeenAt: "2026-10-18T08:00:00.000Z",
    },
  ],
};

const reportFunction: MockedFunction<typeof getSharedVisitorAddresses> =
  jest.mocked(getSharedVisitorAddresses);

let httpServer: Server;
let baseUrl: string = "";

const session: (data: {
  isMasterAdmin: boolean;
  kind?: "user" | "blocked";
}) => RequestSession = (data: {
  isMasterAdmin: boolean;
  kind?: "user" | "blocked";
}): RequestSession => {
  return {
    kind: data.kind || "user",
    session: {
      userId: ObjectID.generate(),
      email: "admin@example.com",
      name: "Admin",
      isMasterAdmin: data.isMasterAdmin,
    },
  } as unknown as RequestSession;
};

const signInAs: (requestSession: RequestSession) => void = (
  requestSession: RequestSession,
): void => {
  jest
    .spyOn(UserMiddleware, "readRequestSession")
    .mockResolvedValue(requestSession);
};

const get: (headers?: Record<string, string>) => Promise<HttpResult> = async (
  headers: Record<string, string> = {},
): Promise<HttpResult> => {
  const response: globalThis.Response = await fetch(
    `${baseUrl}/api/admin/health/visitor-addresses`,
    { method: "GET", headers },
  );

  return {
    status: response.status,
    body: (await response.json()) as JSONObject,
  };
};

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/api/admin/health", AdminHealthRouter);
  app.use(
    (
      error: Exception,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      const status: number =
        typeof error.code === "number" && error.code >= 400 && error.code < 600
          ? error.code
          : 500;
      res.status(status).json({ message: error.message });
    },
  );

  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    httpServer.close((): void => {
      resolve();
    });
  });
});

beforeEach(() => {
  reportFunction.mockReset();
  reportFunction.mockResolvedValue(REPORT);

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may read where people sign in from", () => {
  test("the route takes a master admin's session only, never the master API key", () => {
    const layers: Array<RouteLayer> = (
      AdminHealthRouter as unknown as { stack: Array<RouteLayer> }
    ).stack.filter((layer: RouteLayer): boolean => {
      return layer.route?.path === "/visitor-addresses";
    });

    expect(layers).toHaveLength(1);
    expect(layers[0]?.route?.methods).toEqual({ get: true });
    expect(layers[0]?.route?.stack).toHaveLength(2);
    expect(layers[0]?.route?.stack[0]?.handle).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
    expect(layers[0]?.route?.stack[0]?.handle).not.toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    );
  });

  test("without a session: 401, and nothing is read", async () => {
    signInAs({ kind: "none" });

    const result: HttpResult = await get();

    expect(result.status).toBe(401);
    expect(result.body["message"]).toBe(
      "Unauthorized: Access token is required.",
    );
    expect(reportFunction).not.toHaveBeenCalled();
  });

  test("with a token that is not a session: 401, and nothing is read", async () => {
    signInAs({ kind: "invalid", error: new Error("bad token") });

    const result: HttpResult = await get({ authorization: "Bearer nope" });

    expect(result.status).toBe(401);
    expect(reportFunction).not.toHaveBeenCalled();
  });

  test("a blocked master admin: 401, and nothing is read", async () => {
    signInAs(session({ isMasterAdmin: true, kind: "blocked" }));

    const result: HttpResult = await get();

    expect(result.status).toBe(401);
    expect(reportFunction).not.toHaveBeenCalled();
  });

  test("a user who is not a master admin: refused, and nothing is read", async () => {
    signInAs(session({ isMasterAdmin: false }));

    const result: HttpResult = await get();

    expect(result.status).toBe(422);
    expect(result.body["message"]).toBe(
      "Unauthorized: Only master admins can perform this action.",
    );
    expect(reportFunction).not.toHaveBeenCalled();
  });

  test("the master API key alone is not a session: 401, and nothing is read", async () => {
    signInAs({ kind: "none" });

    const result: HttpResult = await get({
      apikey: ObjectID.generate().toString(),
    });

    expect(result.status).toBe(401);
    expect(reportFunction).not.toHaveBeenCalled();
  });
});

describe("what a master admin reads", () => {
  test("the report as it was made, and nothing more", async () => {
    signInAs(session({ isMasterAdmin: true }));

    const result: HttpResult = await get();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      checked: true,
      windowDays: 30,
      minimumPeople: 2,
      trustedProxyHops: 1,
      addressCount: 3,
      addresses: [
        {
          address: "172.18.0.1",
          people: 6,
          lastSeenAt: "2026-10-19T08:00:00.000Z",
        },
        {
          address: "10.244.1.1",
          people: 2,
          lastSeenAt: "2026-10-18T08:00:00.000Z",
        },
      ],
    });
    expect(reportFunction).toHaveBeenCalledTimes(1);
  });

  test("a report that could not be made says so: checked is false, nothing listed", async () => {
    signInAs(session({ isMasterAdmin: true }));
    reportFunction.mockResolvedValue({
      ...REPORT,
      checked: false,
      addressCount: 0,
      addresses: [],
    });

    const result: HttpResult = await get();

    expect(result.status).toBe(200);
    expect(result.body["checked"]).toBe(false);
    expect(result.body["addresses"]).toEqual([]);
  });

  test("a report that fails is an error, never an answer that all is well", async () => {
    signInAs(session({ isMasterAdmin: true }));
    reportFunction.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    const result: HttpResult = await get();

    expect(result.status).toBe(500);
    expect(result.body["addresses"]).toBeUndefined();
  });
});
