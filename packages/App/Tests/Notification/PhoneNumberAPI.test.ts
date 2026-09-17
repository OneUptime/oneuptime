import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import IncomingCallPolicyPhoneNumberService from "Common/Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import { ICallProvider } from "Common/Types/Call/CallProvider";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import CallProviderFactory from "../../FeatureSet/Notification/Providers/CallProviderFactory";
import { getProjectTwilioConfig } from "../../FeatureSet/Notification/Utils/TwilioConfigHelper";

type AnyMock = Mock<(...args: Array<any>) => any>;

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Types/Database/Permissions/Index", () => {
  return {
    __esModule: true,
    default: {
      checkUpdatePermissionByModel: jest.fn(),
      checkUpdateQueryPermissions: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
      requirePermission: jest.fn(() => {
        return jest.fn();
      }),
    },
  };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyPhoneNumberService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneBy: jest.fn(),
      deleteOneById: jest.fn(),
      syncPrimaryPhoneNumberToPolicy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Providers/CallProviderFactory", () => {
  return {
    __esModule: true,
    default: { getProviderWithConfig: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Utils/TwilioConfigHelper", () => {
  return {
    __esModule: true,
    getProjectTwilioConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    HttpProtocol: "https://",
    Host: "oneuptime.example",
  };
});

import "../../FeatureSet/Notification/API/PhoneNumber";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const POLICY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NUMBER_ROW_1: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444441",
);
const NUMBER_ROW_2: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const TWILIO_CONFIG: {
  accountSid: string;
  authToken: string;
  primaryPhoneNumber: Phone;
  secondaryPhoneNumbers: Array<Phone>;
} = {
  accountSid: "AC-test",
  authToken: "token",
  primaryPhoneNumber: new Phone("+14155550999"),
  secondaryPhoneNumbers: [],
};

interface ProviderMocks {
  searchAvailableNumbers: AnyMock;
  listOwnedNumbers: AnyMock;
  purchaseNumber: AnyMock;
  assignExistingNumber: AnyMock;
  releaseNumber: AnyMock;
  updateWebhookUrl: AnyMock;
  generateGreetingResponse: AnyMock;
  generateDialResponse: AnyMock;
  generateHangupResponse: AnyMock;
  generateEscalationResponse: AnyMock;
  parseIncomingCallWebhook: AnyMock;
  parseDialStatusWebhook: AnyMock;
  validateWebhookSignature: AnyMock;
}

const provider: ProviderMocks = {
  searchAvailableNumbers: jest.fn(),
  listOwnedNumbers: jest.fn(),
  purchaseNumber: jest.fn(),
  assignExistingNumber: jest.fn(),
  releaseNumber: jest.fn(),
  updateWebhookUrl: jest.fn(),
  generateGreetingResponse: jest.fn(),
  generateDialResponse: jest.fn(),
  generateHangupResponse: jest.fn(),
  generateEscalationResponse: jest.fn(),
  parseIncomingCallWebhook: jest.fn(),
  parseDialStatusWebhook: jest.fn(),
  validateWebhookSignature: jest.fn(),
};

const policyService: {
  findOneBy: AnyMock;
  findOneById: AnyMock;
  updateOneById: AnyMock;
} = IncomingCallPolicyService as unknown as {
  findOneBy: AnyMock;
  findOneById: AnyMock;
  updateOneById: AnyMock;
};
const numberService: {
  create: AnyMock;
  findOneBy: AnyMock;
  deleteOneById: AnyMock;
  syncPrimaryPhoneNumberToPolicy: AnyMock;
} = IncomingCallPolicyPhoneNumberService as unknown as {
  create: AnyMock;
  findOneBy: AnyMock;
  deleteOneById: AnyMock;
  syncPrimaryPhoneNumberToPolicy: AnyMock;
};
const projectService: { findOneById: AnyMock } = ProjectService as unknown as {
  findOneById: AnyMock;
};
const configService: { findOneById: AnyMock } =
  ProjectCallSMSConfigService as unknown as { findOneById: AnyMock };
const providerFactory: { getProviderWithConfig: AnyMock } =
  CallProviderFactory as unknown as { getProviderWithConfig: AnyMock };
const twilioConfig: AnyMock = getProjectTwilioConfig as unknown as AnyMock;
const responseUtil: { sendJsonObjectResponse: AnyMock } =
  Response as unknown as { sendJsonObjectResponse: AnyMock };
const commonApi: { getDatabaseCommonInteractionProps: AnyMock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: AnyMock };
const modelPermission: {
  checkUpdatePermissionByModel: AnyMock;
  checkUpdateQueryPermissions: AnyMock;
} = ModelPermission as unknown as {
  checkUpdatePermissionByModel: AnyMock;
  checkUpdateQueryPermissions: AnyMock;
};

const EDIT_DATABASE_PROPS: Record<string, unknown> = {
  isRoot: false,
  isMasterAdmin: false,
  userTenantAccessPermission: {},
};

const registeredPermissionChecks: Array<any> = (
  UserMiddleware.requirePermission as unknown as AnyMock
).mock.calls.map((call: Array<any>) => {
  return call[0];
});

function makeProject(id: ObjectID = PROJECT_ID): Project {
  const project: Project = new Project();
  project.id = id;
  return project;
}

function makeConfig(projectId: ObjectID = PROJECT_ID): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.id = CONFIG_ID;
  config.projectId = projectId;
  return config;
}

