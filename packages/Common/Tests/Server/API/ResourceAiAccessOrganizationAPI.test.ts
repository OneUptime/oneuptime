import CommonAPI from "../../../Server/API/CommonAPI";
import CloudAccountService from "../../../Server/Services/CloudAccountService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import CloudOrganizationAgents from "../../../Server/Utils/CloudConnection/CloudOrganizationAgents";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import {
  getCloudAiAgentKeyEditRefusal,
  getCloudAiAgentKeyRefusal,
} from "../../../Types/AI/ResourceAiAccessPermissions";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CloudAiAgentKeyResponse } from "../../../Types/CloudConnection/CloudAiAgentKey";
import {
  CLOUD_ORGANIZATION_MAX_ACCOUNTS,
  CloudOrganizationKeys,
  CloudOrganizationView,
  NOT_AN_ORGANIZATION,
  RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
  RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
} from "../../../Types/CloudConnection/CloudOrganizationAgents";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Common/Server/API/ResourceAiAccessAPI.ts - the two routes behind "Every
 * account of the organization" in Let AI fix problems on an AWS account:
 *
 *   POST /resource-ai-access/organization
 *     the organization the account is in, read for anyone who may read the
 *     account, with the caller's own props (CloudOrganizationAgents.getView);
 *     any other cloud's account reads as no organization;
 *   POST /resource-ai-access/organization-agent-keys
 *     a key for each account's agent - made exactly as one account's is
 *     (CloudAccountService.makeAiAgentKey), for the same people: one of the
 *     admin permissions, and edit of the account the dialog is on, then of
 *     each account; one the caller may not edit is named with why, and gets
 *     no key. At most CLOUD_ORGANIZATION_MAX_ACCOUNTS, in order.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

const registerRoute: (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, jest.Mock> => {
        return mockRouter;
      },
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

const sendJsonObjectResponseMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
// The account the dialog is on.
const RESOURCE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-2222-4222-8222-222222222222",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MANAGEMENT: string = "111111111111";

const CLOUD_MANAGEMENT: ObjectID = new ObjectID(
  "aaaaaaaa-1111-4111-8111-111111111111",
);
const CLOUD_B: ObjectID = new ObjectID("cccccccc-3333-4333-8333-333333333333");

function cloudAccount(
  id: ObjectID,
  accountId: string,
  name: string,
): CloudAccount {
  const row: CloudAccount = new CloudAccount();
  row.id = id;
  row.accountId = accountId;
  row.name = name;
  return row;
}

const ORGANIZATION_ACCOUNTS: Array<CloudAccount> = [
  cloudAccount(CLOUD_MANAGEMENT, MANAGEMENT, "Management"),
  cloudAccount(RESOURCE_ID, "222222222222", "Payments"),
  cloudAccount(CLOUD_B, "333333333333", "Sandbox"),
];

function userProps(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      ...data.permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission;
      }),
      ...(data.blocked || []).map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: true,
        } as UserPermission;
      }),
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
}

interface RouteCallResult {
  thrownToNext: unknown;
}

