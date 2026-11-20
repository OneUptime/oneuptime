import { mockRouter } from "Common/Tests/Server/API/Helpers";
import { ON_HIGHEST_PLAN } from "Common/Tests/Server/TestingUtils/RequestPlan";
import CommonAPI from "Common/Server/API/CommonAPI";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
import AmazonSesProjectRole, {
  AmazonSesRoleSignInError,
} from "Common/Server/Utils/Mail/AmazonSesProjectRole";
import Response from "Common/Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { AmazonSesRoleSetup } from "Common/Types/Email/AmazonSesRoleSetup";
import {
  AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
  AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
} from "Common/Types/Email/AmazonSesRoleWords";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ProjectAmazonSesAuthenticationType from "Common/Types/Email/ProjectAmazonSesAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
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
 * A PROJECT'S AMAZON SES IAM ROLE, AT ITS ROUTES (#7378):
 *
 *   - GET /smtp-config/aws-role-setup answers the project the request is
 *     signed in to - never one it names - and only to whoever may create the
 *     project's SMTP configs;
 *   - POST /smtp-config/test checks a role config's role afresh before it
 *     sends, with the config row's own project, and a role that is refused
 *     sends nothing and says why in OneUptime's words.
 *
 * The router is mocked and each handler called directly, as
 * SmtpConfigTestRoute.test does; CommonAPI's guards are the real ones.
 */

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
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Notification/Services/MailService", () => {
  return {
    __esModule: true,
    default: { send: jest.fn() },
  };
});

import MailService from "../../FeatureSet/Notification/Services/MailService";
import { AMAZON_SES_ROLE_SETUP_PERMISSION_MESSAGE } from "../../FeatureSet/Notification/API/SMTPConfig";

const ROLE_ARN: string = "arn:aws:iam::210987654321:role/OneUptimeSes";

interface RouteCall {
  thrownToNext: unknown;
  answered: unknown;
}

function propsFor(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permission: Permission;
  tenant?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permission: UserPermission = {
    _type: "UserPermission",
    permission: data.permission,
    labelIds: [],
  };
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [permission],
  };
  const permissions: Dictionary<UserTenantAccessPermission> = {};

  permissions[data.projectId.toString()] = tenantPermission;

  return {
    ...(data.tenant === false ? {} : { tenantId: data.projectId }),
    userId: data.userId,
    userTenantAccessPermission: permissions,
    ...ON_HIGHEST_PLAN,
  };
}

async function call(
  method: "GET" | "POST",
  uri: string,
  request: { body?: Dictionary<string>; query?: Dictionary<string> },
): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: request.query || {},
    body: request.body || {},
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(method, uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  const answered: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    answered: answered.mock.calls[0] ? answered.mock.calls[0][2] : undefined,
  };
}

let projectId: ObjectID;
let userId: ObjectID;
let propsSpy: jest.SpiedFunction<
  typeof CommonAPI.getDatabaseCommonInteractionProps
>;

beforeAll(async () => {
  // Importing the route module registers its routes on the mock router.
  await import("../../FeatureSet/Notification/API/SMTPConfig");
});

beforeEach(() => {
  jest.clearAllMocks();
  projectId = ObjectID.generate();
  userId = ObjectID.generate();
  propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /smtp-config/aws-role-setup", () => {
  const SETUP: AmazonSesRoleSetup = {
    isAvailable: true,
    trustedPrincipalArn: "arn:aws:iam::999988887777:root",
    externalId: "oneuptime-0123456789abcdef0123456789abcdef",
    trustPolicy: "{}",
  };

  test("answers the setup of the project the request is signed in to, never one it names", async () => {
    const setupSpy: jest.SpiedFunction<
      typeof AmazonSesProjectRole.getRoleSetup
    > = jest
      .spyOn(AmazonSesProjectRole, "getRoleSetup")
      .mockResolvedValue(SETUP);

    propsSpy.mockResolvedValue(
      propsFor({ projectId, userId, permission: Permission.ProjectAdmin }),
    );

    const result: RouteCall = await call("GET", "/aws-role-setup", {
      query: { projectId: ObjectID.generate().toString() },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(setupSpy).toHaveBeenCalledWith({ projectId: projectId.toString() });
    expect(result.answered).toEqual(SETUP);
  });

  test("whoever may create SMTP configs may ask: owners, admins and the create permission", async () => {
    jest.spyOn(AmazonSesProjectRole, "getRoleSetup").mockResolvedValue(SETUP);

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectSMTPConfig,
    ]) {
      jest.clearAllMocks();
      propsSpy.mockResolvedValue(propsFor({ projectId, userId, permission }));

      expect(
        (await call("GET", "/aws-role-setup", {})).thrownToNext,
      ).toBeUndefined();
    }
  });

  test("anyone else is refused, and nothing is asked of AWS", async () => {
    const setupSpy: jest.SpiedFunction<
      typeof AmazonSesProjectRole.getRoleSetup
    > = jest
      .spyOn(AmazonSesProjectRole, "getRoleSetup")
      .mockResolvedValue(SETUP);

    for (const permission of [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadProjectSMTPConfig,
    ]) {
      jest.clearAllMocks();
      propsSpy.mockResolvedValue(propsFor({ projectId, userId, permission }));

      const result: RouteCall = await call("GET", "/aws-role-setup", {});

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Exception).message).toBe(
        AMAZON_SES_ROLE_SETUP_PERMISSION_MESSAGE,
      );
    }

    expect(setupSpy).not.toHaveBeenCalled();
  });

  test("a request that names no project is refused before anything is read", async () => {
    const setupSpy: jest.SpiedFunction<
      typeof AmazonSesProjectRole.getRoleSetup
    > = jest
      .spyOn(AmazonSesProjectRole, "getRoleSetup")
      .mockResolvedValue(SETUP);

    propsSpy.mockResolvedValue(
      propsFor({
        projectId,
        userId,
        permission: Permission.ProjectAdmin,
        tenant: false,
      }),
    );

    const result: RouteCall = await call("GET", "/aws-role-setup", {});

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(setupSpy).not.toHaveBeenCalled();
  });
});

