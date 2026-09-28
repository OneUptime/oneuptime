import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import CommonAPI from "../../../Server/API/CommonAPI";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsChatNameRefreshResult,
} from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { MicrosoftTeamsChat } from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * POST /microsoft-teams/chats/refresh — what "Refresh Chats" on the Microsoft
 * Teams Chats card calls (issue #4106). It re-reads the name of every stored
 * group chat from Microsoft, so a group chat listed by its members' names
 * picks up its real name.
 *
 * The page's first load keeps using GET /microsoft-teams/chats, which must
 * stay a plain read: no Graph calls just for opening Project Settings.
 */

type ExpressRouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next?: (err?: unknown) => void,
) => Promise<void> | void;

type ExpressRouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: ExpressRouteHandler }>;
  };
};

const REFRESH_PATH: string = "/microsoft-teams/chats/refresh";
const LIST_PATH: string = "/microsoft-teams/chats";

const NOT_A_MEMBER_MESSAGE: string =
  "You are not authorized to access this project's data.";

let router: ExpressRouter;

function findLayers(path: string, method?: string): Array<ExpressRouteLayer> {
  return (
    router as unknown as { stack: Array<ExpressRouteLayer> }
  ).stack.filter((layer: ExpressRouteLayer) => {
    return (
      layer.route?.path === path &&
      (method === undefined || layer.route?.methods[method] === true)
    );
  });
}

function getHandler(path: string, method: string): ExpressRouteHandler {
  const layers: Array<ExpressRouteLayer> = findLayers(path, method);
  if (layers.length === 0) {
    throw new Error(`${method.toUpperCase()} ${path} is not registered`);
  }
  const stack: Array<{ handle: ExpressRouteHandler }> = layers[0]!.route!.stack;
  return stack[stack.length - 1]!.handle;
}

interface InvokedResponse {
  statusCalls: Array<number>;
  sendCalls: Array<unknown>;
  body: JSONObject | null;
}

async function invoke(path: string, method: string): Promise<InvokedResponse> {
  const response: InvokedResponse = {
    statusCalls: [],
    sendCalls: [],
    body: null,
  };

  const res: ExpressResponse = {
    status(statusCode: number): ExpressResponse {
      response.statusCalls.push(statusCode);
      return res;
    },
    send(body: JSONObject): ExpressResponse {
      response.body = body;
      response.sendCalls.push(body);
      return res;
    },
  } as unknown as ExpressResponse;

  const req: ExpressRequest = {
    headers: {},
    query: {},
    params: {},
    body: {},
  } as unknown as ExpressRequest;

  await getHandler(path, method)(req, res, (err?: unknown) => {
    throw new Error(`handler called next(): ${String(err)}`);
  });

  return response;
}

function chat(overrides: Partial<MicrosoftTeamsChat>): MicrosoftTeamsChat {
  return {
    id: "19:chat@thread.v2",
    name: "Chat",
    chatType: "groupChat",
    addedAt: "2026-09-01T00:00:00.000Z",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    memberAadObjectIds: ["aad-secret-id"],
    memberNames: ["Alice", "Bob"],
    ...overrides,
  };
}

