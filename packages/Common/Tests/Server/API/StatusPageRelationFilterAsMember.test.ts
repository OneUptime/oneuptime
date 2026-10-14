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
 * The Twilio auth token and the SMTP password of a project's settings can
 * be reached from the records that name the settings - a status page, an
 * incoming call policy, one of its phone numbers - and not only from the
 * settings' own routes. A caller who may read those records but not the
 * credential could ask for it through the relation:
 *
 *   - select it: { callSmsConfig: { twilioAuthToken: true } }
 *   - filter by it: { callSmsConfig: { twilioAuthToken: ... } }
 *
 * The select is refused to every request (the token is not marked
 * canReadOnRelationQuery), and the filter is refused to a caller who may
 * not read the related column. Every request below is the one a client
 * sends - operators serialized as {_type, value} - made through BaseAPI's
 * routes with the caller's real props and the whole permission layer; the
 * refusal comes before anything is read, so the tables are held in memory.
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
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const CONFIG_ID: string = "33333333-3333-4333-8333-333333333333";
const POLICY_ID: string = "44444444-4444-4444-8444-444444444444";

let props: DatabaseCommonInteractionProps;
let statusPages: InMemoryTable;
let policies: InMemoryTable;

const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function post(
  route: string,
  body: JSONObject,
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: {},
    query: { skip: "0", limit: "10" },
    headers: {},
    // What a client sends: operators as {_type, value}.
    body: JSON.parse(JSON.stringify(JSONFunctions.serialize(body))),
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("POST", route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new BaseAPI(StatusPage, StatusPageService);
  new BaseAPI(IncomingCallPolicy, IncomingCallPolicyService);
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});
  statusPages = useInMemoryTable(StatusPageService, [
    {
      _id: STATUS_PAGE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Status",
      slug: "status",
      callSmsConfigId: CONFIG_ID,
      version: 1,
    },
  ]);
  policies = useInMemoryTable(IncomingCallPolicyService, [
    {
      _id: POLICY_ID,
      projectId: PROJECT_ID.toString(),
      name: "Support line",
      projectCallSMSConfigId: CONFIG_ID,
      version: 1,
    },
  ]);
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

const STATUS_PAGE_READERS: Array<[string, Array<Permission>]> = [
  ["a viewer", [Permission.Viewer]],
  ["a project member", [Permission.ProjectMember]],
  ["a status page viewer", [Permission.StatusPageViewer]],
  ["a status page admin", [Permission.StatusPageAdmin]],
];

describe.each(STATUS_PAGE_READERS)(
  "%s reading status pages",
  (_who: string, permissions: Array<Permission>) => {
    beforeEach(() => {
      props = caller(permissions);
    });

    test("may not filter them by their Twilio config's auth token", async () => {
      const { error } = await post("/status-page/get-list", {
        query: { callSmsConfig: { twilioAuthToken: new StartsWith("0") } },
        select: { name: true },
      });

      expect(error).toBeDefined();
      expect(error!.message).toContain(
        "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through callSmsConfig.",
      );
      // Refused before anything was read.
      expect(statusPages.repository.find).not.toHaveBeenCalled();
      expect(sendEntityArrayResponseMock).not.toHaveBeenCalled();
    });

    test("may not count them by it either", async () => {
      const { error } = await post("/status-page/count", {
        query: { callSmsConfig: { twilioAuthToken: new StartsWith("0") } },
      });

      expect(error).toBeDefined();
      expect(error!.message).toContain(
        "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through callSmsConfig.",
      );
      expect(statusPages.repository.count).not.toHaveBeenCalled();
    });

    test("may not filter them by their SMTP config's password", async () => {
      const { error } = await post("/status-page/get-list", {
        query: { smtpConfig: { password: new StartsWith("s") } },
        select: { name: true },
      });

      expect(error).toBeDefined();
      expect(error!.message).toContain(
        "You do not have permissions to query on - password of SMTP Config through smtpConfig.",
      );
      expect(statusPages.repository.find).not.toHaveBeenCalled();
    });

    test("may not select the auth token through the page", async () => {
      const { error } = await post("/status-page/get-list", {
        query: {},
        select: { name: true, callSmsConfig: { twilioAuthToken: true } },
      });

      expect(error).toBeDefined();
      expect(error!.message).toBe(
        "Column twilioAuthToken on Call and SMS Config does not support read on relation query.",
      );
      expect(statusPages.repository.find).not.toHaveBeenCalled();
    });
  },
);

test("not even a project owner selects the auth token through a status page: it is read from the settings' own routes", async () => {
  props = caller([Permission.ProjectOwner]);

  const { error } = await post("/status-page/get-list", {
    query: {},
    select: { name: true, callSmsConfig: { twilioAuthToken: true } },
  });

  expect(error).toBeDefined();
  expect(error!.message).toBe(
    "Column twilioAuthToken on Call and SMS Config does not support read on relation query.",
  );
});

describe("reading incoming call policies", () => {
  test.each([
    ["a project member", [Permission.ProjectMember]],
    ["a viewer", [Permission.Viewer]],
    ["a settings viewer", [Permission.SettingsViewer]],
    [
      "a holder of Read Incoming Call Policy",
      [Permission.ReadProjectIncomingCallPolicy],
    ],
  ])(
    "%s may neither filter by nor select the config's auth token",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const filtered: { error: Error | undefined } = await post(
        "/incoming-call-policy/get-list",
        {
          query: {
            projectCallSMSConfig: { twilioAuthToken: new StartsWith("0") },
          },
          select: { name: true },
        },
      );
      expect(filtered.error).toBeDefined();
      expect(filtered.error!.message).toContain(
        "You do not have permissions to query on - twilioAuthToken of Call and SMS Config through projectCallSMSConfig.",
      );

      const selected: { error: Error | undefined } = await post(
        "/incoming-call-policy/get-list",
        {
          query: {},
          select: {
            name: true,
            projectCallSMSConfig: { twilioAuthToken: true },
          },
        },
      );
      expect(selected.error).toBeDefined();
      expect(selected.error!.message).toBe(
        "Column twilioAuthToken on Call and SMS Config does not support read on relation query.",
      );

      expect(policies.repository.find).not.toHaveBeenCalled();
    },
  );
});
