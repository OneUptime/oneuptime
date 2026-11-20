import SecurityEventConnectionAPI from "../../../Server/API/SecurityEventConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import DataSourceHttpFetch from "../../../Server/Utils/DataSource/HttpFetch";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import { SecurityConnectorSettings } from "../../../Server/Utils/SecurityEvent/Connectors/Types";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ConnectorFieldChoicesReport } from "../../../Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import CloudflareFakeApi, {
  ACCOUNT_ID,
  FakeRequest,
  TOKEN,
  ZONE_A,
} from "../Utils/SecurityEvent/Connectors/Cloudflare/CloudflareFakeApi";
import { countRefusals, withoutRefusals } from "./RouteRefusals";
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
 * POST /security-event-connection/field-choices, the route a connection
 * form reads the product's own choices from (a Cloudflare token's accounts
 * and zones), through the real route and the real Cloudflare connector,
 * with only the network faked (CloudflareFakeApi behind the transport):
 * who may call it, for each role; that a refused caller reaches neither the
 * stored credentials nor Cloudflare; that a saved connection is read with
 * its stored token, or the token the form holds over it; that an unsaved
 * form needs its token but not yet its account; and that nothing comes
 * back but the choices.
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

const FIELD_CHOICES_ROUTE: string = "/security-event-connection/field-choices";
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ROTATED_TOKEN: string = "Rotated7Lq2Vx9Tb4Zw6Hy1Jm8Pd3Sg5Ua_-Kk0Oo";
const STORED_SETTINGS: SecurityConnectorSettings = {
  provider: SecurityEventConnectorProvider.Cloudflare,
  config: { accountId: ACCOUNT_ID },
  secrets: { apiToken: TOKEN },
  alertingOnly: false,
};

let handler: Handler;
let props: DatabaseCommonInteractionProps;
let api: CloudflareFakeApi;
let next: jest.Mock<NextFunction>;
const res: ExpressResponse = {} as ExpressResponse;

function setPermission(permission: Permission, blocked: boolean = false): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: [
        {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: blocked,
        },
      ],
    },
  };
}

function request(body: JSONObject): ExpressRequest {
  return { params: {}, body } as unknown as ExpressRequest;
}

const UNSAVED_FORM: JSONObject = {
  provider: SecurityEventConnectorProvider.Cloudflare,
  config: {},
  secrets: { apiToken: TOKEN },
};

function sentReport(): ConnectorFieldChoicesReport {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls;

  expect(calls).toHaveLength(1);

  return calls[0]![2] as ConnectorFieldChoicesReport;
}

function authorizationsSent(): Array<string> {
  return api.requests.map((sent: FakeRequest): string => {
    return sent.headers["Authorization"] || "";
  });
}

