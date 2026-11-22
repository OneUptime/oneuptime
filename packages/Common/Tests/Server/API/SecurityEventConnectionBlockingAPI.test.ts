import SecurityEventConnectionAPI, {
  BLOCKING_ACTIONS,
  BLOCKING_REFUSED_MESSAGE,
} from "../../../Server/API/SecurityEventConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import DataSourceHttpFetch from "../../../Server/Utils/DataSource/HttpFetch";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import SecurityBlocklistJobs from "../../../Server/Utils/SecurityBlocklist/SecurityBlocklistJobs";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import CloudflareBlockingFakeApi from "../Utils/SecurityEvent/Connectors/Cloudflare/CloudflareBlockingFakeApi";
import {
  ACCOUNT_ID,
  FakeRequest,
  TOKEN,
  ZONE_A,
  ZONE_B,
  restError,
} from "../Utils/SecurityEvent/Connectors/Cloudflare/CloudflareFakeApi";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /security-event-connection/:connectionId/blocking/:action, the one
 * way blocking at Cloudflare is turned on and off (#10343), through the real
 * route and the real Cloudflare client, with only the network faked
 * (CloudflareBlockingFakeApi) and the connection held behind its service:
 * who may call it, for each role, refused before the stored credentials or
 * Cloudflare are reached; the opt-in - on only when every write permission
 * checks out, the token pasted saved with the connection, and nothing
 * changed when a check fails; off, with the question answered; Put It Back;
 * and what each body may say.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const BLOCKING_ROUTE: string =
  "/security-event-connection/:connectionId/blocking/:action";
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PASTED_TOKEN: string = "Blocking7Lq2Vx9Tb4Zw6Hy1Jm8Pd3Sg5Ua_-Kk0Oo";
const NOW: Date = new Date("2026-11-21T10:42:00.000Z");

let handler: Handler;
let props: DatabaseCommonInteractionProps;
let api: CloudflareBlockingFakeApi;
let next: NextFunction;
let loaded: SecurityEventConnection;
let updates: Array<{ data: JSONObject; props: DatabaseCommonInteractionProps }>;
let reconciles: Array<string>;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  };
}

async function call(action: string, body: JSONObject = {}): Promise<void> {
  await handler(
    {
      params: { connectionId: CONNECTION.toString(), action },
      body,
    } as unknown as ExpressRequest,
    res,
    next,
  );
}

function sent(): JSONObject | null {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls;

  return calls.length ? (calls[0]![2] as JSONObject) : null;
}

function refusal(): string | null {
  const calls: Array<Array<unknown>> = (next as unknown as jest.Mock).mock
    .calls;

  return calls.length ? (calls[0]![0] as Error).message : null;
}

function checkStatuses(answer: JSONObject | null): Array<string> {
  return ((answer?.["checks"] || []) as Array<JSONObject>).map(
    (check: JSONObject): string => {
      return `${check["key"]}:${check["status"]}`;
    },
  );
}

function settingsWritten(): Array<JSONObject> {
  return updates
    .filter((update: { data: JSONObject }): boolean => {
      return update.data["blockingSettings"] !== undefined;
    })
    .map((update: { data: JSONObject }): JSONObject => {
      return update.data["blockingSettings"] as JSONObject;
    });
}

