import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import CommonAPI from "../../../Server/API/CommonAPI";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import SlackAPI from "../../../Server/API/SlackAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import { WorkspaceThread } from "../../../Server/Utils/Workspace/WorkspaceBase";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";

/*
 * The three "Send Test" routes behind the button on every row of the Slack
 * Channels, Microsoft Teams Channels and Microsoft Teams Chats cards in
 * Project Settings:
 *
 *   POST /slack/channels/test           { channelId }
 *   POST /microsoft-teams/channels/test { teamId, channelId }
 *   POST /microsoft-teams/chats/test    { chatId }
 *
 * The service method they call (sendTestNotificationToDestination) validates
 * the ids and posts through the same bot delivery path real notifications use,
 * so it is covered by its own suite. What this file protects is the layer
 * above it, which is where the mistakes that matter live:
 *
 *   - The routes are mounted behind getUserMiddleware, which admits a request
 *     with no credentials as "public" and takes the project from a
 *     caller-supplied `tenantid` header. Posting into a channel is a side
 *     effect, so each route must itself prove the caller is an authenticated
 *     member of that project AND could already make OneUptime post there,
 *     i.e. could create a workspace notification rule through its CRUD
 *     endpoint. That gate is CommonAPI.assertCanCreateTable, which applies
 *     both halves of the CRUD create's table check: an Allow grant from the
 *     model's create list, and no unlabelled team BLOCK row on it. A Viewer
 *     must not be able to spam a customer's channels, and neither may a
 *     member whose team is blocked from creating rules - the CRUD create
 *     refuses that member, so the test route must too.
 *   - A refused caller must never reach the service - nothing may be sent.
 *   - The project, the workspace and the "tested by" user must come from the
 *     authenticated request, never from the body, and each route may only
 *     forward the destination fields that belong to it: the channel route must
 *     not smuggle a chat id through, the chat route must not smuggle a
 *     channel, and Slack has neither chats nor teams.
 *   - Body fields are untrusted JSON: anything that is not a string reaches
 *     the service as "" so the service's own validation produces the
 *     user-facing error, instead of a TypeError on `.trim()`.
 *   - Service failures surface with the status of the exception thrown and
 *     its exact message, because the dashboard shows that message verbatim in
 *     the "Test Notification Failed" modal.
 *
 * Handlers are pulled out of the routers the API classes really build (so the
 * path, method and middleware wiring are the real ones) and run against the
 * real Response utility. A second group then drives each route over real HTTP
 * through express and the real getUserMiddleware.
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
    stack: Array<{ handle: ExpressRouteHandler; method?: string }>;
  };
};

type DestinationField = "teamId" | "channelId" | "chatId";

type ApiName = "MicrosoftTeams" | "Slack";

interface RouteSpec {
  path: string;
  api: ApiName;
  workspaceType: WorkspaceType;
  // The only destination fields this route may forward to the service.
  forwardedFields: Array<DestinationField>;
  // A realistic body for this route.
  validBody: JSONObject;
}

type SendTestArgs = Parameters<
  typeof WorkspaceNotificationRuleService.sendTestNotificationToDestination
>[0];

const TEAMS_CHANNEL_ROUTE: RouteSpec = {
  path: "/microsoft-teams/channels/test",
  api: "MicrosoftTeams",
  workspaceType: WorkspaceType.MicrosoftTeams,
  forwardedFields: ["teamId", "channelId"],
  validBody: {
    teamId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    channelId: "19:0123456789abcdef0123456789abcdef@thread.tacv2",
  },
};

const TEAMS_CHAT_ROUTE: RouteSpec = {
  path: "/microsoft-teams/chats/test",
  api: "MicrosoftTeams",
  workspaceType: WorkspaceType.MicrosoftTeams,
  forwardedFields: ["chatId"],
  validBody: {
    chatId: "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2",
  },
};

const SLACK_CHANNEL_ROUTE: RouteSpec = {
  path: "/slack/channels/test",
  api: "Slack",
  workspaceType: WorkspaceType.Slack,
  forwardedFields: ["channelId"],
  validBody: {
    channelId: "C0123456789",
  },
};

const ALL_ROUTES: Array<[string, RouteSpec]> = [
  [`POST ${TEAMS_CHANNEL_ROUTE.path}`, TEAMS_CHANNEL_ROUTE],
  [`POST ${TEAMS_CHAT_ROUTE.path}`, TEAMS_CHAT_ROUTE],
  [`POST ${SLACK_CHANNEL_ROUTE.path}`, SLACK_CHANNEL_ROUTE],
];

const ALL_DESTINATION_FIELDS: Array<DestinationField> = [
  "teamId",
  "channelId",
  "chatId",
];

const PERMISSION_DENIED_MESSAGE: string =
  "You do not have permission to send test notifications in this project.";

const NOT_A_MEMBER_MESSAGE: string =
  "You are not authorized to access this project's data.";

/*
 * What a team BLOCK row answers with. It is the block check's own wording
 * (the same one POST /workspace-notification-rule gives), not the send-test
 * message: the caller does hold an Allow grant, and this names the block
 * that overrides it.
 */
type BlockedMessageFunction = (permission: Permission) => string;

const blockedMessage: BlockedMessageFunction = (
  permission: Permission,
): string => {
  return `You are not authorized to create Workspace Notification Rule because ${permission} is in your team's permission block list.`;
};

const LABEL_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

/*
 * Routers are built once from the real API classes. Building them is cheap;
 * importing the API modules is what pulls in the big module graph, and that
 * happens at file load, outside every test's timeout.
 */
const routers: Record<ApiName, ExpressRouter | null> = {
  MicrosoftTeams: null,
  Slack: null,
};

type GetRouterFunction = (api: ApiName) => ExpressRouter;

const getRouter: GetRouterFunction = (api: ApiName): ExpressRouter => {
  const router: ExpressRouter | null = routers[api];

  if (!router) {
    throw new Error(`The ${api} router has not been built yet.`);
  }

  return router;
};

type GetLayersFunction = (api: ApiName) => Array<ExpressRouteLayer>;

const getLayers: GetLayersFunction = (
  api: ApiName,
): Array<ExpressRouteLayer> => {
  return (getRouter(api) as unknown as { stack: Array<ExpressRouteLayer> })
    .stack;
};

type FindRouteLayersFunction = (data: {
  api: ApiName;
  path: string;
  method: string;
}) => Array<ExpressRouteLayer>;

const findRouteLayers: FindRouteLayersFunction = (data: {
  api: ApiName;
  path: string;
  method: string;
}): Array<ExpressRouteLayer> => {
  return getLayers(data.api).filter((layer: ExpressRouteLayer) => {
    return (
      layer.route?.path === data.path &&
      layer.route?.methods[data.method] === true
    );
  });
};

type GetRouteLayerFunction = (data: {
  api: ApiName;
  path: string;
  method: string;
}) => ExpressRouteLayer;

