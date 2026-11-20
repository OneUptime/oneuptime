import UserService from "../../../Server/Services/UserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EmailAddressChangedNotice, {
  EmailAddressChangedEvent,
} from "../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import EmailChangeConfirmation, {
  EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS,
} from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import User from "../../../Models/DatabaseModels/User";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  EmailAddressChangedBy,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RequestOrigin from "../../../Types/RequestOrigin";
import Timezone from "../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * EVERY ADDRESS AN ACCOUNT LEAVES IS TOLD (#9907), AND A WAITING CHANGE
 * KEEPS WHEN ITS LINK STOPS WORKING (#9908).
 *
 * UserService.onUpdateSuccess emails the address an account had, once,
 * whenever a write changed it (EmailAddressChangedNotice). These run each
 * way an address changes through the update hooks, without a database:
 *
 *   - a person's own change, confirmed by opening the link sent to the new
 *     address (Identity's /verify-email: root, naming the account's own
 *     change, with the request's origin);
 *   - a master admin's change of somebody else's address (Admin
 *     Dashboard, the API), and of their own;
 *   - SCIM (root, naming the identity provider);
 *   - single sign-on, and any other write OneUptime makes: single sign-on
 *     finds the account by the address its provider names and writes no
 *     address of an existing account (SsoSignInsWriteNoAddress pins that),
 *     so its only write is the address again - which changes nothing and
 *     sends nothing, as SCIM's push of the same address does not.
 *
 * Each sends exactly one email, to the old address, in the account's
 * language and zone as read before the write, with the request's origin;
 * a write that leaves the address as it was sends none.
 *
 * Then the waiting change's link (#9908): its expiry is written beside the
 * waiting address - the same for a taken address as for a free one - and
 * cleared with it, and the link itself ends at that very moment.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const ADMIN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";
const TAKEN_EMAIL: string = "someone-else@example.com";

const ORIGIN: RequestOrigin = {
  ipAddress: "203.0.113.7",
  location: "Berlin, Germany",
  device: "Firefox on Linux",
};

interface UserServiceInternals {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
  onUpdatePermitted: (updateBy: UpdateBy<User>) => Promise<void>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

function accountRow(email: string = OLD_EMAIL, id: ObjectID = USER_ID): User {
  const user: User = new User();
  user.id = id;
  user._id = id.toString();
  user.email = new Email(email);
  user.language = "de";
  user.timezone = Timezone.EuropeBerlin;
  return user;
}

function update(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  options: {
    accountId?: ObjectID;
    miscDataProps?: JSONObject;
  } = {},
): UpdateBy<User> {
  return {
    query: {
      _id: (options.accountId || USER_ID).toString(),
    } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    ...(options.miscDataProps ? { miscDataProps: options.miscDataProps } : {}),
    props: props,
    limit: 1,
    skip: 0,
  };
}

let send: jest.SpyInstance;
let findBy: jest.SpyInstance;
let sendForPendingChange: jest.SpyInstance;
let assertMayAsk: jest.SpyInstance;

async function flushBackgroundWork(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

/*
 * One write, through the hooks the update path runs, around a write that
 * reached the rows `written` names.
 */
async function write(
  updateBy: UpdateBy<User>,
  written: Array<ObjectID> = [USER_ID],
): Promise<OnUpdate<User>> {
  const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(updateBy);
  await userService().onUpdatePermitted(onUpdate.updateBy);
  await userService().onUpdateSuccess(onUpdate, written);
  await flushBackgroundWork();
  return onUpdate;
}

function told(): Array<EmailAddressChangedEvent> {
  return send.mock.calls.map((call: Array<unknown>) => {
    return call[0] as EmailAddressChangedEvent;
  });
}

function onlyNotice(): EmailAddressChangedEvent {
  expect(send).toHaveBeenCalledTimes(1);
  return told()[0]!;
}

function dataOf(updateBy: UpdateBy<User>): Record<string, unknown> {
  return updateBy.data as unknown as Record<string, unknown>;
}

beforeEach(() => {
  // Every session here has confirmed it's its person's (#10155).
  confirmEverySession();

  findBy = jest
    .spyOn(UserService, "findBy")
    .mockResolvedValue([accountRow()] as never);

  stubRowsCallerMayWriteLikeFindBy(UserService, findBy);

  jest.spyOn(UserService, "findOneBy").mockImplementation(((args: {
    query: { email?: Email };
  }): Promise<User | null> => {
    const address: string = args.query.email?.toString() || "";

    return Promise.resolve(
      address === TAKEN_EMAIL ? accountRow(TAKEN_EMAIL, OTHER_USER_ID) : null,
    );
  }) as never);
  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
  jest.spyOn(UserService, "updateOneBy").mockResolvedValue(1 as never);
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

  assertMayAsk = jest
    .spyOn(EmailChangeConfirmation, "assertMayAsk")
    .mockResolvedValue(undefined);
  sendForPendingChange = jest
    .spyOn(EmailChangeConfirmation, "sendForPendingChange")
    .mockResolvedValue(undefined);
  jest.spyOn(EmailChangeConfirmation, "canSendEmail").mockResolvedValue(true);

  send = jest.spyOn(EmailAddressChangedNotice, "send").mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("each way an address changes tells the old address, once", () => {
  test("a person's own change, confirmed with the link sent to the new address", async () => {
    // Identity's /verify-email writes exactly this.
    await write(
      update(
        {
          email: new Email(NEW_EMAIL),
          isEmailVerified: true,
          newUnverifiedTemporaryEmail: null,
        },
        { isRoot: true, requestOrigin: ORIGIN },
        {
          miscDataProps: {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]: EmailAddressChangedBy.AccountOwner,
          },
        },
      ),
    );

    const notice: EmailAddressChangedEvent = onlyNotice();

    expect(notice.userId.toString()).toBe(USER_ID.toString());
    expect(notice.previousEmail.toString()).toBe(OLD_EMAIL);
    expect(notice.newEmail.toString()).toBe(NEW_EMAIL);
    expect(notice.changedBy).toBe(EmailAddressChangedBy.AccountOwner);
    // Where the link was opened.
    expect(notice.origin).toEqual(ORIGIN);
  });

  test("a master admin's change of somebody else's address", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true, requestOrigin: ORIGIN },
      ),
    );

    const notice: EmailAddressChangedEvent = onlyNotice();

    expect(notice.previousEmail.toString()).toBe(OLD_EMAIL);
    expect(notice.newEmail.toString()).toBe(NEW_EMAIL);
    // Named by role; the email drops their address and device.
    expect(notice.changedBy).toBe(EmailAddressChangedBy.ServerAdmin);
  });

  test("a master admin's change of their own address, which is written at once, is the account's own", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, isMasterAdmin: true, requestOrigin: ORIGIN },
      ),
    );

    const notice: EmailAddressChangedEvent = onlyNotice();

    expect(notice.changedBy).toBe(EmailAddressChangedBy.AccountOwner);
    expect(notice.origin).toEqual(ORIGIN);
  });

  test("SCIM: the identity provider's change", async () => {
    // ee's SCIM.ts writes exactly this for a new address.
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { isRoot: true },
        {
          miscDataProps: {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]:
              EmailAddressChangedBy.IdentityProvider,
          },
        },
      ),
    );

    const notice: EmailAddressChangedEvent = onlyNotice();

    expect(notice.previousEmail.toString()).toBe(OLD_EMAIL);
    expect(notice.changedBy).toBe(EmailAddressChangedBy.IdentityProvider);
    expect(notice.origin).toBeUndefined();
  });

  test("any other write OneUptime makes of a new address is told too, without a role", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { isRoot: true }));

    expect(onlyNotice().changedBy).toBe(EmailAddressChangedBy.OneUptime);
  });

  test("in the account's language and zone, as read before the write", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    const notice: EmailAddressChangedEvent = onlyNotice();

    expect(notice.language).toBe("de");
    expect(notice.timezone).toBe(Timezone.EuropeBerlin);
    expect(notice.at).toBeInstanceOf(Date);
  });

  test("the read of the rows the write changes asks for the account's language", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    const select: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["email"]).toBe(true);
    expect(select["language"]).toBe(true);
    expect(select["timezone"]).toBe(true);
  });
});