function makePolicy(data?: {
  projectId?: ObjectID | undefined;
  configId?: ObjectID | undefined;
  legacySid?: string | undefined;
  legacyPhone?: string | undefined;
  legacyCountryCode?: string | undefined;
  legacyAreaCode?: string | undefined;
  legacyPurchasedAt?: Date | undefined;
}): IncomingCallPolicy {
  const policy: IncomingCallPolicy = new IncomingCallPolicy();
  policy.id = POLICY_ID;
  if (data && Object.prototype.hasOwnProperty.call(data, "projectId")) {
    if (data.projectId) {
      policy.projectId = data.projectId;
    }
  } else {
    policy.projectId = PROJECT_ID;
  }
  if (data && Object.prototype.hasOwnProperty.call(data, "configId")) {
    if (data.configId) {
      policy.projectCallSMSConfigId = data.configId;
    }
  } else {
    policy.projectCallSMSConfigId = CONFIG_ID;
  }
  if (data?.legacySid !== undefined) {
    policy.callProviderPhoneNumberId = data.legacySid;
  }
  if (data?.legacyPhone) {
    policy.routingPhoneNumber = new Phone(data.legacyPhone);
  }
  if (data?.legacyCountryCode !== undefined) {
    policy.phoneNumberCountryCode = data.legacyCountryCode;
  }
  if (data?.legacyAreaCode !== undefined) {
    policy.phoneNumberAreaCode = data.legacyAreaCode;
  }
  if (data?.legacyPurchasedAt !== undefined) {
    policy.phoneNumberPurchasedAt = data.legacyPurchasedAt;
  }
  return policy;
}

function makeNumberRow(data: {
  id: ObjectID;
  sid: string;
  phone?: string | undefined;
  policyId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  configId?: ObjectID | undefined;
}): IncomingCallPolicyPhoneNumber {
  const row: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();
  row.id = data.id;
  row.incomingCallPolicyId = data.policyId || POLICY_ID;
  row.projectId = data.projectId || PROJECT_ID;
  row.projectCallSMSConfigId = data.configId || CONFIG_ID;
  row.callProviderPhoneNumberId = data.sid;
  if (data.phone) {
    row.phoneNumber = new Phone(data.phone);
  }
  return row;
}

interface Invocation {
  request: ExpressRequest;
  response: ExpressResponse;
  next: AnyMock;
}

async function invoke(
  method: "post" | "delete",
  route: string,
  data?: {
    body?: Record<string, unknown> | undefined;
    params?: Record<string, string | undefined> | undefined;
    tenantId?: ObjectID | null | undefined;
  },
): Promise<Invocation> {
  const hasTenantOverride: boolean = Boolean(
    data && Object.prototype.hasOwnProperty.call(data, "tenantId"),
  );
  const tenantId: ObjectID | null | undefined = hasTenantOverride
    ? data?.tenantId
    : PROJECT_ID;
  const request: ExpressRequest = {
    body: data?.body || {},
    params: data?.params || {},
    tenantId: tenantId || undefined,
  } as unknown as ExpressRequest;
  const response: ExpressResponse = {} as ExpressResponse;
  const next: AnyMock = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(request, response, next as unknown as NextFunction);

  return { request, response, next };
}

function expectNextError(next: AnyMock, message: string): void {
  expect(next).toHaveBeenCalledTimes(1);
  expect(String(next.mock.calls[0]?.[0]?.message)).toContain(message);
}

function createdRow(callIndex: number = 0): IncomingCallPolicyPhoneNumber {
  return numberService.create.mock.calls[callIndex]?.[0]
    .data as IncomingCallPolicyPhoneNumber;
}

function installAllowedPolicyEditAuthorization(
  databaseProps: Record<string, unknown> = EDIT_DATABASE_PROPS,
): void {
  commonApi.getDatabaseCommonInteractionProps
    .mockReset()
    .mockResolvedValue(databaseProps);
  modelPermission.checkUpdatePermissionByModel
    .mockReset()
    .mockResolvedValue(undefined);
  modelPermission.checkUpdateQueryPermissions
    .mockReset()
    .mockImplementation(
      (
        _modelType: typeof IncomingCallPolicy,
        query: Record<string, unknown>,
      ) => {
        return Promise.resolve(query);
      },
    );
  policyService.findOneBy
    .mockReset()
    .mockImplementation(({ query }: { query: Record<string, unknown> }) => {
      if (query["_id"] && query["projectId"]) {
        return Promise.resolve(makePolicy());
      }
      return Promise.resolve(null);
    });
}

describe("phone-number route authorization", () => {
  test("uses read permission for discovery, edit permission for mutations, and cluster auth internally", () => {
    expect(registeredPermissionChecks).toEqual([
      {
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadProjectIncomingCallPolicy,
        ],
      },
      {
        permissions: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadProjectIncomingCallPolicy,
        ],
      },
      ...Array.from({ length: 4 }, () => {
        return {
          permissions: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditProjectIncomingCallPolicy,
          ],
        };
      }),
    ]);

    for (const [method, route] of [
      ["post", "/search"],
      ["post", "/list-owned"],
      ["post", "/assign-existing"],
      ["post", "/purchase"],
      [
        "delete",
        "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      ],
      ["delete", "/release/:incomingCallPolicyId"],
    ] as const) {
      expect(mockRouter.match(method, route).middlewares.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(mockRouter.match(method, route).middlewares).toHaveLength(3);
    }

    expect(mockRouter.match("post", "/internal/release").middlewares).toEqual([
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    ]);
  });
});

