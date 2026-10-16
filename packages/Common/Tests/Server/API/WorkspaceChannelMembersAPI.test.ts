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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { WorkspaceChannelRecordType } from "../../../Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannels,
} from "../../../Types/Workspace/WorkspaceChannelMembers";
import { JSONObject } from "../../../Types/JSON";
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
 * GET /workspace-channel-members/<record type>/<record id> and POST .../add:
 * the record page's channel card. Driven over HTTP through the real router
 * and the production error handler; who the caller is comes from the fake
 * session middleware, and the work itself from a stubbed
 * WorkspaceChannelMembers (it has suites of its own: ChannelMembers/).
 * What is pinned here is what the route checks before anything is read, and
 * what it hands on.
 */

type Read = (data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  props: JSONObject;
}) => Promise<WorkspaceRecordChannels>;

type Add = (data: {
  recordType: WorkspaceChannelRecordType;
  recordId: ObjectID;
  props: JSONObject;
  channelId: string;
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
}) => Promise<WorkspaceChannelAddAnswer>;

const mockRead: Mock<Read> = jest.fn<Read>();
const mockAdd: Mock<Add> = jest.fn<Add>();

jest.mock("../../../Server/Utils/Workspace/WorkspaceChannelMembers", () => {
  return {
    __esModule: true,
    default: {
      read: (...args: Parameters<Read>) => {
        return mockRead(...args);
      },
      add: (...args: Parameters<Add>) => {
        return mockAdd(...args);
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

const INCIDENT_ID: string = "c6000000-0000-4000-8000-000000000001";
const BOB_ID: string = "c6000000-0000-4000-8000-000000000002";
const TEAM_ID: string = "c6000000-0000-4000-8000-000000000003";

const CHANNELS: WorkspaceRecordChannels = {
  canAddPeople: true,
  channels: [
    {
      channelId: "C0INC42",
      workspaceType: WorkspaceType.Slack,
      name: "inc-42",
      url: "https://slack.com/app_redirect?channel=C0INC42&team=T0ACME",
      isPrivate: true,
      state: WorkspaceChannelState.Members,
      people: [{ key: "U0BOB", name: "Bob Jones", userId: BOB_ID }],
      peopleCount: 1,
      viewer: WorkspaceChannelViewerStatus.NotIn,
    },
  ],
};

describe("the channel members routes", () => {
  let server: http.Server;
  let port: number;
  let projectId: ObjectID;
  let userId: ObjectID;

  beforeAll(async () => {
    const router: any = (
      await import("../../../Server/API/WorkspaceChannelMembersAPI")
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
    mockRead.mockReset();
    mockAdd.mockReset();
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
    body?: unknown;
  }) => Promise<ProbeResponse> = (data: {
    method: "GET" | "POST";
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }): Promise<ProbeResponse> => {
    return httpRequest({
      port,
      method: data.method,
      path: `/api/workspace-channel-members${data.path}`,
      headers: data.headers || signedIn(),
      body: data.body,
      timeoutMs: 20000,
    });
  };

  describe("GET: the record's channels and the people in them", () => {
    test("answers what WorkspaceChannelMembers read, with the caller's own props", async () => {
      mockRead.mockResolvedValue(CHANNELS);

      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        canAddPeople: true,
        channels: [
          {
            channelId: "C0INC42",
            workspaceType: "Slack",
            name: "inc-42",
            url: "https://slack.com/app_redirect?channel=C0INC42&team=T0ACME",
            isPrivate: true,
            state: "members",
            people: [{ key: "U0BOB", name: "Bob Jones", userId: BOB_ID }],
            peopleCount: 1,
            viewer: "not-in",
          },
        ],
      });

      const asked: { recordId: ObjectID; props: JSONObject } = mockRead.mock
        .calls[0]![0] as never;

      expect(asked.recordId.toString()).toBe(INCIDENT_ID);
      expect(String(asked.props["userId"])).toBe(userId.toString());
      expect(String(asked.props["tenantId"])).toBe(projectId.toString());
      expect(asked.props["isRoot"]).toBeUndefined();
    });

    test.each(Object.values(WorkspaceChannelRecordType))(
      "serves the %s pages",
      async (recordType: WorkspaceChannelRecordType) => {
        mockRead.mockResolvedValue({ channels: [], canAddPeople: false });

        const response: ProbeResponse = await call({
          method: "GET",
          path: `/${recordType}/${INCIDENT_ID}`,
        });

        expect(response.status).toBe(200);
        expect(
          (mockRead.mock.calls[0]![0] as { recordType: string }).recordType,
        ).toBe(recordType);
      },
    );

    test("a project API key reads with the key's own permissions, never as root", async () => {
      mockRead.mockResolvedValue({ channels: [], canAddPeople: false });

      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
        headers: {
          [TEST_API_KEY_HEADER]: "1",
          [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
          tenantid: projectId.toString(),
        },
      });

      expect(response.status).toBe(200);

      const props: JSONObject = (
        mockRead.mock.calls[0]![0] as { props: JSONObject }
      ).props;

      expect(props["userType"]).toBe(UserType.API);
      expect(props["userId"]).toBeUndefined();
      expect(props["isRoot"]).toBeUndefined();
    });

    test("a record the caller cannot see is not found", async () => {
      mockRead.mockRejectedValue(
        new NotFoundException("This record was not found."),
      );

      expect(
        (await call({ method: "GET", path: `/incident/${INCIDENT_ID}` }))
          .status,
      ).toBe(404);
    });

    test.each<[string]>([["monitor"], ["users"], ["__proto__"], ["INCIDENT"]])(
      "an unknown record type (%s) is refused before anything is read",
      async (recordType: string) => {
        const response: ProbeResponse = await call({
          method: "GET",
          path: `/${recordType}/${INCIDENT_ID}`,
        });

        expect(response.status).toBe(400);
        expect(mockRead).not.toHaveBeenCalled();
      },
    );

    test("an id that is not an id is refused before anything is read", async () => {
      expect(
        (await call({ method: "GET", path: "/incident/not-an-id" })).status,
      ).toBe(400);
      expect(mockRead).not.toHaveBeenCalled();
    });

    test("nobody signed in is refused", async () => {
      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
        headers: { tenantid: projectId.toString() },
      });

      expect(response.status).toBe(401);
      expect(mockRead).not.toHaveBeenCalled();
    });

    test("a request for no project is refused", async () => {
      const response: ProbeResponse = await call({
        method: "GET",
        path: `/incident/${INCIDENT_ID}`,
        headers: { [TEST_USER_HEADER]: userId.toString() },
      });

      expect(response.status).toBe(400);
      expect(mockRead).not.toHaveBeenCalled();
    });
  });

  describe("POST: adding people to one of the record's channels", () => {
    test("hands on the channel, the people and the teams, with the caller's own props, and answers each person", async () => {
      mockAdd.mockResolvedValue({
        results: [
          {
            userId: BOB_ID,
            name: "Bob Jones",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      });

      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}/add`,
        body: { channelId: " C0INC42 ", userIds: [BOB_ID], teamIds: [TEAM_ID] },
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        results: [{ userId: BOB_ID, name: "Bob Jones", outcome: "added" }],
      });

      const asked: {
        recordType: string;
        recordId: ObjectID;
        props: JSONObject;
        channelId: string;
        userIds: Array<ObjectID>;
        teamIds: Array<ObjectID>;
      } = mockAdd.mock.calls[0]![0] as never;

      expect(asked.recordType).toBe("incident");
      expect(asked.recordId.toString()).toBe(INCIDENT_ID);
      expect(asked.channelId).toBe("C0INC42");
      expect(
        asked.userIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([BOB_ID]);
      expect(
        asked.teamIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([TEAM_ID]);
      expect(String(asked.props["userId"])).toBe(userId.toString());
      expect(asked.props["isRoot"]).toBeUndefined();
    });

    test("answers the channel's state when the channel took nobody", async () => {
      mockAdd.mockResolvedValue({
        channelState: WorkspaceChannelState.Archived,
        results: [],
      });

      const response: ProbeResponse = await call({
        method: "POST",
        path: `/alert/${INCIDENT_ID}/add`,
        body: { channelId: "C0ALT7", userIds: [BOB_ID] },
      });

      expect(response.body).toEqual({ channelState: "archived", results: [] });
    });

    test("only a signed-in person adds people: a project API key is refused, and nothing is added", async () => {
      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}/add`,
        headers: {
          [TEST_API_KEY_HEADER]: "1",
          [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
          tenantid: projectId.toString(),
        },
        body: { channelId: "C0INC42", userIds: [BOB_ID] },
      });

      // A permission refusal, as everywhere in OneUptime's API: 422.
      expect(response.status).toBe(422);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    test("somebody not a member of the project is refused", async () => {
      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}/add`,
        headers: {
          [TEST_USER_HEADER]: userId.toString(),
          tenantid: projectId.toString(),
        },
        body: { channelId: "C0INC42", userIds: [BOB_ID] },
      });

      expect(response.status).toBe(422);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    test("no permission to edit the record is refused with the reason", async () => {
      mockAdd.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to add people to this incident's channel: it needs permission to edit the incident.",
        ),
      );

      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}/add`,
        body: { channelId: "C0INC42", userIds: [BOB_ID] },
      });

      expect(response.status).toBe(422);
      expect(JSON.stringify(response.body)).toContain(
        "it needs permission to edit the incident",
      );
    });

    test.each([
      ["no channel", { userIds: [BOB_ID] }],
      ["a blank channel", { channelId: "  ", userIds: [BOB_ID] }],
      ["a channel that is not text", { channelId: 7, userIds: [BOB_ID] }],
      ["nobody to add", { channelId: "C0INC42" }],
      ["empty lists", { channelId: "C0INC42", userIds: [], teamIds: [] }],
      ["people that are not a list", { channelId: "C0INC42", userIds: BOB_ID }],
      [
        "a person that is not an id",
        { channelId: "C0INC42", userIds: ["not-an-id"] },
      ],
      ["a team that is not an id", { channelId: "C0INC42", teamIds: [7] }],
      [
        "too many people",
        {
          channelId: "C0INC42",
          userIds: Array.from({ length: 51 }, () => {
            return BOB_ID;
          }),
        },
      ],
      [
        "too many teams",
        {
          channelId: "C0INC42",
          teamIds: Array.from({ length: 11 }, () => {
            return TEAM_ID;
          }),
        },
      ],
    ] as Array<[string, unknown]>)(
      "%s is refused before anything is read",
      async (_name: string, body: unknown) => {
        const response: ProbeResponse = await call({
          method: "POST",
          path: `/incident/${INCIDENT_ID}/add`,
          body: body,
        });

        expect(response.status).toBe(400);
        expect(mockAdd).not.toHaveBeenCalled();
      },
    );

    test("an unknown record type or a bad id is refused before anything is read", async () => {
      expect(
        (
          await call({
            method: "POST",
            path: `/monitor/${INCIDENT_ID}/add`,
            body: { channelId: "C1", userIds: [BOB_ID] },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call({
            method: "POST",
            path: "/incident/not-an-id/add",
            body: { channelId: "C1", userIds: [BOB_ID] },
          })
        ).status,
      ).toBe(400);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    test("nobody signed in is refused", async () => {
      const response: ProbeResponse = await call({
        method: "POST",
        path: `/incident/${INCIDENT_ID}/add`,
        headers: { tenantid: projectId.toString() },
        body: { channelId: "C0INC42", userIds: [BOB_ID] },
      });

      expect(response.status).toBe(401);
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  test("neither answer is ever cached: who is in a channel changes", async () => {
    mockRead.mockResolvedValue({ channels: [], canAddPeople: false });

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
              path: `/api/workspace-channel-members/incident/${INCIDENT_ID}`,
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
  });
});
