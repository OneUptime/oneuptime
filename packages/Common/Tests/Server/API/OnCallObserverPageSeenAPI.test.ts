import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  ON_CALL_OBSERVER_PAGE_SEEN_ROUTE,
  OnCallObserverOpenPage,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { OnCallPageRecordType } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  httpRequest,
  ProbeResponse,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

// jsdom has no setImmediate, and Express needs it to hand an error on.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * GET and POST /on-call-page/seen/<record type>/<record id>: the person paged
 * as an observer (OnCallObserverPage) asks whether they have a page about
 * the record they can still say they have seen, and says so - from the
 * record's screen in the mobile app, which the action under their push
 * opens. Driven over HTTP through the real router and the production error
 * handler, with who the caller is from the fake session middleware and the
 * work itself stubbed (OnCallObserverPageSeen has its own suite). What is
 * pinned is what the routes check before anything is read, and that they
 * only ever answer the caller's own pages, in the project they are signed in
 * to.
 */

type Arguments = {
  userId: ObjectID;
  projectId: ObjectID;
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
};

type GetOpenPages = (data: Arguments) => Promise<Array<OnCallObserverOpenPage>>;
type MarkSeen = (data: Arguments) => Promise<number>;

const mockGetOpenPages: Mock<GetOpenPages> = jest.fn<GetOpenPages>();
const mockMarkSeen: Mock<MarkSeen> = jest.fn<MarkSeen>();

jest.mock("../../../Server/Utils/OnCall/OnCallObserverPageSeen", () => {
  return {
    __esModule: true,
    default: {
      getOpenPagesForRecord: (...args: Parameters<GetOpenPages>) => {
        return mockGetOpenPages(...args);
      },
      markPagesSeenForRecord: (...args: Parameters<MarkSeen>) => {
        return mockMarkSeen(...args);
      },
    },
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
      requireUserAuthentication: (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): void => {
        const userType: unknown = (req as any).userType;

        if (!userType || userType === UserType.Public) {
          res.status(401).json({ message: "Authentication required." });
          return;
        }

        next();
      },
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
    },
  };
});

const INCIDENT_ID: string = "0fc00000-0000-4000-8000-000000000002";
const RUN_ID: string = "0fc00000-0000-4000-8000-000000000003";