describe("phone-number discovery routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectService.findOneById.mockResolvedValue(makeProject());
    configService.findOneById.mockResolvedValue(makeConfig());
    twilioConfig.mockResolvedValue(TWILIO_CONFIG);
    providerFactory.getProviderWithConfig.mockReturnValue(
      provider as unknown as ICallProvider,
    );
    provider.searchAvailableNumbers.mockResolvedValue([]);
    provider.listOwnedNumbers.mockResolvedValue([]);
    responseUtil.sendJsonObjectResponse.mockImplementation(
      (_request: ExpressRequest, response: ExpressResponse) => {
        return response;
      },
    );
  });

  test("requires an authenticated tenant instead of trusting body projectId", async () => {
    const result: Invocation = await invoke("post", "/search", {
      tenantId: null,
      body: {
        projectId: OTHER_PROJECT_ID.toString(),
        projectCallSMSConfigId: CONFIG_ID.toString(),
        countryCode: "US",
      },
    });

    expectNextError(result.next, "Project ID not found in request");
    expect(configService.findOneById).not.toHaveBeenCalled();
    expect(provider.searchAvailableNumbers).not.toHaveBeenCalled();
  });

  test("rejects a config from another project before touching its provider", async () => {
    configService.findOneById.mockResolvedValue(makeConfig(OTHER_PROJECT_ID));

    const result: Invocation = await invoke("post", "/list-owned", {
      body: {
        projectCallSMSConfigId: CONFIG_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "Project Call/SMS Config not found for this project",
    );
    expect(twilioConfig).not.toHaveBeenCalled();
    expect(provider.listOwnedNumbers).not.toHaveBeenCalled();
  });

  test("search sends bounded optional filters and preserves provider metadata", async () => {
    provider.searchAvailableNumbers.mockResolvedValue([
      {
        phoneNumber: "+14155550101",
        friendlyName: "San Francisco",
        locality: "San Francisco",
        region: "CA",
        country: "US",
      },
      {
        phoneNumber: "+14155550102",
        friendlyName: "US number",
        country: "US",
      },
    ]);

    const result: Invocation = await invoke("post", "/search", {
      body: {
        projectId: OTHER_PROJECT_ID.toString(),
        projectCallSMSConfigId: CONFIG_ID.toString(),
        countryCode: "US",
        areaCode: "415",
        contains: "010",
      },
    });

    expect(configService.findOneById.mock.calls[0]?.[0]).toMatchObject({
      id: CONFIG_ID,
    });
    expect(projectService.findOneById.mock.calls[0]?.[0]).toMatchObject({
      id: PROJECT_ID,
    });
    expect(provider.searchAvailableNumbers).toHaveBeenCalledWith({
      countryCode: "US",
      areaCode: "415",
      contains: "010",
      limit: 10,
    });
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      result.request,
      result.response,
      {
        availableNumbers: [
          {
            phoneNumber: "+14155550101",
            friendlyName: "San Francisco",
            locality: "San Francisco",
            region: "CA",
            country: "US",
          },
          {
            phoneNumber: "+14155550102",
            friendlyName: "US number",
            country: "US",
          },
        ],
      },
    );
  });

  test("list-owned maps provider ids, numbers, names, and webhook URLs", async () => {
    provider.listOwnedNumbers.mockResolvedValue([
      {
        phoneNumberId: "PN-owned-1",
        phoneNumber: "+14155550101",
        friendlyName: "Primary",
        voiceUrl: "https://old.example/voice",
      },
      {
        phoneNumberId: "PN-owned-2",
        phoneNumber: "+14155550102",
        friendlyName: "Secondary",
      },
    ]);

    const result: Invocation = await invoke("post", "/list-owned", {
      body: { projectCallSMSConfigId: CONFIG_ID.toString() },
    });

    expect(provider.listOwnedNumbers).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      result.request,
      result.response,
      {
        ownedNumbers: [
          {
            phoneNumberId: "PN-owned-1",
            phoneNumber: "+14155550101",
            friendlyName: "Primary",
            voiceUrl: "https://old.example/voice",
          },
          {
            phoneNumberId: "PN-owned-2",
            phoneNumber: "+14155550102",
            friendlyName: "Secondary",
            voiceUrl: undefined,
          },
        ],
      },
    );
  });

  test.each([
    ["/search", {}, "projectCallSMSConfigId is required"],
    [
      "/search",
      { projectCallSMSConfigId: CONFIG_ID.toString() },
      "countryCode is required",
    ],
    ["/list-owned", {}, "projectCallSMSConfigId is required"],
  ])(
    "%s rejects missing input %#",
    async (
      route: string,
      body: Record<string, unknown>,
      message: string,
    ): Promise<void> => {
      const result: Invocation = await invoke("post", route as string, {
        body: body as Record<string, unknown>,
      });

      expectNextError(result.next, message as string);
    },
  );

  test("does not create a provider when the project or resolved config is missing", async () => {
    projectService.findOneById.mockResolvedValueOnce(null);
    let result: Invocation = await invoke("post", "/search", {
      body: {
        projectCallSMSConfigId: CONFIG_ID.toString(),
        countryCode: "US",
      },
    });
    expectNextError(result.next, "Project not found");

    projectService.findOneById.mockResolvedValueOnce(makeProject());
    twilioConfig.mockResolvedValueOnce(null);
    result = await invoke("post", "/search", {
      body: {
        projectCallSMSConfigId: CONFIG_ID.toString(),
        countryCode: "US",
      },
    });
    expectNextError(result.next, "Project Call/SMS Config not found");

    expect(provider.searchAvailableNumbers).not.toHaveBeenCalled();
  });
});

