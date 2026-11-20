import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService, {
  WEBAUTHN_ADDED_BY_REGISTRATION_ONLY_MESSAGE,
} from "../../../Server/Services/UserWebAuthnService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EmailAddressChangedNotice from "../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import EmailChangeConfirmation, {
  EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE,
} from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import {
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import {
  MINUTE_IN_MS,
  PASSKEY_ONLY_ACCOUNT,
  PASSWORD_ACCOUNT,
  REAUTH_OTHER_SESSION_ID,
  REAUTH_OTHER_USER_ID,
  REAUTH_SESSION_ID,
  REAUTH_USER_ID,
  RIGHT_BACKUP_CODE,
  RIGHT_CODE,
  RIGHT_PASSWORD,
  SSO_ONLY_ACCOUNT,
  StandInAccount,
  StandInAccountSpies,
  StandInValkey,
  TWO_FACTOR_ACCOUNT,
  standInAccount,
} from "../TestingUtils/ReauthenticationStandIns";

/*
 * EVERY PATH THAT CHANGES HOW YOU SIGN IN WAITS FOR "CONFIRM IT'S YOU"
 * (#10155), through the real hooks and the real check.
 *
 * Nothing about the check is stubbed here: Server/Utils/Reauthentication
 * runs as it does, against Valkey in memory and an account at the
 * services' edges (TestingUtils/ReauthenticationStandIns). For an account
 * with a password, one with two-factor authentication and one that signs
 * in with single sign-on only, each path:
 *
 *   - refuses a session that has not confirmed (missing), with the code a
 *     client acts on, before it writes, counts or spends anything;
 *   - goes through once the session has confirmed the way the account
 *     does: its password, its password and second step, or a sign-in of
 *     its own in the window;
 *   - refuses again once the confirmation is older than the window (stale);
 *   - refuses a confirmation that was wrong (a wrong password confirms
 *     nothing).
 *
 * The paths: UserService's new password, new address and two-factor
 * authentication turned off; an authenticator app begun and removed; a key
 * registered and removed; and a key the API's create tried to add with no
 * ceremony. The routes in front of them are ReauthenticationRoutes.test.ts.
 */

interface UserHooks {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
}

interface CreateHooks<T extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<T>) => Promise<OnCreate<T>>;
}

interface DeleteHooks<T extends DatabaseBaseModel> {
  onBeforeDelete: (deleteBy: DeleteBy<T>) => Promise<OnDelete<T>>;
}

const OLD_EMAIL: string = "river@example.com";
const NEW_EMAIL: string = "river@new-mailbox.example.com";
const NEW_PASSWORD: string = "a much newer password, 2026";

let valkey: StandInValkey;
let account: StandInAccount;
let spies: StandInAccountSpies;
let assertMayAsk: SpyInstance<typeof EmailChangeConfirmation.assertMayAsk>;

function ownRow(): User {
  const user: User = new User();
  user.id = REAUTH_USER_ID;
  user._id = REAUTH_USER_ID.toString();
  user.email = new Email(OLD_EMAIL);

  if (account.hasPassword) {
    user.password = new HashedString("stored-hash", true);
  }

  return user;
}

function othersRow(): User {
  const user: User = new User();
  user.id = REAUTH_OTHER_USER_ID;
  user._id = REAUTH_OTHER_USER_ID.toString();
  user.email = new Email("someone-else@example.com");
  user.password = new HashedString("their-hash", true);
  return user;
}

function signedIn(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID, ...overrides };
}

function update(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = signedIn(),
  accountId: ObjectID = REAUTH_USER_ID,
): UpdateBy<User> {
  return {
    query: { _id: accountId.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    props: props,
    limit: 1,
    skip: 0,
  };
}

async function onBeforeUpdate(
  updateBy: UpdateBy<User>,
): Promise<OnUpdate<User>> {
  return await (UserService as unknown as UserHooks).onBeforeUpdate(updateBy);
}

async function refusalOf(work: Promise<unknown>): Promise<Exception> {
  try {
    await work;
  } catch (err) {
    return err as Exception;
  }

  throw new Error("Expected a refusal, and the change went through.");
}

// Confirms the session the way `account` does, through the real confirmation.
async function confirmAsTheOwner(): Promise<void> {
  if (account.hasPassword) {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: {
        password: RIGHT_PASSWORD,
        ...(account.isTwoFactorOn ? { code: RIGHT_CODE } : {}),
      },
      clientIp: "203.0.113.9",
    });
    return;
  }

  if (
    account.keys.some((isPasskey: boolean | null): boolean => {
      return isPasskey !== false;
    })
  ) {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: { passkeyCredential: { id: "passkey-credential" } },
      clientIp: "203.0.113.9",
    });
    return;
  }

  // An account that confirms by signing in: it has just signed in.
  account = { ...account, signedInMinutesAgo: 0 };
}