beforeAll(() => {
  new SecurityEventConnectionAPI();
  handler = recordedRoutes
    .find((route: { uri: string }): boolean => {
      return route.uri === BLOCKING_ROUTE;
    })!
    .handlers.slice(-1)[0]!;
});

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.SecurityAdmin);
  next = jest.fn() as unknown as NextFunction;
  updates = [];
  reconciles = [];

  api = new CloudflareBlockingFakeApi([
    {
      id: ZONE_A,
      name: "example.com",
      plan: { name: "Pro Website", legacy_id: "pro" },
    },
    {
      id: ZONE_B,
      name: "shop.example.com",
      plan: { name: "Pro Website", legacy_id: "pro" },
    },
  ]);
  jest.spyOn(DataSourceHttpFetch, "fetch").mockImplementation(api.transport());
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  const accessible: SecurityEventConnection = new SecurityEventConnection();
  accessible.id = CONNECTION;
  accessible.projectId = PROJECT;
  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockResolvedValue(accessible);

  loaded = new SecurityEventConnection();
  loaded.id = CONNECTION;
  loaded.projectId = PROJECT;
  loaded.name = "Production Cloudflare";
  loaded.provider = SecurityEventConnectorProvider.Cloudflare;
  loaded.config = { accountId: ACCOUNT_ID };
  loaded.secrets = JSON.stringify({ apiToken: TOKEN });
  loaded.alertingOnly = true;
  jest
    .spyOn(SecurityEventConnectionService, "findOneById")
    .mockImplementation(async () => {
      return loaded;
    });
  jest
    .spyOn(SecurityEventConnectionService, "updateOneById")
    .mockImplementation((async (args: unknown): Promise<void> => {
      updates.push(
        args as { data: JSONObject; props: DatabaseCommonInteractionProps },
      );
    }) as never);
  jest
    .spyOn(SecurityBlocklistJobs, "queueReconcile")
    .mockImplementation(async (projectId: ObjectID): Promise<void> => {
      reconciles.push(projectId.toString());
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("registration", () => {
  test("resolves the user, requires authentication, and is refused while Security Events is off", () => {
    const route: { uri: string; handlers: Array<Handler> } =
      recordedRoutes.find((candidate: { uri: string }): boolean => {
        return candidate.uri === BLOCKING_ROUTE;
      })!;

    expect(route.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(route.handlers).toHaveLength(4);
    expect(BLOCKING_ACTIONS).toEqual([
      "check",
      "turn-on",
      "turn-off",
      "put-back",
    ]);
  });
});

describe("who may", () => {
  test.each([
    ["Project Owner", Permission.ProjectOwner],
    ["Project Admin", Permission.ProjectAdmin],
    ["Security Admin", Permission.SecurityAdmin],
  ])(
    "a %s checks and turns blocking on",
    async (_who: string, permission: Permission) => {
      setPermission(permission);

      await call("turn-on");

      expect(refusal()).toBeNull();
      expect(sent()?.["isOn"]).toBe(true);
    },
  );

  test.each([
    ["Security Member", Permission.SecurityMember],
    ["Security Viewer", Permission.SecurityViewer],
    ["Project Member", Permission.ProjectMember],
  ])(
    "a %s is refused before the stored credentials or Cloudflare are reached",
    async (_who: string, permission: Permission) => {
      setPermission(permission);

      for (const action of BLOCKING_ACTIONS) {
        (next as unknown as jest.Mock).mockClear();
        await call(action, { removeFromCloudflare: true });
        expect(refusal()).toBe(BLOCKING_REFUSED_MESSAGE);
      }

      expect(api.requests).toEqual([]);
      expect(SecurityEventConnectionService.findOneById).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    },
  );

  test("another project's connection is refused", async () => {
    (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
      null as never,
    );

    await call("turn-on");

    expect(refusal()).not.toBeNull();
    expect(api.requests).toEqual([]);
    expect(updates).toEqual([]);
  });

  test("a connection of another provider has no blocking", async () => {
    loaded.provider = SecurityEventConnectorProvider.OktaSystemLog;

    await call("check");

    expect(refusal()).toBe(
      "Blocking addresses is available on Cloudflare connections only.",
    );
  });

  test("an action the route does not have is refused", async () => {
    await call("delete-everything");

    expect(refusal()).toBe(
      'Blocking has no "delete-everything": choose check, turn-on, turn-off or put-back.',
    );
  });
});

describe("check: how blocking would be set up, and whether the token may write it", () => {
  test("answers the checks, and changes nothing in Cloudflare or OneUptime", async () => {
    await call("check", { zoneIds: [ZONE_A] });

    expect(refusal()).toBeNull();
    expect(sent()?.["isReady"]).toBe(true);
    expect(checkStatuses(sent())).toEqual([
      "blocking-setup:pass",
      "blocking-lists:pass",
      "blocking-rules:pass",
    ]);
    expect(api.lists).toEqual([]);
    expect(api.rulesets.size).toBe(0);
    expect(updates).toEqual([]);
    expect(reconciles).toEqual([]);
  });

  test("with a token pasted, checks that token, not the stored one", async () => {
    api.acceptedToken = PASTED_TOKEN;

    await call("check", { secrets: { apiToken: PASTED_TOKEN } });

    expect(sent()?.["isReady"]).toBe(true);
    expect(
      new Set(
        api.requests.map((request: FakeRequest): string => {
          return request.headers["Authorization"] || "";
        }),
      ),
    ).toEqual(new Set([`Bearer ${PASTED_TOKEN}`]));
  });
});

describe("turn-on: the opt-in", () => {
  test("turns blocking on in every zone the connection reads, asks OneUptime to set it up, and queues the project's blocklist at once", async () => {
    await call("turn-on");

    expect(sent()).toEqual(expect.objectContaining({ isOn: true }));
    expect(settingsWritten()).toEqual([
      {
        isEnabled: true,
        zoneIds: [],
        turnedOnAt: NOW.toISOString(),
        setupRequestedAt: NOW.toISOString(),
      },
    ]);
    // Written as OneUptime: no plain update writes the column.
    expect(updates[0]?.props).toEqual({ isRoot: true });
    expect(reconciles).toEqual([PROJECT.toString()]);
    // Set up by the reconciler, not by the request.
    expect(api.lists).toEqual([]);
  });

  test("in the zones chosen, each once", async () => {
    await call("turn-on", { zoneIds: [ZONE_B, ZONE_B.toUpperCase()] });

    expect(settingsWritten()[0]?.["zoneIds"]).toEqual([ZONE_B]);
  });

  test("a token pasted is saved with the connection, through its own update with the caller's props", async () => {
    api.acceptedToken = PASTED_TOKEN;

    await call("turn-on", { secrets: { apiToken: PASTED_TOKEN } });

    expect(sent()?.["isOn"]).toBe(true);
    expect(updates[0]).toEqual({
      id: CONNECTION,
      data: { secrets: JSON.stringify({ apiToken: PASTED_TOKEN }) },
      props,
    });
    expect(settingsWritten()).toHaveLength(1);
  });

  test("a check that fails turns nothing on, saves no token, and says which permission is missing", async () => {
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" && request.path.endsWith("/rules/lists")
        );
      },
      response: restError(403, 10000, "Authentication error"),
      times: 1,
    });

    await call("turn-on", { secrets: { apiToken: TOKEN } });

    expect(sent()?.["isOn"]).toBe(false);
    expect(checkStatuses(sent())).toContain("blocking-lists:fail");
    expect(updates).toEqual([]);
    expect(reconciles).toEqual([]);
  });

  test("a check that cannot tell turns nothing on either: OneUptime fails toward a person", async () => {
    api.script({
      matches: (request: FakeRequest): boolean => {
        return (
          request.method === "POST" && request.path.endsWith("/rules/lists")
        );
      },
      response: restError(503, 1, "Service Unavailable"),
      times: 1,
    });

    await call("turn-on");

    expect(sent()?.["isOn"]).toBe(false);
    expect(checkStatuses(sent())).toContain("blocking-lists:warn");
    expect(updates).toEqual([]);
  });

  test("turned on again, it keeps when it was first turned on, and sets the new zones up", async () => {
    loaded.blockingSettings = {
      isEnabled: true,
      zoneIds: [],
      turnedOnAt: "2026-11-01T09:00:00.000Z",
      setupRequestedAt: "2026-11-01T09:00:00.000Z",
    };

    await call("turn-on", { zoneIds: [ZONE_A] });

    expect(settingsWritten()).toEqual([
      {
        isEnabled: true,
        zoneIds: [ZONE_A],
        turnedOnAt: "2026-11-01T09:00:00.000Z",
        setupRequestedAt: NOW.toISOString(),
      },
    ]);
  });

  test("a zone that is no Cloudflare zone id is refused", async () => {
    await call("turn-on", { zoneIds: ["example.com"] });

    expect(refusal()).toBe(
      "Each zone must be a Cloudflare zone ID: 32 letters and digits.",
    );
    expect(updates).toEqual([]);
  });
});