const getRouteLayer: GetRouteLayerFunction = (data: {
  api: ApiName;
  path: string;
  method: string;
}): ExpressRouteLayer => {
  const layers: Array<ExpressRouteLayer> = findRouteLayers(data);

  if (layers.length === 0 || !layers[0]!.route) {
    throw new Error(
      `${data.method.toUpperCase()} ${data.path} is not registered on the ${data.api} router`,
    );
  }

  return layers[0]!;
};

type GetHandlerFunction = (route: RouteSpec) => ExpressRouteHandler;

// The route's own handler: the last function in its stack.
const getHandler: GetHandlerFunction = (
  route: RouteSpec,
): ExpressRouteHandler => {
  const layer: ExpressRouteLayer = getRouteLayer({
    api: route.api,
    path: route.path,
    method: "post",
  });

  const stack: Array<{ handle: ExpressRouteHandler }> = layer.route!.stack;

  return stack[stack.length - 1]!.handle;
};

/*
 * Props builders. These mirror what getUserMiddleware + getDatabaseCommon-
 * InteractionProps produce for real requests: a tenant id taken from the
 * `tenantid` header, the user id from the access token, and a per-project
 * dictionary of the permissions the user's teams grant in that project.
 */
type BuildPermissionFunction = (
  permission: Permission,
  isBlockPermission?: boolean,
  labelIds?: Array<ObjectID>,
) => UserPermission;

const buildPermission: BuildPermissionFunction = (
  permission: Permission,
  isBlockPermission?: boolean,
  labelIds?: Array<ObjectID>,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds || [],
    isBlockPermission: Boolean(isBlockPermission),
  };
};

type BuildTenantPermissionsFunction = (
  grants: Array<{ projectId: ObjectID; permissions: Array<UserPermission> }>,
) => Dictionary<UserTenantAccessPermission>;

const buildTenantPermissions: BuildTenantPermissionsFunction = (
  grants: Array<{ projectId: ObjectID; permissions: Array<UserPermission> }>,
): Dictionary<UserTenantAccessPermission> => {
  const map: Dictionary<UserTenantAccessPermission> = {};

  grants.forEach(
    (grant: { projectId: ObjectID; permissions: Array<UserPermission> }) => {
      map[grant.projectId.toString()] = {
        _type: "UserTenantAccessPermission",
        projectId: grant.projectId,
        permissions: grant.permissions,
      };
    },
  );

  return map;
};

type BuildMemberPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blockedPermissions?: Array<Permission> | undefined;
  // Labels every block row is scoped to; none means a table-wide block.
  blockLabelIds?: Array<ObjectID> | undefined;
  userType?: UserType | undefined;
  isMasterAdmin?: boolean | undefined;
}) => DatabaseCommonInteractionProps;

const buildMemberProps: BuildMemberPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blockedPermissions?: Array<Permission> | undefined;
  blockLabelIds?: Array<ObjectID> | undefined;
  userType?: UserType | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps => {
  const userPermissions: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission) => {
      return buildPermission(permission);
    }),
    ...(data.blockedPermissions || []).map((permission: Permission) => {
      return buildPermission(permission, true, data.blockLabelIds);
    }),
  ];

  const props: DatabaseCommonInteractionProps = {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.userType || UserType.User,
    userTenantAccessPermission: buildTenantPermissions([
      { projectId: data.projectId, permissions: userPermissions },
    ]),
  };

  if (data.isMasterAdmin) {
    props.isMasterAdmin = true;
  }

  return props;
};

type InvokedResponse = {
  statusCode: number | null;
  body: JSONObject | null;
  statusCalls: Array<number>;
  sendCalls: Array<unknown>;
};

type InvokeRouteFunction = (data: {
  route: RouteSpec;
  body?: unknown;
  omitBody?: boolean | undefined;
}) => Promise<{ response: InvokedResponse; req: ExpressRequest }>;

/*
 * Calls the real handler with a minimal request and a response that records
 * every status()/send() the real Response utility makes. A handler that
 * forgets to answer, or answers twice, shows up in statusCalls/sendCalls.
 */
const invokeRoute: InvokeRouteFunction = async (data: {
  route: RouteSpec;
  body?: unknown;
  omitBody?: boolean | undefined;
}): Promise<{ response: InvokedResponse; req: ExpressRequest }> => {
  const handler: ExpressRouteHandler = getHandler(data.route);

  const response: InvokedResponse = {
    statusCode: null,
    body: null,
    statusCalls: [],
    sendCalls: [],
  };

  const res: ExpressResponse = {
    status(statusCode: number): ExpressResponse {
      response.statusCode = statusCode;
      response.statusCalls.push(statusCode);
      return res;
    },
    send(body: JSONObject): ExpressResponse {
      response.body = body;
      response.sendCalls.push(body);
      return res;
    },
  } as unknown as ExpressResponse;

  const reqObject: Record<string, unknown> = {
    headers: {},
    query: {},
    params: {},
  };

  if (!data.omitBody) {
    reqObject["body"] =
      data.body === undefined ? data.route.validBody : data.body;
  }

  const req: ExpressRequest = reqObject as unknown as ExpressRequest;

  const next: (err?: unknown) => void = (err?: unknown): void => {
    throw new Error(
      `The route handler called next() instead of answering: ${String(err)}`,
    );
  };

  await handler(req, res, next);

  return { response, req };
};

type ExpectedArgsFunction = (data: {
  route: RouteSpec;
  props: DatabaseCommonInteractionProps;
  body: unknown;
}) => SendTestArgs;

/*
 * What the spec says the route forwards: the project and user from the
 * authenticated props, the route's own workspace type, and - for each of
 * the route's own destination fields only - the body value when it is a
 * string, "" otherwise.
 */
const expectedArgs: ExpectedArgsFunction = (data: {
  route: RouteSpec;
  props: DatabaseCommonInteractionProps;
  body: unknown;
}): SendTestArgs => {
  const args: SendTestArgs = {
    projectId: data.props.tenantId!,
    workspaceType: data.route.workspaceType,
    testByUserId: data.props.userId!,
  };

  const body: Record<string, unknown> | null =
    data.body && typeof data.body === "object"
      ? (data.body as Record<string, unknown>)
      : null;

  data.route.forwardedFields.forEach((field: DestinationField) => {
    const value: unknown = body ? body[field] : undefined;
    args[field] = typeof value === "string" ? value : "";
  });

  return args;
};

const SAMPLE_THREAD: WorkspaceThread = {
  channel: {
    id: "C0123456789",
    name: "alerts",
    workspaceType: WorkspaceType.Slack,
  },
  threadId: "1700000000.000100",
};

