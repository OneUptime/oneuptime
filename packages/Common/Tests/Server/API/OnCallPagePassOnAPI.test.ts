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
  OnCallOpenPage,
  OnCallPageRecordType,
  OnCallPassOnAnswer,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  httpRequest,
  ProbeResponse,
  TEST_API_KEY_HEADER,
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
 * GET and POST /on-call-page/pass-on/<record type>/<record id>: "Can't take
 * it? Pass it on" from a record's page in the Dashboard and from the mobile
 * app. Driven over HTTP through the real router and the production error
 * handler, with who the caller is from the fake session middleware and the
 * work itself stubbed (OnCallPagePassOn has its own suite). What is pinned is
 * what the route checks before anything is read, and that it only ever
 * passes on the caller's own pages, in the project they are signed in to.
 */

type Arguments = {
  userId: ObjectID;
  projectId: ObjectID;
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
};

type Read = (data: Arguments) => Promise<Array<OnCallOpenPage>>;
type PassOn = (data: Arguments) => Promise<Array<OnCallPassOnAnswer>>;

const mockRead: Mock<Read> = jest.fn<Read>();
const mockPassOn: Mock<PassOn> = jest.fn<PassOn>();

jest.mock("../../../Server/Utils/OnCall/OnCallPagePassOn", () => {
  return {
    __esModule: true,
    default: {
      getOpenPagesForRecord: (...args: Parameters<Read>) => {
        return mockRead(...args);
      },
      passOnForRecord: (...args: Parameters<PassOn>) => {
        return mockPassOn(...args);
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

const INCIDENT_ID: string = "0fb00000-0000-4000-8000-000000000001";
const RUN_ID: string = "0fb00000-0000-4000-8000-000000000002";

const PAGE: OnCallOpenPage = {
  executionLogId: RUN_ID,
  preview: {
    outcome: OnCallPassOnOutcome.OthersStillPaged,
    isPreview: true,
    isDirectPage: false,
    policyName: "Payments",
    pagedNames: [],
    stillPagedNames: ["Bob Smith"],
    nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
    nextRule: { order: 2, name: "Level 2" },
    ruleCount: 2,
  },
};

describe("the pass-on routes", () => {
  let server: http.Server;
  let port: number;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const router: any = (await import("../../../Server/API/OnCallPagePassOnAPI"))
      .default;
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
    mockRead.mockReset();
    mockPassOn.mockReset();
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

  const call: (data: {
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
      path: `/api/on-call-page/pass-on${data.path}`,
      headers: data.headers || signedIn(),
      body: data.method === "POST" ? {} : undefined,
      timeoutMs: 20000,
    });
  };

  describe("GET: the caller's own pages about the record", () => {
    test("answers what passing each on would do, as plain JSON", async () => {
      mockRead.mockResolvedValue([PAGE]);

      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        pages: [
          {
            executionLogId: RUN_ID,
            preview: {
              outcome: "OthersStillPaged",
              isPreview: true,
              isDirectPage: false,
              policyName: "Payments",
              pagedNames: [],
              stillPagedNames: ["Bob Smith"],
              nextStepAt: "2026-10-16T03:30:00.000Z",
              nextRule: { order: 2, name: "Level 2" },
              ruleCount: 2,
            },
          },
        ],
      });
    });

    test("asks only about the signed-in person, in the project they are signed in to", async () => {
      mockRead.mockResolvedValue([]);

      await call({ method: "GET", path: `/alert/${INCIDENT_ID}` });

      const asked: Arguments = mockRead.mock.calls[0]![0];

      expect(asked.userId.toString()).toBe(userId.toString());
      expect(asked.projectId.toString()).toBe(projectId.toString());
      expect(asked.recordType).toBe(OnCallPageRecordType.Alert);
      expect(asked.recordId.toString()).toBe(INCIDENT_ID);
    });

    test("answers no pages for somebody who is not being paged", async () => {
      mockRead.mockResolvedValue([]);

      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
      });

      expect(response.body).toEqual({ pages: [] });
    });

    test.each(Object.values(OnCallPageRecordType))(
      "serves the %s pages",
      async (recordType: OnCallPageRecordType) => {
        mockRead.mockResolvedValue([]);

        expect(
          (await call({ method: "GET", path: `/${recordType}/${INCIDENT_ID}` }))
            .status,
        ).toBe(200);
      },
    );
  });

  describe("POST: passes the caller's own pages about the record on", () => {
    test("and answers what came of each", async () => {
      mockPassOn.mockResolvedValue([
        {
          passedOn: true,
          result: {
            ...PAGE.preview,
            outcome: OnCallPassOnOutcome.NextRulePaged,
            isPreview: false,
            pagedNames: ["Carl Diaz"],
            rule: { order: 2, name: "Level 2" },
          },
        },
      ]);

      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}`,
      });

      expect(response.status).toBe(200);
      expect(
        (response.body as { answers: Array<{ passedOn: boolean }> })
          .answers[0]!.passedOn,
      ).toBe(true);

      const asked: Arguments = mockPassOn.mock.calls[0]![0];

      expect(asked.userId.toString()).toBe(userId.toString());
      expect(asked.projectId.toString()).toBe(projectId.toString());
    });

    test("answers why, when there was nothing to pass on", async () => {
      mockPassOn.mockResolvedValue([
        { passedOn: false, refusal: OnCallPassOnRefusal.NotPaged },
      ]);

      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}`,
      });

      expect(response.body).toEqual({
        answers: [{ passedOn: false, refusal: "NotPaged" }],
      });
    });
  });

  describe("what is refused before anything is read", () => {
    test.each<[string]>([
      ["monitor"],
      ["scheduled-maintenance"],
      ["INCIDENT"],
      ["__proto__"],
    ])("an unknown record type (%s)", async (recordType: string) => {
      for (const method of ["GET", "POST"] as const) {
        const response: ProbeResponse = await call({
          method: method,
          path: `/${recordType}/${INCIDENT_ID}`,
        });

        expect(response.status).toBe(400);
      }

      expect(mockRead).not.toHaveBeenCalled();
      expect(mockPassOn).not.toHaveBeenCalled();
    });

    test("an id that is not an id", async () => {
      expect(
        (await call({ method: "POST", path: "/incident/not-an-id" })).status,
      ).toBe(400);
      expect(mockPassOn).not.toHaveBeenCalled();
    });

    test("nobody signed in", async () => {
      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}`,
        headers: { tenantid: projectId.toString() },
      });

      expect(response.status).toBe(401);
      expect(mockPassOn).not.toHaveBeenCalled();
    });

    test("a project API key: a key is nobody's page to pass on", async () => {
      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}`,
        headers: {
          [TEST_API_KEY_HEADER]: "1",
          [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
          tenantid: projectId.toString(),
        },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mockPassOn).not.toHaveBeenCalled();
    });

    test("a project the caller is not a member of", async () => {
      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
        headers: {
          [TEST_USER_HEADER]: userId.toString(),
          tenantid: projectId.toString(),
        },
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(mockRead).not.toHaveBeenCalled();
    });
  });
});
