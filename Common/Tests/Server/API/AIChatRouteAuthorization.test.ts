import { mockRouter } from "./Helpers";
import "../../../Server/API/AIChatAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIConversationService from "../../../Server/Services/AIConversationService";
import AIConversationMessageService from "../../../Server/Services/AIConversationMessageService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { beforeEach, describe, expect, it, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * GHSA-hm7m-9qjj-xj5x - "AI chat provider listing discloses another project's
 * provider inventory".
 *
 * Every /ai-chat/* route is a custom (non-CRUD) route mounted with nothing but
 * UserMiddleware.getUserMiddleware, and that middleware is not an authorisation
 * gate: it lets an unauthenticated request through as UserType.Public, and the
 * tenant id it attaches comes from the caller-supplied `tenantid` header before
 * any authorisation has run. The routes used to check only that props carried
 * SOME user id and SOME tenant id, and then read with `isRoot: true`.
 *
 * /ai-chat/providers was the reportable consequence: a user of project A could
 * send project B's UUID in that header and be handed B's LLM provider inventory
 * - ids, names, internal descriptions, provider types and model names - without
 * belonging to B at all.
 *
 * Two things are asserted here, and they are separate concerns:
 *
 *   1. MEMBERSHIP of the project named in the header (all five routes).
 *   2. PERMISSION to read that project's providers once inside it
 *      (/ai-chat/providers), because being a member is not the same as being
 *      allowed to read every model the project owns - a plain GET
 *      /llm-provider is gated by LlmProvider's own read list and the picker
 *      must not be a way around it.
 *
 * The refusals are also asserted to happen BEFORE any lookup runs. An endpoint
 * that rejects only after querying still leaks through timing, and it still
 * confirms that a project id exists.
 */

const PROJECT_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// The victim project. The attacker belongs to A and never to B.
const PROJECT_B_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const ATTACKER_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const CONVERSATION_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const MESSAGE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const PROVIDERS_ROUTE: string = "/ai-chat/providers";

type PropsOverrides = {
  userId?: ObjectID | undefined;
  tenantId?: ObjectID | undefined;

  // The project the caller actually belongs to, if any.
  memberOfProjectId?: ObjectID | undefined;

  // Permissions that membership grants inside memberOfProjectId.
  permissions?: Array<Permission> | undefined;

  // Permissions the caller's teams explicitly BLOCK inside that project.
  blockedPermissions?: Array<Permission> | undefined;

  userType?: UserType | undefined;
  isMasterAdmin?: boolean | undefined;
  userGlobalAccessPermission?: UserGlobalAccessPermission | undefined;
};

/*
 * Props shaped the way UserAuthorization actually builds them. That middleware
 * resolves the caller's tenant permissions for THE PROJECT IN THE HEADER and
 * keys the dictionary by that project alone, so a user reaching for a project
 * they do not belong to arrives with `userTenantAccessPermission` undefined -
 * which is the default here when no membership is given.
 */
function buildProps(
  overrides?: PropsOverrides,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = {
    userId: overrides?.userId,
    tenantId: overrides?.tenantId,
    userType: overrides?.userType,
    isMasterAdmin: overrides?.isMasterAdmin,
    userGlobalAccessPermission: overrides?.userGlobalAccessPermission,
  };

  if (overrides?.memberOfProjectId) {
    const permissions: Array<UserPermission> = (
      overrides.permissions || [Permission.ProjectMember]
    ).map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    });

    for (const blocked of overrides.blockedPermissions || []) {
      permissions.push({
        _type: "UserPermission",
        permission: blocked,
        labelIds: [],
        isBlockPermission: true,
      } as UserPermission);
    }

    const tenantPermission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: overrides.memberOfProjectId,
      permissions: permissions,
      isBlockPermission: false,
    } as UserTenantAccessPermission;

    const dictionary: Dictionary<UserTenantAccessPermission> = {};
    dictionary[overrides.memberOfProjectId.toString()] = tenantPermission;

    props.userTenantAccessPermission = dictionary;
  }

  return props;
}

// A legitimate member of project B with the default Member role.
function memberOfVictimProject(
  permissions?: Array<Permission>,
): DatabaseCommonInteractionProps {
  return buildProps({
    userId: ATTACKER_USER_ID,
    tenantId: PROJECT_B_ID,
    memberOfProjectId: PROJECT_B_ID,
    permissions: permissions,
  });
}

/*
 * The advisory's reproduction, in props: a real, logged-in user whose only
 * membership is project A, naming project B in the `tenantid` header.
 */
