import { mockRouter } from "./Helpers";
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
 * WHAT THIS FILE DEFENDS
 *
 * Who may read a project's Twilio auth token through the generic CRUD API,
 * end to end: the request the dashboard sends, the caller's real props,
 * BaseAPI's routes, ProjectCallSMSConfigService's hooks and the whole
 * permission layer - nothing of it stubbed but the table, which is held in
 * memory.
 *
 * The auth token is a password-equivalent credential: it alone, with the
 * account SID, sends calls and SMS on the customer's Twilio account. It is
 * read only by the roles that own a project's call and SMS settings - its
 * owners and admins and whoever is explicitly granted Read Call and SMS -
 * never by the broad read-only roles (a plain member, a viewer, the settings
 * roles) that may still see the rest of the config. The account SID, the
 * phone numbers, the name and the default flag stay readable by that wider
 * audience: the SID identifies the account but cannot authenticate without
 * the token, exactly as the SMTP username does beside its password.
 *
 * Every read below is a `get-list` and a `get-item` that selects the token,
 * made as each role, through BaseAPI and the real SelectPermission.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendFileResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectCallSMSConfigService, {
  Service as ProjectCallSMSConfigServiceType,
} from "../../../Server/Services/ProjectCallSMSConfigService";
import ColumnRefusalMessage from "../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONFIG_ID: string = "33333333-3333-4333-8333-333333333333";
const SID: string = "AC0123456789abcdef0123456789abcde";
const TOKEN: string = "0123456789abcdef0123456789abcdef";

// Who may read the token: owners, admins, and the explicit Read Call and SMS.
const TOKEN_READERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["someone granted Read Call and SMS", [Permission.ReadProjectCallSMSConfig]],
  [
    "a viewer also granted Read Call and SMS",
    [Permission.Viewer, Permission.ReadProjectCallSMSConfig],
  ],
];

// Who may see a config but not its token.
const NOT_TOKEN_READERS: Array<[string, Array<Permission>]> = [
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
  ["a settings admin", [Permission.SettingsAdmin]],
  ["a settings member", [Permission.SettingsMember]],
  ["a settings viewer", [Permission.SettingsViewer]],
];

let props: DatabaseCommonInteractionProps;
let configs: InMemoryTable;

const sendEntityResponseMock: MockedFn =
  Response.sendEntityResponse as unknown as MockedFn;
