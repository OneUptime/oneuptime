import UserService, {
  OWN_EMAIL_ONLY_MESSAGE,
  PENDING_EMAIL_NOT_WRITABLE_MESSAGE,
} from "../../../Server/Services/UserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EmailChangeConfirmation, {
  EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE,
  EMAIL_CHANGE_TOO_MANY_MESSAGE,
} from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import EmailAddressChangedNotice from "../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * CHANGING YOUR OWN EMAIL ADDRESS SAYS NOTHING ABOUT THE NEW ONE (#9821).
 *
 * A signed-in person's own new `email` used to be written at once, and an
 * address another account had was refused on the unique index - "A User
 * with this Email already exists" - so any account could test addresses
 * one at a time. Now UserService holds the change for the new address to
 * confirm: `email` is taken out of the write and `newUnverifiedTemporaryEmail`
 * put in, the update is answered as any other, and only after it has been
 * answered is the new address looked up and emailed - a link to confirm it,
 * or word that another account has it.
 *
 * These pin, without a database:
 *   - the held write is the same whether or not the address is taken, and
 *     nothing reads who has the address before the answer;
 *   - the lookup and the email happen after the answer, not awaited by it,
 *     so how long the answer takes says nothing either (with a timing check
 *     like #9797's);
 *   - what is not held: the address the account already has, a master
 *     admin's change, the server's own (root) writes;
 *   - the pending address is OneUptime's to write: a person may clear it,
 *     never set it;
 *   - the email branch of onUpdateSuccess asks no proof of a write that
 *     says it is proven, or on a server that cannot send email (where it
 *     used to lock its person out).
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const OLD_EMAIL: string = "river@old-mailbox.example.com";
const FREE_EMAIL: string = "river@new-mailbox.example.com";
const TAKEN_EMAIL: string = "someone-else@example.com";

interface UserServiceInternals {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

function ownRow(email: string = OLD_EMAIL): User {
  const user: User = new User();
  user.id = USER_ID;
  user._id = USER_ID.toString();
  user.email = new Email(email);
  return user;
}

function signedInProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    requestOrigin: {
      ipAddress: "203.0.113.7",
    } as DatabaseCommonInteractionProps["requestOrigin"],
  };
}

