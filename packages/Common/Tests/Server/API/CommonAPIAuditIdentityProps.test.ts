import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it; nothing password-related is under
 * test here, so it is replaced with a factory.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * CI's config.env sets BILLING_ENABLED=true and a local run does not, and
 * getDatabaseCommonInteractionProps reads the project's plan when billing is
 * on. Billing is therefore a live flag here, pinned by each test.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";

/*
 * What CommonAPI.getDatabaseCommonInteractionProps carries from the request
 * into the props every database call is made with, for two purposes:
 *
 *   THE AUDIT TRAIL - which API key, or which connected MCP client, made the
 *   change. These fields are read by nothing but the audit recorder.
 *
 *   READ-ONLY ENFORCEMENT - `isReadOnlyCredential`, set for exactly one kind
 *   of request: one the MCP server makes for a client its user authorized as
 *   read-only. This one IS enforced (the permission layer refuses every
 *   create, update and delete), so it matters as much that it is never set
 *   for anybody else as that it is set for them.
 */

type SpyInstance = ReturnType<typeof getJestSpyOn>;

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GRANT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const IDENTITY_KEYS: Array<string> = [
  "apiKeyId",
  "apiKeyName",
  "mcpOAuthGrantId",
  "mcpClientName",
  "isReadOnlyCredential",
];

const buildRequest: (fields: Partial<OneUptimeRequest>) => ExpressRequest = (
  fields: Partial<OneUptimeRequest>,
): ExpressRequest => {
  return {
    headers: {},
    ...fields,
  } as unknown as ExpressRequest;
};

const sessionFields: () => Partial<OneUptimeRequest> =
  (): Partial<OneUptimeRequest> => {
    return {
      userType: UserType.User,
      tenantId: PROJECT_ID,
      userAuthorization: {
        userId: USER_ID,
        email: new Email("member@example.com"),
        name: new Name("Mia Member"),
        isMasterAdmin: false,
        isGlobalLogin: true,
      },
    };
  };

const mcpOAuthContext: (isReadOnly: boolean) => {
  grantId: ObjectID;
  clientId: string;
  clientName: string;
  isReadOnly: boolean;
} = (
  isReadOnly: boolean,
): {
  grantId: ObjectID;
  clientId: string;
  clientName: string;
  isReadOnly: boolean;
} => {
  return {
    grantId: GRANT_ID,
    clientId: "https://claude.ai/oauth/mcp-client-metadata",
    clientName: "Claude",
    isReadOnly,
  };
};

const presentIdentityKeys: (
  props: DatabaseCommonInteractionProps,
) => Array<string> = (props: DatabaseCommonInteractionProps): Array<string> => {
  return IDENTITY_KEYS.filter((key: string): boolean => {
    return key in props;
  });
};

