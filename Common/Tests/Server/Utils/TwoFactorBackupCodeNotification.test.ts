import TwoFactorBackupCodeNotification from "../../../Server/Utils/TwoFactorBackupCodeNotification";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import Dictionary from "../../../Types/Dictionary";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The out-of-band notice that a set of recovery codes was just created.
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE ROUTES THAT SEND IT
 *
 * Until issue #3382 was fixed, backup codes only came into existence when a
 * user personally pressed a button on their own profile page, and that route
 * mailed them about it. Codes are now minted by ENROLMENT instead -- verifying
 * a first authenticator app, registering a first security key, or completing a
 * mandated enrolment at sign-in -- which moved the creation of ten sign-in
 * credentials onto routes that are authenticated by a session or by a password
 * alone. Somebody holding a stolen session can register a security key of
 * their own and walk away with the account's recovery codes; somebody holding
 * a stolen password can complete a mandated enrolment. Neither is prevented by
 * this mail. Both become VISIBLE to the real owner because of it, at the
 * address on the account rather than in the browser that did it, which is the
 * same bargain the regenerate route already struck.
 *
 * EVERY ASSERTION BELOW IS A SILENT FAILURE.
 *
 *  - the codes must never be in the mail. They are a sign-in credential, and
 *    mailing them hands the account to whoever later reads the mailbox --
 *    which is exactly the thing a second factor exists to stop. Nothing about
 *    the vars bag makes that obvious, so it is asserted directly;
 *  - the address must come off the ACCOUNT, never from the caller. A caller
 *    proved which user they are; it did not prove where that user's mail
 *    should go, and a notice that can be redirected is worth nothing;
 *  - it must never throw into its caller. Every call site runs inside a
 *    request whose response carries the only copy of the plaintext codes, so
 *    an unreachable SMTP server that propagated would destroy the very thing
 *    the mail is announcing.
 *
 * SIBLING FILES: Common/Tests/Server/API/UserTwoFactorBackupCodeAPI.test.ts
 * owns the "codes were REPLACED" mail on the self-service regenerate route,
 * which is a different template with different copy; nothing here repeats it.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

type SpyLike = ReturnType<typeof getJestSpyOn>;

let sendMailSpy: SpyLike;
let findOneByIdSpy: SpyLike;
let loggerErrorSpy: SpyLike;

type StubUserFunction = (email: string | null) => void;

/*
 * `findOneById` is what reads the address off the account. A null user stands
 * in for a deleted account, and a user with no email for one that never
 * verified one -- both reachable, and both must end in silence rather than a
 * throw.
 */
const stubUser: StubUserFunction = (email: string | null): void => {
  findOneByIdSpy.mockImplementation(async (): Promise<User | null> => {
    if (email === null) {
      return null;
    }

    const user: User = new User();
    user.id = USER_ID;
    user.email = new Email(email);
    return user;
  });
};