const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function apiKey(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      isApiKey: true,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function storedConfig(): StoredRow {
  return {
    _id: CONFIG_ID,
    projectId: PROJECT_ID.toString(),
    name: "Production Twilio",
    slug: "production-twilio",
    twilioAccountSID: SID,
    twilioAuthToken: TOKEN,
    isProjectDefault: true,
    version: 1,
  };
}

async function callRoute(
  method: string,
  route: string,
  data: {
    body?: JSONObject;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

async function listSelecting(select: JSONObject): Promise<{
  error: Error | undefined;
  rows: Array<ProjectCallSMSConfig>;
}> {
  const { error } = await callRoute("POST", "/call-sms-config/get-list", {
    body: { query: {}, select },
    query: { skip: "0", limit: "10" },
  });
  const rows: Array<ProjectCallSMSConfig> =
    (sendEntityArrayResponseMock.mock
      .calls[0]?.[2] as Array<ProjectCallSMSConfig>) || [];
  return { error, rows };
}

async function getItemSelecting(select: JSONObject): Promise<{
  error: Error | undefined;
  item: ProjectCallSMSConfig | undefined;
}> {
  const { error } = await callRoute("POST", "/call-sms-config/:id/get-item", {
    params: { id: CONFIG_ID },
    body: { select },
  });
  const item: ProjectCallSMSConfig | undefined = sendEntityResponseMock.mock
    .calls[sendEntityResponseMock.mock.calls.length - 1]?.[2] as
    | ProjectCallSMSConfig
    | undefined;
  return { error, item };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new BaseAPI<ProjectCallSMSConfig, ProjectCallSMSConfigServiceType>(
    ProjectCallSMSConfig,
    ProjectCallSMSConfigService,
  );
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});
  configs = useInMemoryTable(ProjectCallSMSConfigService, [storedConfig()]);
  props = caller([Permission.ProjectOwner]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading the Twilio auth token through the CRUD API", () => {
  describe.each(TOKEN_READERS)(
    "%s reads the token",
    (_who: string, permissions: Array<Permission>) => {
      beforeEach(() => {
        props = caller(permissions);
      });

      test("get-list selecting the token succeeds and returns it", async () => {
        const { error, rows } = await listSelecting({
          name: true,
          twilioAuthToken: true,
        });
        expect(error).toBeUndefined();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.twilioAuthToken).toBe(TOKEN);
      });

      test("get-item selecting the token succeeds and returns it", async () => {
        const { error, item } = await getItemSelecting({
          name: true,
          twilioAuthToken: true,
        });
        expect(error).toBeUndefined();
        expect(item?.twilioAuthToken).toBe(TOKEN);
      });
    },
  );

  describe.each(NOT_TOKEN_READERS)(
    "%s may not read the token",
    (_who: string, permissions: Array<Permission>) => {
      beforeEach(() => {
        props = caller(permissions);
      });

      test("get-list selecting the token is refused, and the refusal names who may", async () => {
        const { error } = await listSelecting({ twilioAuthToken: true });
        expect(error).toBeDefined();
        expect(error!.message).toBe(
          ColumnRefusalMessage.getSelectRefusal({
            column: "twilioAuthToken",
            permissions: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ReadProjectCallSMSConfig,
            ],
          }),
        );
      });

      test("get-item selecting the token is refused", async () => {
        const { error } = await getItemSelecting({ twilioAuthToken: true });
        expect(error).toBeDefined();
        expect(error!.message).toContain(
          "do not have permissions to select on - twilioAuthToken",
        );
      });

      test("filtering by the token is refused too (no value oracle)", async () => {
        const { error } = await callRoute("POST", "/call-sms-config/get-list", {
          body: { query: { twilioAuthToken: TOKEN }, select: { name: true } },
          query: { skip: "0", limit: "10" },
        });
        expect(error).toBeDefined();
        expect(error!.message).toContain(
          "do not have permissions to query on - twilioAuthToken",
        );
      });

      test("the rest of the config still reads: name, SID, phone numbers, default", async () => {
        const { error, rows } = await listSelecting({
          name: true,
          twilioAccountSID: true,
          isProjectDefault: true,
        });
        expect(error).toBeUndefined();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.name).toBe("Production Twilio");
        expect(rows[0]!.twilioAccountSID).toBe(SID);
        expect(rows[0]!.isProjectDefault).toBe(true);
      });
    },
  );

  test("an API key holding only Viewer is refused the token, like the role it carries", async () => {
    props = apiKey([Permission.Viewer]);
    const { error } = await listSelecting({ twilioAuthToken: true });
    expect(error).toBeDefined();
    expect(error!.message).toContain(
      "do not have permissions to select on - twilioAuthToken",
    );
  });

  test("an API key granted Read Call and SMS reads the token", async () => {
    props = apiKey([Permission.ReadProjectCallSMSConfig]);
    const { error, rows } = await listSelecting({ twilioAuthToken: true });
    expect(error).toBeUndefined();
    expect(rows[0]!.twilioAuthToken).toBe(TOKEN);
  });

  test("a member of another project reads nothing of this project's config", async () => {
    props = {
      ...customDomainCaller({
        permissions: [Permission.ProjectOwner],
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      }),
      ...ON_HIGHEST_PLAN,
    };
    const { error, rows } = await listSelecting({
      name: true,
      twilioAuthToken: true,
    });
    // Another project's owner is scoped to their own project: no rows here.
    expect(error).toBeUndefined();
    expect(rows).toHaveLength(0);
    expect(configs.rows).toHaveLength(1);
  });
});