describe("CommonAPI.getDatabaseCommonInteractionProps - who made the request, for the audit trail", () => {
  let getCurrentPlanSpy: SpyInstance;

  beforeEach(() => {
    setTestBillingEnabled(false);

    getCurrentPlanSpy = getJestSpyOn(
      ProjectService,
      "getCurrentPlan",
    ).mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: false });
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  const propsFor: (
    fields: Partial<OneUptimeRequest>,
  ) => Promise<DatabaseCommonInteractionProps> = async (
    fields: Partial<OneUptimeRequest>,
  ): Promise<DatabaseCommonInteractionProps> => {
    return await CommonAPI.getDatabaseCommonInteractionProps(
      buildRequest(fields),
    );
  };

  describe("a project API key request", () => {
    test("carries the key's id and name", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: API_KEY_ID,
        apiKeyName: "Terraform",
      });

      expect(props.apiKeyId?.toString()).toBe(API_KEY_ID.toString());
      expect(props.apiKeyName).toBe("Terraform");
      expect(presentIdentityKeys(props)).toEqual(["apiKeyId", "apiKeyName"]);
    });

    test("a key with no name carries only its id", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: API_KEY_ID,
      });

      expect(presentIdentityKeys(props)).toEqual(["apiKeyId"]);
    });

    test("is never read-only: an API key's reach is its permissions' business", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: API_KEY_ID,
        apiKeyName: "Terraform",
      });

      expect(props.isReadOnlyCredential).toBeUndefined();
      expect(() => {
        DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
      }).not.toThrow();
    });

    test("stays an API request with no user", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: API_KEY_ID,
        apiKeyName: "Terraform",
      });

      expect(props.userType).toBe(UserType.API);
      expect(props.userId).toBeUndefined();
      expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
      expect(props.isMasterAdmin).toBeUndefined();
    });
  });

  describe("the master API key", () => {
    test("carries its label and no id", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.MasterAdmin,
        apiKeyName: "Master API Key",
        userAuthorization: {
          userId: USER_ID,
          email: new Email("admin@example.com"),
          name: new Name("Ada Admin"),
          isMasterAdmin: true,
          isGlobalLogin: true,
        },
      });

      expect(props.apiKeyName).toBe("Master API Key");
      expect(presentIdentityKeys(props)).toEqual(["apiKeyName"]);
      expect(props.isMasterAdmin).toBe(true);
    });
  });

  describe("a request the MCP server makes for a connected client", () => {
    test("carries the grant and the client's name", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(false),
      });

      expect(props.mcpOAuthGrantId?.toString()).toBe(GRANT_ID.toString());
      expect(props.mcpClientName).toBe("Claude");
    });

    test("is still attributed to the member: the client is how, not who", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(false),
      });

      expect(props.userId?.toString()).toBe(USER_ID.toString());
      expect(props.userType).toBe(UserType.User);
      expect(props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    });

    test("a read-and-write client is NOT marked read-only - the flag is absent, not false", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(false),
      });

      expect(presentIdentityKeys(props)).toEqual([
        "mcpOAuthGrantId",
        "mcpClientName",
      ]);
      expect(() => {
        DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
      }).not.toThrow();
    });

    test("a read-only client IS marked read-only", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(true),
      });

      expect(props.isReadOnlyCredential).toBe(true);
      expect(presentIdentityKeys(props)).toEqual([
        "mcpOAuthGrantId",
        "mcpClientName",
        "isReadOnlyCredential",
      ]);
    });

    test("the props built for a read-only client are the ones the permission layer refuses writes for", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(true),
      });

      expect(() => {
        DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
      }).toThrow(NotAuthorizedException);
    });

    test("is never root and never a master admin, read-only or not", async () => {
      for (const isReadOnly of [true, false]) {
        const props: DatabaseCommonInteractionProps = await propsFor({
          ...sessionFields(),
          mcpOAuth: mcpOAuthContext(isReadOnly),
        });

        expect(props.isRoot).toBeUndefined();
        expect(props.isMasterAdmin).toBeUndefined();
      }
    });

    test("carries no API key identity", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(true),
      });

      expect(props.apiKeyId).toBeUndefined();
      expect(props.apiKeyName).toBeUndefined();
    });

    test("the client's id (a URL, or a registration id) is not copied: the audit trail names the client, and the grant row holds the rest", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(false),
      });

      expect(JSON.stringify(Object.keys(props))).not.toContain("clientId");
    });
  });

  describe("an ordinary dashboard session", () => {
    test("carries none of the identity fields, and is not read-only", async () => {
      const props: DatabaseCommonInteractionProps =
        await propsFor(sessionFields());

      expect(presentIdentityKeys(props)).toEqual([]);
      expect(props.userId?.toString()).toBe(USER_ID.toString());
      expect(() => {
        DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(props);
      }).not.toThrow();
    });

    test("a master admin's session carries none either", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.MasterAdmin,
        userAuthorization: {
          userId: USER_ID,
          email: new Email("admin@example.com"),
          name: new Name("Ada Admin"),
          isMasterAdmin: true,
          isGlobalLogin: true,
        },
      });

      expect(presentIdentityKeys(props)).toEqual([]);
      expect(props.isMasterAdmin).toBe(true);
    });
  });

  describe("an anonymous request", () => {
    test("carries none of the identity fields", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.Public,
      });

      expect(presentIdentityKeys(props)).toEqual([]);
      expect(props.userId).toBeUndefined();
    });
  });

  describe("the caller cannot set them", () => {
    test("headers and body fields with the same names are not read", async () => {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps({
          headers: {
            apikeyid: API_KEY_ID.toString(),
            apikeyname: "Forged",
            mcpoauthgrantid: GRANT_ID.toString(),
            mcpclientname: "Forged",
            isreadonlycredential: "false",
          },
          body: {
            apiKeyId: API_KEY_ID.toString(),
            apiKeyName: "Forged",
            mcpOAuthGrantId: GRANT_ID.toString(),
            mcpClientName: "Forged",
            isReadOnlyCredential: false,
            mcpOAuth: { isReadOnly: false },
          },
          ...sessionFields(),
        } as unknown as ExpressRequest);

      expect(presentIdentityKeys(props)).toEqual([]);
    });

    test("a body cannot switch a read-only client back to read and write", async () => {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps({
          headers: {},
          body: {
            isReadOnlyCredential: false,
            mcpOAuth: { isReadOnly: false },
          },
          ...sessionFields(),
          mcpOAuth: mcpOAuthContext(true),
        } as unknown as ExpressRequest);

      expect(props.isReadOnlyCredential).toBe(true);
    });
  });

  describe("with billing on (how CI runs)", () => {
    beforeEach(() => {
      setTestBillingEnabled(true);
    });

    test("the identity fields are carried exactly as with billing off", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        ...sessionFields(),
        mcpOAuth: mcpOAuthContext(true),
      });

      expect(presentIdentityKeys(props)).toEqual([
        "mcpOAuthGrantId",
        "mcpClientName",
        "isReadOnlyCredential",
      ]);
      // And the plan is read for the request's project, as for any request.
      expect(getCurrentPlanSpy).toHaveBeenCalledTimes(1);
      expect((getCurrentPlanSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(props.currentPlan).toBe(PlanType.Growth);
    });

    test("an API key request carries the key's identity", async () => {
      const props: DatabaseCommonInteractionProps = await propsFor({
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: API_KEY_ID,
        apiKeyName: "Terraform",
      });

      expect(presentIdentityKeys(props)).toEqual(["apiKeyId", "apiKeyName"]);
    });
  });

  test("with billing off the plan is not read", async () => {
    await propsFor({ ...sessionFields(), mcpOAuth: mcpOAuthContext(true) });

    expect(getCurrentPlanSpy).not.toHaveBeenCalled();
  });
});
