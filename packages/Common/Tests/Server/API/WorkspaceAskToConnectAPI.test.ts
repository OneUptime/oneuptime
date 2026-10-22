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
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  WorkspaceAskToConnectState,
  WorkspaceAskToConnectStatus,
} from "../../../Types/Workspace/WorkspaceAskToConnect";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  httpRequest,
  ProbeResponse,
  TEST_API_KEY_HEADER,
  TEST_MASTER_ADMIN_HEADER,
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
 * GET and POST /workspace-ask-to-connect/<workspace type>: the "Ask everyone
 * to connect" card of a project's Slack and Microsoft Teams settings. Driven
 * over HTTP through the real router and the production error handler; who
 * the caller is comes from the fake session middleware, and the work itself
 * from a stubbed WorkspaceAskToConnect (WorkspaceAskToConnect.test.ts has
 * it). What is pinned here is who may ask, and what the route hands on.
 */

type GetStatus = (data: {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
}) => Promise<WorkspaceAskToConnectStatus>;

type Start = (data: {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  askedByUserId: ObjectID;
}) => Promise<WorkspaceAskToConnectStatus>;

const mockGetStatus: Mock<GetStatus> = jest.fn<GetStatus>();
const mockStart: Mock<Start> = jest.fn<Start>();

jest.mock("../../../Server/Utils/Workspace/WorkspaceAskToConnect", () => {
  const actual: any = jest.requireActual(
    "../../../Server/Utils/Workspace/WorkspaceAskToConnect",
  );

  return {
    __esModule: true,
    WORKSPACE_ASK_TO_CONNECT_PERMISSIONS:
      actual.WORKSPACE_ASK_TO_CONNECT_PERMISSIONS,
    WORKSPACE_ASK_TO_CONNECT_PERMISSION_MESSAGE:
      actual.WORKSPACE_ASK_TO_CONNECT_PERMISSION_MESSAGE,
    default: {
      getStatus: (...args: Parameters<GetStatus>) => {
        return mockGetStatus(...args);
      },
      start: (...args: Parameters<Start>) => {
        return mockStart(...args);
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

const STATUS: WorkspaceAskToConnectStatus = {
  memberCount: 1000,
  connectedCount: 312,
  run: {
    state: WorkspaceAskToConnectState.Asking,
    startedAt: "2026-10-22T10:00:00.000Z",
    askedByName: "Jane Admin",
    toAskCount: 688,
    askedCount: 0,
    notFoundCount: 0,
    failedCount: 0,
    notFoundNames: [],
  },
};

describe("the ask-to-connect routes", () => {
  let server: http.Server;
  let port: number;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const router: any = (
      await import("../../../Server/API/WorkspaceAskToConnectAPI")
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
    mockGetStatus.mockReset();
    mockStart.mockReset();
    mockGetStatus.mockResolvedValue(STATUS);
    mockStart.mockResolvedValue(STATUS);
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
  });

  const signedInAs: (permission: Permission) => Record<string, string> = (
    permission: Permission,
  ): Record<string, string> => {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      [TEST_PERMISSIONS_HEADER]: permission,
      tenantid: projectId.toString(),
    };
  };

  const call: (data: {
    method: "GET" | "POST";
    workspace: string;
    headers?: Record<string, string>;
  }) => Promise<ProbeResponse> = (data: {
    method: "GET" | "POST";
    workspace: string;
    headers?: Record<string, string>;
  }): Promise<ProbeResponse> => {
    return httpRequest({
      port,
      method: data.method,
      path: `/api/workspace-ask-to-connect/${data.workspace}`,
      headers: data.headers || signedInAs(Permission.ProjectOwner),
      body: data.method === "POST" ? {} : undefined,
      timeoutMs: 20000,
    });
  };

  test.each([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams])(
    "GET answers how many of the project's members connected %s, and the last run",
    async (workspaceType: WorkspaceType) => {
      const response: ProbeResponse = await call({
        method: "GET",
        workspace: workspaceType,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        memberCount: 1000,
        connectedCount: 312,
        run: {
          state: "asking",
          startedAt: "2026-10-22T10:00:00.000Z",
          finishedAt: null,
          askedByName: "Jane Admin",
          toAskCount: 688,
          askedCount: 0,
          notFoundCount: 0,
          failedCount: 0,
          notFoundNames: [],
        },
      });

      const asked: { projectId: ObjectID; workspaceType: WorkspaceType } =
        mockGetStatus.mock.calls[0]![0];

      expect(asked.projectId.toString()).toBe(projectId.toString());
      expect(asked.workspaceType).toBe(workspaceType);
    },
  );

  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "POST by a %s starts asking, as the person who asked",
    async (permission: Permission) => {
      const response: ProbeResponse = await call({
        method: "POST",
        workspace: WorkspaceType.Slack,
        headers: signedInAs(permission),
      });

      expect(response.status).toBe(200);
      expect(mockStart).toHaveBeenCalledTimes(1);

      const asked: {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        askedByUserId: ObjectID;
      } = mockStart.mock.calls[0]![0];

      expect(asked.projectId.toString()).toBe(projectId.toString());
      expect(asked.workspaceType).toBe(WorkspaceType.Slack);
      expect(asked.askedByUserId.toString()).toBe(userId.toString());
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.ProjectUser,
    Permission.SettingsAdmin,
  ])(
    "a %s may neither read nor ask: a message to every member is an owner's or an admin's",
    async (permission: Permission) => {
      for (const method of ["GET", "POST"] as Array<"GET" | "POST">) {
        const response: ProbeResponse = await call({
          method: method,
          workspace: WorkspaceType.Slack,
          headers: signedInAs(permission),
        });

        expect(response.status).toBe(422);
        expect(JSON.stringify(response.body)).toContain(
          "Only a project owner or admin can ask the project's members to connect their accounts.",
        );
      }

      expect(mockGetStatus).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    },
  );

  test("a master admin may ask", async () => {
    const response: ProbeResponse = await call({
      method: "POST",
      workspace: WorkspaceType.MicrosoftTeams,
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
        [TEST_MASTER_ADMIN_HEADER]: "1",
        tenantid: projectId.toString(),
      },
    });

    expect(response.status).toBe(200);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  test("an API key cannot ask, even an owner's: the messages say who asked, and a key is nobody", async () => {
    const response: ProbeResponse = await call({
      method: "POST",
      workspace: WorkspaceType.Slack,
      headers: {
        [TEST_API_KEY_HEADER]: "1",
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectOwner,
        tenantid: projectId.toString(),
      },
    });

    expect(response.status).toBe(422);
    expect(mockStart).not.toHaveBeenCalled();
  });

  test("nobody signed in is refused", async () => {
    const response: ProbeResponse = await call({
      method: "GET",
      workspace: WorkspaceType.Slack,
      headers: { tenantid: projectId.toString() },
    });

    expect(response.status).toBe(401);
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  test.each<[string]>([["slack"], ["Discord"], ["__proto__"], ["Telegram"]])(
    "an unknown workspace (%s) is refused before anything is read",
    async (workspace: string) => {
      const response: ProbeResponse = await call({
        method: "POST",
        workspace: workspace,
      });

      expect(response.status).toBe(400);
      expect(mockStart).not.toHaveBeenCalled();
    },
  );

  test("asking while a run is asking says so", async () => {
    mockStart.mockRejectedValue(
      new BadDataException(
        "OneUptime is already asking this project's members to connect their accounts. Wait for it to finish.",
      ),
    );

    const response: ProbeResponse = await call({
      method: "POST",
      workspace: WorkspaceType.Slack,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain(
      "already asking this project's members",
    );
  });
});