describe("attaching multiple incoming-call policy numbers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectService.findOneById.mockResolvedValue(makeProject());
    configService.findOneById.mockResolvedValue(makeConfig());
    policyService.findOneById.mockResolvedValue(makePolicy());
    installAllowedPolicyEditAuthorization();
    numberService.findOneBy.mockResolvedValue(null);
    twilioConfig.mockResolvedValue(TWILIO_CONFIG);
    providerFactory.getProviderWithConfig.mockReturnValue(
      provider as unknown as ICallProvider,
    );
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-assigned",
      phoneNumber: "+14155550101",
    });
    provider.purchaseNumber.mockResolvedValue({
      phoneNumberId: "PN-purchased",
      phoneNumber: "+14155550102",
    });
    provider.releaseNumber.mockResolvedValue(undefined);
    let rowSequence: number = 0;
    numberService.create.mockImplementation(
      ({ data }: { data: IncomingCallPolicyPhoneNumber }) => {
        rowSequence++;
        data.id = new ObjectID(
          `66666666-6666-4666-8666-${String(rowSequence).padStart(12, "0")}`,
        );
        return Promise.resolve(data);
      },
    );
    responseUtil.sendJsonObjectResponse.mockImplementation(
      (_request: ExpressRequest, response: ExpressResponse) => {
        return response;
      },
    );
  });

  test("allows a policy to add second and third existing number attachments", async () => {
    provider.assignExistingNumber
      .mockResolvedValueOnce({
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
      })
      .mockResolvedValueOnce({
        phoneNumberId: "PN-third",
        phoneNumber: "+14155550103",
      });

    for (const [sid, phone] of [
      ["PN-second", "+14155550102"],
      ["PN-third", "+14155550103"],
    ]) {
      const result: Invocation = await invoke("post", "/assign-existing", {
        body: {
          phoneNumberId: sid,
          phoneNumber: phone,
          incomingCallPolicyId: POLICY_ID.toString(),
        },
      });
      expect(result.next).not.toHaveBeenCalled();
    }

    expect(numberService.create).toHaveBeenCalledTimes(2);
    expect(createdRow(0).phoneNumber?.toString()).toBe("+14155550102");
    expect(createdRow(1).phoneNumber?.toString()).toBe("+14155550103");
    expect(createdRow(0).incomingCallPolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );
    expect(createdRow(1).incomingCallPolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );
    expect(policyService.updateOneById).not.toHaveBeenCalled();
  });

  test("reapplies model and scoped-query authorization before an allowed mutation", async () => {
    const selectedPolicy: IncomingCallPolicy = makePolicy();
    policyService.findOneById.mockResolvedValue(selectedPolicy);

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(commonApi.getDatabaseCommonInteractionProps).toHaveBeenCalledWith(
      result.request,
    );
    expect(modelPermission.checkUpdatePermissionByModel).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: IncomingCallPolicy,
        props: EDIT_DATABASE_PROPS,
        fetchModelWithAccessControlIds: expect.any(Function),
      }),
    );
    const permissionArgs: Record<string, unknown> =
      modelPermission.checkUpdatePermissionByModel.mock.calls[0]?.[0];
    await expect(
      (
        permissionArgs[
          "fetchModelWithAccessControlIds"
        ] as () => Promise<IncomingCallPolicy>
      )(),
    ).resolves.toBe(selectedPolicy);
    expect(modelPermission.checkUpdateQueryPermissions).toHaveBeenCalledWith(
      IncomingCallPolicy,
      { _id: POLICY_ID, projectId: PROJECT_ID },
      {},
      EDIT_DATABASE_PROPS,
    );
    expect(policyService.findOneBy).toHaveBeenCalledWith({
      query: { _id: POLICY_ID, projectId: PROJECT_ID },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(policyService.findOneById.mock.calls[0]?.[0].select.labels).toEqual({
      _id: true,
      name: true,
    });
    expect(provider.assignExistingNumber).toHaveBeenCalledTimes(1);
  });

  test("rejects a label-scoped model denial before config or provider access", async () => {
    const denied: Error = new Error("policy labels are outside this grant");
    modelPermission.checkUpdatePermissionByModel.mockRejectedValueOnce(denied);

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).toHaveBeenCalledWith(denied);
    expect(modelPermission.checkUpdateQueryPermissions).not.toHaveBeenCalled();
    expect(configService.findOneById).not.toHaveBeenCalled();
    expect(numberService.findOneBy).not.toHaveBeenCalled();
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
  });

  test("rejects an owner-scoped query that cannot reselect the policy", async () => {
    const ownerId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );
    modelPermission.checkUpdateQueryPermissions.mockResolvedValueOnce({
      _id: POLICY_ID,
      projectId: PROJECT_ID,
      ownerUsers: ownerId,
    });
    policyService.findOneBy.mockResolvedValueOnce(null);

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "do not have permission to edit this incoming call policy",
    );
    expect(policyService.findOneBy).toHaveBeenCalledWith({
      query: {
        _id: POLICY_ID,
        projectId: PROJECT_ID,
        ownerUsers: ownerId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(configService.findOneById).not.toHaveBeenCalled();
    expect(provider.purchaseNumber).not.toHaveBeenCalled();
  });

  test("allows a master/unscoped caller through the same record authorization path", async () => {
    const masterProps: Record<string, unknown> = {
      ...EDIT_DATABASE_PROPS,
      isMasterAdmin: true,
    };
    installAllowedPolicyEditAuthorization(masterProps);

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(modelPermission.checkUpdatePermissionByModel).toHaveBeenCalledWith(
      expect.objectContaining({ props: masterProps }),
    );
    expect(modelPermission.checkUpdateQueryPermissions).toHaveBeenCalledWith(
      IncomingCallPolicy,
      { _id: POLICY_ID, projectId: PROJECT_ID },
      {},
      masterProps,
    );
    expect(provider.purchaseNumber).toHaveBeenCalledTimes(1);
  });

  test("preserves every scalar-only legacy field before attaching a second number", async () => {
    const purchasedAt: Date = new Date("2025-04-03T02:01:00.000Z");
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        legacySid: "PN-legacy-primary",
        legacyPhone: "+442079460000",
        legacyCountryCode: "GB",
        legacyAreaCode: "20",
        legacyPurchasedAt: purchasedAt,
      }),
    );
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-second",
      phoneNumber: "+14155550102",
    });

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(numberService.create).toHaveBeenCalledTimes(2);
    expect(createdRow(0)).toMatchObject({
      projectId: PROJECT_ID,
      incomingCallPolicyId: POLICY_ID,
      projectCallSMSConfigId: CONFIG_ID,
      callProviderPhoneNumberId: "PN-legacy-primary",
      countryCode: "GB",
      areaCode: "20",
      phoneNumberPurchasedAt: purchasedAt,
    });
    expect(createdRow(0).phoneNumber?.toString()).toBe("+442079460000");
    expect(createdRow(1).callProviderPhoneNumberId).toBe("PN-second");
    expect(numberService.create.mock.invocationCallOrder[0]).toBeLessThan(
      provider.assignExistingNumber.mock.invocationCallOrder[0]!,
    );
    expect(policyService.findOneById.mock.calls[0]?.[0].select).toEqual({
      _id: true,
      projectId: true,
      projectCallSMSConfigId: true,
      routingPhoneNumber: true,
      callProviderPhoneNumberId: true,
      phoneNumberCountryCode: true,
      phoneNumberAreaCode: true,
      phoneNumberPurchasedAt: true,
      labels: {
        _id: true,
        name: true,
      },
    });
  });

  test("does not duplicate a legacy number already preserved by the worker", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        legacySid: "PN-legacy-primary",
        legacyPhone: "+442079460000",
      }),
    );
    numberService.findOneBy
      .mockResolvedValueOnce(
        makeNumberRow({
          id: NUMBER_ROW_1,
          sid: "PN-legacy-primary",
          phone: "+442079460000",
        }),
      )
      .mockResolvedValue(null);
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-second",
      phoneNumber: "+14155550102",
    });

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(numberService.create).toHaveBeenCalledTimes(1);
    expect(createdRow().callProviderPhoneNumberId).toBe("PN-second");
    expect(provider.assignExistingNumber).toHaveBeenCalledTimes(1);
  });

  test("blocks an incomplete scalar legacy attachment before provider mutation", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ legacyPhone: "+442079460000" }),
    );

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "existing phone number on this policy could not be migrated",
    );
    expect(numberService.findOneBy).not.toHaveBeenCalled();
    expect(numberService.create).not.toHaveBeenCalled();
    expect(twilioConfig).not.toHaveBeenCalled();
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
  });

  test("accepts a concurrent worker winning the legacy preservation insert", async () => {
    const concurrentRow: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_1,
      sid: "PN-legacy-primary",
      phone: "+442079460000",
    });
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        legacySid: "PN-legacy-primary",
        legacyPhone: "+442079460000",
      }),
    );
    numberService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentRow)
      .mockResolvedValue(null);
    numberService.create.mockRejectedValueOnce(new Error("duplicate key"));
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-second",
      phoneNumber: "+14155550102",
    });

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(numberService.findOneBy).toHaveBeenCalledTimes(6);
    expect(numberService.create).toHaveBeenCalledTimes(2);
    expect(createdRow(1).callProviderPhoneNumberId).toBe("PN-second");
    expect(provider.assignExistingNumber).toHaveBeenCalledTimes(1);
  });

  test("propagates a real legacy preservation failure before provider mutation", async () => {
    const persistenceFailure: Error = new Error("database unavailable");
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        legacySid: "PN-legacy-primary",
        legacyPhone: "+442079460000",
      }),
    );
    numberService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    numberService.create.mockRejectedValueOnce(persistenceFailure);

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-second",
        phoneNumber: "+14155550102",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).toHaveBeenCalledWith(persistenceFailure);
    expect(numberService.create).toHaveBeenCalledTimes(1);
    expect(twilioConfig).not.toHaveBeenCalled();
    expect(providerFactory.getProviderWithConfig).not.toHaveBeenCalled();
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
  });

  test("persists the provider-returned existing number, never the caller's claimed number", async () => {
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-authoritative",
      phoneNumber: "+442071838750",
    });

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-requested",
        phoneNumber: "+14155550199",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(provider.assignExistingNumber).toHaveBeenCalledWith(
      "PN-requested",
      "https://oneuptime.example/notification/incoming-call/voice",
    );
    expect(createdRow()).toMatchObject({
      projectId: PROJECT_ID,
      incomingCallPolicyId: POLICY_ID,
      projectCallSMSConfigId: CONFIG_ID,
      callProviderPhoneNumberId: "PN-authoritative",
      countryCode: "GB",
      areaCode: "",
    });
    expect(createdRow().phoneNumber?.toString()).toBe("+442071838750");
    expect(createdRow().phoneNumberPurchasedAt).toBeInstanceOf(Date);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      result.request,
      result.response,
      expect.objectContaining({
        success: true,
        phoneNumberId: "PN-authoritative",
        phoneNumber: "+442071838750",
        incomingCallPolicyPhoneNumberId: expect.any(String),
      }),
    );
  });

  test("purchases and stores a third number using authoritative metadata", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ legacySid: "PN-primary", legacyPhone: "+14155550100" }),
    );
    numberService.findOneBy
      .mockResolvedValueOnce(
        makeNumberRow({
          id: NUMBER_ROW_1,
          sid: "PN-primary",
          phone: "+14155550100",
        }),
      )
      .mockResolvedValue(null);
    provider.purchaseNumber.mockResolvedValue({
      phoneNumberId: "PN-third",
      phoneNumber: "+16175550103",
    });

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550199",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(provider.purchaseNumber).toHaveBeenCalledWith(
      "+14155550199",
      "https://oneuptime.example/notification/incoming-call/voice",
    );
    expect(numberService.findOneBy.mock.invocationCallOrder[0]).toBeLessThan(
      provider.purchaseNumber.mock.invocationCallOrder[0]!,
    );
    expect(createdRow().phoneNumber?.toString()).toBe("+16175550103");
    expect(createdRow()).toMatchObject({
      callProviderPhoneNumberId: "PN-third",
      countryCode: "US",
      areaCode: "617",
    });
    expect(result.next).not.toHaveBeenCalled();
  });

  test("rolls back a paid provider number when persistence fails", async () => {
    const persistFailure: Error = new Error("unique phone violation");
    numberService.create.mockRejectedValueOnce(persistFailure);
    provider.purchaseNumber.mockResolvedValue({
      phoneNumberId: "PN-new-paid",
      phoneNumber: "+14155550150",
    });

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550150",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(provider.releaseNumber).toHaveBeenCalledTimes(1);
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-new-paid");
    expect(result.next).toHaveBeenCalledWith(persistFailure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a number held by a scalar-only legacy policy before changing its provider webhook", async () => {
    policyService.findOneBy.mockResolvedValue(
      makePolicy({
        legacySid: "PN-legacy",
        legacyPhone: "+14155550140",
      }),
    );

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-reused",
        phoneNumber: "+14155550140",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "This phone number is already attached to an incoming call policy",
    );
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
    expect(numberService.create).not.toHaveBeenCalled();
  });

  test("rejects a provider SID already attached within the same config before provider mutation", async () => {
    numberService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        makeNumberRow({ id: NUMBER_ROW_1, sid: "PN-duplicate-sid" }),
      );

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-duplicate-sid",
        phoneNumber: "+14155550141",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "This phone number is already attached to an incoming call policy",
    );
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
  });

  test("uses the provider's canonical assign result for its second duplicate check", async () => {
    const existing: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_1,
      sid: "PN-existing-canonical",
      phone: "+14155550142",
    });
    numberService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    provider.assignExistingNumber.mockResolvedValue({
      phoneNumberId: "PN-existing-canonical",
      phoneNumber: "+14155550142",
    });

    const result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-requested-alias",
        phoneNumber: "+14155550199",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(provider.assignExistingNumber).toHaveBeenCalledTimes(1);
    expectNextError(
      result.next,
      "This phone number is already attached to an incoming call policy",
    );
    expect(numberService.create).not.toHaveBeenCalled();
    // Assigning changes a customer-owned number's webhook; it must not release it.
    expect(provider.releaseNumber).not.toHaveBeenCalled();
  });

  test("rejects a malformed policy id on attach before any provider call", async () => {
    let result: Invocation = await invoke("post", "/assign-existing", {
      body: {
        phoneNumberId: "PN-assigned",
        phoneNumber: "+14155550101",
        incomingCallPolicyId: "not-a-uuid",
      },
    });
    expectNextError(result.next, "incomingCallPolicyId is not valid");

    result = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550102",
        incomingCallPolicyId: "not-a-uuid",
      },
    });
    expectNextError(result.next, "incomingCallPolicyId is not valid");

    expect(policyService.findOneById).not.toHaveBeenCalled();
    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
    expect(provider.purchaseNumber).not.toHaveBeenCalled();
    expect(numberService.create).not.toHaveBeenCalled();
  });

  test("releases a newly purchased number when its canonical result collides", async () => {
    const existing: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_1,
      sid: "PN-canonical-purchased",
      phone: "+14155550143",
    });
    numberService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    provider.purchaseNumber.mockResolvedValue({
      phoneNumberId: "PN-canonical-purchased",
      phoneNumber: "+14155550143",
    });

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550198",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expectNextError(
      result.next,
      "This phone number is already attached to an incoming call policy",
    );
    expect(numberService.create).not.toHaveBeenCalled();
    expect(provider.releaseNumber).toHaveBeenCalledTimes(1);
    expect(provider.releaseNumber).toHaveBeenCalledWith(
      "PN-canonical-purchased",
    );
  });

  test("preserves the persistence error when rollback release also fails", async () => {
    const persistFailure: Error = new Error("database unavailable");
    const rollbackFailure: Error = new Error("Twilio unavailable");
    numberService.create.mockRejectedValueOnce(persistFailure);
    provider.releaseNumber.mockRejectedValueOnce(rollbackFailure);

    const result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550151",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });

    expect(result.next).toHaveBeenCalledWith(persistFailure);
    expect(logger.error).toHaveBeenCalledWith(rollbackFailure);
  });

  test("rejects a foreign policy before assigning or purchasing anything", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ projectId: OTHER_PROJECT_ID }),
    );

    for (const [route, body] of [
      [
        "/assign-existing",
        {
          phoneNumberId: "PN-foreign",
          phoneNumber: "+14155550101",
          incomingCallPolicyId: POLICY_ID.toString(),
        },
      ],
      [
        "/purchase",
        {
          phoneNumber: "+14155550101",
          incomingCallPolicyId: POLICY_ID.toString(),
        },
      ],
    ] as const) {
      const result: Invocation = await invoke("post", route, { body });
      expectNextError(
        result.next,
        "Incoming Call Policy does not belong to this project",
      );
    }

    expect(provider.assignExistingNumber).not.toHaveBeenCalled();
    expect(provider.purchaseNumber).not.toHaveBeenCalled();
    expect(numberService.create).not.toHaveBeenCalled();
  });

  test("requires the policy, its project config, and that config's tenancy", async () => {
    policyService.findOneById.mockResolvedValueOnce(null);
    let result: Invocation = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550101",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });
    expectNextError(result.next, "Incoming Call Policy not found");

    policyService.findOneById.mockResolvedValueOnce(
      makePolicy({ configId: undefined }),
    );
    result = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550101",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });
    expectNextError(
      result.next,
      "This policy does not have a project Twilio configuration",
    );

    policyService.findOneById.mockResolvedValueOnce(makePolicy());
    configService.findOneById.mockResolvedValueOnce(
      makeConfig(OTHER_PROJECT_ID),
    );
    result = await invoke("post", "/purchase", {
      body: {
        phoneNumber: "+14155550101",
        incomingCallPolicyId: POLICY_ID.toString(),
      },
    });
    expectNextError(
      result.next,
      "Project Call/SMS Config not found for this project",
    );

    expect(provider.purchaseNumber).not.toHaveBeenCalled();
  });

  test.each([
    ["/assign-existing", {}, "phoneNumberId is required"],
    [
      "/assign-existing",
      { phoneNumberId: "PN-one" },
      "phoneNumber is required",
    ],
    [
      "/assign-existing",
      { phoneNumberId: "PN-one", phoneNumber: "+14155550101" },
      "incomingCallPolicyId is required",
    ],
    ["/purchase", {}, "phoneNumber is required"],
    [
      "/purchase",
      { phoneNumber: "+14155550101" },
      "incomingCallPolicyId is required",
    ],
  ])(
    "%s rejects missing mutation input %#",
    async (
      route: string,
      body: Record<string, unknown>,
      message: string,
    ): Promise<void> => {
      const result: Invocation = await invoke("post", route as string, {
        body: body as Record<string, unknown>,
      });
      expectNextError(result.next, message as string);
      expect(numberService.create).not.toHaveBeenCalled();
    },
  );
});

