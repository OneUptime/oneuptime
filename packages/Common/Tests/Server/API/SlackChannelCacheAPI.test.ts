import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import BadDataException from "../../../Types/Exception/BadDataException";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import { SlackChannelCache } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
  TEST_MEMBER_OF_HEADER,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * PUT /slack/channel-cache is how the dashboard's Slack channel editor saves,
 * now that WorkspaceProjectAuthToken.miscData cannot be updated through the
 * CRUD API (for Microsoft Teams it carries server-trusted values such as the
 * Bot Framework service URLs). These drive the real route over HTTP and pin
 * that it needs a signed-in member allowed to manage the connection, takes the
 * project from that membership, and hands the service a channel cache built
 * from `channels` alone, never anything else in the body.
 */

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

jest.mock("../../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      replaceSlackChannelCache: jest.fn(),
      getProjectAuth: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {},
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

const ROUTE: string = "/api/slack/channel-cache";

describe("PUT /slack/channel-cache", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;

  const replaceChannelCache: jest.Mock =
    WorkspaceProjectAuthTokenService.replaceSlackChannelCache as unknown as jest.Mock;

  // Loading the API pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    replaceChannelCache.mockImplementation(async () => {
      return undefined;
    });
  });

  function signedInHeaders(options?: {
    permissions?: Array<Permission> | undefined;
    memberOf?: ObjectID | undefined;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: (
        options?.permissions || [Permission.ProjectMember]
      ).join(","),
    };

    if (options?.memberOf) {
      headers[TEST_MEMBER_OF_HEADER] = options.memberOf.toString();
    }

    return headers;
  }

  function put(
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> {
    return httpRequest({
      port: app.port,
      method: "PUT",
      path: ROUTE,
      headers: headers,
      body: body,
    });
  }

  function savedCache(): SlackChannelCache {
    expect(replaceChannelCache).toHaveBeenCalledTimes(1);
    return replaceChannelCache.mock.calls[0]![0].channelCache;
  }

  describe("who may save", () => {
    test("an anonymous caller is told to sign in, and nothing is saved", async () => {
      const response: ProbeResponse = await put(
        { channels: { general: "C0123456789" } },
        { tenantid: projectId.toString() },
      );

      expect(response.status).toBe(401);
      expect(replaceChannelCache).not.toHaveBeenCalled();
    });

    test("a signed-in user who is not a member of the named project is refused", async () => {
      const response: ProbeResponse = await put(
        { channels: { general: "C0123456789" } },
        signedInHeaders({ memberOf: ObjectID.generate() }),
      );

      // NotAuthorizedException is answered with 422 throughout the API.
      expect(response.status).toBe(422);
      expect(replaceChannelCache).not.toHaveBeenCalled();
    });

    test("a member who may only view the project is refused", async () => {
      const response: ProbeResponse = await put(
        { channels: { general: "C0123456789" } },
        signedInHeaders({ permissions: [Permission.Viewer] }),
      );

      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        message:
          "You do not have permission to edit this project's Slack channels.",
      });
      expect(replaceChannelCache).not.toHaveBeenCalled();
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ])(
      "%s can save, for the project they are a member of",
      async (permission: Permission) => {
        const response: ProbeResponse = await put(
          { channels: { general: "C0123456789" } },
          signedInHeaders({ permissions: [permission] }),
        );

        expect(response.status).toBe(200);
        expect(replaceChannelCache).toHaveBeenCalledTimes(1);
        expect(replaceChannelCache.mock.calls[0]![0].projectId.toString()).toBe(
          projectId.toString(),
        );
      },
    );
  });

  describe("what is saved", () => {
    test("only the channel cache reaches the service, whatever else the body carries", async () => {
      const response: ProbeResponse = await put(
        {
          channels: { general: "C0123456789" },
          miscData: {
            installedTeams: {
              "team-1": {
                id: "team-1",
                serviceUrl: "https://attacker.example.com/",
              },
            },
            appAccessToken: "attacker-token",
          },
          installedTeams: {
            "team-1": { serviceUrl: "https://attacker.example.com/" },
          },
          teamId: "T0ATTACKER",
          projectId: ObjectID.generate().toString(),
        },
        signedInHeaders(),
      );

      expect(response.status).toBe(200);
      expect(replaceChannelCache).toHaveBeenCalledTimes(1);

      const args: { projectId: ObjectID; channelCache: SlackChannelCache } =
        replaceChannelCache.mock.calls[0]![0];

      expect(Object.keys(args).sort()).toEqual(["channelCache", "projectId"]);
      expect(args.projectId.toString()).toBe(projectId.toString());
      expect(Object.keys(args.channelCache)).toEqual(["general"]);
    });

    test("builds the stored shape: lower-cased keys, trimmed names and ids, a timestamp", async () => {
      const response: ProbeResponse = await put(
        {
          channels: {
            " Incident-Updates ": " C0INCIDENT1 ",
            general: "C0123456789",
          },
        },
        signedInHeaders(),
      );

      expect(response.status).toBe(200);

      const cache: SlackChannelCache = savedCache();

      expect(Object.keys(cache).sort()).toEqual([
        "general",
        "incident-updates",
      ]);
      expect(cache["incident-updates"]).toMatchObject({
        id: "C0INCIDENT1",
        name: "Incident-Updates",
      });
      expect(cache["general"]).toMatchObject({
        id: "C0123456789",
        name: "general",
      });
      expect(Number.isNaN(Date.parse(cache["general"]!.lastUpdated))).toBe(
        false,
      );

      expect(response.body).toEqual({ channelCache: cache });
    });

    test("blank rows from the editor are dropped", async () => {
      const response: ProbeResponse = await put(
        {
          channels: {
            general: "C0123456789",
            "": "C0EMPTYNAME",
            "no-id": "   ",
          },
        },
        signedInHeaders(),
      );

      expect(response.status).toBe(200);
      expect(Object.keys(savedCache())).toEqual(["general"]);
    });

    test("an empty map clears the list", async () => {
      const response: ProbeResponse = await put(
        { channels: {} },
        signedInHeaders(),
      );

      expect(response.status).toBe(200);
      expect(savedCache()).toEqual({});
    });

    test("a Slack connection that does not exist is reported, not created", async () => {
      replaceChannelCache.mockImplementation(async () => {
        throw new BadDataException(
          "Slack is not connected for this project. Please connect Slack first.",
        );
      });

      const response: ProbeResponse = await put(
        { channels: { general: "C0123456789" } },
        signedInHeaders(),
      );

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message:
          "Slack is not connected for this project. Please connect Slack first.",
      });
    });
  });

  describe("what is refused", () => {
    test.each([
      ["no channels at all", {}],
      ["channels as a list", { channels: [["general", "C0123456789"]] }],
      ["channels as a string", { channels: "general=C0123456789" }],
      ["a non-string channel id", { channels: { general: { id: "C01" } } }],
      [
        "a channel id that is not a Slack id",
        { channels: { general: "https://attacker.example.com/" } },
      ],
      ["a name that is too long", { channels: { ["a".repeat(256)]: "C01" } }],
    ])(
      "%s is a 400 and nothing is saved",
      async (_label: string, body: unknown) => {
        const response: ProbeResponse = await put(body, signedInHeaders());

        expect(response.status).toBe(400);
        expect(replaceChannelCache).not.toHaveBeenCalled();
      },
    );

    test("a reserved key such as __proto__ is a 400 and nothing is saved", async () => {
      // An object literal would set the prototype; a parsed body has it as an own key.
      const channels: unknown = JSON.parse('{"__proto__": "C0123456789"}');

      const response: ProbeResponse = await put(
        { channels: channels },
        signedInHeaders(),
      );

      expect(response.status).toBe(400);
      expect(replaceChannelCache).not.toHaveBeenCalled();
    });
  });
});