function outsiderReachingForVictimProject(): DatabaseCommonInteractionProps {
  return buildProps({
    userId: ATTACKER_USER_ID,
    tenantId: PROJECT_B_ID,
    memberOfProjectId: PROJECT_A_ID,
    permissions: [Permission.ProjectOwner],
  });
}

function requestFor(body?: JSONObject): ExpressRequest {
  return {
    body: body || {},
    headers: {},
    params: {},
    query: {},
  } as unknown as ExpressRequest;
}

function response(): ExpressResponse {
  return {} as ExpressResponse;
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callRoute(data: {
  uri: string;
  body?: JSONObject | undefined;
}): Promise<RouteCall> {
  const next: ReturnType<typeof jest.fn> = jest.fn();

  await mockRouter
    .match("post", data.uri)
    .handlerFunction(
      requestFor(data.body),
      response(),
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0]?.[0],
    nextCallCount: next.mock.calls.length,
  };
}

function callProviders(): Promise<RouteCall> {
  return callRoute({ uri: PROVIDERS_ROUTE });
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

// A provider row with the exact metadata the advisory says leaked.
function victimProvider(): LlmProvider {
  const provider: LlmProvider = new LlmProvider(PROVIDER_ID);
  provider.name = "acme-internal-gpt";
  provider.description = "Acme's private evaluation cluster";
  provider.llmType = LlmType.OpenAI;
  provider.modelName = "gpt-4o-secret-eval";
  provider.isDefault = true;
  provider.isGlobalLlm = false;
  provider.projectId = PROJECT_B_ID;
  return provider;
}

function stubProviderLookups(): void {
  jest
    .spyOn(LlmProviderService, "getSelectableProvidersForProject")
    .mockResolvedValue([victimProvider()]);
  jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(victimProvider());
}

function providerLookupsRan(): boolean {
  const selectable: jest.Mock =
    LlmProviderService.getSelectableProvidersForProject as unknown as jest.Mock;
  const forProject: jest.Mock =
    LlmProviderService.getLLMProviderForProject as unknown as jest.Mock;

  return selectable.mock.calls.length > 0 || forProject.mock.calls.length > 0;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  stubProviderLookups();
});

describe("POST /ai-chat/providers - cross-tenant disclosure (GHSA-hm7m-9qjj-xj5x)", () => {
  test("a user of project A cannot list project B's providers by sending B's tenantid", async () => {
    withProps(outsiderReachingForVictimProject());

    const call: RouteCall = await callRoute({ uri: PROVIDERS_ROUTE });

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("the refusal happens before any provider lookup runs, so nothing is queried for the victim project", async () => {
    withProps(outsiderReachingForVictimProject());

    await callProviders();

    expect(providerLookupsRan()).toBe(false);
    expect(
      LlmProviderService.getSelectableProvidersForProject,
    ).not.toHaveBeenCalled();
    expect(LlmProviderService.getLLMProviderForProject).not.toHaveBeenCalled();
  });

  test("none of the leaked metadata reaches the response body", async () => {
    withProps(outsiderReachingForVictimProject());

    await callProviders();

    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("the refusal does not distinguish a project that exists from one that does not", async () => {
    withProps(outsiderReachingForVictimProject());
    const realProject: RouteCall = await callProviders();

    jest.clearAllMocks();
    stubProviderLookups();

    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: new ObjectID("99999999-9999-4999-8999-999999999999"),
        memberOfProjectId: PROJECT_A_ID,
      }),
    );
    const madeUpProject: RouteCall = await callProviders();

    expect((madeUpProject.thrown as NotAuthorizedException).message).toBe(
      (realProject.thrown as NotAuthorizedException).message,
    );
  });

  test("holding every permission in the caller's OWN project grants nothing in the target project", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_A_ID,
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SettingsAdmin,
          Permission.ReadProjectLlm,
        ],
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });

  test("a tenant permission dictionary that is present but keyed for another project is refused", async () => {
    const props: DatabaseCommonInteractionProps = buildProps({
      userId: ATTACKER_USER_ID,
      tenantId: PROJECT_B_ID,
      memberOfProjectId: PROJECT_A_ID,
    });

    expect(props.userTenantAccessPermission).toBeDefined();
    expect(
      props.userTenantAccessPermission![PROJECT_B_ID.toString()],
    ).toBeUndefined();

    withProps(props);

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
  });

  test("global permissions cannot stand in for membership of the target project", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: PROJECT_B_ID,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [PROJECT_A_ID],
          globalPermissions: [Permission.Public, Permission.CurrentUser],
        } as UserGlobalAccessPermission,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });
});

