import {
  buildRequest,
  buildResponse,
  RouteHandler,
} from "App/Tests/FeatureSet/Identity/IdentityRouterTestUtil";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  EmailAddressChangedBy,
} from "Common/Types/Accounts/EmailAddressChangedEmail";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";
import statusPageScimRouter from "../../../Server/Identity/API/StatusPageSCIM";

/*
 * A STATUS PAGE'S IDENTITY PROVIDER NAMES ITSELF WHEN IT MOVES A PRIVATE
 * USER TO A NEW ADDRESS (#10156).
 *
 * The address a private user leaves is emailed that it changed, and by whom,
 * by role (StatusPagePrivateUserService.onUpdateSuccess,
 * Types/StatusPage/PrivateUserEmailAddressChangedEmail): the status page's
 * team, or its identity provider through SCIM. SCIM writes as root, so it
 * says it is the identity provider in the write's miscDataProps, as account
 * SCIM does (#9907) - otherwise the email would name nobody.
 *
 * Both of status page SCIM's writes of an address: a user's PUT and PATCH,
 * and the same in a Bulk request. A push of the address the user already
 * has writes nothing, so nothing is told.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    ...jest.requireActual("Common/Server/Utils/Express"),
    __esModule: true,
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): JSONObject => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserFindOneById: jest.Mock = jest.fn();
const privateUserUpdate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return privateUserFindOneById(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return privateUserUpdate(...args);
      },
    },
  };
});

jest.mock("../../../Server/Identity/Middleware/SCIMAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedSCIMRequest: jest.fn() },
  };
});

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn(),
  };
});

const sendJson: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJson(...args);
      },
    },
  };
});

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PAGE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SCIM_ID: string = "44444444-4444-4444-8444-444444444444";
const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";
const USERS_ROUTE: string = "/status-page-scim/v2/:statusPageScimId/Users";
const BULK_ROUTE: string = "/status-page-scim/v2/:statusPageScimId/Bulk";

const makeUser: (email: string) => unknown = (email: string) => {
  return {
    id: USER_ID,
    email: new Email(email),
    statusPageId: PAGE_ID,
    projectId: PROJECT_ID,
  };
};

interface RegisteredRoute {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
}

const invoke: (
  method: string,
  route: string,
  body: JSONObject,
) => Promise<jest.Mock> = async (
  method: string,
  route: string,
  body: JSONObject,
): Promise<jest.Mock> => {
  const req: ExpressRequest = buildRequest(body);
  req.params = {
    statusPageId: PAGE_ID.toString(),
    statusPageScimId: SCIM_ID,
    userId: USER_ID.toString(),
  };
  req.query = {};
  req.method = method.toUpperCase();
  (req as OneUptimeRequest).bearerTokenData = {
    statusPageId: PAGE_ID,
    projectId: PROJECT_ID,
    scimConfig: { autoProvisionUsers: true, autoDeprovisionUsers: true },
  };
  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();
  // Express exposes route.methods at runtime but omits it from IRoute's type.
  const registeredRoutes: Array<RegisteredRoute> = [
    ...statusPageScimRouter.stack,
  ] as unknown as Array<RegisteredRoute>;
  const registeredRoute: RegisteredRoute | undefined = registeredRoutes.find(
    (layer: RegisteredRoute) => {
      return layer.route?.path === route && layer.route.methods[method];
    },
  );
  const handlers: Array<{ handle: RouteHandler }> =
    registeredRoute!.route!.stack;
  await handlers[handlers.length - 1]!.handle(req, res, next);
  return next;
};

const IDENTITY_PROVIDER: JSONObject = {
  [EMAIL_ADDRESS_CHANGED_BY_KEY]: EmailAddressChangedBy.IdentityProvider,
};

describe("status page SCIM names the identity provider on a new address", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    privateUserFindOneBy.mockResolvedValue(makeUser(OLD_EMAIL));
    privateUserFindOneById.mockResolvedValue(makeUser(NEW_EMAIL));
    privateUserUpdate.mockResolvedValue(undefined);
  });

  it.each(["put", "patch"])(
    "a user's %s: the write of the new address says it is the identity provider's, as root",
    async (method: string) => {
      const next: jest.Mock = await invoke(method, `${USERS_ROUTE}/:userId`, {
        userName: NEW_EMAIL,
        active: true,
      });

      expect(next).not.toHaveBeenCalled();
      expect(privateUserUpdate).toHaveBeenCalledTimes(1);
      expect(privateUserUpdate).toHaveBeenCalledWith({
        id: USER_ID,
        data: { email: new Email(NEW_EMAIL) },
        miscDataProps: IDENTITY_PROVIDER,
        props: { isRoot: true },
      });
    },
  );

  it.each(["PUT", "PATCH"])("a Bulk %s: the same", async (method: string) => {
    const next: jest.Mock = await invoke("post", BULK_ROUTE, {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
      Operations: [
        {
          method: method,
          path: `/Users/${USER_ID}`,
          data: { userName: NEW_EMAIL },
        },
      ],
    });

    expect(next).not.toHaveBeenCalled();
    expect(privateUserUpdate).toHaveBeenCalledTimes(1);
    expect(privateUserUpdate).toHaveBeenCalledWith({
      id: USER_ID,
      data: { email: new Email(NEW_EMAIL) },
      miscDataProps: IDENTITY_PROVIDER,
      props: { isRoot: true },
    });
  });

  it("a push of the address the user already has writes nothing, so tells nothing", async () => {
    privateUserFindOneBy.mockResolvedValue(makeUser(NEW_EMAIL));

    const next: jest.Mock = await invoke("put", `${USERS_ROUTE}/:userId`, {
      userName: NEW_EMAIL,
      active: true,
    });

    expect(next).not.toHaveBeenCalled();
    expect(privateUserUpdate).not.toHaveBeenCalled();
  });
});
