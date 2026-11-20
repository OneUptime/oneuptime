import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import RequestOrigin from "../../../Types/RequestOrigin";
import Timezone from "../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * ---------------------------------------------------------------------------
 * "YOUR PASSWORD WAS CHANGED" SAYS WHEN, AND FROM WHERE.
 *
 * Every change of a password - the reset link, the profile page, a server
 * admin's Set Password - goes through UserService.onUpdateSuccess, which
 * mails the account's owner. The email now says when, in the owner's own
 * time zone, and - when a request made the change and its props carry where
 * it came from (requestOrigin, set by CommonAPI or the reset route) - the IP
 * address, roughly where and the device. It offers a reset, for somebody who
 * did not change it.
 *
 * An account given its first password - an invited person claiming their
 * account at sign-up - had nothing changed, and is not mailed (#7472).
 *
 * No database: the services the hook calls are jest.spyOn stubs, and the
 * protected hooks are reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Chrome 130 on macOS",
};

interface UserServiceInternals {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
  findRowsAndHoldUpdateToThem: (
    updateBy: UpdateBy<User>,
    select: Record<string, boolean>,
  ) => Promise<Array<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

/*
 * An account as onBeforeUpdate reads it for a password write: with the
 * password it had, which a stored row holds hashed. `hadPassword: false` is
 * an invited account nobody has signed up to yet.
 */
function account(data: {
  id: ObjectID;
  email: string;
  timezone?: Timezone | undefined;
  hadPassword?: boolean | undefined;
}): User {
  const user: User = new User();
  user.id = data.id;
  user.email = new Email(data.email);

  if (data.hadPassword !== false) {
    user.password = new HashedString("an-old-password-hash", true);
  }

  if (data.timezone) {
    user.timezone = data.timezone;
  }

  return user;
}

function passwordUpdate(data: {
  props?: DatabaseCommonInteractionProps | undefined;
  carryForward: Array<User>;
}): OnUpdate<User> {
  const updateBy: UpdateBy<User> = {
    query: { _id: USER_ID.toString() } as unknown as UpdateBy<User>["query"],
    data: {
      password: "a new river lantern",
    } as unknown as UpdateBy<User>["data"],
    props: data.props || { isRoot: true },
    limit: 1,
    skip: 0,
  };

  return { updateBy, carryForward: data.carryForward };
}

type SentMail = {
  toEmail: Email;
  subject: string;
  templateType: EmailTemplateType;
  vars: Record<string, string>;
};

let sendMail: jest.SpyInstance;

function sentMails(): Array<SentMail> {
  return sendMail.mock.calls.map((call: Array<unknown>): SentMail => {
    return call[0] as SentMail;
  });
}

beforeEach(() => {
  // Every session here has confirmed it's its person's (#10155).
  confirmEverySession();

  sendMail = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);

  jest.spyOn(TwoFactorWrongCodes, "forget").mockResolvedValue(undefined);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));

  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a changed password is mailed to its owner", () => {
  test("once, to the address on the account, as it always was", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    expect(sentMails()).toHaveLength(1);

    const mail: SentMail = sentMails()[0]!;

    expect(mail.toEmail.toString()).toBe("owner@example.com");
    expect(mail.subject).toBe("Password Changed.");
    expect(mail.templateType).toBe(EmailTemplateType.PasswordChanged);
  });

  test("says from which address, roughly where and on which device", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestLocation"]).toBe("Berlin, Germany");
    expect(vars["requestDevice"]).toBe("Chrome 130 on macOS");
  });

  test("says when, in the owner's own time zone", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [
          account({
            id: USER_ID,
            email: "owner@example.com",
            timezone: Timezone.AsiaKolkata,
          }),
        ],
      }),
      [USER_ID],
    );

    expect(sentMails()[0]!.vars["requestedAt"]).toContain("IST");
  });

  test("an owner without a time zone of their own reads the time in UTC", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    expect(sentMails()[0]!.vars["requestedAt"]).toContain("UTC");
  });

  test("offers the installation's own reset, for somebody who did not change it", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    const vars: Record<string, string> = sentMails()[0]!.vars;
    const forgotPassword: URL = new URL(vars["forgotPasswordUrl"]!);

    expect(forgotPassword.origin).toBe("https://oneuptime.example.com");
    expect(forgotPassword.pathname).toBe("/accounts/forgot-password");
    expect(new URL(vars["homeURL"]!).origin).toBe(
      "https://oneuptime.example.com",
    );
  });

  /*
   * A server admin's Set Password writes with props of its own, and no
   * request of the owner's is behind it: the email says when, and nothing
   * about a device that was not theirs.
   */
  test("a change no request describes says when alone", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestedAt"]!.length).toBeGreaterThan(0);
    expect(vars["requestIpAddress"]).toBe("");
    expect(vars["requestLocation"]).toBe("");
    expect(vars["requestDevice"]).toBe("");
  });

  test("a request whose device nobody could name says so", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: {
          isRoot: true,
          requestOrigin: { ipAddress: "198.51.100.5" },
        },
        carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
      }),
      [USER_ID],
    );

    const vars: Record<string, string> = sentMails()[0]!.vars;

    expect(vars["requestIpAddress"]).toBe("198.51.100.5");
    expect(vars["requestDevice"]).toBe("Unknown device");
    expect(vars["requestLocation"]).toBe("");
  });

  test("every account a write changed is mailed, each in its own time zone", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [
          account({
            id: USER_ID,
            email: "first@example.com",
            timezone: Timezone.EuropeBerlin,
          }),
          account({
            id: OTHER_USER_ID,
            email: "second@example.com",
            timezone: Timezone.AmericaNew_York,
          }),
        ],
      }),
      [USER_ID, OTHER_USER_ID],
    );

    expect(
      sentMails().map((mail: SentMail): string => {
        return mail.toEmail.toString();
      }),
    ).toEqual(["first@example.com", "second@example.com"]);
    expect(sentMails()[0]!.vars["requestedAt"]).toMatch(/CES?T/);
    expect(sentMails()[1]!.vars["requestedAt"]).toMatch(/E[SD]T/);
  });

  test("a write that does not change a password mails nothing", async () => {
    const update: OnUpdate<User> = passwordUpdate({
      props: { isRoot: true, requestOrigin: ORIGIN },
      carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
    });
    update.updateBy.data = {
      name: "Renamed",
    } as unknown as UpdateBy<User>["data"];

    await userService().onUpdateSuccess(update, [USER_ID]);

    expect(sentMails()).toHaveLength(0);
  });
});