describe("POST /smtp-config/test, for a config that signs in with an IAM role", () => {
  let configId: ObjectID;

  function roleConfig(): ProjectSmtpConfig {
    const config: ProjectSmtpConfig = new ProjectSmtpConfig();

    config.id = configId;
    config.projectId = projectId;
    config.transportType = MailTransportType.AmazonSES;
    config.amazonSesAuthenticationType =
      ProjectAmazonSesAuthenticationType.IamRole;
    config.amazonSesRoleArn = ROLE_ARN;
    config.amazonSesRegion = "eu-west-1";
    config.fromEmail = new Email("alerts@example.test");
    config.fromName = "Acme Alerts";

    return config;
  }

  beforeEach(() => {
    configId = ObjectID.generate();
    propsSpy.mockResolvedValue(
      propsFor({ projectId, userId, permission: Permission.ProjectAdmin }),
    );
    jest
      .spyOn(ProjectSMTPConfigService, "findOneById")
      .mockResolvedValue(roleConfig());
  });

  test("the role is checked afresh, with the config row's own project, before the test email is sent", async () => {
    const sessionSpy: jest.SpiedFunction<
      typeof AmazonSesProjectRole.getSession
    > = jest.spyOn(AmazonSesProjectRole, "getSession").mockResolvedValue({
      credentials: {
        accessKeyId: "ASIASESSION000000001",
        secretAccessKey: "session-secret",
        sessionToken: "session-token",
      },
      key: "key",
    });

    const result: RouteCall = await call("POST", "/test", {
      body: {
        smtpConfigId: configId.toString(),
        toEmail: "someone@example.com",
      },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(sessionSpy).toHaveBeenCalledWith({
      projectId: projectId.toString(),
      configId: configId.toString(),
      roleArn: ROLE_ARN,
      region: "eu-west-1",
      checksAfresh: true,
    });
    expect(MailService.send).toHaveBeenCalledTimes(1);
  });

  test("a role that is refused sends nothing, and the dialog is told why in OneUptime's words", async () => {
    for (const refusal of [
      AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
      AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
    ]) {
      jest.clearAllMocks();
      jest
        .spyOn(AmazonSesProjectRole, "getSession")
        .mockRejectedValue(
          new AmazonSesRoleSignInError(refusal, { isRetryable: false }),
        );

      const result: RouteCall = await call("POST", "/test", {
        body: {
          smtpConfigId: configId.toString(),
          toEmail: "someone@example.com",
        },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Exception).message).toBe(refusal);
      expect(MailService.send).not.toHaveBeenCalled();
    }
  });

  test("an access key config is not checked as a role", async () => {
    const sessionSpy: jest.SpiedFunction<
      typeof AmazonSesProjectRole.getSession
    > = jest.spyOn(AmazonSesProjectRole, "getSession");
    const config: ProjectSmtpConfig = roleConfig();

    config.amazonSesAuthenticationType =
      ProjectAmazonSesAuthenticationType.AccessKey;
    config.amazonSesAccessKeyId = "AKIAIOSFODNN7EXAMPLE";
    config.amazonSesSecretAccessKey =
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    jest
      .spyOn(ProjectSMTPConfigService, "findOneById")
      .mockResolvedValue(config);

    const result: RouteCall = await call("POST", "/test", {
      body: {
        smtpConfigId: configId.toString(),
        toEmail: "someone@example.com",
      },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(MailService.send).toHaveBeenCalledTimes(1);
  });
});