describe("targeted and legacy phone-number release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    policyService.findOneById.mockResolvedValue(makePolicy());
    installAllowedPolicyEditAuthorization();
    configService.findOneById.mockResolvedValue(makeConfig());
    twilioConfig.mockResolvedValue(TWILIO_CONFIG);
    providerFactory.getProviderWithConfig.mockReturnValue(
      provider as unknown as ICallProvider,
    );
    provider.releaseNumber.mockResolvedValue(undefined);
    numberService.deleteOneById.mockResolvedValue(1);
    numberService.syncPrimaryPhoneNumberToPolicy.mockResolvedValue(undefined);
    policyService.updateOneById.mockResolvedValue(undefined);
    responseUtil.sendJsonObjectResponse.mockImplementation(
      (_request: ExpressRequest, response: ExpressResponse) => {
        return response;
      },
    );
  });

  test("rejects record-scoped release before loading or mutating the number", async () => {
    const denied: Error = new Error("policy owner grant does not match");
    modelPermission.checkUpdatePermissionByModel.mockRejectedValueOnce(denied);

    const result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: NUMBER_ROW_1.toString(),
        },
      },
    );

    expect(result.next).toHaveBeenCalledWith(denied);
    expect(numberService.findOneBy).not.toHaveBeenCalled();
    expect(configService.findOneById).not.toHaveBeenCalled();
    expect(provider.releaseNumber).not.toHaveBeenCalled();
    expect(numberService.deleteOneById).not.toHaveBeenCalled();
  });

  test("releases only the explicitly selected child row and leaves siblings alone", async () => {
    const selected: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_2,
      sid: "PN-second",
      phone: "+14155550102",
    });
    numberService.findOneBy.mockResolvedValue(selected);

    const result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: NUMBER_ROW_2.toString(),
        },
      },
    );

    expect(numberService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          _id: NUMBER_ROW_2,
          incomingCallPolicyId: POLICY_ID,
          projectId: PROJECT_ID,
        },
      }),
    );
    expect(provider.releaseNumber).toHaveBeenCalledTimes(1);
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-second");
    expect(numberService.deleteOneById).toHaveBeenCalledWith({
      id: NUMBER_ROW_2,
      props: { isRoot: true },
    });
    expect(policyService.updateOneById).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      result.request,
      result.response,
      {
        success: true,
        incomingCallPolicyPhoneNumberId: NUMBER_ROW_2.toString(),
      },
    );
  });

  test("cannot release a row belonging to another policy or project", async () => {
    numberService.findOneBy.mockResolvedValue(null);

    const result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: NUMBER_ROW_2.toString(),
        },
      },
    );

    expectNextError(
      result.next,
      "Incoming Call Policy phone number not found for this policy",
    );
    expect(provider.releaseNumber).not.toHaveBeenCalled();
    expect(numberService.deleteOneById).not.toHaveBeenCalled();
  });

  test("does not delete the child if provider release fails", async () => {
    const providerFailure: Error = new Error("provider rejected release");
    numberService.findOneBy.mockResolvedValue(
      makeNumberRow({ id: NUMBER_ROW_2, sid: "PN-second" }),
    );
    provider.releaseNumber.mockRejectedValueOnce(providerFailure);

    const result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: NUMBER_ROW_2.toString(),
        },
      },
    );

    expect(result.next).toHaveBeenCalledWith(providerFailure);
    expect(numberService.deleteOneById).not.toHaveBeenCalled();
  });

  test("legacy release targets the exact child represented by the scalar mirror", async () => {
    const unrelatedOldest: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_1,
      sid: "PN-unrelated-oldest",
    });
    const mirroredChild: IncomingCallPolicyPhoneNumber = makeNumberRow({
      id: NUMBER_ROW_2,
      sid: "PN-mirrored",
    });
    policyService.findOneById.mockResolvedValue(
      makePolicy({ legacySid: "PN-mirrored" }),
    );
    numberService.findOneBy.mockImplementation(
      ({ query, sort }: { query: Record<string, unknown>; sort?: unknown }) => {
        if (query["callProviderPhoneNumberId"] === "PN-mirrored") {
          return Promise.resolve(mirroredChild);
        }
        if (sort) {
          return Promise.resolve(unrelatedOldest);
        }
        return Promise.resolve(null);
      },
    );

    await invoke("delete", "/release/:incomingCallPolicyId", {
      params: { incomingCallPolicyId: POLICY_ID.toString() },
    });

    expect(numberService.findOneBy).toHaveBeenCalledWith({
      query: {
        incomingCallPolicyId: POLICY_ID,
        projectId: PROJECT_ID,
        callProviderPhoneNumberId: "PN-mirrored",
        projectCallSMSConfigId: CONFIG_ID,
      },
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-mirrored");
    expect(provider.releaseNumber).not.toHaveBeenCalledWith(
      "PN-unrelated-oldest",
    );
    expect(numberService.deleteOneById).toHaveBeenCalledWith({
      id: NUMBER_ROW_2,
      props: { isRoot: true },
    });
    expect(policyService.updateOneById).not.toHaveBeenCalled();
    expect(numberService.syncPrimaryPhoneNumberToPolicy).not.toHaveBeenCalled();
  });

  test("missing scalar provider id retains the oldest-child fallback", async () => {
    numberService.findOneBy.mockResolvedValue(
      makeNumberRow({ id: NUMBER_ROW_1, sid: "PN-primary" }),
    );

    await invoke("delete", "/release/:incomingCallPolicyId", {
      params: { incomingCallPolicyId: POLICY_ID.toString() },
    });

    expect(numberService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          incomingCallPolicyId: POLICY_ID,
          projectId: PROJECT_ID,
        },
        sort: { createdAt: "ASC", _id: "ASC" },
      }),
    );
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-primary");
    expect(numberService.deleteOneById).toHaveBeenCalledWith({
      id: NUMBER_ROW_1,
      props: { isRoot: true },
    });
    expect(policyService.updateOneById).not.toHaveBeenCalled();
    expect(numberService.syncPrimaryPhoneNumberToPolicy).not.toHaveBeenCalled();
  });

  test("an unmatched scalar releases only that scalar and then promotes remaining children", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        legacySid: "PN-unmatched-scalar",
        legacyPhone: "+14155550100",
      }),
    );
    numberService.findOneBy.mockResolvedValue(null);

    await invoke("delete", "/release/:incomingCallPolicyId", {
      params: { incomingCallPolicyId: POLICY_ID.toString() },
    });

    expect(numberService.findOneBy).toHaveBeenCalledWith({
      query: {
        incomingCallPolicyId: POLICY_ID,
        projectId: PROJECT_ID,
        callProviderPhoneNumberId: "PN-unmatched-scalar",
        projectCallSMSConfigId: CONFIG_ID,
      },
      select: {
        _id: true,
        callProviderPhoneNumberId: true,
        projectCallSMSConfigId: true,
      },
      props: { isRoot: true },
    });
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-unmatched-scalar");
    expect(numberService.deleteOneById).not.toHaveBeenCalled();
    expect(policyService.updateOneById).toHaveBeenCalledWith({
      id: POLICY_ID,
      data: {
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      },
      props: { isRoot: true },
    });
    expect(numberService.syncPrimaryPhoneNumberToPolicy).toHaveBeenCalledWith(
      POLICY_ID,
    );
    expect(
      policyService.updateOneById.mock.invocationCallOrder[0],
    ).toBeLessThan(
      numberService.syncPrimaryPhoneNumberToPolicy.mock.invocationCallOrder[0]!,
    );
  });

  test("rejects cross-tenant policy release before reading a child or provider", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ projectId: OTHER_PROJECT_ID }),
    );

    const result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: NUMBER_ROW_2.toString(),
        },
      },
    );

    expectNextError(
      result.next,
      "Incoming Call Policy does not belong to this project",
    );
    expect(numberService.findOneBy).not.toHaveBeenCalled();
    expect(provider.releaseNumber).not.toHaveBeenCalled();
  });

  test("requires an attached provider id and its owning config", async () => {
    numberService.findOneBy.mockResolvedValue(null);
    policyService.findOneById.mockResolvedValueOnce(makePolicy());

    let result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId",
      { params: { incomingCallPolicyId: POLICY_ID.toString() } },
    );
    expectNextError(result.next, "This policy does not have a phone number");

    const missingConfig: IncomingCallPolicy = makePolicy({
      legacySid: "PN-legacy",
    });
    delete missingConfig.projectCallSMSConfigId;
    policyService.findOneById.mockResolvedValueOnce(missingConfig);
    result = await invoke("delete", "/release/:incomingCallPolicyId", {
      params: { incomingCallPolicyId: POLICY_ID.toString() },
    });
    expectNextError(
      result.next,
      "This phone number does not have a project Twilio configuration",
    );
  });

  test("rejects a malformed id before it reaches the database", async () => {
    let result: Invocation = await invoke(
      "delete",
      "/release/:incomingCallPolicyId",
      { params: { incomingCallPolicyId: "not-a-uuid" } },
    );
    expectNextError(result.next, "incomingCallPolicyId is not valid");

    result = await invoke(
      "delete",
      "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
      {
        params: {
          incomingCallPolicyId: POLICY_ID.toString(),
          incomingCallPolicyPhoneNumberId: "not-a-uuid",
        },
      },
    );
    expectNextError(
      result.next,
      "incomingCallPolicyPhoneNumberId is not valid",
    );

    expect(policyService.findOneById).not.toHaveBeenCalled();
    expect(numberService.findOneBy).not.toHaveBeenCalled();
    expect(provider.releaseNumber).not.toHaveBeenCalled();
  });
});