/*
 * An invitation makes an account with no password; signing up from it gives
 * the account its first one (Authentication's /signup, the invited-account
 * branch). Nothing was changed: the person who just chose it was told "Your
 * password was changed ... someone else can get into your account" seconds
 * later (#7472).
 */
describe("a first password is not a change", () => {
  test("an account that had no password is not mailed", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [
          account({
            id: USER_ID,
            email: "invited@example.com",
            hadPassword: false,
          }),
        ],
      }),
      [USER_ID],
    );

    expect(sentMails()).toHaveLength(0);
  });

  test("its sessions still end and its wrong two factor codes are still forgotten, as for any new password", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true },
        carryForward: [
          account({
            id: USER_ID,
            email: "invited@example.com",
            hadPassword: false,
          }),
        ],
      }),
      [USER_ID],
    );

    expect(UserSessionService.revokeAllSessionsByUserId).toHaveBeenCalledTimes(
      1,
    );
    expect(
      String(
        (UserSessionService.revokeAllSessionsByUserId as unknown as jest.Mock)
          .mock.calls[0]![0],
      ),
    ).toBe(USER_ID.toString());
    expect(
      String(
        (TwoFactorWrongCodes.forget as unknown as jest.Mock).mock.calls[0]![0],
      ),
    ).toBe(USER_ID.toString());
  });

  test("a write that changes two accounts mails only the one that had a password", async () => {
    await userService().onUpdateSuccess(
      passwordUpdate({
        props: { isRoot: true, requestOrigin: ORIGIN },
        carryForward: [
          account({
            id: USER_ID,
            email: "invited@example.com",
            hadPassword: false,
          }),
          account({
            id: OTHER_USER_ID,
            email: "owner@example.com",
          }),
        ],
      }),
      [USER_ID, OTHER_USER_ID],
    );

    expect(
      sentMails().map((mail: SentMail): string => {
        return mail.toEmail.toString();
      }),
    ).toEqual(["owner@example.com"]);
    expect(sentMails()[0]!.templateType).toBe(
      EmailTemplateType.PasswordChanged,
    );
  });

  /*
   * The reset link, the profile page and a master admin's Set Password all
   * write a password over the one the account had: each is still mailed.
   */
  test.each([
    ["the reset link's page", { isRoot: true, requestOrigin: ORIGIN }],
    ["the profile page", { userId: USER_ID, requestOrigin: ORIGIN }],
    ["a master admin's Set Password", { isRoot: true }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "a password changed from %s is still mailed",
    async (_how: string, props: DatabaseCommonInteractionProps) => {
      await userService().onUpdateSuccess(
        passwordUpdate({
          props: props,
          carryForward: [account({ id: USER_ID, email: "owner@example.com" })],
        }),
        [USER_ID],
      );

      expect(sentMails()).toHaveLength(1);
      expect(sentMails()[0]!.subject).toBe("Password Changed.");
    },
  );
});

