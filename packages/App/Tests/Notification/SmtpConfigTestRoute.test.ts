import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import ProjectSMTPConfigService from "Common/Server/Services/ProjectSmtpConfigService";
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
import EmailServer from "Common/Types/Email/EmailServer";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import MailTransportType from "Common/Types/Email/MailTransportType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import Hostname from "Common/Types/API/Hostname";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
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
  test,
} from "@jest/globals";

/*
 * POST /api/notification/smtp-config/test - the "Send Test Email" button on
 * Project Settings > Custom SMTP.
 *
 * This is the server half of OneUptime issue #3920 ("Can't test SMTP
 * connection"). The route is custom rather than model CRUD, and the work it
 * does runs as root: it reads the ProjectSmtpConfig named in the body with
 * `isRoot: true` so it can see the password, then opens a connection to
 * whatever mail server that row points at. So it has to prove two things for
 * itself, exactly like the other project-scoped custom routes:
 *
 *   1. the caller is an authenticated member of the project they claimed in
 *      the `tenantid` header (CommonAPI.assertAuthenticatedProjectMember), and
 *   2. the config they named actually belongs to that project
 *      (CommonAPI.assertResourceBelongsToProject) - otherwise a member of
 *      project A reaches project B's SMTP credentials just by sending their
 *      own header.
 *
 * Check (1) is what the bug report was. The Dashboard reached this route with
 * a raw API.post and no headers, so there was no project to check and every
 * click answered "Project ID is required" - the error in the screenshot on the
 * issue. The client-side fix is pinned by
 * Tests/Dashboard/DashboardRequestsNameTheirProject.test.ts; what is pinned
 * here is that the server is RIGHT to refuse, so nobody "fixes" the report by
 * deleting the guard and reopening the cross-tenant hole it closes.
 *
 * The route is a module-level Express registration with no extractable
 * handler, so the router is mocked and the handler invoked directly, the same
 * way the sibling PhoneNumberAPI and ProjectScopedCustomRouteAuth suites do.
 * CommonAPI itself is NOT mocked - the guards under test are its real ones.
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
import "../../FeatureSet/Notification/API/SMTPConfig";

const TEST_ROUTE: string = "/test";
const TO_EMAIL: string = "someone@example.com";

/* The fast-fail the route asks MailService for, so a bad host does not hang. */
const TEST_TIMEOUT_MS: number = 4000;

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function buildMemberProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [memberPermission],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

/*
 * What a signed-in user's request looked like before the fix: authenticated,
 * a member of their project - and no tenant at all, because the raw API.post
 * sent no `tenantid` header and ProjectMiddleware.getProjectId had nothing
 * else to read.
 */
function buildPropsWithoutTenant(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = buildMemberProps(data);

  delete (props as { tenantId?: ObjectID | undefined }).tenantId;

  return props;
}

function buildConfig(data: {
  configId: ObjectID;
  projectId: ObjectID;
}): ProjectSmtpConfig {
  const config: ProjectSmtpConfig = new ProjectSmtpConfig();
  config.id = data.configId;
  config.projectId = data.projectId;
  config.hostname = Hostname.fromString("smtp.sendgrid.net");
  config.port = new Port(587);
  config.username = "apikey";
  config.password = "a-secret";
  config.fromEmail = new Email("noreply@example.com");
  config.fromName = "OneUptime";
  config.secure = false;

  return config;
}

function buildEmailServer(data: {
  configId: ObjectID;
  transportType?: MailTransportType | undefined;
  authType?: SMTPAuthenticationType | undefined;
}): EmailServer {
  return {
    id: data.configId,
    host: Hostname.fromString("smtp.sendgrid.net"),
    port: new Port(587),
    username: "apikey",
    password: "a-secret",
    fromEmail: new Email("noreply@example.com"),
    fromName: "OneUptime",
    secure: false,
    ...(data.transportType ? { transportType: data.transportType } : {}),
    ...(data.authType ? { authType: data.authType } : {}),
  } as EmailServer;
}