describe("internal provider release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    twilioConfig.mockResolvedValue(TWILIO_CONFIG);
    providerFactory.getProviderWithConfig.mockReturnValue(
      provider as unknown as ICallProvider,
    );
    provider.releaseNumber.mockResolvedValue(undefined);
    responseUtil.sendJsonObjectResponse.mockImplementation(
      (_request: ExpressRequest, response: ExpressResponse) => {
        return response;
      },
    );
  });

  test("releases exactly the requested provider SID", async () => {
    await invoke("post", "/internal/release", {
      body: {
        projectCallSMSConfigId: CONFIG_ID.toString(),
        callProviderPhoneNumberId: "PN-cleanup",
      },
      tenantId: null,
    });

    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_ID);
    expect(provider.releaseNumber).toHaveBeenCalledWith("PN-cleanup");
  });

  test("treats an already-deleted config as a successful no-op", async () => {
    twilioConfig.mockResolvedValue(null);
    const result: Invocation = await invoke("post", "/internal/release", {
      body: {
        projectCallSMSConfigId: CONFIG_ID.toString(),
        callProviderPhoneNumberId: "PN-cleanup",
      },
      tenantId: null,
    });

    expect(providerFactory.getProviderWithConfig).not.toHaveBeenCalled();
    expect(provider.releaseNumber).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledWith(
      result.request,
      result.response,
      { success: true },
    );
  });

  test.each([
    {},
    { projectCallSMSConfigId: CONFIG_ID.toString() },
    { callProviderPhoneNumberId: "PN-cleanup" },
  ])(
    "requires config and provider id %#",
    async (body: Record<string, unknown>): Promise<void> => {
      const result: Invocation = await invoke("post", "/internal/release", {
        body,
        tenantId: null,
      });

      expectNextError(
        result.next,
        "projectCallSMSConfigId and callProviderPhoneNumberId are required",
      );
      expect(provider.releaseNumber).not.toHaveBeenCalled();
    },
  );
});