// Moves the clock on: what was confirmed `minutes` ago is now that old.
function minutesPass(minutes: number): void {
  jest.setSystemTime(Date.now() + minutes * MINUTE_IN_MS);
  account = {
    ...account,
    signedInMinutesAgo: account.signedInMinutesAgo + minutes,
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "queueMicrotask",
    ],
  });

  valkey = new StandInValkey();
  account = PASSWORD_ACCOUNT;

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  spies = standInAccount(() => {
    return account;
  });

  jest
    .spyOn(
      UserService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<Array<User>>;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockImplementation((async (updateBy: UpdateBy<User>) => {
      const id: string = String(
        (updateBy.query as unknown as { _id: string })._id,
      );
      return id === REAUTH_OTHER_USER_ID.toString()
        ? [othersRow()]
        : [ownRow()];
    }) as never);

  jest
    .spyOn(SsoManagedSignIn, "assertMayChangeLocalSignIn")
    .mockResolvedValue(undefined);
  assertMayAsk = jest
    .spyOn(EmailChangeConfirmation, "assertMayAsk")
    .mockResolvedValue(undefined);
  jest.spyOn(EmailChangeConfirmation, "canSendEmail").mockResolvedValue(true);
  jest
    .spyOn(EmailChangeConfirmation, "sendForPendingChange")
    .mockResolvedValue(undefined);
  jest.spyOn(EmailAddressChangedNotice, "send").mockResolvedValue(true);
  jest
    .spyOn(UserService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "updateOneBy").mockResolvedValue(1 as never);
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(UserService, "assertTwoFactorAuthKeepsASecondStep")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each([
  ["an account with a password", PASSWORD_ACCOUNT],
  ["an account with two-factor authentication on", TWO_FACTOR_ACCOUNT],
  ["an account that signs in with single sign-on only", SSO_ONLY_ACCOUNT],
] as Array<[string, StandInAccount]>)(
  "%s",
  (_name: string, kind: StandInAccount) => {
    beforeEach(() => {
      account = kind;
    });

    describe("a new password (User Profile > Password, PUT /api/user/:id)", () => {
      test("missing: refused with the code a client acts on, and nothing is written", async () => {
        const updateBy: UpdateBy<User> = update({
          password: new HashedString(NEW_PASSWORD),
        });

        const refusal: Exception = await refusalOf(onBeforeUpdate(updateBy));

        expect(refusal).toBeInstanceOf(ReauthenticationRequiredException);
        expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.required);
        expect(UserService.updateOneById).not.toHaveBeenCalled();
      });

      test("confirmed the way the account confirms: it goes through", async () => {
        await confirmAsTheOwner();

        const updateBy: UpdateBy<User> = update({
          password: new HashedString(NEW_PASSWORD),
        });

        await expect(onBeforeUpdate(updateBy)).resolves.toEqual(
          expect.objectContaining({ updateBy: updateBy }),
        );
      });

      test("stale - confirmed longer ago than the window: refused again", async () => {
        await confirmAsTheOwner();
        minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

        expect(
          await refusalOf(
            onBeforeUpdate(
              update({ password: new HashedString(NEW_PASSWORD) }),
            ),
          ),
        ).toBeInstanceOf(ReauthenticationRequiredException);
      });

      test("just inside the window: still confirmed", async () => {
        await confirmAsTheOwner();
        minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES - 1);

        await expect(
          onBeforeUpdate(update({ password: new HashedString(NEW_PASSWORD) })),
        ).resolves.toBeDefined();
      });

      test("a confirmation of one session of the person's confirms nothing for another of theirs", async () => {
        await confirmAsTheOwner();

        expect(
          await refusalOf(
            onBeforeUpdate(
              update(
                { password: new HashedString(NEW_PASSWORD) },
                signedIn({ sessionId: REAUTH_OTHER_SESSION_ID }),
              ),
            ),
          ),
        ).toBeInstanceOf(ReauthenticationRequiredException);
      });
    });

    describe("a new email address (User Profile > Basic Info, Send Link Again, PUT /api/user/:id)", () => {
      test("missing: refused before the change is counted, held or sent", async () => {
        const updateBy: UpdateBy<User> = update({
          email: new Email(NEW_EMAIL),
        });

        expect(await refusalOf(onBeforeUpdate(updateBy))).toBeInstanceOf(
          ReauthenticationRequiredException,
        );

        // Nothing about the address was counted, held or written.
        expect(assertMayAsk).not.toHaveBeenCalled();
        expect(
          (updateBy.data as unknown as Record<string, unknown>)[
            "newUnverifiedTemporaryEmail"
          ],
        ).toBeUndefined();
        expect(String(updateBy.data.email)).toBe(NEW_EMAIL);
        expect(UserService.updateOneById).not.toHaveBeenCalled();
      });

      test("confirmed: held for the new address to confirm, as before (#9821)", async () => {
        await confirmAsTheOwner();

        const updateBy: UpdateBy<User> = update({
          email: new Email(NEW_EMAIL),
        });

        await onBeforeUpdate(updateBy);

        expect(assertMayAsk).toHaveBeenCalledTimes(1);
        expect(
          String(
            (updateBy.data as unknown as Record<string, unknown>)[
              "newUnverifiedTemporaryEmail"
            ],
          ),
        ).toBe(NEW_EMAIL);
      });

      test("stale: refused again", async () => {
        await confirmAsTheOwner();
        minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

        expect(
          await refusalOf(
            onBeforeUpdate(update({ email: new Email(NEW_EMAIL) })),
          ),
        ).toBeInstanceOf(ReauthenticationRequiredException);
      });

      test("the address it already has - every save of the profile's form - asks nothing", async () => {
        await expect(
          onBeforeUpdate(
            update({
              email: new Email(OLD_EMAIL.toUpperCase()),
              name: "River",
            }),
          ),
        ).resolves.toBeDefined();
      });

      test("a server that cannot send the link refuses first: nobody confirms for a change that cannot happen", async () => {
        jest
          .spyOn(EmailChangeConfirmation, "canSendEmail")
          .mockResolvedValue(false);

        const refusal: Exception = await refusalOf(
          onBeforeUpdate(update({ email: new Email(NEW_EMAIL) })),
        );

        expect(refusal).toBeInstanceOf(BadDataException);
        expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
        expect(refusal.message).toBe(EMAIL_CHANGE_CANNOT_BE_EMAILED_MESSAGE);
      });
    });

    describe("an authenticator app begun (User Profile > Two-Factor Authentication, POST /api/user-totp-auth)", () => {
      const begin: () => Promise<OnCreate<UserTotpAuth>> = async (): Promise<
        OnCreate<UserTotpAuth>
      > => {
        const app: UserTotpAuth = new UserTotpAuth();
        app.name = "Phone";

        return await (
          UserTotpAuthService as unknown as CreateHooks<UserTotpAuth>
        ).onBeforeCreate({
          data: app,
          props: signedIn(),
        } as CreateBy<UserTotpAuth>);
      };

      test("missing: refused before a secret is made", async () => {
        expect(await refusalOf(begin())).toBeInstanceOf(
          ReauthenticationRequiredException,
        );
      });

      test("confirmed: begun, with a secret the server made", async () => {
        await confirmAsTheOwner();

        const begun: OnCreate<UserTotpAuth> = await begin();

        expect(begun.createBy.data.twoFactorSecret).toEqual(expect.any(String));
        expect(begun.createBy.data.isVerified).toBe(false);
      });
    });

    describe("an authenticator app or a key removed (DELETE /api/user-totp-auth/:id, /api/user-webauthn/:id)", () => {
      const removeFrom: (
        service: typeof UserTotpAuthService | typeof UserWebAuthnService,
        isVerified: boolean,
      ) => Promise<unknown> = async (
        service: typeof UserTotpAuthService | typeof UserWebAuthnService,
        isVerified: boolean,
      ): Promise<unknown> => {
        jest
          .spyOn(
            service as unknown as {
              findRowsAndHoldDeleteToThem: () => Promise<Array<unknown>>;
            },
            "findRowsAndHoldDeleteToThem",
          )
          .mockResolvedValue([
            { _id: "row", userId: REAUTH_USER_ID, isVerified: isVerified },
          ] as never);

        return await (
          service as unknown as DeleteHooks<UserTotpAuth | UserWebAuthn>
        ).onBeforeDelete({
          query: { _id: "row" },
          limit: 1,
          skip: 0,
          props: signedIn(),
        } as unknown as DeleteBy<UserTotpAuth | UserWebAuthn>);
      };

      test.each([
        ["an authenticator app", UserTotpAuthService],
        ["a key or a passkey", UserWebAuthnService],
      ] as Array<
        [string, typeof UserTotpAuthService | typeof UserWebAuthnService]
      >)(
        "%s: missing is refused, confirmed goes through",
        async (
          _thing: string,
          service: typeof UserTotpAuthService | typeof UserWebAuthnService,
        ) => {
          expect(await refusalOf(removeFrom(service, true))).toBeInstanceOf(
            ReauthenticationRequiredException,
          );

          await confirmAsTheOwner();

          await expect(removeFrom(service, true)).resolves.toBeDefined();
        },
      );

      test("an authenticator app whose setup was never finished signs nobody in, and goes without asking", async () => {
        await expect(
          removeFrom(UserTotpAuthService, false),
        ).resolves.toBeDefined();
      });
    });

    describe("a key registered (User Profile > Passkeys, Two-Factor Authentication)", () => {
      test("missing: refused before the browser's answer is checked or its challenge spent", async () => {
        const challengeKey: string = `webauthn-registration-${REAUTH_USER_ID.toString()}`;

        await valkey.set(
          challengeKey,
          JSON.stringify({
            challenge: "challenge",
            requireUserVerification: false,
            isPasskey: true,
          }),
          "EX",
          300,
        );

        expect(
          await refusalOf(
            UserWebAuthnService.verifyRegistration({
              credential: { id: "new-key" },
              name: "My key",
              props: signedIn(),
            }),
          ),
        ).toBeInstanceOf(ReauthenticationRequiredException);

        // The challenge is still there, for the same answer to go through once confirmed.
        expect(await valkey.get(challengeKey)).not.toBeNull();
      });
    });
  },
);