describe("the seen routes of an observer's page", () => {
  let server: http.Server;
  let port: number;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const router: any = (
      await import("../../../Server/API/OnCallPagePassOnAPI")
    ).default;
    const { expressErrorHandler } = await import(
      "../../../Server/Utils/StartServer"
    );

    const app: express.Express = express();
    app.use(express.json());
    app.use("/api", router);
    app.use(expressErrorHandler as any);

    server = http.createServer(app);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  }, 600000);

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    mockGetOpenPages.mockReset();
    mockMarkSeen.mockReset();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
  });

  const signedIn: () => Record<string, string> = (): Record<string, string> => {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
      tenantid: projectId.toString(),
    };
  };

  const request: (data: {
    method: "GET" | "POST";
    path: string;
    headers?: Record<string, string>;
  }) => Promise<ProbeResponse> = (data: {
    method: "GET" | "POST";
    path: string;
    headers?: Record<string, string>;
  }): Promise<ProbeResponse> => {
    return httpRequest({
      port,
      method: data.method,
      path: `/api${ON_CALL_OBSERVER_PAGE_SEEN_ROUTE}${data.path}`,
      headers: data.headers || signedIn(),
      ...(data.method === "POST" ? { body: {} } : {}),
      timeoutMs: 20000,
    });
  };

  function expectAskedAboutTheCaller(asked: Arguments): void {
    expect(asked.userId.toString()).toBe(userId.toString());
    expect(asked.projectId.toString()).toBe(projectId.toString());
  }

  test("is at /on-call-page/seen, beside escalating and acknowledging again", () => {
    expect(ON_CALL_OBSERVER_PAGE_SEEN_ROUTE).toBe("/on-call-page/seen");
  });

  test("GET answers the caller's own observer pages about the record", async () => {
    mockGetOpenPages.mockResolvedValue([
      { executionLogId: RUN_ID, policyName: "Oversight" },
    ]);

    const response: ProbeResponse = await request({
      method: "GET",
      path: `/incident/${INCIDENT_ID}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      pages: [{ executionLogId: RUN_ID, policyName: "Oversight" }],
    });

    const asked: Arguments = mockGetOpenPages.mock.calls[0]![0];

    expectAskedAboutTheCaller(asked);
    expect(asked.recordType).toBe(OnCallPageRecordType.Incident);
    expect(asked.recordId.toString()).toBe(INCIDENT_ID);
    // Asking never answers anything.
    expect(mockMarkSeen).not.toHaveBeenCalled();
  });

  test("POST says the caller has seen them, and how many", async () => {
    mockMarkSeen.mockResolvedValue(1);

    const response: ProbeResponse = await request({
      method: "POST",
      path: `/incident/${INCIDENT_ID}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ seen: 1 });

    const asked: Arguments = mockMarkSeen.mock.calls[0]![0];

    expectAskedAboutTheCaller(asked);
    expect(asked.recordType).toBe(OnCallPageRecordType.Incident);
    expect(asked.recordId.toString()).toBe(INCIDENT_ID);
  });

  test("none to answer is an answer too, not an error", async () => {
    mockGetOpenPages.mockResolvedValue([]);
    mockMarkSeen.mockResolvedValue(0);

    const asking: ProbeResponse = await request({
      method: "GET",
      path: `/alert/${INCIDENT_ID}`,
    });
    const answering: ProbeResponse = await request({
      method: "POST",
      path: `/alert/${INCIDENT_ID}`,
    });

    expect(asking.status).toBe(200);
    expect(asking.body).toEqual({ pages: [] });
    expect(answering.status).toBe(200);
    expect(answering.body).toEqual({ seen: 0 });
  });

  test.each(Object.values(OnCallPageRecordType))(
    "serves the %s pages",
    async (recordType: OnCallPageRecordType) => {
      mockGetOpenPages.mockResolvedValue([]);
      mockMarkSeen.mockResolvedValue(0);

      for (const method of ["GET", "POST"] as const) {
        const response: ProbeResponse = await request({
          method,
          path: `/${recordType}/${INCIDENT_ID}`,
        });

        expect(response.status).toBe(200);
      }

      expect(mockGetOpenPages.mock.calls[0]![0].recordType).toBe(recordType);
      expect(mockMarkSeen.mock.calls[0]![0].recordType).toBe(recordType);
    },
  );

  test.each(["GET", "POST"] as const)(
    "%s refuses somebody who is not signed in, before anything is read",
    async (method: "GET" | "POST") => {
      const response: ProbeResponse = await request({
        method,
        path: `/incident/${INCIDENT_ID}`,
        headers: { tenantid: projectId.toString() },
      });

      expect(response.status).toBe(401);
      expect(mockGetOpenPages).not.toHaveBeenCalled();
      expect(mockMarkSeen).not.toHaveBeenCalled();
    },
  );

  test.each(["GET", "POST"] as const)(
    "%s refuses a record type it does not know, or an id that is not one, before anything is read",
    async (method: "GET" | "POST") => {
      for (const path of [`/monitor/${INCIDENT_ID}`, "/incident/not-an-id"]) {
        const response: ProbeResponse = await request({ method, path });

        expect(response.status).toBe(400);
      }

      expect(mockGetOpenPages).not.toHaveBeenCalled();
      expect(mockMarkSeen).not.toHaveBeenCalled();
    },
  );

  test.each(["GET", "POST"] as const)(
    "%s refuses a caller signed in to no project",
    async (method: "GET" | "POST") => {
      const response: ProbeResponse = await request({
        method,
        path: `/incident/${INCIDENT_ID}`,
        headers: {
          [TEST_USER_HEADER]: userId.toString(),
          [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
        },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mockGetOpenPages).not.toHaveBeenCalled();
      expect(mockMarkSeen).not.toHaveBeenCalled();
    },
  );

  test("a failure is the server's, said as an error - never 'seen'", async () => {
    mockMarkSeen.mockRejectedValue(new Error("database is down"));

    const response: ProbeResponse = await request({
      method: "POST",
      path: `/incident/${INCIDENT_ID}`,
    });

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