describe("POST /ai-chat/providers - anonymous and unscoped callers", () => {
  test("an unauthenticated caller (getUserMiddleware admits these as public) is refused", async () => {
    withProps(buildProps({ tenantId: PROJECT_B_ID }));

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });

  test("an anonymous caller carrying a stray tenant permission entry but no user id is refused", async () => {
    withProps(
      buildProps({
        userId: undefined,
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_B_ID,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });

  test("a request with no tenantid header is a bad request, not an authorization failure", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        memberOfProjectId: PROJECT_A_ID,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as BadDataException).message).toBe(
      "Project ID is required",
    );
    expect(providerLookupsRan()).toBe(false);
  });

  test("a project API key (no user id) cannot use this route - it is a logged-in-member route", async () => {
    withProps(
      buildProps({
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_B_ID,
        userType: UserType.API,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });
});

describe("POST /ai-chat/providers - membership alone is not read authorization", () => {
  test("a member whose teams grant no provider-read permission is refused", async () => {
    withProps(memberOfVictimProject([Permission.ReadProjectIncident]));

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((call.thrown as NotAuthorizedException).message).toBe(
      "You do not have permission to read this project's AI providers.",
    );
    expect(providerLookupsRan()).toBe(false);
  });

  test("a member with no tenant permissions at all is refused", async () => {
    withProps(memberOfVictimProject([]));

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });

  test("Permission.Public in LlmProvider's read list does not admit an ordinary member", async () => {
    /*
     * LlmProvider declares Permission.Public as a reader so the shared global
     * providers stay visible, and getUserPermissions merges Public into EVERY
     * caller's permissions. A guard that intersected the two lists naively
     * would therefore pass for anyone at all - this is the regression test for
     * that specific mistake.
     */
    expect(new LlmProvider().getReadPermissions()).toContain(Permission.Public);

    withProps(memberOfVictimProject([Permission.ReadProjectIncident]));

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
  });

  test("Permission.CurrentUser, which every logged-in caller carries, does not admit them either", async () => {
    withProps(memberOfVictimProject([Permission.CurrentUser]));

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
  });

  test("a team's BLOCK row for a reader permission is not counted as a grant of it", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_B_ID,
        permissions: [Permission.ReadProjectIncident],
        blockedPermissions: [
          Permission.ProjectMember,
          Permission.ReadProjectLlm,
        ],
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });
});

describe("POST /ai-chat/providers - legitimate members still get their picker", () => {
  const readerPermissions: Array<Permission> = [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectLlm,
  ];

  test.each(readerPermissions)(
    "a member holding %s is served the provider list",
    async (permission: Permission) => {
      withProps(memberOfVictimProject([permission]));

      const call: RouteCall = await callProviders();

      expect(call.nextCallCount).toBe(0);
      expect(Response.sendJsonObjectResponse).toHaveBeenCalled();
      expect((sentPayload()["providers"] as Array<JSONObject>).length).toBe(1);
    },
  );

  test("every tenant-assignable reader of LlmProvider is covered by the cases above", () => {
    /*
     * Pins the positive cases to the model rather than to a copy of its list:
     * if LlmProvider gains a new reader role, this fails until the cases above
     * cover it too. The filter is the guard's own rule - only permissions a
     * team can actually grant inside a project count.
     */
    const tenantAssignable: Array<Permission> =
      PermissionHelper.getTenantPermissionProps().map(
        (permissionProps: PermissionProps) => {
          return permissionProps.permission;
        },
      );

    const tenantAssignableReaders: Array<Permission> = new LlmProvider()
      .getReadPermissions()
      .filter((permission: Permission) => {
        return tenantAssignable.includes(permission);
      });

    expect([...tenantAssignableReaders].sort()).toEqual(
      [...readerPermissions].sort(),
    );

    // ...and the guard's filter really does drop Public, which everyone holds.
    expect(tenantAssignableReaders).not.toContain(Permission.Public);
  });

  test("the lookup is made for the caller's own project, never for a header-supplied stranger", async () => {
    withProps(memberOfVictimProject());

    await callProviders();

    expect(
      LlmProviderService.getSelectableProvidersForProject,
    ).toHaveBeenCalledWith(PROJECT_B_ID);
    expect(LlmProviderService.getLLMProviderForProject).toHaveBeenCalledWith(
      PROJECT_B_ID,
    );
  });

  test("the response carries picker metadata and the default provider id", async () => {
    withProps(memberOfVictimProject());

    await callProviders();

    const payload: JSONObject = sentPayload();

    expect(payload["defaultProviderId"]).toBe(PROVIDER_ID.toString());

    const providers: Array<JSONObject> = payload[
      "providers"
    ] as Array<JSONObject>;

    expect(providers).toEqual([
      {
        id: PROVIDER_ID.toString(),
        name: "acme-internal-gpt",
        description: "Acme's private evaluation cluster",
        llmType: LlmType.OpenAI.toString(),
        modelName: "gpt-4o-secret-eval",
        isDefault: true,
        isGlobal: false,
      },
    ]);
  });

  test("secrets are never included in the response", async () => {
    withProps(memberOfVictimProject());

    await callProviders();

    const providers: Array<JSONObject> = sentPayload()[
      "providers"
    ] as Array<JSONObject>;

    for (const provider of providers) {
      expect(provider).not.toHaveProperty("apiKey");
      expect(provider).not.toHaveProperty("baseUrl");
      expect(provider).not.toHaveProperty("additionalParams");
    }
  });

  test("a master admin who is a member of the project is not blocked by the permission gate", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_B_ID,
        permissions: [Permission.ReadProjectIncident],
        isMasterAdmin: true,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.nextCallCount).toBe(0);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalled();
  });

  test("master admin does NOT bypass the membership check", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        tenantId: PROJECT_B_ID,
        memberOfProjectId: PROJECT_A_ID,
        isMasterAdmin: true,
      }),
    );

    const call: RouteCall = await callProviders();

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(providerLookupsRan()).toBe(false);
  });
});