describe("turn-off, with the question answered", () => {
  beforeEach(() => {
    loaded.blockingSettings = {
      isEnabled: true,
      zoneIds: [ZONE_A],
      turnedOnAt: "2026-11-01T09:00:00.000Z",
      setupRequestedAt: "2026-11-01T09:00:00.000Z",
    };
  });

  test("removing OneUptime's lists and rules: asked of the reconciler, queued at once", async () => {
    await call("turn-off", { removeFromCloudflare: true });

    expect(sent()).toEqual({ isOn: false });
    expect(settingsWritten()).toEqual([
      {
        isEnabled: false,
        zoneIds: [ZONE_A],
        removalRequestedAt: NOW.toISOString(),
      },
    ]);
    expect(reconciles).toEqual([PROJECT.toString()]);
    // Nothing is removed by the request itself.
    expect(api.requests).toEqual([]);
  });

  test("keeping them: off, and nothing asked of Cloudflare", async () => {
    await call("turn-off", { removeFromCloudflare: false });

    expect(settingsWritten()).toEqual([
      { isEnabled: false, zoneIds: [ZONE_A] },
    ]);
  });

  test("the question must be answered", async () => {
    await call("turn-off", {});

    expect(refusal()).toBe(
      "Say whether OneUptime removes its lists and rules from Cloudflare: removeFromCloudflare must be true or false.",
    );
    expect(updates).toEqual([]);
  });
});

describe("put-back", () => {
  test("asks OneUptime to set up again what changed at Cloudflare, in the zone named", async () => {
    loaded.blockingSettings = {
      isEnabled: true,
      zoneIds: [],
      turnedOnAt: "2026-11-01T09:00:00.000Z",
      setupRequestedAt: "2026-11-01T09:00:00.000Z",
    };

    await call("put-back", { zoneIds: [ZONE_A] });

    expect(sent()).toEqual({ isOn: true });
    expect(settingsWritten()).toEqual([
      {
        isEnabled: true,
        zoneIds: [],
        turnedOnAt: "2026-11-01T09:00:00.000Z",
        setupRequestedAt: NOW.toISOString(),
        setupZoneIds: [ZONE_A],
      },
    ]);
    expect(reconciles).toEqual([PROJECT.toString()]);
  });

  test("is refused while blocking is off", async () => {
    await call("put-back");

    expect(refusal()).toBe(
      "Blocking at Cloudflare is off for this connection. Turn it on to set it up.",
    );
  });
});