beforeAll(() => {
  new SecurityEventConnectionAPI();
  handler = recordedRoutes
    .find((route: { uri: string }): boolean => {
      return route.uri === FIELD_CHOICES_ROUTE;
    })!
    .handlers.slice(-1)[0]!;
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermission(Permission.SecurityAdmin);
  next = jest.fn<NextFunction>();
  api = new CloudflareFakeApi([
    {
      id: ZONE_A,
      name: "example.com",
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

  const loaded: SecurityEventConnection = new SecurityEventConnection();
  loaded.id = CONNECTION;
  loaded.projectId = PROJECT;
  loaded.provider = SecurityEventConnectorProvider.Cloudflare;
  loaded.config = STORED_SETTINGS.config;
  loaded.secrets = JSON.stringify(STORED_SETTINGS.secrets);
  jest
    .spyOn(SecurityEventConnectionService, "findOneById")
    .mockResolvedValue(loaded);
  jest
    .spyOn(SecurityEventConnectionService, "getConnectorSettings")
    .mockResolvedValue(STORED_SETTINGS);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /security-event-connection/field-choices - registration", () => {
  test("resolves the user and requires authentication, and is refused while Security Events is off", () => {
    const route: { uri: string; handlers: Array<Handler> } =
      recordedRoutes.find((candidate: { uri: string }): boolean => {
        return candidate.uri === FIELD_CHOICES_ROUTE;
      })!;

    expect(route.handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(withoutRefusals(route.handlers)).toHaveLength(3);
    expect(countRefusals(route.handlers)).toBe(1);
  });
});

describe("POST /security-event-connection/field-choices - who may read the product's choices", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])(
    "%s gets the accounts and zones the token reads",
    async (permission: Permission) => {
      setPermission(permission);

      await handler(request(UNSAVED_FORM), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(sentReport()).toEqual({
        provider: SecurityEventConnectorProvider.Cloudflare,
        choices: {
          accountId: [{ value: ACCOUNT_ID, label: "Acme Corp" }],
          zoneIds: [
            {
              value: ZONE_A,
              label: "example.com",
              description: "Pro",
              parentValue: ACCOUNT_ID,
            },
          ],
        },
      });
    },
  );

  test.each([
    Permission.SecurityMember,
    Permission.SecurityViewer,
    Permission.ProjectMember,
    Permission.Public,
  ])(
    "%s is refused before the stored credentials or Cloudflare are reached",
    async (permission: Permission) => {
      setPermission(permission);

      await handler(
        request({ connectionId: CONNECTION.toString(), secrets: {} }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(SecurityEventConnectionService.findOneBy).not.toHaveBeenCalled();
      expect(
        SecurityEventConnectionService.getConnectorSettings,
      ).not.toHaveBeenCalled();
      expect(api.requests).toHaveLength(0);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
  ])("a blocked %s is no grant", async (permission: Permission) => {
    setPermission(permission, true);

    await handler(request(UNSAVED_FORM), res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(api.requests).toHaveLength(0);
  });

  test.each(["anonymous", "missing tenant", "not a member"])(
    "%s is refused before anything is read",
    async (reason: string) => {
      if (reason === "anonymous") {
        props.userId = undefined;
      }

      if (reason === "missing tenant") {
        props.tenantId = undefined;
      }

      if (reason === "not a member") {
        props.userTenantAccessPermission = {};
      }

      await handler(request(UNSAVED_FORM), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(api.requests).toHaveLength(0);
    },
  );
});

describe("POST /security-event-connection/field-choices - the settings it reads with", () => {
  test("an unsaved form needs its token, not yet its account", async () => {
    await handler(request(UNSAVED_FORM), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(authorizationsSent()).toEqual([`Bearer ${TOKEN}`]);
  });

  test("an unsaved form without its token is told so, and Cloudflare is not asked", async () => {
    await handler(request({ ...UNSAVED_FORM, secrets: {} }), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "API token is required for Cloudflare.",
      }),
    );
    expect(api.requests).toHaveLength(0);
  });

  test("a saved connection is read with its stored token, scoped to the caller's project", async () => {
    await handler(
      request({ connectionId: CONNECTION.toString(), secrets: {} }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(SecurityEventConnectionService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: CONNECTION.toString(), projectId: PROJECT },
      }),
    );
    expect(authorizationsSent()).toEqual([`Bearer ${TOKEN}`]);
    // The stored token is used, never sent back.
    expect(JSON.stringify(sentReport())).not.toContain(TOKEN);
  });

  test("a saved connection with a new token on the form is read with the new one", async () => {
    api.acceptedToken = ROTATED_TOKEN;

    await handler(
      request({
        connectionId: CONNECTION.toString(),
        secrets: { apiToken: ROTATED_TOKEN },
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(authorizationsSent()).toEqual([`Bearer ${ROTATED_TOKEN}`]);
  });

  test("another project's connection is refused", async () => {
    (SecurityEventConnectionService.findOneBy as jest.Mock).mockResolvedValue(
      null as never,
    );

    await handler(
      request({ connectionId: CONNECTION.toString(), secrets: {} }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(api.requests).toHaveLength(0);
  });

  test("a provider whose settings are all typed has no choices to read", async () => {
    await handler(
      request({
        provider: SecurityEventConnectorProvider.OktaSystemLog,
        config: { orgUrl: "https://acme.okta.com" },
        secrets: { apiToken: "00Zx9QkLm3VpR7tWyB2nHc5JdF8gS4aE6uK1oP0iNv" },
      }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Okta System Log has no settings to choose from its own lists.",
      }),
    );
  });

  test("a token Cloudflare refuses is said in words a person can act on", async () => {
    api.acceptedToken = "a-token-cloudflare-would-accept-0123456789";

    await handler(request(UNSAVED_FORM), res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Cloudflare did not accept the API token. Check that you pasted the whole token and that it is still active.",
      }),
    );
  });

  test("a setting the provider does not have is refused", async () => {
    await handler(
      request({ ...UNSAVED_FORM, config: { region: "us" } }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Configuration contains an unknown setting "region" for Cloudflare.',
      }),
    );
    expect(api.requests).toHaveLength(0);
  });
});