describe("Send Test notification routes (Slack channels, Microsoft Teams channels and chats)", () => {
  let sendTestSpy: jest.SpyInstance;
  let getPropsSpy: jest.SpyInstance;
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;

  type MockPropsFunction = (props: DatabaseCommonInteractionProps) => void;

  const mockProps: MockPropsFunction = (
    props: DatabaseCommonInteractionProps,
  ): void => {
    getPropsSpy.mockResolvedValue(props);
  };

  type OwnerPropsFunction = () => DatabaseCommonInteractionProps;

  const ownerProps: OwnerPropsFunction = (): DatabaseCommonInteractionProps => {
    return buildMemberProps({
      projectId: projectId,
      userId: userId,
      permissions: [Permission.ProjectOwner],
    });
  };

  beforeAll(() => {
    routers.MicrosoftTeams = new MicrosoftTeamsAPI().getRouter();
    routers.Slack = new SlackAPI().getRouter();
  });

  beforeEach(() => {
    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();

    sendTestSpy = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendTestNotificationToDestination",
      )
      .mockResolvedValue(SAMPLE_THREAD);

    getPropsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(ownerProps());

    // sendErrorResponse logs every refusal; keep the test output readable.
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("wiring", () => {
    test.each(ALL_ROUTES)(
      "%s is registered exactly once, for POST only",
      (_label: string, route: RouteSpec) => {
        const postLayers: Array<ExpressRouteLayer> = findRouteLayers({
          api: route.api,
          path: route.path,
          method: "post",
        });

        expect(postLayers).toHaveLength(1);

        const methods: Record<string, boolean> = postLayers[0]!.route!.methods;
        expect(methods["post"]).toBe(true);
        expect(methods["get"]).toBeFalsy();
        expect(methods["put"]).toBeFalsy();
        expect(methods["delete"]).toBeFalsy();

        /*
         * No other layer (any method) may claim the same path, otherwise a
         * GET or PUT to it would reach a different handler.
         */
        const allLayersForPath: Array<ExpressRouteLayer> = getLayers(
          route.api,
        ).filter((layer: ExpressRouteLayer) => {
          return layer.route?.path === route.path;
        });
        expect(allLayersForPath).toHaveLength(1);
      },
    );

    test.each(ALL_ROUTES)(
      "%s runs getUserMiddleware and then exactly one handler",
      (_label: string, route: RouteSpec) => {
        const layer: ExpressRouteLayer = getRouteLayer({
          api: route.api,
          path: route.path,
          method: "post",
        });

        const handles: Array<ExpressRouteHandler> = layer.route!.stack.map(
          (entry: { handle: ExpressRouteHandler }) => {
            return entry.handle;
          },
        );

        /*
         * Without getUserMiddleware the request would never carry a user or a
         * tenant, so every caller would look anonymous - and a route that
         * forgot to check would have no middleware to blame.
         */
        expect(handles).toHaveLength(2);
        expect(handles[0]).toBe(UserMiddleware.getUserMiddleware);
        expect(typeof handles[1]).toBe("function");
        expect(handles[1]).not.toBe(UserMiddleware.getUserMiddleware);
      },
    );

    test.each([
      ["MicrosoftTeams" as ApiName, "/microsoft-teams/channels"],
      ["MicrosoftTeams" as ApiName, "/microsoft-teams/chats"],
      ["Slack" as ApiName, "/slack/channels"],
    ])(
      "the existing GET list route on the %s router, %s, is still registered behind getUserMiddleware",
      (api: ApiName, path: string) => {
        const layers: Array<ExpressRouteLayer> = findRouteLayers({
          api: api,
          path: path,
          method: "get",
        });

        expect(layers).toHaveLength(1);
        expect(layers[0]!.route!.stack[0]!.handle).toBe(
          UserMiddleware.getUserMiddleware,
        );
        // Adding the POST beside it must not have turned the list route into a POST.
        expect(layers[0]!.route!.methods["post"]).toBeFalsy();
      },
    );

    test("each route has its own handler (they are not one shared function)", () => {
      const handlers: Array<ExpressRouteHandler> = [
        getHandler(TEAMS_CHANNEL_ROUTE),
        getHandler(TEAMS_CHAT_ROUTE),
        getHandler(SLACK_CHANNEL_ROUTE),
      ];

      expect(new Set(handlers).size).toBe(3);
    });

    test("the Slack router does not serve the Microsoft Teams test routes, and vice versa", () => {
      expect(
        findRouteLayers({
          api: "Slack",
          path: TEAMS_CHANNEL_ROUTE.path,
          method: "post",
        }),
      ).toHaveLength(0);
      expect(
        findRouteLayers({
          api: "Slack",
          path: TEAMS_CHAT_ROUTE.path,
          method: "post",
        }),
      ).toHaveLength(0);
      expect(
        findRouteLayers({
          api: "MicrosoftTeams",
          path: SLACK_CHANNEL_ROUTE.path,
          method: "post",
        }),
      ).toHaveLength(0);
    });
  });

  describe.each(ALL_ROUTES)("%s", (_label: string, route: RouteSpec) => {
    type ExpectRefusedFunction = (
      response: InvokedResponse,
      status: number,
      message: string,
    ) => void;

    const expectRefused: ExpectRefusedFunction = (
      response: InvokedResponse,
      status: number,
      message: string,
    ): void => {
      expect(response.statusCalls).toEqual([status]);
      expect(response.sendCalls).toHaveLength(1);
      expect(response.body).toEqual({ message: message });
      expect(sendTestSpy).not.toHaveBeenCalled();
    };

    describe("authentication", () => {
      test("reads the caller's props from the request it was given", async () => {
        const { req } = await invokeRoute({ route });

        expect(getPropsSpy).toHaveBeenCalledTimes(1);
        expect(getPropsSpy.mock.calls[0]![0]).toBe(req);
      });

      test("an unauthenticated (public) caller with a tenant header gets 401 and nothing is sent", async () => {
        mockProps({
          tenantId: projectId,
          userType: UserType.Public,
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 401, CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
      });

      test("a caller with no credentials and no tenant gets 401 (not 400) and nothing is sent", async () => {
        mockProps({});

        const { response } = await invokeRoute({ route });

        expectRefused(response, 401, CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
      });

      test("an anonymous caller carrying a forged ProjectOwner grant is still 401", async () => {
        /*
         * No user id means no identity, whatever permission map rides along.
         * The route must not decide on permissions before identity.
         */
        mockProps({
          tenantId: projectId,
          userType: UserType.Public,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [buildPermission(Permission.ProjectOwner)],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 401, CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
      });

      test("an authenticated user with no tenant is refused with 400 and nothing is sent", async () => {
        mockProps({
          userId: userId,
          userType: UserType.User,
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 400, "Project ID is required");
      });

      test("an authenticated user who is not a member of the tenant is refused and nothing is sent", async () => {
        mockProps({
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, NOT_A_MEMBER_MESSAGE);
      });

      test("an owner of ANOTHER project who names this project in the tenant header is refused and nothing is sent", async () => {
        mockProps({
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: otherProjectId,
              permissions: [buildPermission(Permission.ProjectOwner)],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, NOT_A_MEMBER_MESSAGE);
      });

      test("a project API key is refused: the test is sent as a person, so it needs a user", async () => {
        mockProps({
          tenantId: projectId,
          userType: UserType.API,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [buildPermission(Permission.ProjectOwner)],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, NOT_A_MEMBER_MESSAGE);
      });

      test("a failure while reading the caller's props is answered as an error and nothing is sent", async () => {
        getPropsSpy.mockRejectedValue(
          new BadDataException("Could not read the current plan."),
        );

        const { response } = await invokeRoute({ route });

        expectRefused(response, 400, "Could not read the current plan.");
      });
    });

    describe("authorization", () => {
      test.each([
        ["Viewer", [Permission.Viewer]],
        [
          "ReadWorkspaceNotificationRule",
          [Permission.ReadWorkspaceNotificationRule],
        ],
        ["SettingsViewer", [Permission.SettingsViewer]],
        [
          "EditWorkspaceNotificationRule",
          [Permission.EditWorkspaceNotificationRule],
        ],
        [
          "DeleteWorkspaceNotificationRule",
          [Permission.DeleteWorkspaceNotificationRule],
        ],
        [
          "every read-only grant at once",
          [
            Permission.Viewer,
            Permission.SettingsViewer,
            Permission.ReadWorkspaceNotificationRule,
          ],
        ],
        ["no grants at all", []],
      ])(
        "a member whose only grant is %s is refused with the send-test permission message and nothing is sent",
        async (_permissionLabel: string, permissions: Array<Permission>) => {
          mockProps(
            buildMemberProps({
              projectId: projectId,
              userId: userId,
              permissions: permissions,
            }),
          );

          const { response } = await invokeRoute({ route });

          expectRefused(response, 422, PERMISSION_DENIED_MESSAGE);
        },
      );

      test("a team BLOCK on CreateWorkspaceNotificationRule is not counted as a grant", async () => {
        mockProps(
          buildMemberProps({
            projectId: projectId,
            userId: userId,
            permissions: [Permission.Viewer],
            blockedPermissions: [Permission.CreateWorkspaceNotificationRule],
          }),
        );

        const { response } = await invokeRoute({ route });

        /*
         * With no Allow grant at all, the Allow half refuses first, so the
         * caller sees the send-test message rather than the block wording.
         */
        expectRefused(response, 422, PERMISSION_DENIED_MESSAGE);
      });

      test("an owner grant in another project does not leak into this one", async () => {
        const props: DatabaseCommonInteractionProps = {
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [buildPermission(Permission.Viewer)],
            },
            {
              projectId: otherProjectId,
              permissions: [
                buildPermission(Permission.ProjectOwner),
                buildPermission(Permission.CreateWorkspaceNotificationRule),
              ],
            },
          ]),
        };

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, PERMISSION_DENIED_MESSAGE);
      });

      test.each([
        ["ProjectOwner", [Permission.ProjectOwner]],
        ["ProjectAdmin", [Permission.ProjectAdmin]],
        ["ProjectMember", [Permission.ProjectMember]],
        ["SettingsAdmin", [Permission.SettingsAdmin]],
        ["SettingsMember", [Permission.SettingsMember]],
        [
          "CreateWorkspaceNotificationRule",
          [Permission.CreateWorkspaceNotificationRule],
        ],
        [
          "Viewer plus CreateWorkspaceNotificationRule",
          [Permission.Viewer, Permission.CreateWorkspaceNotificationRule],
        ],
      ])(
        "a member with %s sends the test once with the exact arguments and gets 200 {}",
        async (_permissionLabel: string, permissions: Array<Permission>) => {
          const props: DatabaseCommonInteractionProps = buildMemberProps({
            projectId: projectId,
            userId: userId,
            permissions: permissions,
          });

          mockProps(props);

          const { response } = await invokeRoute({ route });

          expect(sendTestSpy).toHaveBeenCalledTimes(1);
          expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
            expectedArgs({ route, props, body: route.validBody }),
          );

          expect(response.statusCalls).toEqual([200]);
          expect(response.sendCalls).toHaveLength(1);
          expect(response.body).toEqual({});
        },
      );

      test("a master admin who is a member with only Viewer bypasses the permission check", async () => {
        const props: DatabaseCommonInteractionProps = buildMemberProps({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.Viewer],
          userType: UserType.MasterAdmin,
          isMasterAdmin: true,
        });

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
          expectedArgs({ route, props, body: route.validBody }),
        );
        expect(response.statusCalls).toEqual([200]);
        expect(response.body).toEqual({});
      });

      test("a master admin who is a member with no grants at all bypasses the permission check", async () => {
        const props: DatabaseCommonInteractionProps = buildMemberProps({
          projectId: projectId,
          userId: userId,
          permissions: [],
          userType: UserType.MasterAdmin,
          isMasterAdmin: true,
        });

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(response.statusCalls).toEqual([200]);
      });

      test("the master admin bypass covers permissions only: a master admin who is not a member of the tenant is still refused", async () => {
        mockProps({
          tenantId: projectId,
          userId: userId,
          userType: UserType.MasterAdmin,
          isMasterAdmin: true,
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, NOT_A_MEMBER_MESSAGE);
      });
    });

    describe("the permission gate", () => {
      test("is CommonAPI.assertCanCreateTable for WorkspaceNotificationRule, with the caller's props and the send-test message, before anything is sent", async () => {
        const gateSpy: jest.SpyInstance = jest.spyOn(
          CommonAPI,
          "assertCanCreateTable",
        );

        const props: DatabaseCommonInteractionProps = buildMemberProps({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.ProjectMember],
        });

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(gateSpy).toHaveBeenCalledTimes(1);

        const gateArgs: {
          modelType: unknown;
          props: DatabaseCommonInteractionProps;
          errorMessage?: string | undefined;
        } = gateSpy.mock.calls[0]![0] as {
          modelType: unknown;
          props: DatabaseCommonInteractionProps;
          errorMessage?: string | undefined;
        };

        expect(gateArgs.modelType).toBe(WorkspaceNotificationRule);
        expect(gateArgs.props).toBe(props);
        expect(gateArgs.errorMessage).toBe(PERMISSION_DENIED_MESSAGE);

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(gateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
          sendTestSpy.mock.invocationCallOrder[0]!,
        );
        expect(response.statusCalls).toEqual([200]);
      });

      test("whatever the gate refuses is answered with its exception, and nothing is sent", async () => {
        // An owner would pass; only the stubbed gate stands in the way.
        jest.spyOn(CommonAPI, "assertCanCreateTable").mockImplementation(() => {
          throw new NotAuthorizedException("Refused by the create gate.");
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, "Refused by the create gate.");
      });

      test("identity is settled before the gate runs: an anonymous caller never reaches it", async () => {
        const gateSpy: jest.SpyInstance = jest.spyOn(
          CommonAPI,
          "assertCanCreateTable",
        );

        mockProps({
          tenantId: projectId,
          userType: UserType.Public,
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 401, CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
        expect(gateSpy).not.toHaveBeenCalled();
      });

      test("membership is settled before the gate runs: a non-member never reaches it", async () => {
        const gateSpy: jest.SpyInstance = jest.spyOn(
          CommonAPI,
          "assertCanCreateTable",
        );

        mockProps({
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: otherProjectId,
              permissions: [buildPermission(Permission.ProjectOwner)],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, NOT_A_MEMBER_MESSAGE);
        expect(gateSpy).not.toHaveBeenCalled();
      });
    });

    describe("team block list", () => {
      test.each([
        ["ProjectOwner", Permission.ProjectOwner],
        ["ProjectAdmin", Permission.ProjectAdmin],
        ["ProjectMember", Permission.ProjectMember],
        ["SettingsAdmin", Permission.SettingsAdmin],
        ["SettingsMember", Permission.SettingsMember],
        [
          "CreateWorkspaceNotificationRule",
          Permission.CreateWorkspaceNotificationRule,
        ],
      ])(
        "a member with %s whose team has an unlabelled BLOCK on CreateWorkspaceNotificationRule is refused with the block message and nothing is sent",
        async (_permissionLabel: string, permission: Permission) => {
          mockProps(
            buildMemberProps({
              projectId: projectId,
              userId: userId,
              permissions: [permission],
              blockedPermissions: [Permission.CreateWorkspaceNotificationRule],
            }),
          );

          const { response } = await invokeRoute({ route });

          expectRefused(
            response,
            422,
            blockedMessage(Permission.CreateWorkspaceNotificationRule),
          );
        },
      );

      test("a BLOCK on any other permission in the create list refuses too, as the CRUD create does", async () => {
        mockProps(
          buildMemberProps({
            projectId: projectId,
            userId: userId,
            permissions: [Permission.ProjectAdmin],
            blockedPermissions: [Permission.ProjectMember],
          }),
        );

        const { response } = await invokeRoute({ route });

        expectRefused(response, 422, blockedMessage(Permission.ProjectMember));
      });

      test("a BLOCK on reading, editing or deleting rules does not stop a ProjectMember from sending a test", async () => {
        const props: DatabaseCommonInteractionProps = buildMemberProps({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.ProjectMember],
          blockedPermissions: [
            Permission.ReadWorkspaceNotificationRule,
            Permission.EditWorkspaceNotificationRule,
            Permission.DeleteWorkspaceNotificationRule,
          ],
        });

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
          expectedArgs({ route, props, body: route.validBody }),
        );
        expect(response.statusCalls).toEqual([200]);
      });

      test("a BLOCK scoped to labels is left to the row-level rules, as the CRUD create's table check leaves it, so the test is sent", async () => {
        /*
         * checkTableLevelBlockPermissions only refuses a block row with no
         * labels; a labelled row covers the labelled records alone. A test
         * notification creates no record, so there is nothing for it to
         * cover here.
         */
        const props: DatabaseCommonInteractionProps = buildMemberProps({
          projectId: projectId,
          userId: userId,
          permissions: [Permission.ProjectMember],
          blockedPermissions: [Permission.CreateWorkspaceNotificationRule],
          blockLabelIds: [LABEL_ID],
        });

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
          expectedArgs({ route, props, body: route.validBody }),
        );
        expect(response.statusCalls).toEqual([200]);
      });

      test("an unlabelled BLOCK still wins when a labelled BLOCK row for the same permission comes first", async () => {
        mockProps({
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [
                buildPermission(Permission.ProjectMember),
                buildPermission(
                  Permission.CreateWorkspaceNotificationRule,
                  true,
                  [LABEL_ID],
                ),
                buildPermission(
                  Permission.CreateWorkspaceNotificationRule,
                  true,
                ),
              ],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(
          response,
          422,
          blockedMessage(Permission.CreateWorkspaceNotificationRule),
        );
      });

      test("a BLOCK in another project does not refuse the test in this one", async () => {
        const props: DatabaseCommonInteractionProps = {
          tenantId: projectId,
          userId: userId,
          userType: UserType.User,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [buildPermission(Permission.ProjectMember)],
            },
            {
              projectId: otherProjectId,
              permissions: [
                buildPermission(Permission.ProjectMember),
                buildPermission(
                  Permission.CreateWorkspaceNotificationRule,
                  true,
                ),
              ],
            },
          ]),
        };

        mockProps(props);

        const { response } = await invokeRoute({ route });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(response.statusCalls).toEqual([200]);
      });

      test.each([
        ["ProjectMember", [Permission.ProjectMember]],
        ["Viewer", [Permission.Viewer]],
        ["no grants at all", []],
      ])(
        "a master admin who is a member with %s and the same unlabelled BLOCK still sends the test",
        async (_permissionLabel: string, permissions: Array<Permission>) => {
          const props: DatabaseCommonInteractionProps = buildMemberProps({
            projectId: projectId,
            userId: userId,
            permissions: permissions,
            blockedPermissions: [Permission.CreateWorkspaceNotificationRule],
            userType: UserType.MasterAdmin,
            isMasterAdmin: true,
          });

          mockProps(props);

          const { response } = await invokeRoute({ route });

          expect(sendTestSpy).toHaveBeenCalledTimes(1);
          expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
            expectedArgs({ route, props, body: route.validBody }),
          );
          expect(response.statusCalls).toEqual([200]);
          expect(response.body).toEqual({});
        },
      );

      test("an anonymous caller carrying a forged grant and a BLOCK is still 401, not the block message", async () => {
        mockProps({
          tenantId: projectId,
          userType: UserType.Public,
          userTenantAccessPermission: buildTenantPermissions([
            {
              projectId: projectId,
              permissions: [
                buildPermission(Permission.ProjectMember),
                buildPermission(
                  Permission.CreateWorkspaceNotificationRule,
                  true,
                ),
              ],
            },
          ]),
        });

        const { response } = await invokeRoute({ route });

        expectRefused(response, 401, CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
      });
    });

    describe("what is forwarded to the service", () => {
      test("the project and the tested-by user are the very objects from the authenticated props", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        await invokeRoute({ route });

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;
        expect(args.projectId).toBe(props.tenantId);
        expect(args.testByUserId).toBe(props.userId);
        expect(args.workspaceType).toBe(route.workspaceType);
      });

      test("projectId, workspaceType, testByUserId and userId in the body are ignored", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const body: JSONObject = {
          ...route.validBody,
          projectId: otherProjectId.toString(),
          tenantId: otherProjectId.toString(),
          workspaceType:
            route.workspaceType === WorkspaceType.Slack
              ? WorkspaceType.MicrosoftTeams
              : WorkspaceType.Slack,
          testByUserId: ObjectID.generate().toString(),
          userId: ObjectID.generate().toString(),
        };

        await invokeRoute({ route, body });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
          expectedArgs({ route, props, body }),
        );

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;
        expect(args.projectId.toString()).toBe(projectId.toString());
        expect(args.workspaceType).toBe(route.workspaceType);
        expect(args.testByUserId.toString()).toBe(userId.toString());
      });

      test("forwards only this route's own destination fields, even when the body carries all of them", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const body: JSONObject = {
          teamId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
          channelId: "C0123456789",
          chatId: "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2",
        };

        await invokeRoute({ route, body });

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;

        expect(Object.keys(args).sort()).toEqual(
          [
            "projectId",
            "testByUserId",
            "workspaceType",
            ...route.forwardedFields,
          ].sort(),
        );

        ALL_DESTINATION_FIELDS.forEach((field: DestinationField) => {
          if (route.forwardedFields.includes(field)) {
            expect(args[field]).toBe(body[field]);
          } else {
            expect(args[field]).toBeUndefined();
          }
        });
      });

      test("string values are forwarded verbatim; trimming and validation belong to the service", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const body: JSONObject = {};
        route.forwardedFields.forEach((field: DestinationField) => {
          body[field] = `  ${field}-value with spaces/and#symbols  `;
        });

        await invokeRoute({ route, body });

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;
        route.forwardedFields.forEach((field: DestinationField) => {
          expect(args[field]).toBe(
            `  ${field}-value with spaces/and#symbols  `,
          );
        });
      });

      test("empty strings are forwarded as empty strings", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const body: JSONObject = {};
        route.forwardedFields.forEach((field: DestinationField) => {
          body[field] = "";
        });

        await invokeRoute({ route, body });

        expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
          expectedArgs({ route, props, body }),
        );
      });

      test('a request with no body at all forwards "" for every destination field', async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const { response } = await invokeRoute({ route, omitBody: true });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;
        route.forwardedFields.forEach((field: DestinationField) => {
          expect(args[field]).toBe("");
        });
        expect(args).toStrictEqual(expectedArgs({ route, props, body: null }));
        expect(response.statusCalls).toEqual([200]);
      });

      test.each([
        ["null", null],
        ["an empty object", {}],
        ["an array", ["C0123456789"]],
        ["a string", "channelId=C0123456789"],
        ["a number", 42],
      ])(
        'a body that is %s forwards "" for every destination field',
        async (_bodyLabel: string, body: unknown) => {
          const props: DatabaseCommonInteractionProps = ownerProps();
          mockProps(props);

          await invokeRoute({ route, body });

          expect(sendTestSpy).toHaveBeenCalledTimes(1);

          const args: SendTestArgs = sendTestSpy.mock
            .calls[0]![0] as SendTestArgs;
          route.forwardedFields.forEach((field: DestinationField) => {
            expect(args[field]).toBe("");
          });
        },
      );

      test.each([
        ["a number", 12345],
        ["zero", 0],
        ["true", true],
        ["false", false],
        ["null", null],
        ["an object", { id: "C0123456789" }],
        ["an object with a toString", { toString: "C0123456789" }],
        ["an array of strings", ["C0123456789"]],
        ["an empty array", []],
        ["a nested array", [["19:chat@thread.v2"]]],
      ])(
        'a destination field that is %s reaches the service as ""',
        async (_valueLabel: string, value: unknown) => {
          const props: DatabaseCommonInteractionProps = ownerProps();
          mockProps(props);

          const body: Record<string, unknown> = {};
          route.forwardedFields.forEach((field: DestinationField) => {
            body[field] = value;
          });

          await invokeRoute({ route, body });

          expect(sendTestSpy).toHaveBeenCalledTimes(1);

          const args: SendTestArgs = sendTestSpy.mock
            .calls[0]![0] as SendTestArgs;
          route.forwardedFields.forEach((field: DestinationField) => {
            expect(args[field]).toBe("");
          });
          expect(args).toStrictEqual(expectedArgs({ route, props, body }));
        },
      );

      test("each destination field is sanitised on its own: a good field survives beside a bad one", async () => {
        const props: DatabaseCommonInteractionProps = ownerProps();
        mockProps(props);

        const body: Record<string, unknown> = {};
        route.forwardedFields.forEach(
          (field: DestinationField, index: number) => {
            body[field] = index === 0 ? 987 : `good-${field}`;
          },
        );

        await invokeRoute({ route, body });

        const args: SendTestArgs = sendTestSpy.mock
          .calls[0]![0] as SendTestArgs;
        route.forwardedFields.forEach(
          (field: DestinationField, index: number) => {
            expect(args[field]).toBe(index === 0 ? "" : `good-${field}`);
          },
        );
      });
    });

    describe("responses", () => {
      test("success answers 200 with an empty object and does not echo the thread", async () => {
        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).toEqual([200]);
        expect(response.sendCalls).toEqual([{}]);

        const serialized: string = JSON.stringify(response.sendCalls);
        expect(serialized).not.toContain(SAMPLE_THREAD.threadId);
        expect(serialized).not.toContain(SAMPLE_THREAD.channel.id);
      });

      test("the service is awaited: a slow send still answers only once it resolves", async () => {
        let resolveSend: (thread: WorkspaceThread) => void = (): void => {
          return undefined;
        };

        sendTestSpy.mockImplementation(() => {
          return new Promise<WorkspaceThread>(
            (resolve: (thread: WorkspaceThread) => void) => {
              resolveSend = resolve;
            },
          );
        });

        let settled: boolean = false;

        const pending: Promise<{
          response: InvokedResponse;
          req: ExpressRequest;
        }> = invokeRoute({ route }).then(
          (result: { response: InvokedResponse; req: ExpressRequest }) => {
            settled = true;
            return result;
          },
        );

        // Let the handler run up to the service call.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 20);
        });

        expect(sendTestSpy).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        resolveSend(SAMPLE_THREAD);

        const { response } = await pending;

        expect(response.statusCalls).toEqual([200]);
      });

      test.each([
        ["Please choose a channel or a chat to send the test notification to."],
        ["The Slack channel id is not valid."],
        ["The Microsoft Teams channel id is not valid."],
        ["The Microsoft Teams chat id is not valid."],
        ["Please select the team this channel belongs to."],
        [
          "This chat is no longer connected to OneUptime. Add the OneUptime app to the chat in Microsoft Teams, click Refresh Chats, and try again.",
        ],
        [
          "Could not send the test notification to #alerts. channel_not_found; not_in_channel",
        ],
      ])(
        "a BadDataException from the service answers 400 with exactly its message: %s",
        async (message: string) => {
          sendTestSpy.mockRejectedValue(new BadDataException(message));

          const { response } = await invokeRoute({ route });

          expect(sendTestSpy).toHaveBeenCalledTimes(1);
          expect(response.statusCalls).toEqual([400]);
          expect(response.sendCalls).toHaveLength(1);
          expect(response.body).toEqual({ message: message });
        },
      );

      test("a NotAuthorizedException from the service answers with its own status (422) and message", async () => {
        sendTestSpy.mockRejectedValue(
          new NotAuthorizedException("This chat belongs to another project."),
        );

        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).toEqual([422]);
        expect(response.body).toEqual({
          message: "This chat belongs to another project.",
        });
      });

      test("a NotAuthenticatedException from the service answers 401", async () => {
        sendTestSpy.mockRejectedValue(
          new NotAuthenticatedException("Session expired."),
        );

        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).toEqual([401]);
        expect(response.body).toEqual({ message: "Session expired." });
      });

      test("an unexpected Error from the service answers 500 with its message instead of crashing the request", async () => {
        sendTestSpy.mockRejectedValue(new Error("boom"));

        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).toEqual([500]);
        expect(response.sendCalls).toHaveLength(1);
        expect(response.body).toEqual({ message: "boom" });
      });

      test("a failed send is never reported as success", async () => {
        sendTestSpy.mockRejectedValue(
          new BadDataException(
            "OneUptime could not send the test notification. Please reconnect from Project Settings and try again.",
          ),
        );

        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).not.toContain(200);
        expect(response.body).not.toEqual({});
      });

      test("an exception whose code is not an HTTP status is answered as 500", async () => {
        // APIException is 2: a code, but not an HTTP status.
        const odd: Exception = new Exception(ExceptionCode.APIException, "odd");

        sendTestSpy.mockRejectedValue(odd);

        const { response } = await invokeRoute({ route });

        expect(response.statusCalls).toEqual([500]);
        expect(response.body).toEqual({ message: "odd" });
      });
    });
  });

  describe("route isolation, spelled out per route", () => {
    const EVERYTHING: JSONObject = {
      teamId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      channelId: "19:0123456789abcdef0123456789abcdef@thread.tacv2",
      chatId: "19:3a9c1f0e5b7d4e2f8a6b0c1d2e3f4a5b@thread.v2",
    };

    test("the Microsoft Teams channel route never forwards chatId", async () => {
      const props: DatabaseCommonInteractionProps = ownerProps();
      mockProps(props);

      await invokeRoute({ route: TEAMS_CHANNEL_ROUTE, body: EVERYTHING });

      expect(sendTestSpy).toHaveBeenCalledTimes(1);

      const args: SendTestArgs = sendTestSpy.mock.calls[0]![0] as SendTestArgs;
      expect(args).toStrictEqual({
        projectId: props.tenantId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        testByUserId: props.userId,
        teamId: EVERYTHING["teamId"],
        channelId: EVERYTHING["channelId"],
      });
      expect(Object.prototype.hasOwnProperty.call(args, "chatId")).toBe(false);
    });

    test("the Microsoft Teams channel route sends a body holding only a chatId as a channel test with no destination", async () => {
      const props: DatabaseCommonInteractionProps = ownerProps();
      mockProps(props);

      await invokeRoute({
        route: TEAMS_CHANNEL_ROUTE,
        body: { chatId: EVERYTHING["chatId"] },
      });

      /*
       * The chat must not be reachable through the channel route: the service
       * sees an empty channel and refuses, rather than posting to the chat.
       */
      expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual({
        projectId: props.tenantId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        testByUserId: props.userId,
        teamId: "",
        channelId: "",
      });
    });

    test("the Microsoft Teams chat route never forwards channelId or teamId", async () => {
      const props: DatabaseCommonInteractionProps = ownerProps();
      mockProps(props);

      await invokeRoute({ route: TEAMS_CHAT_ROUTE, body: EVERYTHING });

      expect(sendTestSpy).toHaveBeenCalledTimes(1);

      const args: SendTestArgs = sendTestSpy.mock.calls[0]![0] as SendTestArgs;
      expect(args).toStrictEqual({
        projectId: props.tenantId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        testByUserId: props.userId,
        chatId: EVERYTHING["chatId"],
      });
      expect(Object.prototype.hasOwnProperty.call(args, "channelId")).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(args, "teamId")).toBe(false);
    });

    test("the Microsoft Teams chat route sends a body holding only a channel as a chat test with no destination", async () => {
      const props: DatabaseCommonInteractionProps = ownerProps();
      mockProps(props);

      await invokeRoute({
        route: TEAMS_CHAT_ROUTE,
        body: {
          teamId: EVERYTHING["teamId"],
          channelId: EVERYTHING["channelId"],
        },
      });

      expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual({
        projectId: props.tenantId,
        workspaceType: WorkspaceType.MicrosoftTeams,
        testByUserId: props.userId,
        chatId: "",
      });
    });

    test("the Slack channel route never forwards chatId or teamId, and always says Slack", async () => {
      const props: DatabaseCommonInteractionProps = ownerProps();
      mockProps(props);

      await invokeRoute({
        route: SLACK_CHANNEL_ROUTE,
        body: { ...EVERYTHING, channelId: "C0123456789" },
      });

      expect(sendTestSpy).toHaveBeenCalledTimes(1);

      const args: SendTestArgs = sendTestSpy.mock.calls[0]![0] as SendTestArgs;
      expect(args).toStrictEqual({
        projectId: props.tenantId,
        workspaceType: WorkspaceType.Slack,
        testByUserId: props.userId,
        channelId: "C0123456789",
      });
      expect(Object.prototype.hasOwnProperty.call(args, "chatId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(args, "teamId")).toBe(false);
    });

    test("the two Microsoft Teams routes always say MicrosoftTeams and the Slack route always says Slack", async () => {
      mockProps(ownerProps());

      await invokeRoute({ route: TEAMS_CHANNEL_ROUTE });
      await invokeRoute({ route: TEAMS_CHAT_ROUTE });
      await invokeRoute({ route: SLACK_CHANNEL_ROUTE });

      const workspaceTypes: Array<WorkspaceType> = sendTestSpy.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as SendTestArgs).workspaceType;
        },
      );

      expect(workspaceTypes).toEqual([
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Slack,
      ]);
    });
  });
});