/*
 * The other four /ai-chat/* routes shared the same "logged in somewhere +
 * a tenantid header" check. None of them disclosed another project's data the
 * way the provider listing did - their reads resolve under the caller's own
 * props - but each still handed the header's project id to root-privileged
 * work, so each is now gated on membership too. These cases lock that in.
 */
describe("every /ai-chat/* route requires membership of the project it was given", () => {
  const routes: Array<{ uri: string; body: JSONObject }> = [
    {
      uri: "/ai-chat/send-message",
      body: { content: "hello" },
    },
    {
      uri: "/ai-chat/respond-to-approval",
      body: {
        conversationId: CONVERSATION_ID.toString(),
        assistantMessageId: MESSAGE_ID.toString(),
        approved: true,
      },
    },
    {
      uri: "/ai-chat/cancel-run",
      body: { conversationId: CONVERSATION_ID.toString() },
    },
    {
      uri: "/ai-chat/message-feedback",
      body: { messageId: MESSAGE_ID.toString(), feedback: "Up" },
    },
    {
      uri: PROVIDERS_ROUTE,
      body: {},
    },
  ];

  beforeEach(() => {
    jest.spyOn(AIConversationService, "findOneById").mockResolvedValue(null);
    jest
      .spyOn(AIConversationMessageService, "findOneById")
      .mockResolvedValue(null);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
  });

  test.each(routes)(
    "$uri refuses a caller who belongs to another project",
    async (route: { uri: string; body: JSONObject }) => {
      withProps(outsiderReachingForVictimProject());

      const call: RouteCall = await callRoute({
        uri: route.uri,
        body: route.body,
      });

      expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test.each(routes)(
    "$uri refuses an unauthenticated caller",
    async (route: { uri: string; body: JSONObject }) => {
      withProps(buildProps({ tenantId: PROJECT_B_ID }));

      const call: RouteCall = await callRoute({
        uri: route.uri,
        body: route.body,
      });

      expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(routes)(
    "$uri refuses before it touches the database",
    async (route: { uri: string; body: JSONObject }) => {
      withProps(outsiderReachingForVictimProject());

      await callRoute({ uri: route.uri, body: route.body });

      expect(AIConversationService.findOneById).not.toHaveBeenCalled();
      expect(AIConversationMessageService.findOneById).not.toHaveBeenCalled();
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
      expect(providerLookupsRan()).toBe(false);
    },
  );

  test.each(routes)(
    "$uri is mounted behind UserMiddleware.getUserMiddleware",
    (route: { uri: string; body: JSONObject }) => {
      expect(mockRouter.match("post", route.uri).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    },
  );
});

describe("the fixed routes still reject a missing tenantid the same way", () => {
  it("send-message reports the missing project id as a bad request", async () => {
    withProps(
      buildProps({
        userId: ATTACKER_USER_ID,
        memberOfProjectId: PROJECT_A_ID,
      }),
    );

    const call: RouteCall = await callRoute({
      uri: "/ai-chat/send-message",
      body: { content: "hello" },
    });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(call.thrown).not.toBeInstanceOf(NotAuthorizedException);
  });
});