function update(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = signedInProps(),
  accountId: ObjectID = USER_ID,
): UpdateBy<User> {
  return {
    query: { _id: accountId.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    props: props,
    limit: 1,
    skip: 0,
  };
}

type Stubs = {
  findBy: jest.SpyInstance;
  findOneBy: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
  updateOneBy: jest.SpyInstance;
  assertMayAsk: jest.SpyInstance;
  sendForPendingChange: jest.SpyInstance;
  canSendEmail: jest.SpyInstance;
  tellPreviousAddress: jest.SpyInstance;
};

let stubs: Stubs;

// Who has an address, as the background lookup reads it.
function holderOf(address: string): User | null {
  if (address.toLowerCase() !== TAKEN_EMAIL) {
    return null;
  }

  const holder: User = new User();
  holder.id = OTHER_USER_ID;
  holder._id = OTHER_USER_ID.toString();
  return holder;
}

async function flushBackgroundWork(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

beforeEach(() => {
  // Every session here has confirmed it's its person's (#10155).
  confirmEverySession();

  const findBy: jest.SpyInstance = jest
    .spyOn(UserService, "findBy")
    .mockResolvedValue([ownRow()] as never);

  stubRowsCallerMayWriteLikeFindBy(UserService, findBy);

  stubs = {
    findBy: findBy,
    findOneBy: jest.spyOn(UserService, "findOneBy").mockImplementation(((args: {
      query: { email?: Email };
    }): Promise<User | null> => {
      return Promise.resolve(holderOf(args.query.email?.toString() || ""));
    }) as never),
    updateOneById: jest
      .spyOn(UserService, "updateOneById")
      .mockResolvedValue(undefined as never),
    updateOneBy: jest
      .spyOn(UserService, "updateOneBy")
      .mockResolvedValue(1 as never),
    assertMayAsk: jest
      .spyOn(EmailChangeConfirmation, "assertMayAsk")
      .mockResolvedValue(undefined),
    sendForPendingChange: jest
      .spyOn(EmailChangeConfirmation, "sendForPendingChange")
      .mockResolvedValue(undefined),
    canSendEmail: jest
      .spyOn(EmailChangeConfirmation, "canSendEmail")
      .mockResolvedValue(true),
    /*
     * The email to the address an account leaves (#9907), pinned in
     * UserServiceEmailAddressChangedNotice.test.ts.
     */
    tellPreviousAddress: jest
      .spyOn(EmailAddressChangedNotice, "send")
      .mockResolvedValue(true),
  };

  // A verified address sets up the projects' notification defaults: none here.
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a person's own new address waits for a link to it", () => {
  test("the address is not written: it is kept as pending, and the rest of the update goes through", async () => {
    const updateBy: UpdateBy<User> = update({
      email: new Email(FREE_EMAIL),
      timezone: "Europe/Berlin",
    });

    await userService().onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    expect(data["email"]).toBeUndefined();
    expect(String(data["newUnverifiedTemporaryEmail"])).toBe(FREE_EMAIL);
    expect(data["timezone"]).toBe("Europe/Berlin");
  });

  test("the change is counted for the account and the new address before it is held", async () => {
    await userService().onBeforeUpdate(
      update({ email: new Email(FREE_EMAIL) }),
    );

    expect(stubs.assertMayAsk).toHaveBeenCalledTimes(1);

    const asked: { userId: ObjectID; newEmail: Email } = stubs.assertMayAsk.mock
      .calls[0]![0] as { userId: ObjectID; newEmail: Email };

    expect(asked.userId.toString()).toBe(USER_ID.toString());
    expect(asked.newEmail.toString()).toBe(FREE_EMAIL);
  });

  test("a taken address and a free one leave the same write, and nothing asks who has either", async () => {
    const free: UpdateBy<User> = update({ email: new Email(FREE_EMAIL) });
    const taken: UpdateBy<User> = update({ email: new Email(TAKEN_EMAIL) });

    await userService().onBeforeUpdate(free);
    await userService().onBeforeUpdate(taken);

    expect(Object.keys(free.data).sort()).toEqual(
      Object.keys(taken.data).sort(),
    );
    expect(Object.keys(taken.data)).toEqual(["newUnverifiedTemporaryEmail"]);

    // The answer reads nobody's address: the lookup waits for afterwards.
    expect(stubs.findOneBy).not.toHaveBeenCalled();
  });

  test("the links mailed to the address the account still has keep working until it changes", async () => {
    await userService().onBeforeUpdate(
      update({ email: new Email(FREE_EMAIL) }),
    );

    // The reset and sign-in links are ended by the write that moves the account.
    expect(stubs.updateOneById).not.toHaveBeenCalled();
  });

  test("addresses are compared without case, as the account's own is not a change", async () => {
    const updateBy: UpdateBy<User> = update({
      email: new Email(OLD_EMAIL.toUpperCase()),
    });

    await userService().onBeforeUpdate(updateBy);

    expect(stubs.assertMayAsk).not.toHaveBeenCalled();
    expect(
      (updateBy.data as unknown as Record<string, unknown>)[
        "newUnverifiedTemporaryEmail"
      ],
    ).toBeUndefined();
  });

  test("a refusal - too many changes, a server that cannot email - leaves the account as it was", async () => {
    stubs.assertMayAsk.mockRejectedValueOnce(
      new TooManyRequestsException(EMAIL_CHANGE_TOO_MANY_MESSAGE),
    );

    const tooMany: UpdateBy<User> = update({ email: new Email(FREE_EMAIL) });

    await expect(userService().onBeforeUpdate(tooMany)).rejects.toThrow(
      EMAIL_CHANGE_TOO_MANY_MESSAGE,
    );
    expect(
      (tooMany.data as unknown as Record<string, unknown>)[
        "newUnverifiedTemporaryEmail"
      ],
    ).toBeUndefined();

    stubs.assertMayAsk.mockRejectedValueOnce(
      new BadDataException(EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE),
    );

    await expect(
      userService().onBeforeUpdate(update({ email: new Email(TAKEN_EMAIL) })),
    ).rejects.toThrow(EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE);
  });

  test("an address for somebody else's account is refused, should a write reach one", async () => {
    // Column permissions keep a person to their own row; this is the backstop.
    const other: User = new User();
    other.id = OTHER_USER_ID;
    other._id = OTHER_USER_ID.toString();
    other.email = new Email(TAKEN_EMAIL);
    stubs.findBy.mockResolvedValue([other] as never);

    await expect(
      userService().onBeforeUpdate(
        update(
          { email: new Email(FREE_EMAIL) },
          { userId: USER_ID },
          OTHER_USER_ID,
        ),
      ),
    ).rejects.toThrow(OWN_EMAIL_ONLY_MESSAGE);
    expect(stubs.assertMayAsk).not.toHaveBeenCalled();
  });
});

describe("what is not held", () => {
  test("a master admin's change is written at once: they see every account already", async () => {
    const updateBy: UpdateBy<User> = update(
      { email: new Email(FREE_EMAIL) },
      { userId: USER_ID, isMasterAdmin: true },
    );

    await userService().onBeforeUpdate(updateBy);

    expect(String(updateBy.data.email)).toBe(FREE_EMAIL);
    expect(stubs.assertMayAsk).not.toHaveBeenCalled();
    // And the links to the old address end with it.
    expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("the server's own write - a confirmed change, single sign-on, SCIM - is written at once", async () => {
    const updateBy: UpdateBy<User> = update(
      { email: new Email(FREE_EMAIL) },
      { isRoot: true },
    );

    await userService().onBeforeUpdate(updateBy);

    expect(String(updateBy.data.email)).toBe(FREE_EMAIL);
    expect(stubs.assertMayAsk).not.toHaveBeenCalled();
  });
});

describe("the pending address is OneUptime's to write", () => {
  test("a person cannot write an address into it", async () => {
    await expect(
      userService().onBeforeUpdate(
        update({ newUnverifiedTemporaryEmail: new Email(TAKEN_EMAIL) }),
      ),
    ).rejects.toThrow(PENDING_EMAIL_NOT_WRITABLE_MESSAGE);
  });

  test("nor can a master admin", async () => {
    await expect(
      userService().onBeforeUpdate(
        update(
          { newUnverifiedTemporaryEmail: new Email(TAKEN_EMAIL) },
          { userId: USER_ID, isMasterAdmin: true },
        ),
      ),
    ).rejects.toThrow(PENDING_EMAIL_NOT_WRITABLE_MESSAGE);
  });

  test("a person may clear it: Cancel Change", async () => {
    const updateBy: UpdateBy<User> = update({
      newUnverifiedTemporaryEmail: null,
    });

    await expect(userService().onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(stubs.assertMayAsk).not.toHaveBeenCalled();
  });
});

describe("after the answer, the new address is told", () => {
  async function askAndAnswer(address: string): Promise<void> {
    const updateBy: UpdateBy<User> = update({ email: new Email(address) });
    const onUpdate: OnUpdate<User> =
      await userService().onBeforeUpdate(updateBy);

    await userService().onUpdateSuccess(onUpdate, [USER_ID]);
    await flushBackgroundWork();
  }

  test("a free address is sent a link to confirm it", async () => {
    await askAndAnswer(FREE_EMAIL);

    expect(stubs.sendForPendingChange).toHaveBeenCalledTimes(1);

    const sent: {
      userId: ObjectID;
      newEmail: Email;
      isTaken: boolean;
      origin: unknown;
    } = stubs.sendForPendingChange.mock.calls[0]![0] as {
      userId: ObjectID;
      newEmail: Email;
      isTaken: boolean;
      origin: unknown;
    };

    expect(sent.userId.toString()).toBe(USER_ID.toString());
    expect(sent.newEmail.toString()).toBe(FREE_EMAIL);
    expect(sent.isTaken).toBe(false);
    // Where the change was asked from, for the email's details.
    expect(sent.origin).toEqual({ ipAddress: "203.0.113.7" });
  });

  test("a taken address is told it has an account, in the email alone", async () => {
    await askAndAnswer(TAKEN_EMAIL);

    const sent: { newEmail: Email; isTaken: boolean } = stubs
      .sendForPendingChange.mock.calls[0]![0] as {
      newEmail: Email;
      isTaken: boolean;
    };

    expect(sent.newEmail.toString()).toBe(TAKEN_EMAIL);
    expect(sent.isTaken).toBe(true);
  });

  test("the answer does not wait for the lookup or the email", async () => {
    // A lookup that never ends: the answer must not be held by it.
    stubs.findOneBy.mockImplementation((() => {
      return new Promise<never>(() => {});
    }) as never);

    const updateBy: UpdateBy<User> = update({
      email: new Email(TAKEN_EMAIL),
    });
    const onUpdate: OnUpdate<User> =
      await userService().onBeforeUpdate(updateBy);

    await expect(
      userService().onUpdateSuccess(onUpdate, [USER_ID]),
    ).resolves.toBeDefined();
    expect(stubs.sendForPendingChange).not.toHaveBeenCalled();
  });

  test("a taken address and a free one are answered in the same time (tolerance as in #9797)", async () => {
    const SLOW_LOOKUP_MS: number = 120;
    const TOLERANCE_MS: number = 60;

    // Whoever has the address is slow to find, as a cold index may be.
    stubs.findOneBy.mockImplementation(((args: {
      query: { email?: Email };
    }): Promise<User | null> => {
      return new Promise<User | null>((resolve: (u: User | null) => void) => {
        setTimeout(() => {
          resolve(holderOf(args.query.email?.toString() || ""));
        }, SLOW_LOOKUP_MS);
      });
    }) as never);

    async function timeAnswer(address: string): Promise<number> {
      const started: number = Date.now();
      const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
        update({ email: new Email(address) }),
      );
      await userService().onUpdateSuccess(onUpdate, [USER_ID]);
      return Date.now() - started;
    }

    const samples: Array<{ free: number; taken: number }> = [];

    for (let i: number = 0; i < 5; i++) {
      samples.push({
        free: await timeAnswer(FREE_EMAIL),
        taken: await timeAnswer(TAKEN_EMAIL),
      });
    }

    for (const sample of samples) {
      expect(sample.free).toBeLessThan(SLOW_LOOKUP_MS);
      expect(sample.taken).toBeLessThan(SLOW_LOOKUP_MS);
      expect(Math.abs(sample.free - sample.taken)).toBeLessThan(TOLERANCE_MS);
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, SLOW_LOOKUP_MS + 20);
    });
  });

  test("nothing is sent when the write reached no row", async () => {
    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update({ email: new Email(FREE_EMAIL) }),
    );

    await userService().onUpdateSuccess(onUpdate, []);
    await flushBackgroundWork();

    expect(stubs.findOneBy).not.toHaveBeenCalled();
    expect(stubs.sendForPendingChange).not.toHaveBeenCalled();
  });

  test("the held change asks for no second proof: the old address stays verified", async () => {
    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update({ email: new Email(FREE_EMAIL) }),
    );

    await userService().onUpdateSuccess(onUpdate, [USER_ID]);
    await flushBackgroundWork();

    expect(stubs.updateOneBy).not.toHaveBeenCalled();
  });
});