interface HttpProbeResult {
  status: number;
  body: unknown;
}

type HttpRequestJsonFunction = (data: {
  port: number;
  method: string;
  path: string;
  headers: http.OutgoingHttpHeaders;
  body?: JSONObject | undefined;
}) => Promise<HttpProbeResult>;

/*
 * The jest environment here is jsdom, which has no global fetch, so the probe
 * talks to the server with Node's http client.
 */
const httpRequestJson: HttpRequestJsonFunction = (data: {
  port: number;
  method: string;
  path: string;
  headers: http.OutgoingHttpHeaders;
  body?: JSONObject | undefined;
}): Promise<HttpProbeResult> => {
  return new Promise<HttpProbeResult>(
    (
      resolve: (result: HttpProbeResult) => void,
      reject: (error: Error) => void,
    ) => {
      const payload: string | undefined =
        data.body === undefined ? undefined : JSON.stringify(data.body);

      const headers: http.OutgoingHttpHeaders = { ...data.headers };

      if (payload !== undefined) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload).toString();
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers: headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");

            let parsed: unknown = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = raw;
            }

            resolve({
              status: response.statusCode || 0,
              body: parsed,
            });
          });
        },
      );

      request.on("error", (error: Error) => {
        return reject(error);
      });

      if (payload !== undefined) {
        request.write(payload);
      }

      request.end();
    },
  );
};

