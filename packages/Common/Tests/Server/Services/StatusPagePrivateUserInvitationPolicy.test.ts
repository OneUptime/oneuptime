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
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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
