import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelRecordType } from "../../../Types/Workspace/WorkspaceChannelLink";
import { JSONObject } from "../../../Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  httpGet,
  ProbeResponse,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
  TEST_API_KEY_HEADER,
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
 * GET /workspace-channel-link/<record type>/<record id>: what the Open in
 * Slack / Open in Microsoft Teams buttons open. Driven over HTTP through the
 * real router and the production error handler; who the caller is comes
 * from the fake session middleware, and the links themselves from a stubbed
 * WorkspaceChannelLinks (it has suites of its own).
 */

const mockGetLinks: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/Workspace/WorkspaceChannelLinks", () => {
  return {
    __esModule: true,
    default: {
      getLinks: (...args: Array<unknown>) => {
        return mockGetLinks(...args);
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
      // As the real one: nobody signed in is refused before the route runs.
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

const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";

describe("GET /workspace-channel-link/:recordType/:recordId", () => {
  let server: http.Server;
  let port: number;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const router: any = (
      await import("../../../Server/API/WorkspaceChannelLinkAPI")
    ).default;
    const { expressErrorHandler } = await import(
      "../../../Server/Utils/StartServer"
    );

    const app: express.Express = express();
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
    mockGetLinks.mockReset();
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

  const get: (
    path: string,
    headers?: Record<string, string>,
  ) => Promise<ProbeResponse> = (
    path: string,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> => {
    return httpGet({
      port,
      path: `/api/workspace-channel-link${path}`,
      headers: headers || signedIn(),
      timeoutMs: 20000,
    });
  };

  test("answers the record's links, read with the caller's own permissions", async () => {
    mockGetLinks.mockImplementation(async () => {
      return [
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "incident-42",
          url: "https://slack.com/app_redirect?channel=C1&team=T1",
        },
      ];
    });

    const response: ProbeResponse = await get(`/incident/${INCIDENT_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      links: [
        {
          workspaceType: "Slack",
          channelName: "incident-42",
          url: "https://slack.com/app_redirect?channel=C1&team=T1",
        },
      ],
    });

    expect(mockGetLinks).toHaveBeenCalledTimes(1);
    const call: {
      recordType: WorkspaceChannelRecordType;
      recordId: ObjectID;
      props: JSONObject;
    } = mockGetLinks.mock.calls[0]![0] as any;

    expect(call.recordType).toBe(WorkspaceChannelRecordType.Incident);
    expect(call.recordId.toString()).toBe(INCIDENT_ID);
    // The caller's own props: their user, their project, not root.
    expect(String(call.props["userId"])).toBe(userId.toString());
    expect(String(call.props["tenantId"])).toBe(projectId.toString());
    expect(call.props["isRoot"]).toBeUndefined();
  });

  test.each(Object.values(WorkspaceChannelRecordType))(
    "serves the %s pages",
    async (recordType: WorkspaceChannelRecordType) => {
      mockGetLinks.mockImplementation(async () => {
        return [];
      });

      const response: ProbeResponse = await get(
        `/${recordType}/${INCIDENT_ID}`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ links: [] });
      expect(
        (mockGetLinks.mock.calls[0]![0] as { recordType: string }).recordType,
      ).toBe(recordType);
    },
  );

  test("a record without a channel answers an empty list, not an error", async () => {
    mockGetLinks.mockImplementation(async () => {
      return [];
    });

    const response: ProbeResponse = await get(`/alert/${INCIDENT_ID}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ links: [] });
  });

  test("a record the caller cannot see is not found", async () => {
    mockGetLinks.mockImplementation(async () => {
      throw new NotFoundException("This record was not found.");
    });

    const response: ProbeResponse = await get(`/incident/${INCIDENT_ID}`);

    expect(response.status).toBe(404);
  });

  test.each<[string]>([["monitor"], ["users"], ["__proto__"], ["INCIDENT"]])(
    "an unknown record type (%s) is refused before anything is read",
    async (recordType: string) => {
      const response: ProbeResponse = await get(
        `/${recordType}/${INCIDENT_ID}`,
      );

      expect(response.status).toBe(400);
      expect(mockGetLinks).not.toHaveBeenCalled();
    },
  );

  test("an id that is not an id is refused before anything is read", async () => {
    const response: ProbeResponse = await get(`/incident/not-an-id`);

    expect(response.status).toBe(400);
    expect(mockGetLinks).not.toHaveBeenCalled();
  });

  test("nobody signed in is refused", async () => {
    const response: ProbeResponse = await get(`/incident/${INCIDENT_ID}`, {
      tenantid: projectId.toString(),
    });

    expect(response.status).toBe(401);
    expect(mockGetLinks).not.toHaveBeenCalled();
  });

  test("a request for no project is refused", async () => {
    const response: ProbeResponse = await get(`/incident/${INCIDENT_ID}`, {
      [TEST_USER_HEADER]: userId.toString(),
    });

    expect(response.status).toBe(400);
    expect(mockGetLinks).not.toHaveBeenCalled();
  });

  test("a project API key reads with the key's own permissions, never as root", async () => {
    mockGetLinks.mockImplementation(async () => {
      return [];
    });

    const response: ProbeResponse = await get(`/incident/${INCIDENT_ID}`, {
      [TEST_API_KEY_HEADER]: "1",
      [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
      tenantid: projectId.toString(),
    });

    expect(response.status).toBe(200);

    const props: JSONObject = (
      mockGetLinks.mock.calls[0]![0] as { props: JSONObject }
    ).props;

    expect(props["userType"]).toBe(UserType.API);
    expect(props["userId"]).toBeUndefined();
    expect(String(props["tenantId"])).toBe(projectId.toString());
    expect(props["isRoot"]).toBeUndefined();
  });

  test("the answer is never cached: a channel can be created a moment later", async () => {
    mockGetLinks.mockImplementation(async () => {
      return [];
    });

    const response: http.IncomingMessage =
      await new Promise<http.IncomingMessage>(
        (
          resolve: (response: http.IncomingMessage) => void,
          reject: (error: Error) => void,
        ) => {
          const request: http.ClientRequest = http.request(
            {
              host: "127.0.0.1",
              port: port,
              path: `/api/workspace-channel-link/incident/${INCIDENT_ID}`,
              method: "GET",
              headers: signedIn(),
            },
            (incoming: http.IncomingMessage) => {
              incoming.resume();
              incoming.on("end", () => {
                resolve(incoming);
              });
            },
          );
          request.on("error", reject);
          request.end();
        },
      );

    expect(response.statusCode).toBe(200);
    expect(String(response.headers["cache-control"])).toContain("no-store");
    expect(String(response.headers["pragma"])).toBe("no-cache");
  });
});