async function callRoute(
  uri: string,
  body: JSONObject,
): Promise<RouteCallResult> {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    { params: {}, query: {}, body, headers: {} } as unknown as ExpressRequest,
    {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

function lastAnswer(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock
    .calls as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![2] as JSONObject;
}

function body(
  resourceType: AiResourceType = AiResourceType.AwsAccount,
): JSONObject {
  return { resourceType, resourceId: RESOURCE_ID.toString() };
}

function keyFor(cloudAccountId: ObjectID): string {
  return `ouca_${cloudAccountId.toString()}_${"a".repeat(64)}`;
}

const VIEW: CloudOrganizationView = {
  isOrganization: true,
  managementAccountId: MANAGEMENT,
  accounts: [
    {
      cloudAccountId: CLOUD_MANAGEMENT.toString(),
      accountId: MANAGEMENT,
      name: "Management",
      isManagementAccount: true,
      agent: "connected",
      lastSeenAt: "2026-11-06T11:59:00.000Z",
    },
  ],
  isTruncated: false,
};

describe("ResourceAiAccessAPI: an AWS Organization's agents", () => {
  let propsSpy: jest.SpyInstance;
  let findAccountSpy: jest.SpyInstance;
  let viewSpy: jest.SpyInstance;
  let organizationSpy: jest.SpyInstance;
  let accountsSpy: jest.SpyInstance;
  let changeSpy: jest.SpyInstance;
  let makeKeySpy: jest.SpyInstance;
  // The accounts the caller may not edit.
  let notEditable: Set<string>;

  beforeAll(async () => {
    await import("../../../Server/API/ResourceAiAccessAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    notEditable = new Set<string>();

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(userProps({ permissions: [Permission.ProjectAdmin] }));
    findAccountSpy = jest
      .spyOn(CloudAccountService, "findOneBy")
      .mockResolvedValue({
        id: RESOURCE_ID,
        _id: RESOURCE_ID.toString(),
        projectId: PROJECT_ID,
        name: "Payments",
      } as never);
    viewSpy = jest
      .spyOn(CloudOrganizationAgents, "getView")
      .mockResolvedValue(VIEW);
    organizationSpy = jest
      .spyOn(CloudOrganizationAgents, "findOrganization")
      .mockResolvedValue({
        connectionId: CONNECTION_ID,
        managementAccountId: MANAGEMENT,
      });
    accountsSpy = jest
      .spyOn(CloudOrganizationAgents, "findAccounts")
      .mockResolvedValue(ORGANIZATION_ACCOUNTS);
    changeSpy = jest
      .spyOn(ResourceAiAccessService, "assertCallerMayChangeResource")
      .mockImplementation(async (data: unknown): Promise<void> => {
        const id: string = String(
          (data as { resourceId: ObjectID }).resourceId,
        );

        if (notEditable.has(id)) {
          throw new NotAuthorizedException("not yours");
        }
      });
    makeKeySpy = jest
      .spyOn(CloudAccountService, "makeAiAgentKey")
      .mockImplementation(
        async (data: {
          cloudAccountId: ObjectID;
        }): Promise<CloudAiAgentKeyResponse> => {
          return {
            agentKey: keyFor(data.cloudAccountId),
            worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
          };
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("both routes are registered behind the user middleware", () => {
    for (const uri of [
      RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
      RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
    ]) {
      const route: MockRoute | undefined = mockRoutes.find(
        (candidate: MockRoute): boolean => {
          return candidate.uri === uri;
        },
      );

      expect(route?.method).toBe("POST");
      expect(route?.middleware).toBeDefined();
    }
  });

  describe("POST /organization", () => {
    test("answers the organization the account is in, read with the caller's own props", async () => {
      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(lastAnswer()).toEqual(VIEW);

      const call: Record<string, unknown> = viewSpy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;

      expect(String(call["cloudAccountId"])).toBe(RESOURCE_ID.toString());
      expect(call["projectId"]).toEqual(PROJECT_ID);
      expect((call["props"] as DatabaseCommonInteractionProps).userId).toEqual(
        USER_ID,
      );
      expect(call["now"]).toBeInstanceOf(Date);
    });

    test("for anyone who may read the account: no admin permission needed", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectMember] }),
      );

      await callRoute(RESOURCE_AI_ACCESS_ORGANIZATION_PATH, body());

      expect(lastAnswer()).toEqual(VIEW);
    });

    test.each([
      [AiResourceType.AzureSubscription],
      [AiResourceType.GoogleCloudProject],
    ])(
      "%s: no organization, and nothing read",
      async (resourceType: AiResourceType) => {
        await callRoute(
          RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
          body(resourceType),
        );

        expect(lastAnswer()).toEqual(NOT_AN_ORGANIZATION);
        expect(viewSpy).not.toHaveBeenCalled();
      },
    );

    test("an account the caller may not read is answered as missing", async () => {
      findAccountSpy.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(viewSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /organization-agent-keys", () => {
    test("a key for each account, each made as its own dialog makes it, in order", async () => {
      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeUndefined();

      const answer: CloudOrganizationKeys =
        lastAnswer() as unknown as CloudOrganizationKeys;

      expect(answer).toEqual({
        managementAccountId: MANAGEMENT,
        keys: ORGANIZATION_ACCOUNTS.map((account: CloudAccount) => {
          return {
            cloudAccountId: account.id!.toString(),
            accountId: account.accountId,
            name: account.name,
            agentKey: keyFor(account.id!),
            worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
          };
        }),
        skipped: [],
      });

      // Every key is the account's own: made for it, by this person, at one moment.
      const made: Array<Record<string, unknown>> = makeKeySpy.mock.calls.map(
        (call: Array<unknown>): Record<string, unknown> => {
          return call[0] as Record<string, unknown>;
        },
      );

      expect(
        made.map((call: Record<string, unknown>): string => {
          return String(call["cloudAccountId"]);
        }),
      ).toEqual(
        ORGANIZATION_ACCOUNTS.map((account: CloudAccount): string => {
          return account.id!.toString();
        }),
      );
      for (const call of made) {
        expect(call["userId"]).toEqual(USER_ID);
        expect(call["now"]).toBe(made[0]!["now"]);
        // Who made it, for each account's audit log (issue #6302).
        expect(
          (call["props"] as DatabaseCommonInteractionProps).userId,
        ).toEqual(USER_ID);
      }

      // The accounts are the caller's own read, of the organization's connection.
      const accountsCall: Record<string, unknown> = accountsSpy.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(accountsCall["connectionId"]).toEqual(CONNECTION_ID);
      expect(
        (accountsCall["props"] as DatabaseCommonInteractionProps).userId,
      ).toEqual(USER_ID);
    });

    test("each account is checked for itself: one the caller may not edit is named with why, and gets no key", async () => {
      notEditable.add(CLOUD_B.toString());

      await callRoute(RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH, body());

      const answer: CloudOrganizationKeys =
        lastAnswer() as unknown as CloudOrganizationKeys;

      expect(
        answer.keys.map((key: { cloudAccountId: string }): string => {
          return key.cloudAccountId;
        }),
      ).toEqual([CLOUD_MANAGEMENT.toString(), RESOURCE_ID.toString()]);
      expect(answer.skipped).toEqual([
        {
          cloudAccountId: CLOUD_B.toString(),
          accountId: "333333333333",
          name: "Sandbox",
          reason: getCloudAiAgentKeyEditRefusal(AiResourceType.AwsAccount),
        },
      ]);
      expect(
        makeKeySpy.mock.calls.map((call: Array<unknown>): string => {
          return String(
            (call[0] as { cloudAccountId: ObjectID }).cloudAccountId,
          );
        }),
      ).not.toContain(CLOUD_B.toString());

      // Every account's own check ran, with the caller's own props.
      expect(
        changeSpy.mock.calls.map((call: Array<unknown>): string => {
          return String((call[0] as { resourceId: ObjectID }).resourceId);
        }),
      ).toEqual([
        RESOURCE_ID.toString(),
        CLOUD_MANAGEMENT.toString(),
        RESOURCE_ID.toString(),
        CLOUD_B.toString(),
      ]);
    });

    test.each([
      [Permission.ProjectMember],
      [Permission.EditCloudResource],
      [Permission.ReadCloudResource],
      [Permission.SettingsAdmin],
    ])(
      "refuses %s, before the organization is even read",
      async (role: Permission) => {
        propsSpy.mockResolvedValue(userProps({ permissions: [role] }));

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
          body(),
        );

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          getCloudAiAgentKeyRefusal(AiResourceType.AwsAccount),
        );
        expect(organizationSpy).not.toHaveBeenCalled();
        expect(makeKeySpy).not.toHaveBeenCalled();
      },
    );

    test("a block row is not a grant", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [Permission.ProjectAdmin],
          blocked: [Permission.ProjectAdmin],
        }),
      );

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(makeKeySpy).not.toHaveBeenCalled();
    });

    test("an admin who may not edit the account the dialog is on gets no key at all", async () => {
      notEditable.add(RESOURCE_ID.toString());

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe(
        getCloudAiAgentKeyEditRefusal(AiResourceType.AwsAccount),
      );
      expect(makeKeySpy).not.toHaveBeenCalled();
    });

    test("an account outside any organization: said, and no key made", async () => {
      organizationSpy.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        "This AWS account's cloud connection reads this account alone, not an AWS Organization, so its agent is set up on its own.",
      );
      expect(makeKeySpy).not.toHaveBeenCalled();
    });

    test("another cloud's account: said, and no key made", async () => {
      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(AiResourceType.AzureSubscription),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        "Only an AWS account's Cloud AI agent is set up in every account of an organization at once.",
      );
      expect(organizationSpy).not.toHaveBeenCalled();
      expect(makeKeySpy).not.toHaveBeenCalled();
    });

    test("a master admin may", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [], isMasterAdmin: true }),
      );

      await callRoute(RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH, body());

      expect(makeKeySpy).toHaveBeenCalledTimes(ORGANIZATION_ACCOUNTS.length);
    });

    test("an error other than a refusal is not taken for one", async () => {
      changeSpy.mockImplementation(async (data: unknown): Promise<void> => {
        if (
          String((data as { resourceId: ObjectID }).resourceId) ===
          CLOUD_B.toString()
        ) {
          throw new Error("the database went away");
        }
      });

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect((result.thrownToNext as Error).message).toBe(
        "the database went away",
      );
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    });

    test(`at most ${CLOUD_ORGANIZATION_MAX_ACCOUNTS} accounts, rows without an account id left out, a few at a time`, async () => {
      const many: Array<CloudAccount> = [
        cloudAccount(ObjectID.generate(), "", "No id"),
      ];

      for (
        let index: number = 0;
        index <= CLOUD_ORGANIZATION_MAX_ACCOUNTS;
        index++
      ) {
        many.push(
          cloudAccount(ObjectID.generate(), String(100000000000 + index), ""),
        );
      }

      accountsSpy.mockResolvedValue(many);

      let inFlight: number = 0;
      let most: number = 0;

      makeKeySpy.mockImplementation(
        async (data: {
          cloudAccountId: ObjectID;
        }): Promise<CloudAiAgentKeyResponse> => {
          inFlight++;
          most = Math.max(most, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 0);
          });
          inFlight--;

          return {
            agentKey: keyFor(data.cloudAccountId),
            worksUntilConnectedBy: "2026-11-07T12:00:00.000Z",
          };
        },
      );

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH,
        body(),
      );

      expect(result.thrownToNext).toBeUndefined();

      const answer: CloudOrganizationKeys =
        lastAnswer() as unknown as CloudOrganizationKeys;

      expect(answer.keys).toHaveLength(CLOUD_ORGANIZATION_MAX_ACCOUNTS);
      expect(answer.keys[0]!.accountId).toBe("100000000000");
      expect(answer.keys[answer.keys.length - 1]!.accountId).toBe(
        String(100000000000 + CLOUD_ORGANIZATION_MAX_ACCOUNTS - 1),
      );
      // Several at once, never all at once.
      expect(most).toBeGreaterThan(1);
      expect(most).toBeLessThanOrEqual(8);
    });
  });
});
