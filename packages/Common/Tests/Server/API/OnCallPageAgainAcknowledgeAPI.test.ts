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
import { ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE } from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
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
 * POST /on-call-page/acknowledge/<record type>/<record id>: the person being
 * paged again (OnCallAcknowledgementTimeout) acknowledges their page from
 * the record's page in the Dashboard - its record was acknowledged all
 * along, so the record's own Acknowledge is not offered. Driven over HTTP
 * through the real router and the production error handler, with who the
 * caller is from the fake session middleware and the work itself stubbed
 * (the acknowledgement timeout has its own suites). What is pinned is what
 * the route checks before anything is read, and that it only ever answers
 * the caller's own pages, in the project they are signed in to.
 */

type Arguments = {
  userId: ObjectID;
  projectId: ObjectID;
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
};

type Acknowledge = (data: Arguments) => Promise<number>;

const mockAcknowledge: Mock<Acknowledge> = jest.fn<Acknowledge>();

jest.mock("../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout", () => {
  return {
    __esModule: true,
    default: {
      acknowledgePagesAgainForRecord: (...args: Parameters<Acknowledge>) => {
        return mockAcknowledge(...args);
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

const INCIDENT_ID: string = "0fc00000-0000-4000-8000-000000000001";

describe("the acknowledge route of a page again", () => {
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
    mockAcknowledge.mockReset();
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

  const post: (data: {
    path: string;
    headers?: Record<string, string>;
  }) => Promise<ProbeResponse> = (data: {
    path: string;
    headers?: Record<string, string>;
  }): Promise<ProbeResponse> => {
    return httpRequest({
      port,
      method: "POST",
      path: `/api${ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE}${data.path}`,
      headers: data.headers || signedIn(),
      body: {},
      timeoutMs: 20000,
    });
  };

  test("is at /on-call-page/acknowledge, beside escalating", () => {
    expect(ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE).toBe(
      "/on-call-page/acknowledge",
    );
  });

  test("acknowledges the caller's own pages again about the record, and says how many", async () => {
    mockAcknowledge.mockResolvedValue(1);

    const response: ProbeResponse = await post({
      path: `/incident/${INCIDENT_ID}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ acknowledged: 1 });

    const asked: Arguments = mockAcknowledge.mock.calls[0]![0];

    expect(asked.userId.toString()).toBe(userId.toString());
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.recordType).toBe(OnCallPageRecordType.Incident);
    expect(asked.recordId.toString()).toBe(INCIDENT_ID);
  });

  test("none to acknowledge is an answer too, not an error", async () => {
    mockAcknowledge.mockResolvedValue(0);

    const response: ProbeResponse = await post({
      path: `/alert/${INCIDENT_ID}`,
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ acknowledged: 0 });
  });

  test.each(Object.values(OnCallPageRecordType))(
    "serves the %s pages",
    async (recordType: OnCallPageRecordType) => {
      mockAcknowledge.mockResolvedValue(0);

      const response: ProbeResponse = await post({
        path: `/${recordType}/${INCIDENT_ID}`,
      });

      expect(response.status).toBe(200);
      expect(mockAcknowledge.mock.calls[0]![0].recordType).toBe(recordType);
    },
  );

  test("refuses somebody who is not signed in, before anything is read", async () => {
    const response: ProbeResponse = await post({
      path: `/incident/${INCIDENT_ID}`,
      headers: { tenantid: projectId.toString() },
    });

    expect(response.status).toBe(401);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  test("refuses a record type it does not know, before anything is read", async () => {
    const response: ProbeResponse = await post({
      path: `/monitor/${INCIDENT_ID}`,
    });

    expect(response.status).toBe(400);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  test("refuses an id that is not one, before anything is read", async () => {
    const response: ProbeResponse = await post({ path: "/incident/not-an-id" });

    expect(response.status).toBe(400);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  test("refuses a caller signed in to no project", async () => {
    const response: ProbeResponse = await post({
      path: `/incident/${INCIDENT_ID}`,
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
      },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });

  test("a failure is the server's, said as an error", async () => {
    mockAcknowledge.mockRejectedValue(new Error("database is down"));

    const response: ProbeResponse = await post({
      path: `/incident/${INCIDENT_ID}`,
    });

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