/*
 * The two hooks together, as an update runs them: onBeforeUpdate reads the
 * rows the write changes, and onUpdateSuccess mails from what it read. The
 * read stands in for the table: it answers each column the select asks for,
 * and nothing else, so an account is mailed only if the read asked whether
 * it had a password and it had one.
 */
describe("from the read before the write to the email after it", () => {
  type StoredAccount = {
    id: ObjectID;
    email: string;
    password: HashedString | null;
  };

  async function writePassword(
    stored: Array<StoredAccount>,
  ): Promise<Array<SentMail>> {
    jest
      .spyOn(
        userService() as unknown as Record<string, () => unknown>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockImplementation((async (
        _updateBy: UpdateBy<User>,
        select: Record<string, boolean>,
      ): Promise<Array<User>> => {
        return stored.map((row: StoredAccount): User => {
          const user: User = new User();
          user.id = row.id;
          user.email = new Email(row.email);

          if (select["password"] && row.password) {
            user.password = row.password;
          }

          return user;
        });
      }) as never);

    const update: OnUpdate<User> = passwordUpdate({ carryForward: [] });
    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update.updateBy,
    );

    await userService().onUpdateSuccess(
      onUpdate,
      stored.map((row: StoredAccount): ObjectID => {
        return row.id;
      }),
    );

    return sentMails();
  }

  test("an invited person signing up - no password yet - is sent nothing", async () => {
    expect(
      await writePassword([
        { id: USER_ID, email: "invited@example.com", password: null },
      ]),
    ).toEqual([]);
  });

  test("an account with a password is told it changed", async () => {
    const mails: Array<SentMail> = await writePassword([
      {
        id: USER_ID,
        email: "owner@example.com",
        password: new HashedString("an-old-password-hash", true),
      },
    ]);

    expect(
      mails.map((mail: SentMail): string => {
        return `${mail.toEmail.toString()} ${mail.subject}`;
      }),
    ).toEqual(["owner@example.com Password Changed."]);
  });
});

describe("the accounts a password write changes are read with their time zone", () => {
  test("onBeforeUpdate reads each one's address, time zone and whether it had a password", async () => {
    const findRows: jest.SpyInstance = jest
      .spyOn(
        userService() as unknown as Record<string, () => unknown>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([] as never);

    await userService().onBeforeUpdate(
      passwordUpdate({ carryForward: [] }).updateBy,
    );

    expect(findRows).toHaveBeenCalledTimes(1);
    expect(findRows.mock.calls[0]![1]).toEqual({
      _id: true,
      email: true,
      timezone: true,
      password: true,
    });
  });

  test("a new email address alone does not read the password", async () => {
    const findRows: jest.SpyInstance = jest
      .spyOn(
        userService() as unknown as Record<string, () => unknown>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        userService() as unknown as Record<string, () => unknown>,
        "expirePasswordResetTokensForEmailChange",
      )
      .mockResolvedValue(undefined as never);

    const updateBy: UpdateBy<User> = passwordUpdate({
      carryForward: [],
    }).updateBy;
    updateBy.data = {
      email: new Email("new-address@example.com"),
    } as unknown as UpdateBy<User>["data"];

    await userService().onBeforeUpdate(updateBy);

    expect(findRows).toHaveBeenCalledTimes(1);
    expect(findRows.mock.calls[0]![1]).toEqual({
      _id: true,
      email: true,
      timezone: true,
    });
  });
});
