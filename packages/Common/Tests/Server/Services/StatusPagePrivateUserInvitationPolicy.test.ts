import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import MailService from "../../../Server/Services/MailService";
import { Service } from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import logger from "../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A status page's "require SSO" is an Enterprise Edition control: honoured
 * while SSO is active (EnterpriseEdition.isFeatureActive(SSO)), relaxed on the
 * Community Edition and on an Enterprise install whose license lapsed, where
 * status page SSO login does not exist or refuses. Billing and the edition are
 * pinned so the suite tests the same thing locally and in CI (whose
 * config.env sets BILLING_ENABLED=true).
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

class TestService extends Service {
  public async completeCreation(
    user: StatusPagePrivateUser,
  ): Promise<StatusPagePrivateUser> {
    return await this.onCreateSuccess(
      {
        createBy: { data: user, props: { isRoot: true } },
        carryForward: null,
      },
      user,
    );
  }
}

const FROZEN_NOW: Date = new Date("2026-09-17T10:00:00.000Z");
const STATUS_PAGE_URL: string = "https://status.example.com";

describe("StatusPagePrivateUserService invitation login policy", () => {
  let service: TestService;
  let user: StatusPagePrivateUser;
  let statusPage: StatusPage;
  let update: jest.SpyInstance;
  let sendMail: jest.SpyInstance;
  let findStatusPage: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);
    setTestBillingEnabled(false);
    installFakeEnterpriseModule();

    service = new TestService();
    statusPage = new StatusPage();
    statusPage.id = ObjectID.generate();
    statusPage.projectId = ObjectID.generate();
    statusPage.name = "Example status";
    statusPage.requireSsoForLogin = false;

    user = new StatusPagePrivateUser();
    user.id = ObjectID.generate();
    user.statusPageId = statusPage.id!;
    user.projectId = statusPage.projectId!;
    user.email = new Email("private-user@example.com");
    user.isSsoUser = false;

    update = getJestSpyOn(service, "updateOneById").mockResolvedValue(1);
    sendMail = getJestSpyOn(MailService, "sendMail").mockResolvedValue(
      undefined,
    );
    findStatusPage = getJestSpyOn(
      StatusPageService,
      "findOneById",
    ).mockResolvedValue(statusPage);
    getJestSpyOn(StatusPageService, "getStatusPageURL").mockResolvedValue(
      STATUS_PAGE_URL,
    );
    getJestSpyOn(DatabaseConfig, "getHost").mockResolvedValue(
      new Hostname("status.example.com"),
    );
    getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockResolvedValue(
      Protocol.HTTPS,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
  });

  test.each([false, undefined])(
    "SCIM and admin-created users with isSsoUser=%s receive no password link when the page requires SSO",
    async (isSsoUser: boolean | undefined) => {
      if (isSsoUser === undefined) {
        delete user.isSsoUser;
      } else {
        user.isSsoUser = isSsoUser;
      }
      statusPage.requireSsoForLogin = true;

      await expect(service.completeCreation(user)).resolves.toBe(user);

      expect(findStatusPage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: user.statusPageId,
          select: expect.objectContaining({ requireSsoForLogin: true }),
        }),
      );
      expect(update).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(StatusPageService.getStatusPageURL).not.toHaveBeenCalled();
    },
  );

  test("the requirement still holds on the Enterprise Edition during the grace period", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("grace"),
    });
    statusPage.requireSsoForLogin = true;

    await expect(service.completeCreation(user)).resolves.toBe(user);

    expect(update).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test.each(["expired", "missing", "invalid"] as const)(
    "with a lapsed (%s) license a page that required SSO gets a usable password invitation, as on the Community Edition",
    async (status: "expired" | "missing" | "invalid") => {
      getJestSpyOn(logger, "warn").mockImplementation((): void => {
        return undefined;
      });
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus(status),
      });
      statusPage.requireSsoForLogin = true;

      await expect(service.completeCreation(user)).resolves.toBe(user);

      // Status page SSO refuses while the license is lapsed: without a password link the user could not sign in.
      expect(update).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateType: EmailTemplateType.StatusPageWelcomeEmail,
        }),
        expect.anything(),
      );
    },
  );

  test.each([false, true])(
    "on the Community Edition (billing=%p) a page that required SSO still gets a usable password invitation",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      uninstallEnterpriseModule();
      statusPage.requireSsoForLogin = true;

      await expect(service.completeCreation(user)).resolves.toBe(user);

      /*
       * Status page SSO does not exist on the Community Edition, so without a
       * password link the invited user would have no way to sign in at all.
       */
      expect(update).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateType: EmailTemplateType.StatusPageWelcomeEmail,
        }),
        expect.anything(),
      );
    },
  );

  test("SSO sign-ups do not create an unused password-reset credential", async () => {
    user.isSsoUser = true;

    await expect(service.completeCreation(user)).resolves.toBe(user);

    expect(findStatusPage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test("password-enabled pages still send a usable invitation and persist only its digest", async () => {
    await expect(service.completeCreation(user)).resolves.toBe(user);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    const invitation: {
      vars: { tokenVerifyUrl: string };
    } = sendMail.mock.calls[0]![0];
    const resetUrl: string = invitation.vars.tokenVerifyUrl;
    expect(resetUrl).toMatch(
      /^https:\/\/status\.example\.com\/reset-password\//,
    );
    const rawToken: string = resetUrl.split("/reset-password/")[1]!;
    expect(ObjectID.isValidUUID(rawToken)).toBe(true);
    const digest: string = await HashedString.hashValue(
      rawToken,
      EncryptionSecret,
    );

    expect(update).toHaveBeenCalledWith({
      id: user.id,
      data: {
        resetPasswordToken: digest,
        resetPasswordExpires: new Date("2026-09-18T10:00:00.000Z"),
      },
      props: { isRoot: true, ignoreHooks: true },
    });
    expect(digest).not.toBe(rawToken);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: user.email,
        templateType: EmailTemplateType.StatusPageWelcomeEmail,
      }),
      expect.objectContaining({ statusPageId: statusPage.id }),
    );
  });

  test("a missing status page cannot leave an unused reset credential", async () => {
    findStatusPage.mockResolvedValue(null);

    await expect(service.completeCreation(user)).rejects.toThrow(
      "Status Page not found",
    );

    expect(update).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