describe("two-factor authentication turned off (User Profile, PUT /api/user/:id)", () => {
  beforeEach(() => {
    account = TWO_FACTOR_ACCOUNT;
  });

  test("missing: refused", async () => {
    expect(
      await refusalOf(onBeforeUpdate(update({ enableTwoFactorAuth: false }))),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("confirmed with the password and a code: goes through", async () => {
    await confirmAsTheOwner();

    await expect(
      onBeforeUpdate(update({ enableTwoFactorAuth: false })),
    ).resolves.toBeDefined();
  });

  test("confirmed with the password and a backup code: goes through", async () => {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: { password: RIGHT_PASSWORD, backupCode: RIGHT_BACKUP_CODE },
      clientIp: "203.0.113.9",
    });

    await expect(
      onBeforeUpdate(update({ enableTwoFactorAuth: false })),
    ).resolves.toBeDefined();
  });

  test("the password alone confirms nothing while two-factor authentication is on", async () => {
    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
            proof: { password: RIGHT_PASSWORD },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.secondStepRequired);

    expect(
      await refusalOf(onBeforeUpdate(update({ enableTwoFactorAuth: false }))),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("already off: nothing changes, and nothing is asked", async () => {
    account = { ...PASSWORD_ACCOUNT };

    await expect(
      onBeforeUpdate(update({ enableTwoFactorAuth: false })),
    ).resolves.toBeDefined();
  });

  test("turning it on asks nothing: it asks for steps already set up", async () => {
    account = { ...TWO_FACTOR_ACCOUNT, isTwoFactorOn: false };
    jest
      .spyOn(UserService, "assertTwoFactorAuthMayBeTurnedOn")
      .mockResolvedValue(undefined);

    await expect(
      onBeforeUpdate(update({ enableTwoFactorAuth: true })),
    ).resolves.toBeDefined();
  });
});

describe("wrong confirmations confirm nothing", () => {
  test.each([
    ["a wrong password", PASSWORD_ACCOUNT, { password: "not it" }],
    [
      "a wrong authenticator code",
      TWO_FACTOR_ACCOUNT,
      { password: RIGHT_PASSWORD, code: "000000" },
    ],
    [
      "a wrong backup code",
      TWO_FACTOR_ACCOUNT,
      { password: RIGHT_PASSWORD, backupCode: "USEDCODE00" },
    ],
    [
      "the right code with a wrong password",
      TWO_FACTOR_ACCOUNT,
      { password: "not it", code: RIGHT_CODE },
    ],
  ] as Array<[string, StandInAccount, Record<string, string>]>)(
    "%s: the change is still refused",
    async (
      _name: string,
      next: StandInAccount,
      proof: Record<string, string>,
    ) => {
      account = next;

      await refusalOf(
        Reauthentication.confirm({
          session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
          proof: proof,
          clientIp: "203.0.113.9",
        }),
      );

      expect(
        await refusalOf(
          onBeforeUpdate(update({ password: new HashedString(NEW_PASSWORD) })),
        ),
      ).toBeInstanceOf(ReauthenticationRequiredException);
    },
  );

  test("a key that was not accepted: the change is still refused", async () => {
    account = PASSKEY_ONLY_ACCOUNT;
    spies.verifyKey.mockRejectedValue(
      new BadDataException(REAUTHENTICATION_MESSAGES.passkeyNotAccepted),
    );

    await refusalOf(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { passkeyCredential: { id: "passkey-credential" } },
        clientIp: "203.0.113.9",
      }),
    );

    expect(
      await refusalOf(
        onBeforeUpdate(update({ password: new HashedString(NEW_PASSWORD) })),
      ),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("an account that confirms by signing in cannot confirm with a password it does not have", async () => {
    account = SSO_ONLY_ACCOUNT;

    expect(
      (
        await refusalOf(
          Reauthentication.confirm({
            session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
            proof: { password: "anything" },
            clientIp: "203.0.113.9",
          }),
        )
      ).message,
    ).toBe(REAUTHENTICATION_MESSAGES.signInAgain);
  });
});

describe("what the check does not ask", () => {
  test("a root write - a reset link, the link that confirms an address, SCIM, SSO - is the server's own", async () => {
    await expect(
      onBeforeUpdate(
        update({ password: new HashedString(NEW_PASSWORD) }, { isRoot: true }),
      ),
    ).resolves.toBeDefined();

    await expect(
      onBeforeUpdate(
        update(
          { email: new Email(NEW_EMAIL), isEmailVerified: true },
          { isRoot: true },
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("a master admin's own new address is asked like anyone's", async () => {
    account = { ...PASSWORD_ACCOUNT, isMasterAdmin: true };

    expect(
      await refusalOf(
        onBeforeUpdate(
          update(
            { email: new Email(NEW_EMAIL) },
            signedIn({ isMasterAdmin: true }),
          ),
        ),
      ),
    ).toBeInstanceOf(ReauthenticationRequiredException);
  });

  test("a master admin's change of somebody else's address waits for the master admin's own confirmation (#10216)", async () => {
    const refusal: Exception = await refusalOf(
      onBeforeUpdate(
        update(
          { email: new Email(NEW_EMAIL) },
          signedIn({ isMasterAdmin: true }),
          REAUTH_OTHER_USER_ID,
        ),
      ),
    );

    expect(refusal).toBeInstanceOf(ReauthenticationRequiredException);
    expect(refusal.message).toBe(
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
    );

    await confirmAsTheOwner();

    await expect(
      onBeforeUpdate(
        update(
          { email: new Email(NEW_EMAIL) },
          signedIn({ isMasterAdmin: true }),
          REAUTH_OTHER_USER_ID,
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("a request with no session - an API key, an MCP client - is refused, never asked", async () => {
    const refusal: Exception = await refusalOf(
      onBeforeUpdate(
        update(
          { password: new HashedString(NEW_PASSWORD) },
          { userId: REAUTH_USER_ID },
        ),
      ),
    );

    expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
    expect(refusal.message).toBe(REAUTHENTICATION_MESSAGES.notFromASession);
  });

  test("a write that changes nothing about signing in - a name, a time zone, a language - asks nothing", async () => {
    await expect(
      onBeforeUpdate(update({ name: "River", timezone: "Europe/Berlin" })),
    ).resolves.toBeDefined();
  });
});

describe("a key added through the API's create, with no ceremony", () => {
  test("is refused, confirmed or not: only the verified registration adds a key", async () => {
    await confirmAsTheOwner();

    const key: UserWebAuthn = new UserWebAuthn();
    key.name = "A key pair of my own";
    key.credentialId = "attacker-credential";
    key.publicKey = Buffer.from("attacker-public-key").toString("base64");
    key.counter = "0";

    const refusal: Exception = await refusalOf(
      (
        UserWebAuthnService as unknown as CreateHooks<UserWebAuthn>
      ).onBeforeCreate({
        data: key,
        props: signedIn(),
      } as CreateBy<UserWebAuthn>),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(WEBAUTHN_ADDED_BY_REGISTRATION_ONLY_MESSAGE);
    expect(key.isVerified).toBeUndefined();
  });

  test("the verified registration's own write, as root, still adds one", async () => {
    const key: UserWebAuthn = new UserWebAuthn();
    key.name = "A verified key";

    const created: OnCreate<UserWebAuthn> = await (
      UserWebAuthnService as unknown as CreateHooks<UserWebAuthn>
    ).onBeforeCreate({
      data: key,
      props: { ...signedIn(), isRoot: true },
    } as CreateBy<UserWebAuthn>);

    expect(created.createBy.data.isVerified).toBe(true);
  });
});
