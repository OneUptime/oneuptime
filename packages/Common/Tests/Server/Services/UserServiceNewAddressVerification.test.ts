import UserService from "../../../Server/Services/UserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EmailAddressChangedNotice from "../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import EmailChangeConfirmation from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import User from "../../../Models/DatabaseModels/User";
import {
  EMAIL_ADDRESS_CHANGED_BY_KEY,
  EmailAddressChangedBy,
} from "../../../Types/Accounts/EmailAddressChangedEmail";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * THE LINK TO AN ADDRESS WRITTEN STRAIGHT AWAY SAYS WHO WROTE IT, IN THE
 * ACCOUNT'S LANGUAGE (#10157).
 *
 * A master admin's change, the identity provider's through SCIM, or another
 * write OneUptime makes moves an account to a new address at once; then
 * UserService.onUpdateSuccess sends the new address a link that verifies it
 * (EmailChangeConfirmation.sendVerificationOfNewAddress, EmailChanged.hbs)
 * and marks it unverified until it is opened. The email said "You have
 * changed your email" whoever had; now it is told who did, by role, as the
 * email to the address the account left is (#9907, getEmailAddressChanger),
 * and it is written in the language and time zone of the account, as read
 * before the write.
 *
 * Through the update hooks, without a database: each kind of writer, and
 * the writes that send no link - a person's own change (it waits for its
 * own link), the swap that link makes, the same address again, and a server
 * that cannot send email.
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const ADMIN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const OLD_EMAIL: string = "river@old-mailbox.example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";

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

function accountRow(email: string): User {
  const user: User = new User();
  user.id = USER_ID;
  user._id = USER_ID.toString();
  user.email = new Email(email);
  user.language = "fa";
  user.timezone = Timezone.AsiaTehran;
  return user;
}

function update(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  miscDataProps?: JSONObject,
): UpdateBy<User> {
  return {
    query: { _id: USER_ID.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    ...(miscDataProps ? { miscDataProps: miscDataProps } : {}),
    props: props,
    limit: 1,
    skip: 0,
  };
}

// Whether the write has reached the rows: reads after it see the new address.
let isWritten: boolean;
let sendVerification: jest.SpyInstance;
let updateOneBy: jest.SpyInstance;

async function write(updateBy: UpdateBy<User>): Promise<void> {
  isWritten = false;
  const onUpdate: OnUpdate<User> = await userService().onBeforeUpdate(updateBy);
  await userService().onUpdatePermitted(onUpdate.updateBy);
  isWritten = true;
  await userService().onUpdateSuccess(onUpdate, [USER_ID]);
}

interface Verification {
  userId: ObjectID;
  newEmail: Email;
  changedBy: EmailAddressChangedBy;
  at?: Date;
  language?: string | null;
  timezone?: Timezone | null;
}

function onlyVerification(): Verification {
  expect(sendVerification).toHaveBeenCalledTimes(1);
  return sendVerification.mock.calls[0]![0] as Verification;
}

function markedUnverified(): boolean {
  return updateOneBy.mock.calls.some((call: Array<unknown>): boolean => {
    return (
      (call[0] as { data: Record<string, unknown> }).data["isEmailVerified"] ===
      false
    );
  });
}

beforeEach(() => {
  confirmEverySession();
  isWritten = false;

  const findBy: jest.SpyInstance = jest
    .spyOn(UserService, "findBy")
    .mockImplementation((async (): Promise<Array<User>> => {
      return [accountRow(isWritten ? NEW_EMAIL : OLD_EMAIL)];
    }) as never);

  stubRowsCallerMayWriteLikeFindBy(UserService, findBy);

  jest.spyOn(UserService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserService, "updateOneById").mockResolvedValue(1 as never);
  updateOneBy = jest
    .spyOn(UserService, "updateOneBy")
    .mockResolvedValue(1 as never);
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

  jest.spyOn(EmailChangeConfirmation, "assertMayAsk").mockResolvedValue();
  jest
    .spyOn(EmailChangeConfirmation, "sendForPendingChange")
    .mockResolvedValue();
  jest.spyOn(EmailChangeConfirmation, "canSendEmail").mockResolvedValue(true);
  sendVerification = jest
    .spyOn(EmailChangeConfirmation, "sendVerificationOfNewAddress")
    .mockResolvedValue();

  jest.spyOn(EmailAddressChangedNotice, "send").mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who made the change, by role", () => {
  test("a master admin's change of somebody else's address: a server admin", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    const verification: Verification = onlyVerification();

    expect(verification.userId.toString()).toBe(USER_ID.toString());
    expect(verification.newEmail.toString()).toBe(NEW_EMAIL);
    expect(verification.changedBy).toBe(EmailAddressChangedBy.ServerAdmin);
    // The new address is unverified until its link is opened.
    expect(markedUnverified()).toBe(true);
  });

  test("a master admin's change of their own address: their own", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: USER_ID, isMasterAdmin: true },
      ),
    );

    expect(onlyVerification().changedBy).toBe(
      EmailAddressChangedBy.AccountOwner,
    );
  });

  test("SCIM: the organization's identity provider", async () => {
    // ee's SCIM.ts writes exactly this for a new address.
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { isRoot: true },
        {
          [EMAIL_ADDRESS_CHANGED_BY_KEY]:
            EmailAddressChangedBy.IdentityProvider,
        },
      ),
    );

    expect(onlyVerification().changedBy).toBe(
      EmailAddressChangedBy.IdentityProvider,
    );
  });

  test("any other write OneUptime makes: nobody named", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { isRoot: true }));

    expect(onlyVerification().changedBy).toBe(EmailAddressChangedBy.OneUptime);
  });

  test("a master admin cannot name another changer: that is heard from root writes only", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
        {
          [EMAIL_ADDRESS_CHANGED_BY_KEY]:
            EmailAddressChangedBy.IdentityProvider,
        },
      ),
    );

    expect(onlyVerification().changedBy).toBe(
      EmailAddressChangedBy.ServerAdmin,
    );
  });
});