describe("an address written at once, and the proof it is asked for", () => {
  async function writeAtOnce(patch: Record<string, unknown>): Promise<void> {
    // The row as it was, and as it is after the write.
    stubs.findBy
      .mockResolvedValueOnce([ownRow()] as never)
      .mockResolvedValue([ownRow(FREE_EMAIL)] as never);

    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update(patch, { isRoot: true }),
    );

    await userService().onUpdateSuccess(onUpdate, [USER_ID]);
  }

  test("the swap a confirmed change makes says it is proven, and is asked for nothing more", async () => {
    await writeAtOnce({
      email: new Email(FREE_EMAIL),
      isEmailVerified: true,
      newUnverifiedTemporaryEmail: null,
    });

    expect(stubs.canSendEmail).not.toHaveBeenCalled();
    expect(stubs.updateOneBy).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { isEmailVerified: false } }),
    );
    // And the address the account left is told, once (#9907).
    expect(stubs.tellPreviousAddress).toHaveBeenCalledTimes(1);
  });

  test("on a server that cannot send email the address is not marked unverified, which locked its person out", async () => {
    stubs.canSendEmail.mockResolvedValue(false);

    await writeAtOnce({ email: new Email(FREE_EMAIL) });

    expect(stubs.updateOneBy).not.toHaveBeenCalled();
  });
});

describe("asking for a change, and the address the account still has (#9907)", () => {
  test("the old address is told nothing while the change waits for its link", async () => {
    const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(
      update({ email: new Email(FREE_EMAIL) }),
    );

    await userService().onUpdateSuccess(onUpdate, [USER_ID]);
    await flushBackgroundWork();

    expect(stubs.sendForPendingChange).toHaveBeenCalledTimes(1);
    expect(stubs.tellPreviousAddress).not.toHaveBeenCalled();
  });
});