describe("TwoFactorBackupCodeNotification", () => {
  beforeEach(() => {
    sendMailSpy = getJestSpyOn(MailService, "sendMail");
    sendMailSpy.mockImplementation(async (): Promise<void> => {
      return;
    });

    findOneByIdSpy = getJestSpyOn(UserService, "findOneById");
    stubUser("owner@example.com");

    loggerErrorSpy = getJestSpyOn(logger, "error");
    loggerErrorSpy.mockImplementation((): void => {
      return;
    });

    getJestSpyOn(DatabaseConfig, "getHost").mockImplementation(
      async (): Promise<Hostname> => {
        return new Hostname("oneuptime.example.com");
      },
    );

    getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockImplementation(
      async (): Promise<Protocol> => {
        return Protocol.HTTPS;
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("mails the address on the account, not one supplied by the caller", async () => {
    await TwoFactorBackupCodeNotification.sendCodesCreatedEmail({
      userId: USER_ID,
      codeCount: 10,
    });

    expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

    const lookup: { id: ObjectID; props: JSONObject } = (
      findOneByIdSpy.mock.calls[0] as Array<{
        id: ObjectID;
        props: JSONObject;
      }>
    )[0]!;

    expect(lookup.id.toString()).toBe(USER_ID.toString());
    expect(lookup.props["isRoot"]).toBe(true);

    expect(sendMailSpy).toHaveBeenCalledTimes(1);

    const mail: { toEmail: Email } = (
      sendMailSpy.mock.calls[0] as Array<{ toEmail: Email }>
    )[0]!;

    expect(mail.toEmail.toString()).toBe("owner@example.com");
  });

  test("uses the created template, not the replaced one", async () => {
    await TwoFactorBackupCodeNotification.sendCodesCreatedEmail({
      userId: USER_ID,
      codeCount: 10,
    });

    const mail: { templateType: EmailTemplateType; subject: string } = (
      sendMailSpy.mock.calls[0] as Array<{
        templateType: EmailTemplateType;
        subject: string;
      }>
    )[0]!;

    /*
     * The regenerate mail tells the reader every code they were holding has
     * stopped working. Sent to somebody who has just SET UP two factor auth
     * for the first time, that sentence describes an event that did not happen
     * and sends them looking for a list they never had.
     */
    expect(mail.templateType).toBe(
      EmailTemplateType.TwoFactorBackupCodesCreated,
    );
    expect(mail.templateType).not.toBe(
      EmailTemplateType.TwoFactorBackupCodesRegenerated,
    );
    expect(mail.subject.toLowerCase()).toContain("backup codes");
  });

  test("never puts a code in the mail", async () => {
    await TwoFactorBackupCodeNotification.sendCodesCreatedEmail({
      userId: USER_ID,
      codeCount: 10,
    });

    const mail: { vars: Dictionary<string> } = (
      sendMailSpy.mock.calls[0] as Array<{ vars: Dictionary<string> }>
    )[0]!;

    /*
     * Asserted as "the bag holds exactly these four keys" rather than "it does
     * not hold a `codes` key", because the failure being guarded is somebody
     * ADDING one -- under any name -- while making the mail more helpful.
     */
    expect(Object.keys(mail.vars).sort()).toEqual([
      "generatedAt",
      "homeUrl",
      "newCodeCount",
      "twoFactorAuthUrl",
    ]);

    expect(mail.vars["newCodeCount"]).toBe("10");
  });

  test("links to the page where the owner can replace the set", async () => {
    await TwoFactorBackupCodeNotification.sendCodesCreatedEmail({
      userId: USER_ID,
      codeCount: 10,
    });

    const mail: { vars: Dictionary<string> } = (
      sendMailSpy.mock.calls[0] as Array<{ vars: Dictionary<string> }>
    )[0]!;

    /*
     * The mail's whole value to somebody who did NOT do this is that the next
     * click is the one that fixes it. A link to the dashboard root would leave
     * them hunting through a settings tree while an attacker holds their
     * recovery codes.
     */
    expect(String(mail.vars["twoFactorAuthUrl"])).toContain(
      "/user-profile/two-factor-auth",
    );
    expect(String(mail.vars["twoFactorAuthUrl"])).toContain("https://");
  });

  test("says nothing when the account has no address to say it to", async () => {
    stubUser(null);

    await TwoFactorBackupCodeNotification.sendCodesCreatedEmail({
      userId: USER_ID,
      codeCount: 10,
    });

    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  test("does not throw into the caller when the mail server is unreachable", async () => {
    sendMailSpy.mockImplementation(async (): Promise<void> => {
      throw new Error("SMTP unreachable");
    });

    /*
     * `notifyCodesCreated` is the shape every call site uses, and it is the
     * shape that matters: the codes are already written and already on their
     * way to the user's screen when it runs. A rejection escaping here would
     * fail the request carrying the only copy of them.
     */
    expect(() => {
      TwoFactorBackupCodeNotification.notifyCodesCreated({
        userId: USER_ID,
        codeCount: 10,
      });
    }).not.toThrow();

    await new Promise((resolve: (value: void) => void) => {
      setTimeout(resolve, 0);
    });

    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  test("does not throw into the caller when the account lookup fails", async () => {
    findOneByIdSpy.mockImplementation(async (): Promise<User | null> => {
      throw new Error("Database not connected");
    });

    expect(() => {
      TwoFactorBackupCodeNotification.notifyCodesCreated({
        userId: USER_ID,
        codeCount: 10,
      });
    }).not.toThrow();

    await new Promise((resolve: (value: void) => void) => {
      setTimeout(resolve, 0);
    });

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(sendMailSpy).not.toHaveBeenCalled();
  });
});
