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
 * WHAT ONEUPTIME PROTECTS BY ITSELF, THROUGH ITS ROUTE (#10338):
 *
 *   POST /security-protected-entity/automatic
 *
 * Read by whoever may read Protected Entities - Project Owner, Project
 * Admin and the three Security roles - and by nobody else, with the reader's
 * own permissions: the addresses are read as the caller reads them, so a
 * kind of record they may not read comes back unread, never by its names.
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
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityProtectedEntityAPI, {
  AUTOMATIC_PROTECTIONS_REFUSED_MESSAGE,
  AUTOMATIC_PROTECTIONS_ROUTE,
} from "../../../Server/API/SecurityProtectedEntityAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityProtectedAddresses from "../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityProtectedAddressSource } from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { customDomainCaller } from "./CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "6d1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f01",
);

const READERS: Array<[string, Permission]> = [
  ["Project Owner", Permission.ProjectOwner],
  ["Project Admin", Permission.ProjectAdmin],
  ["Security Admin", Permission.SecurityAdmin],
  ["Security Member", Permission.SecurityMember],
  ["Security Viewer", Permission.SecurityViewer],
];

let props: DatabaseCommonInteractionProps;
let list: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(permission: Permission): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: [permission], projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

async function read(): Promise<{
  answer: JSONObject | null;
  refusal: Exception | null;
}> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("post", AUTOMATIC_PROTECTIONS_ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    answer: sendJsonObjectResponseMock.mock.calls[0]
      ? (sendJsonObjectResponseMock.mock.calls[0][2] as JSONObject)
      : null,
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityProtectedEntityAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  list = jest
    .spyOn(SecurityProtectedAddresses, "listAutomaticProtections")
    .mockResolvedValue([
      {
        source: SecurityProtectedAddressSource.Host,
        protections: [
          {
            source: SecurityProtectedAddressSource.Host,
            protectedValue: "203.0.113.10",
            name: "web-3",
          },
        ],
        hasMore: false,
        isRead: true,
      },
      {
        source: SecurityProtectedAddressSource.CloudResource,
        protections: [
          {
            source: SecurityProtectedAddressSource.CloudResource,
            protectedValue: "35.205.11.0/24",
            name: "prod-lb",
            kind: "Load Balancer",
            where: "us-east-1",
          },
        ],
        hasMore: true,
        isRead: true,
      },
      // A kind the reader may not read: protected all the same, not listed.
      {
        source: SecurityProtectedAddressSource.AddressName,
        protections: [],
        hasMore: false,
        isRead: false,
      },
    ]) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /security-protected-entity/automatic", () => {
  test.each(READERS)(
    "a %s reads what OneUptime protects, read as they read it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { answer, refusal } = await read();

      expect(refusal).toBeNull();
      expect(list).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledWith({ projectId: PROJECT_ID, props });
      expect(answer).toEqual({
        groups: [
          {
            source: SecurityProtectedAddressSource.Host,
            hasMore: false,
            isRead: true,
            protections: [{ protectedValue: "203.0.113.10", name: "web-3" }],
          },
          {
            source: SecurityProtectedAddressSource.CloudResource,
            hasMore: true,
            isRead: true,
            protections: [
              {
                protectedValue: "35.205.11.0/24",
                name: "prod-lb",
                kind: "Load Balancer",
                where: "us-east-1",
              },
            ],
          },
          {
            source: SecurityProtectedAddressSource.AddressName,
            hasMore: false,
            isRead: false,
            protections: [],
          },
        ],
      });
    },
  );

  test.each([
    ["Project Member", Permission.ProjectMember],
    ["Project Viewer", Permission.Viewer],
  ])(
    "a %s, who may not read Protected Entities, reads nothing of it",
    async (_who: string, permission: Permission) => {
      props = caller(permission);

      const { answer, refusal } = await read();

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(AUTOMATIC_PROTECTIONS_REFUSED_MESSAGE);
      expect(answer).toBeNull();
      expect(list).not.toHaveBeenCalled();
    },
  );

  test("a request that names no project is refused before anything is read", async () => {
    props = { ...caller(Permission.ProjectOwner), tenantId: undefined };

    const { answer, refusal } = await read();

    expect(refusal?.message).toBe("Project ID is required");
    expect(answer).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});