describe("in the account's language and time zone, as read before the write", () => {
  test("the account's own, and when", async () => {
    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    const verification: Verification = onlyVerification();

    expect(verification.language).toBe("fa");
    expect(verification.timezone).toBe(Timezone.AsiaTehran);
    expect(verification.at).toBeInstanceOf(Date);
  });
});

describe("the writes that send no link", () => {
  test("a person's own change waits for the link sent to the new address", async () => {
    await write(update({ email: new Email(NEW_EMAIL) }, { userId: USER_ID }));

    expect(sendVerification).not.toHaveBeenCalled();
    expect(EmailChangeConfirmation.sendForPendingChange).toHaveBeenCalledTimes(
      1,
    );
  });

  test("the swap that link makes: the mailbox is proven", async () => {
    await write(
      update(
        {
          email: new Email(NEW_EMAIL),
          isEmailVerified: true,
          newUnverifiedTemporaryEmail: null,
        },
        { isRoot: true },
        {
          [EMAIL_ADDRESS_CHANGED_BY_KEY]: EmailAddressChangedBy.AccountOwner,
        },
      ),
    );

    expect(sendVerification).not.toHaveBeenCalled();
    expect(markedUnverified()).toBe(false);
  });

  test("the same address again", async () => {
    isWritten = false;
    jest.spyOn(UserService, "findBy").mockImplementation((async (): Promise<
      Array<User>
    > => {
      return [accountRow(OLD_EMAIL)];
    }) as never);

    await write(
      update(
        { email: new Email(OLD_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    expect(sendVerification).not.toHaveBeenCalled();
  });

  test("a server that cannot send email: the address is taken as verified", async () => {
    (
      EmailChangeConfirmation.canSendEmail as unknown as jest.SpyInstance
    ).mockResolvedValue(false);

    await write(
      update(
        { email: new Email(NEW_EMAIL) },
        { userId: ADMIN_ID, isMasterAdmin: true },
      ),
    );

    expect(sendVerification).not.toHaveBeenCalled();
    expect(markedUnverified()).toBe(false);
  });
});