describe("a write that leaves the address as it was sends nothing", () => {
  test("SCIM's push of the address the account has", async () => {
    await write(
      update(
        { email: new Email(OLD_EMAIL), name: "River Song" },
        { isRoot: true },
        {
          miscDataProps: {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]:
              EmailAddressChangedBy.IdentityProvider,
          },
        },
      ),
    );

    expect(send).not.toHaveBeenCalled();
  });

  test("a sign-in's write of the address it found the account by, in another case", async () => {
    await write(
      update({ email: new Email(OLD_EMAIL.toUpperCase()) }, { isRoot: true }),
    );

    expect(send).not.toHaveBeenCalled();
  });

  test("a profile save that sends the address the account already has", async () => {
    await write(
      update(
        { email: new Email(OLD_EMAIL), name: "River Song" },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    expect(send).not.toHaveBeenCalled();
  });

  test("a write without an address", async () => {
    await write(update({ name: "River Song" }, { isRoot: true }));

    expect(send).not.toHaveBeenCalled();
  });

  test("a write that reached no row", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { isRoot: true }), []);

    expect(send).not.toHaveBeenCalled();
  });

  test("a write that reached another row than the one read", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { isRoot: true }), [
      OTHER_USER_ID,
    ]);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("asking for a change tells the old address nothing yet", () => {
  test("a person's own change is held for its link: the old address is told when the link is opened", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    // The new address is sent its link; the old one hears nothing until then.
    expect(sendForPendingChange).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  test("and the same for an address another account has", async () => {
    await write(
      update(
        { email: new Email(TAKEN_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    expect(send).not.toHaveBeenCalled();
  });
});

describe("who changed it comes from the write, never from the caller", () => {
  test("a request cannot name the changer: a master admin's write is a server admin's", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
        {
          miscDataProps: {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]:
              EmailAddressChangedBy.IdentityProvider,
          },
        },
      ),
    );

    expect(onlyNotice().changedBy).toBe(EmailAddressChangedBy.ServerAdmin);
  });
});

describe("never in the write's way", () => {
  test("the write is answered without waiting for the email", async () => {
    send.mockImplementation(() => {
      return new Promise<never>(() => {});
    });

    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update({ email: new Email(NEW_EMAIL) }, { isRoot: true }),
    );

    await expect(
      userService().onUpdateSuccess(onUpdate, [USER_ID]),
    ).resolves.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("a waiting change keeps when its link stops working (#9908)", () => {
  test("a held change writes its link's expiry beside the waiting address", async () => {
    const before: number = Date.now();
    const onUpdate: OnUpdate<User> = await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );
    const data: Record<string, unknown> = dataOf(onUpdate.updateBy);
    const expires: Date = data["newUnverifiedTemporaryEmailExpires"] as Date;

    expect(String(data["newUnverifiedTemporaryEmail"])).toBe(NEW_EMAIL);
    expect(expires).toBeInstanceOf(Date);

    const hoursLeft: number = (expires.getTime() - before) / (60 * 60 * 1000);

    expect(hoursLeft).toBeGreaterThan(EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS - 0.1);
    expect(hoursLeft).toBeLessThanOrEqual(
      EMAIL_CHANGE_LINK_EXPIRY_IN_HOURS + 0.1,
    );
  });

  test("the link ends at the very moment the account says it does", async () => {
    const onUpdate: OnUpdate<User> = await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    const linkExpires: Date = (
      sendForPendingChange.mock.calls[0]![0] as { linkExpires: Date }
    ).linkExpires;

    expect(linkExpires.getTime()).toBe(
      (
        dataOf(onUpdate.updateBy)["newUnverifiedTemporaryEmailExpires"] as Date
      ).getTime(),
    );
  });

  test("a taken address and a free one still leave the same write", async () => {
    const free: OnUpdate<User> = await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );
    const taken: OnUpdate<User> = await write(
      update(
        { email: new Email(TAKEN_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    expect(Object.keys(dataOf(taken.updateBy)).sort()).toEqual(
      Object.keys(dataOf(free.updateBy)).sort(),
    );
    expect(Object.keys(dataOf(taken.updateBy)).sort()).toEqual([
      "newUnverifiedTemporaryEmail",
      "newUnverifiedTemporaryEmailExpires",
    ]);
  });

  test("Send Link Again is a new change: counted, held, and given a later expiry", async () => {
    const first: OnUpdate<User> = await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });

    // The profile sends the waiting address again.
    const again: OnUpdate<User> = await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    expect(assertMayAsk).toHaveBeenCalledTimes(2);
    expect(sendForPendingChange).toHaveBeenCalledTimes(2);
    expect(
      (
        dataOf(again.updateBy)["newUnverifiedTemporaryEmailExpires"] as Date
      ).getTime(),
    ).toBeGreaterThan(
      (
        dataOf(first.updateBy)["newUnverifiedTemporaryEmailExpires"] as Date
      ).getTime(),
    );
    expect(send).not.toHaveBeenCalled();
  });

  test("Cancel Change clears the expiry with the address", async () => {
    const onUpdate: OnUpdate<User> = await write(
      update(
        { newUnverifiedTemporaryEmail: null },
        { userId: USER_ID, requestOrigin: ORIGIN },
      ),
    );

    expect(dataOf(onUpdate.updateBy)).toEqual({
      newUnverifiedTemporaryEmail: null,
      newUnverifiedTemporaryEmailExpires: null,
    });
  });

  test("the link's own write clears it too", async () => {
    const onUpdate: OnUpdate<User> = await write(
      update(
        {
          email: new Email(NEW_EMAIL),
          isEmailVerified: true,
          newUnverifiedTemporaryEmail: null,
        },
        { isRoot: true, requestOrigin: ORIGIN },
        {
          miscDataProps: {
            [EMAIL_ADDRESS_CHANGED_BY_KEY]: EmailAddressChangedBy.AccountOwner,
          },
        },
      ),
    );

    expect(
      dataOf(onUpdate.updateBy)["newUnverifiedTemporaryEmailExpires"],
    ).toBeNull();
  });

  test("a write that does not touch the waiting address leaves its expiry alone", async () => {
    const onUpdate: OnUpdate<User> = await write(
      update({ name: "River Song" }, { userId: USER_ID }),
    );

    expect(
      Object.keys(dataOf(onUpdate.updateBy)).includes(
        "newUnverifiedTemporaryEmailExpires",
      ),
    ).toBe(false);
  });

  test("the expiry is OneUptime's to write: its owner reads it, nobody sets it", () => {
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = getColumnAccessControlForAllColumns(new User())[
      "newUnverifiedTemporaryEmailExpires"
    ] as {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    };

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access.read).toEqual([Permission.CurrentUser]);
  });
});