describe("POST /microsoft-teams/chats/refresh", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let getPropsSpy: jest.SpyInstance;
  let refreshSpy: jest.SpyInstance;
  let listSpy: jest.SpyInstance;

  function memberProps(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: {
        [projectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: permissions.map((permission: Permission) => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        },
      },
    } as DatabaseCommonInteractionProps;
  }

  function refreshResult(
    chats: Array<MicrosoftTeamsChat>,
    counts?: { permissionDeniedCount?: number; failedCount?: number },
  ): MicrosoftTeamsChatNameRefreshResult {
    const record: Record<string, MicrosoftTeamsChat> = {};
    for (const item of chats) {
      record[item.id] = item;
    }
    return {
      chats: record,
      permissionDeniedCount: counts?.permissionDeniedCount || 0,
      failedCount: counts?.failedCount || 0,
    };
  }

  beforeAll(() => {
    router = new MicrosoftTeamsAPI().getRouter();
  }, 600000);

  beforeEach(() => {
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    getPropsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(memberProps([Permission.ProjectMember]));

    refreshSpy = jest
      .spyOn(MicrosoftTeamsUtil, "refreshChatNamesForProject")
      .mockResolvedValue(refreshResult([]));

    listSpy = jest
      .spyOn(MicrosoftTeamsUtil, "getChatsForProject")
      .mockResolvedValue({});

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("wiring", () => {
    test("is registered exactly once, for POST only", () => {
      const layers: Array<ExpressRouteLayer> = findLayers(REFRESH_PATH);
      expect(layers).toHaveLength(1);
      expect(layers[0]!.route!.methods["post"]).toBe(true);
      expect(layers[0]!.route!.methods["get"]).toBeFalsy();
    });

    test("runs getUserMiddleware and then exactly one handler", () => {
      const handles: Array<ExpressRouteHandler> = findLayers(
        REFRESH_PATH,
        "post",
      )[0]!.route!.stack.map((entry: { handle: ExpressRouteHandler }) => {
        return entry.handle;
      });

      expect(handles).toHaveLength(2);
      expect(handles[0]).toBe(UserMiddleware.getUserMiddleware);
      expect(handles[1]).not.toBe(UserMiddleware.getUserMiddleware);
    });

    test("does not collide with the Send Test route beside it", () => {
      expect(findLayers("/microsoft-teams/chats/test", "post")).toHaveLength(1);
      expect(getHandler(REFRESH_PATH, "post")).not.toBe(
        getHandler("/microsoft-teams/chats/test", "post"),
      );
    });

    test("the GET list route is still there, still a GET, and still behind getUserMiddleware", () => {
      const layers: Array<ExpressRouteLayer> = findLayers(LIST_PATH, "get");
      expect(layers).toHaveLength(1);
      expect(layers[0]!.route!.methods["post"]).toBeFalsy();
      expect(layers[0]!.route!.stack[0]!.handle).toBe(
        UserMiddleware.getUserMiddleware,
      );
    });
  });

  describe("authentication", () => {
    function expectRefused(
      response: InvokedResponse,
      status: number,
      message: string,
    ): void {
      expect(response.statusCalls).toEqual([status]);
      expect(response.sendCalls).toHaveLength(1);
      expect(response.body).toEqual({ message: message });
      expect(refreshSpy).not.toHaveBeenCalled();
    }

    test("an anonymous caller with a tenant header gets 401 and nothing is looked up", async () => {
      getPropsSpy.mockResolvedValue({
        tenantId: projectId,
        userType: UserType.Public,
      });

      expectRefused(
        await invoke(REFRESH_PATH, "post"),
        401,
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    });

    test("a caller with no credentials at all gets 401", async () => {
      getPropsSpy.mockResolvedValue({});

      expectRefused(
        await invoke(REFRESH_PATH, "post"),
        401,
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    });

    test("a signed-in user who is not a member of the project is refused", async () => {
      getPropsSpy.mockResolvedValue({
        tenantId: projectId,
        userId: userId,
        userType: UserType.User,
      });

      expectRefused(
        await invoke(REFRESH_PATH, "post"),
        422,
        NOT_A_MEMBER_MESSAGE,
      );
    });

    test("a member of another project naming this one in the header is refused", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = memberProps([
        Permission.ProjectOwner,
      ]);
      props.userTenantAccessPermission = {
        [otherProjectId.toString()]:
          props.userTenantAccessPermission![projectId.toString()]!,
      };
      getPropsSpy.mockResolvedValue(props);

      expectRefused(
        await invoke(REFRESH_PATH, "post"),
        422,
        NOT_A_MEMBER_MESSAGE,
      );
    });

    test("any project member can refresh, the same as reading the list (a Viewer too)", async () => {
      getPropsSpy.mockResolvedValue(memberProps([Permission.ProjectMember]));

      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");

      expect(response.statusCalls).toEqual([200]);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("response", () => {
    test("refreshes the caller's project (from the authenticated props, not the body)", async () => {
      await invoke(REFRESH_PATH, "post");

      expect(refreshSpy).toHaveBeenCalledWith({ projectId: projectId });
    });

    test("returns the refreshed chats sorted by name, in the same shape GET returns", async () => {
      refreshSpy.mockResolvedValue(
        refreshResult([
          chat({ id: "19:z@thread.v2", name: "Zulu on-call" }),
          chat({
            id: "a:1",
            name: "Jane Doe",
            chatType: "personal",
            addedAt: undefined,
          }),
          chat({ id: "19:p@thread.v2", name: "Platform On-Call" }),
        ]),
      );

      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");

      expect(response.statusCalls).toEqual([200]);
      expect(response.body!["chats"]).toEqual([
        {
          id: "a:1",
          name: "Jane Doe",
          chatType: "personal",
          addedAt: null,
        },
        {
          id: "19:p@thread.v2",
          name: "Platform On-Call",
          chatType: "groupChat",
          addedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "19:z@thread.v2",
          name: "Zulu on-call",
          chatType: "groupChat",
          addedAt: "2026-09-01T00:00:00.000Z",
        },
      ]);
    });

    test("never exposes rosters, Entra ids or service URLs", async () => {
      refreshSpy.mockResolvedValue(refreshResult([chat({})]));

      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");
      const serialized: string = JSON.stringify(response.body);

      expect(serialized).not.toContain("aad-secret-id");
      expect(serialized).not.toContain("memberNames");
      expect(serialized).not.toContain("Alice");
      expect(serialized).not.toContain("trafficmanager");
    });

    test("reports how many names Microsoft refused and how many failed", async () => {
      refreshSpy.mockResolvedValue(
        refreshResult([chat({})], {
          permissionDeniedCount: 3,
          failedCount: 1,
        }),
      );

      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");

      expect(response.body!["chatNamePermissionDeniedCount"]).toBe(3);
      expect(response.body!["chatNameFailedCount"]).toBe(1);
    });

    test("zero counts are sent as 0, not left out", async () => {
      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");

      expect(response.body!["chatNamePermissionDeniedCount"]).toBe(0);
      expect(response.body!["chatNameFailedCount"]).toBe(0);
      expect(response.body!["chats"]).toEqual([]);
    });

    test("a failure surfaces with its status and message", async () => {
      refreshSpy.mockRejectedValue(
        new BadDataException(
          "Microsoft Teams integration not found for this project",
        ),
      );

      const response: InvokedResponse = await invoke(REFRESH_PATH, "post");

      expect(response.statusCalls).toEqual([400]);
      expect(response.body).toEqual({
        message: "Microsoft Teams integration not found for this project",
      });
    });
  });

  describe("GET /microsoft-teams/chats stays a plain read", () => {
    test("it lists stored chats without refreshing any names", async () => {
      listSpy.mockResolvedValue({
        "19:p@thread.v2": chat({ id: "19:p@thread.v2", name: "Platform" }),
      });

      const response: InvokedResponse = await invoke(LIST_PATH, "get");

      expect(response.statusCalls).toEqual([200]);
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(response.body!["chats"]).toEqual([
        {
          id: "19:p@thread.v2",
          name: "Platform",
          chatType: "groupChat",
          addedAt: "2026-09-01T00:00:00.000Z",
        },
      ]);
      expect(response.body!["chatNamePermissionDeniedCount"]).toBeUndefined();
    });

    test("it still sorts by name and hides rosters", async () => {
      listSpy.mockResolvedValue({
        "19:b@thread.v2": chat({ id: "19:b@thread.v2", name: "Bravo" }),
        "19:a@thread.v2": chat({ id: "19:a@thread.v2", name: "Alpha" }),
      });

      const response: InvokedResponse = await invoke(LIST_PATH, "get");

      expect(
        (response.body!["chats"] as Array<JSONObject>).map(
          (item: JSONObject) => {
            return item["name"];
          },
        ),
      ).toEqual(["Alpha", "Bravo"]);
      expect(JSON.stringify(response.body)).not.toContain("aad-secret-id");
    });
  });
});