async function callTestRoute(
  body: Dictionary<string>,
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", TEST_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

describe("POST /smtp-config/test", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;
  let configId: ObjectID;
  let findOneByIdSpy: jest.SpyInstance;
  let toEmailServerSpy: jest.SpyInstance;
  let propsSpy: jest.SpyInstance;

  beforeAll(() => {
    /*
     * Importing the route module registered it on the mock router, so the
     * handler under test is the real one Express would call.
     */
    expect(mockRouter.match("POST", TEST_ROUTE)).toBeDefined();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    configId = ObjectID.generate();

    findOneByIdSpy = jest.spyOn(ProjectSMTPConfigService, "findOneById");
    toEmailServerSpy = jest.spyOn(ProjectSMTPConfigService, "toEmailServer");
    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    propsSpy.mockResolvedValue(props);
  }

  function mockConfigInProject(projectId: ObjectID | null): void {
    if (!projectId) {
      findOneByIdSpy.mockResolvedValue(null);
      return;
    }

    findOneByIdSpy.mockResolvedValue(
      buildConfig({ configId: configId, projectId: projectId }),
    );
    toEmailServerSpy.mockReturnValue(buildEmailServer({ configId: configId }));
  }

  /*
   * The regression. A signed-in project member clicks "Send Test Email"; the
   * browser sends no `tenantid`; the route refuses. This is the exact error in
   * the issue's screenshot, and the shape of the request that produced it.
   */
  describe("when the request carries no project (issue #3920)", () => {
    beforeEach(() => {
      mockProps(
        buildPropsWithoutTenant({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockConfigInProject(callerProjectId);
    });

    test('refuses with BadDataException "Project ID is required"', async () => {
      const result: RouteCallResult = await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(result.nextCallCount).toBe(1);
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Exception).message).toBe(
        "Project ID is required",
      );
    });

    /*
     * The guard runs before the root read, so an unscoped request cannot even
     * be used to learn whether a config id exists.
     */
    test("never reads the SMTP config and never sends mail", async () => {
      await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(MailService.send).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });

  /*
   * A caller with no credentials at all is a different answer: 401, not 400.
   * The browser client refreshes the session and replays the request on a 401
   * and on nothing else, so an expired session has to look like one.
   */
  test("refuses an unauthenticated caller with NotAuthenticatedException (401)", async () => {
    mockProps({});
    mockConfigInProject(callerProjectId);

    const result: RouteCallResult = await callTestRoute({
      smtpConfigId: configId.toString(),
      toEmail: TO_EMAIL,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expect((result.thrownToNext as Exception).code).toBe(
      ExceptionCode.NotAuthenticatedException,
    );
    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(MailService.send).not.toHaveBeenCalled();
  });

  describe("when the caller is a member of the config's own project", () => {
    beforeEach(() => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      mockConfigInProject(callerProjectId);
      (MailService.send as unknown as jest.Mock).mockResolvedValue(undefined);
    });

    test("sends the test email and answers success", async () => {
      const result: RouteCallResult = await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(result.nextCallCount).toBe(0);
      expect(MailService.send).toHaveBeenCalledTimes(1);
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    test("sends to the requested address with the SMTPTest template", async () => {
      await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      const mail: {
        templateType: EmailTemplateType;
        toEmail: Email;
        subject: string;
      } = (MailService.send as unknown as jest.Mock).mock.calls[0]![0] as {
        templateType: EmailTemplateType;
        toEmail: Email;
        subject: string;
      };

      expect(mail.templateType).toBe(EmailTemplateType.SMTPTest);
      expect(mail.toEmail.toString()).toBe(TO_EMAIL);
      expect(mail.subject).toBe("Test Email from OneUptime");
    });

    /*
     * The send is billed and logged against the config's OWN project, not the
     * header the caller sent. Those are the same project by the time we get
     * here - assertResourceBelongsToProject has just said so - but taking it
     * from the row is what keeps that true if the guard above ever changes.
     */
    test("bills the send to the config's project and asks for the fast-fail timeout", async () => {
      await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      const options: {
        emailServer: EmailServer;
        projectId: ObjectID;
        timeout: number;
      } = (MailService.send as unknown as jest.Mock).mock.calls[0]![1] as {
        emailServer: EmailServer;
        projectId: ObjectID;
        timeout: number;
      };

      expect(options.projectId.toString()).toBe(callerProjectId.toString());
      expect(options.timeout).toBe(TEST_TIMEOUT_MS);
      expect(options.emailServer.id!.toString()).toBe(configId.toString());
    });

    /*
     * The ownership check can only work if the read asks for the column it
     * compares. Pin the inputs, not just the outcome.
     */
    test("reads the config as root and selects its projectId", async () => {
      await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

      const readArgs: {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      } = findOneByIdSpy.mock.calls[0]![0] as {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      };

      expect(readArgs.id.toString()).toBe(configId.toString());
      expect(readArgs.select["projectId"]).toBe(true);
      expect(readArgs.props["isRoot"]).toBe(true);
    });
  });

  /*
   * Membership in SOME project is not membership in the config's project. A
   * member of project A who sends their own header while naming project B's
   * config id must be refused - otherwise the route is a way to make another
   * tenant's mail server send mail, and to learn which config ids exist.
   */
  test("refuses a member of a different project naming this config", async () => {
    mockProps(
      buildMemberProps({
        projectId: callerProjectId,
        userId: callerUserId,
      }),
    );
    mockConfigInProject(otherProjectId);

    const result: RouteCallResult = await callTestRoute({
      smtpConfigId: configId.toString(),
      toEmail: TO_EMAIL,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(MailService.send).not.toHaveBeenCalled();
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("refuses when the named config does not exist", async () => {
    mockProps(
      buildMemberProps({
        projectId: callerProjectId,
        userId: callerUserId,
      }),
    );
    mockConfigInProject(null);

    await callTestRoute({
      smtpConfigId: configId.toString(),
      toEmail: TO_EMAIL,
    });

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(
      (Response.sendErrorResponse as unknown as jest.Mock).mock.calls[0]![2],
    ).toBeInstanceOf(BadDataException);
    expect(MailService.send).not.toHaveBeenCalled();
  });

  test("refuses a config that cannot be converted to a mail server", async () => {
    mockProps(
      buildMemberProps({
        projectId: callerProjectId,
        userId: callerUserId,
      }),
    );
    findOneByIdSpy.mockResolvedValue(
      buildConfig({ configId: configId, projectId: callerProjectId }),
    );
    toEmailServerSpy.mockReturnValue(undefined);

    await callTestRoute({
      smtpConfigId: configId.toString(),
      toEmail: TO_EMAIL,
    });

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(MailService.send).not.toHaveBeenCalled();
  });

  /*
   * What the user is told when the send itself fails. The three transports
   * fail for different reasons and each gets its own advice; a caller who has
   * got this far is an authorised member of the project whose mail server it
   * is, so passing the provider's own message through is information they own.
   */
  describe("when the send fails", () => {
    beforeEach(() => {
      mockProps(
        buildMemberProps({
          projectId: callerProjectId,
          userId: callerUserId,
        }),
      );
      findOneByIdSpy.mockResolvedValue(
        buildConfig({ configId: configId, projectId: callerProjectId }),
      );
      (MailService.send as unknown as jest.Mock).mockRejectedValue(
        new Error("535 Incorrect authentication data"),
      );
    });

    test("passes the provider's message through for Microsoft Graph", async () => {
      toEmailServerSpy.mockReturnValue(
        buildEmailServer({
          configId: configId,
          transportType: MailTransportType.MicrosoftGraph,
        }),
      );

      const result: RouteCallResult = await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Exception).message).toContain(
        "Microsoft Graph send failed",
      );
      expect((result.thrownToNext as Exception).message).toContain(
        "535 Incorrect authentication data",
      );
    });

    test("explains the OAuth checklist for OAuth SMTP", async () => {
      toEmailServerSpy.mockReturnValue(
        buildEmailServer({
          configId: configId,
          transportType: MailTransportType.SMTP,
          authType: SMTPAuthenticationType.OAuth,
        }),
      );

      const result: RouteCallResult = await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Exception).message).toContain(
        "OAuth authentication",
      );
      expect((result.thrownToNext as Exception).message).toContain(
        "535 Incorrect authentication data",
      );
    });

    test("falls back to the SMTP checklist for username/password", async () => {
      toEmailServerSpy.mockReturnValue(
        buildEmailServer({
          configId: configId,
          transportType: MailTransportType.SMTP,
          authType: SMTPAuthenticationType.UsernamePassword,
        }),
      );

      const result: RouteCallResult = await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Exception).message).toContain(
        "Cannot send email",
      );
    });

    test("does not answer success", async () => {
      toEmailServerSpy.mockReturnValue(
        buildEmailServer({ configId: configId }),
      );

      await callTestRoute({
        smtpConfigId: configId.toString(),
        toEmail: TO_EMAIL,
      });

      expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
    });
  });
});