type WithServerFunction = (
  router: ExpressRouter,
  run: (port: number) => Promise<void>,
) => Promise<void>;

/*
 * Mounts the router the way the app does (under /api, JSON bodies parsed) and
 * always closes the server, even when an assertion fails - a leaked listener
 * keeps the event loop alive and hangs the whole jest run at exit.
 */
const withServer: WithServerFunction = async (
  router: ExpressRouter,
  run: (port: number) => Promise<void>,
): Promise<void> => {
  const app: express.Express = express();
  app.use(express.json());
  app.use("/api", router);

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        return resolve();
      });
    });
  }
};

describe("Send Test routes over real HTTP", () => {
  let sendTestSpy: jest.SpyInstance;
  let teamsRouterForHttp: ExpressRouter;
  let slackRouterForHttp: ExpressRouter;

  const TENANT_ID: string = "6f4e4b2c-1111-4c2a-9e3d-abcdefabcdef";

  beforeAll(() => {
    teamsRouterForHttp = new MicrosoftTeamsAPI().getRouter();
    slackRouterForHttp = new SlackAPI().getRouter();
  }, 600000);

  beforeEach(() => {
    sendTestSpy = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "sendTestNotificationToDestination",
      )
      .mockResolvedValue(SAMPLE_THREAD);

    /*
     * getUserMiddleware fires ProjectService.updateLastActive for any request
     * with a tenant header; keep it off the database.
     */
    jest.spyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type GetHttpRouterFunction = (route: RouteSpec) => ExpressRouter;

  const getHttpRouter: GetHttpRouterFunction = (
    route: RouteSpec,
  ): ExpressRouter => {
    return route.api === "Slack" ? slackRouterForHttp : teamsRouterForHttp;
  };

  test.each(ALL_ROUTES)(
    "%s with only a tenantid header (no credentials) answers 401 and sends nothing",
    async (_label: string, route: RouteSpec) => {
      // Calls through: the real props are built from what the middleware set.
      const propsSpy: jest.SpyInstance = jest.spyOn(
        CommonAPI,
        "getDatabaseCommonInteractionProps",
      );

      await withServer(getHttpRouter(route), async (port: number) => {
        const result: HttpProbeResult = await httpRequestJson({
          port: port,
          method: "POST",
          path: `/api${route.path}`,
          headers: { tenantid: TENANT_ID },
          body: route.validBody,
        });

        /*
         * Pinned to exactly 401: a request with only a tenantid header is what
         * a signed-in user's browser sends once the access-token cookie has
         * expired, and the dashboard refreshes the session and resends on a
         * 401 and on nothing else.
         */
        expect(result.status).toBe(401);
        expect((result.body as { message?: string }).message).toBe(
          CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
        );
      });

      // The request reached this route's handler, and it stopped there.
      expect(propsSpy).toHaveBeenCalledTimes(1);
      expect(sendTestSpy).not.toHaveBeenCalled();
    },
    60000,
  );

  test.each(ALL_ROUTES)(
    "%s with no headers at all answers 401 and sends nothing",
    async (_label: string, route: RouteSpec) => {
      await withServer(getHttpRouter(route), async (port: number) => {
        const result: HttpProbeResult = await httpRequestJson({
          port: port,
          method: "POST",
          path: `/api${route.path}`,
          headers: {},
          body: route.validBody,
        });

        expect(result.status).toBe(401);
      });

      expect(sendTestSpy).not.toHaveBeenCalled();
    },
    60000,
  );

  test.each(ALL_ROUTES)(
    "%s is dispatched to its own handler through the real middleware, and forwards the JSON body",
    async (_label: string, route: RouteSpec) => {
      const projectId: ObjectID = new ObjectID(TENANT_ID);
      const userId: ObjectID = ObjectID.generate();

      const props: DatabaseCommonInteractionProps = buildMemberProps({
        projectId: projectId,
        userId: userId,
        permissions: [Permission.ProjectMember],
      });

      /*
       * Identity is stubbed at the props layer (minting a real access token
       * needs the signing secret); routing, the real getUserMiddleware, body
       * parsing and the handler are all real.
       */
      const propsSpy: jest.SpyInstance = jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props);

      await withServer(getHttpRouter(route), async (port: number) => {
        const result: HttpProbeResult = await httpRequestJson({
          port: port,
          method: "POST",
          path: `/api${route.path}`,
          headers: { tenantid: TENANT_ID },
          body: {
            ...route.validBody,
            projectId: ObjectID.generate().toString(),
          },
        });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({});
      });

      // getUserMiddleware ran first: it put the header's tenant on the request.
      expect(propsSpy).toHaveBeenCalledTimes(1);
      const reachedReq: OneUptimeRequest = propsSpy.mock
        .calls[0]![0] as OneUptimeRequest;
      expect(reachedReq.tenantId?.toString()).toBe(TENANT_ID);
      expect(reachedReq.userType).toBe(UserType.Public);

      expect(sendTestSpy).toHaveBeenCalledTimes(1);
      expect(sendTestSpy.mock.calls[0]![0]).toStrictEqual(
        expectedArgs({ route, props, body: route.validBody }),
      );
    },
    60000,
  );

  test.each(ALL_ROUTES)(
    "%s refuses a ProjectMember whose team blocks CreateWorkspaceNotificationRule with 422 and sends nothing",
    async (_label: string, route: RouteSpec) => {
      const props: DatabaseCommonInteractionProps = buildMemberProps({
        projectId: new ObjectID(TENANT_ID),
        userId: ObjectID.generate(),
        permissions: [Permission.ProjectMember],
        blockedPermissions: [Permission.CreateWorkspaceNotificationRule],
      });

      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(props);

      await withServer(getHttpRouter(route), async (port: number) => {
        const result: HttpProbeResult = await httpRequestJson({
          port: port,
          method: "POST",
          path: `/api${route.path}`,
          headers: { tenantid: TENANT_ID },
          body: route.validBody,
        });

        expect(result.status).toBe(422);
        expect(result.body).toEqual({
          message: blockedMessage(Permission.CreateWorkspaceNotificationRule),
        });
      });

      expect(sendTestSpy).not.toHaveBeenCalled();
    },
    60000,
  );
});
