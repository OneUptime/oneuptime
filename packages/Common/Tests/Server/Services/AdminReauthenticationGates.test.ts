import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import GlobalConfigService, {
  Service as GlobalConfigServiceClass,
} from "../../../Server/Services/GlobalConfigService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService, {
  SOMEONES_ACCOUNT_IN_A_PROJECT_MESSAGE,
  Service as UserServiceClass,
} from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import EmailAddressChangedNotice from "../../../Server/Utils/EmailChange/EmailAddressChangedNotice";
import EmailChangeConfirmation from "../../../Server/Utils/EmailChange/EmailChangeConfirmation";
import GlobalSsoProviderChanges from "../../../Server/Utils/GlobalSsoProviderChanges";
import IdentityProviderSignOutCheck from "../../../Server/Utils/IdentityProviderSignOutCheck";
import logger from "../../../Server/Utils/Logger";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import {
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  MINUTE_IN_MS,
  PASSWORD_ACCOUNT,
  REAUTH_OTHER_USER_ID,
  REAUTH_SESSION_ID,
  REAUTH_USER_ID,
  RIGHT_PASSWORD,
  StandInAccount,
  StandInValkey,
  standInAccount,
} from "../TestingUtils/ReauthenticationStandIns";

/*
 * A MASTER ADMIN CONFIRMS IT'S THEM BEFORE CHANGING HOW ANYONE SIGNS IN
 * (#10216), AND YOU DO BEFORE DELETING YOUR OWN ACCOUNT (#10220) - through
 * the real hooks and the real check.
 *
 * Nothing about the check is stubbed: Server/Utils/Reauthentication runs as
 * it does, against Valkey in memory and the master admin's own account at
 * the services' edges (TestingUtils/ReauthenticationStandIns). Their
 * session confirms with their own password, as the Admin Dashboard's prompt
 * sends it. Each change below is:
 *
 *   - refused while the session has not confirmed, with the code a client
 *     acts on and what it is for (AdminChange, DeleteAccount), before
 *     anything is read, locked, written or sent;
 *   - let through once it has, inside the window;
 *   - refused again once the window has passed;
 *   - refused, with what to do, from a request with no session - the
 *     master API key's: it acts as a master admin, and nobody signed in to
 *     it, so nobody can confirm.
 *
 * The changes: another person's email address and password (PUT
 * /api/user/:id); who is a master admin; the server's own SAML and OpenID
 * Connect providers; the server's email settings; deleting your own
 * account; and (#10330) deleting someone else's account and turning the
 * master API key back on, each recorded in the server's log with who did
 * it. The routes in front of the rest - Set Password, resetting two-factor
 * authentication and the others - are
 * Tests/Server/API/AdminReauthenticationRoutes.test.ts, and the delete and
 * the switch through the real HTTP routes are
 * Tests/Server/API/AdminDeleteAndMasterApiKeyOverHttp.test.ts.
 */

interface UserHooks {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
  onBeforeDelete: (deleteBy: DeleteBy<User>) => Promise<OnDelete<User>>;
  onDeleteSuccess: (
    onDelete: OnDelete<User>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<OnDelete<User>>;
}

interface ProviderHooks<T extends GlobalSso | GlobalOidc> {
  onCreatePermitted: (onCreate: OnCreate<T>) => Promise<void>;
  onUpdatePermitted: (updateBy: UpdateBy<T>) => Promise<void>;
  onBeforeDelete: (deleteBy: DeleteBy<T>) => Promise<OnDelete<T>>;
}

interface GlobalConfigHooks {
  onBeforeUpdate: (
    updateBy: UpdateBy<GlobalConfig>,
  ) => Promise<OnUpdate<GlobalConfig>>;
  onBeforeCreate: (
    createBy: CreateBy<GlobalConfig>,
  ) => Promise<OnCreate<GlobalConfig>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<GlobalConfig>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<GlobalConfig>>;
}

const userHooks: UserHooks = UserService as unknown as UserHooks;
const globalConfigHooks: GlobalConfigHooks =
  GlobalConfigService as unknown as GlobalConfigHooks;

let valkey: StandInValkey;
let account: StandInAccount;

// The master admin's own session: their account is REAUTH_USER_ID.
function masterAdmin(): DatabaseCommonInteractionProps {
  return {
    userId: REAUTH_USER_ID,
    sessionId: REAUTH_SESSION_ID,
    isMasterAdmin: true,
    userType: UserType.MasterAdmin,
  };
}

/*
 * What the master API key's requests are handed (ProjectAuthorization,
 * CommonAPI): a master admin's user, and no session.
 */
function masterApiKey(): DatabaseCommonInteractionProps {
  return {
    userId: REAUTH_USER_ID,
    isMasterAdmin: true,
    userType: UserType.MasterAdmin,
    apiKeyName: "Master API Key",
  };
}

function ownSession(): DatabaseCommonInteractionProps {
  return { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID };
}

function someonesRow(): User {
  const user: User = new User();
  user.id = REAUTH_OTHER_USER_ID;
  user._id = REAUTH_OTHER_USER_ID.toString();
  user.email = new Email("someone@example.com");
  user.password = new HashedString("their-hash", true);
  return user;
}

function ownRow(): User {
  const user: User = new User();
  user.id = REAUTH_USER_ID;
  user._id = REAUTH_USER_ID.toString();
  user.email = new Email("river@example.com");
  user.password = new HashedString("stored-hash", true);
  return user;
}

function userUpdate(
  patch: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  accountId: ObjectID = REAUTH_OTHER_USER_ID,
): UpdateBy<User> {
  return {
    query: { _id: accountId.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    props: props,
    limit: 1,
    skip: 0,
  };
}

function userDelete(
  props: DatabaseCommonInteractionProps,
  accountId: ObjectID = REAUTH_USER_ID,
): DeleteBy<User> {
  return {
    query: { _id: accountId.toString() } as unknown as DeleteBy<User>["query"],
    props: props,
    limit: 1,
    skip: 0,
  } as DeleteBy<User>;
}

async function refusalOf(work: Promise<unknown>): Promise<Exception> {
  try {
    await work;
  } catch (err) {
    return err as Exception;
  }

  throw new Error("Expected a refusal, and the change went through.");
}

// The master admin's session confirms with their own password, as the prompt sends it.
async function confirm(): Promise<void> {
  await Reauthentication.confirm({
    session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
    proof: { password: RIGHT_PASSWORD },
    clientIp: "203.0.113.9",
  });
}

function minutesPass(minutes: number): void {
  jest.setSystemTime(Date.now() + minutes * MINUTE_IN_MS);
}

// The refusal a change waits with: its words, its code and its purpose.
function expectRefusal(
  refusal: Exception,
  purpose: ReauthenticationPurpose,
): void {
  expect(refusal).toBeInstanceOf(ReauthenticationRequiredException);
  expect(refusal.message).toBe(REAUTHENTICATION_REQUIRED_MESSAGES[purpose]);
  expect(getErrorDetails(refusal)[REAUTHENTICATION_PURPOSE_FIELD]).toBe(
    purpose,
  );
}

function expectNoSessionRefusal(
  refusal: Exception,
  purpose: ReauthenticationPurpose,
): void {
  expect(refusal).toBeInstanceOf(BadDataException);
  expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
  expect(refusal.message).toBe(
    REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[purpose],
  );
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
  account = { ...PASSWORD_ACCOUNT, isMasterAdmin: true };

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  standInAccount(() => {
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
        ? [someonesRow()]
        : [ownRow()];
    }) as never);

  jest
    .spyOn(
      UserService as unknown as {
        findRowsAndHoldDeleteToThem: () => Promise<Array<User>>;
      },
      "findRowsAndHoldDeleteToThem",
    )
    .mockImplementation((async (deleteBy: DeleteBy<User>) => {
      const id: string = String(
        (deleteBy.query as unknown as { _id: string })._id,
      );
      return id === REAUTH_OTHER_USER_ID.toString()
        ? [someonesRow()]
        : [ownRow()];
    }) as never);

  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(SsoManagedSignIn, "assertMayChangeLocalSignIn")
    .mockResolvedValue(undefined);
  jest.spyOn(EmailChangeConfirmation, "canSendEmail").mockResolvedValue(true);
  jest.spyOn(EmailAddressChangedNotice, "send").mockResolvedValue(true);
  jest
    .spyOn(UserService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "updateOneBy").mockResolvedValue(1 as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("another person's email address or password, from a master admin (PUT /api/user/:id)", () => {
  test.each([
    ["a new email address", { email: new Email("taken-over@example.com") }],
    [
      "a new password",
      { password: new HashedString("a much newer password, 2026") },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s: refused until the master admin's own session confirms, through inside the window, refused after it",
    async (_name: string, patch: Record<string, unknown>) => {
      expectRefusal(
        await refusalOf(
          userHooks.onBeforeUpdate(userUpdate(patch, masterAdmin())),
        ),
        ReauthenticationPurpose.AdminChange,
      );

      await confirm();

      await expect(
        userHooks.onBeforeUpdate(userUpdate(patch, masterAdmin())),
      ).resolves.toBeDefined();

      minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

      expectRefusal(
        await refusalOf(
          userHooks.onBeforeUpdate(userUpdate(patch, masterAdmin())),
        ),
        ReauthenticationPurpose.AdminChange,
      );
    },
  );

  test("a wrong password confirms nothing, and the change stays refused", async () => {
    await refusalOf(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: "a guess" },
        clientIp: "203.0.113.9",
      }),
    );

    expectRefusal(
      await refusalOf(
        userHooks.onBeforeUpdate(
          userUpdate(
            { email: new Email("taken-over@example.com") },
            masterAdmin(),
          ),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("the address the person already has asks nothing: nothing changes", async () => {
    await expect(
      userHooks.onBeforeUpdate(
        userUpdate({ email: new Email("someone@example.com") }, masterAdmin()),
      ),
    ).resolves.toBeDefined();
  });

  test("a change that is not to how they sign in - a name - asks nothing", async () => {
    await expect(
      userHooks.onBeforeUpdate(userUpdate({ name: "Someone" }, masterAdmin())),
    ).resolves.toBeDefined();
  });

  test("the master API key - no session - is refused with what to do, and cannot confirm", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        userHooks.onBeforeUpdate(
          userUpdate(
            { password: new HashedString("a much newer password, 2026") },
            masterApiKey(),
          ),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );

    expectNoSessionRefusal(
      await refusalOf(
        userHooks.onBeforeUpdate(
          userUpdate(
            { email: new Email("taken-over@example.com") },
            masterApiKey(),
          ),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("a root write - SCIM, single sign-on, the server's own - is not asked", async () => {
    await expect(
      userHooks.onBeforeUpdate(
        userUpdate(
          { email: new Email("from-the-identity-provider@example.com") },
          { isRoot: true },
        ),
      ),
    ).resolves.toBeDefined();
  });

  test("the master admin's own address is their own change: asked as one", async () => {
    expectRefusal(
      await refusalOf(
        userHooks.onBeforeUpdate(
          userUpdate(
            { email: new Email("river@new-mailbox.example.com") },
            masterAdmin(),
            REAUTH_USER_ID,
          ),
        ),
      ),
      ReauthenticationPurpose.OwnSignIn,
    );
  });
});

describe("who is a master admin (Admin Dashboard > Users > Settings)", () => {
  test.each([
    ["making someone a master admin", true],
    ["no longer one", false],
  ] as Array<[string, boolean]>)(
    "%s: refused until the master admin's session confirms, before anything is read",
    async (_name: string, isMasterAdmin: boolean) => {
      const rowsRead: unknown = (
        UserService as unknown as {
          findRowsAndHoldUpdateToThem: jest.Mock;
        }
      ).findRowsAndHoldUpdateToThem;

      expectRefusal(
        await refusalOf(
          userHooks.onBeforeUpdate(
            userUpdate({ isMasterAdmin: isMasterAdmin }, masterAdmin()),
          ),
        ),
        ReauthenticationPurpose.AdminChange,
      );

      expect(rowsRead).not.toHaveBeenCalled();

      await confirm();

      await expect(
        userHooks.onBeforeUpdate(
          userUpdate({ isMasterAdmin: isMasterAdmin }, masterAdmin()),
        ),
      ).resolves.toBeDefined();
    },
  );

  test("from the master API key: refused, as nobody can confirm", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        userHooks.onBeforeUpdate(
          userUpdate({ isMasterAdmin: true }, masterApiKey()),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("the server's own write - the first account - is not asked", async () => {
    await expect(
      userHooks.onBeforeUpdate(
        userUpdate({ isMasterAdmin: true }, { isRoot: true }),
      ),
    ).resolves.toBeDefined();
  });
});

describe("deleting your own account (Danger Zone > Delete Account, #10220)", () => {
  beforeEach(() => {
    account = PASSWORD_ACCOUNT;
  });

  test("refused until the session confirms, through inside the window, refused after it", async () => {
    expectRefusal(
      await refusalOf(userHooks.onBeforeDelete(userDelete(ownSession()))),
      ReauthenticationPurpose.DeleteAccount,
    );

    await confirm();

    await expect(
      userHooks.onBeforeDelete(userDelete(ownSession())),
    ).resolves.toBeDefined();

    minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

    expectRefusal(
      await refusalOf(userHooks.onBeforeDelete(userDelete(ownSession()))),
      ReauthenticationPurpose.DeleteAccount,
    );
  });

  test("an account still in a project is told so first, and asked nothing", async () => {
    const membership: TeamMember = new TeamMember();
    membership._id = ObjectID.generate().toString();
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([membership]);
    const assertConfirmed: SpyInstance<
      typeof Reauthentication.assertConfirmed
    > = jest.spyOn(Reauthentication, "assertConfirmed");

    const refusal: Exception = await refusalOf(
      userHooks.onBeforeDelete(userDelete(ownSession())),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
    expect(refusal.message).toContain("member of one or more projects");
    expect(assertConfirmed).not.toHaveBeenCalled();
  });

  test("a master admin deleting their own account is asked as anyone is", async () => {
    account = { ...PASSWORD_ACCOUNT, isMasterAdmin: true };

    expectRefusal(
      await refusalOf(userHooks.onBeforeDelete(userDelete(masterAdmin()))),
      ReauthenticationPurpose.DeleteAccount,
    );
  });

  test("a root delete - the server's own - is not asked", async () => {
    await expect(
      userHooks.onBeforeDelete(userDelete({ isRoot: true })),
    ).resolves.toBeDefined();
  });

  test("a request with no session cannot delete its account", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(userDelete({ userId: REAUTH_USER_ID })),
      ),
      ReauthenticationPurpose.DeleteAccount,
    );
  });
});

/*
 * A MASTER ADMIN DELETING SOMEONE ELSE'S ACCOUNT (#10330): Admin Dashboard
 * > Users > Delete, or DELETE /api/user/:id. Only an account in no project
 * can be deleted, so it takes nobody's projects, but it cannot be undone:
 * whoever held a master admin's session could delete any such account
 * without their password. Now it waits for the master admin's own session,
 * as their other changes to someone else's account do.
 */
describe("deleting someone else's account, from a master admin (Admin Dashboard > Users > Delete, #10330)", () => {
  test("refused until the master admin's own session confirms, through inside the window, refused after it", async () => {
    expectRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterAdmin(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );

    await confirm();

    await expect(
      userHooks.onBeforeDelete(userDelete(masterAdmin(), REAUTH_OTHER_USER_ID)),
    ).resolves.toBeDefined();

    minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

    expectRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterAdmin(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("a wrong password confirms nothing, and the delete stays refused", async () => {
    await refusalOf(
      Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
        proof: { password: "a guess" },
        clientIp: "203.0.113.9",
      }),
    );

    expectRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterAdmin(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("another session's confirmation does not count: only the master admin's own", async () => {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: ObjectID.generate() },
      proof: { password: RIGHT_PASSWORD },
      clientIp: "203.0.113.9",
    });

    expectRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterAdmin(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("an account still in a project is told whose it is first, and the master admin is asked nothing", async () => {
    const membership: TeamMember = new TeamMember();
    membership._id = ObjectID.generate().toString();
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([membership]);
    const assertConfirmed: SpyInstance<
      typeof Reauthentication.assertConfirmed
    > = jest.spyOn(Reauthentication, "assertConfirmed");

    const refusal: Exception = await refusalOf(
      userHooks.onBeforeDelete(userDelete(masterAdmin(), REAUTH_OTHER_USER_ID)),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal).not.toBeInstanceOf(ReauthenticationRequiredException);
    expect(refusal.message).toBe(SOMEONES_ACCOUNT_IN_A_PROJECT_MESSAGE);
    // Never "your account": it is not theirs.
    expect(refusal.message).not.toContain("your account");
    expect(assertConfirmed).not.toHaveBeenCalled();
  });

  test("the master API key - no session - is refused with what to do, and cannot confirm", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterApiKey(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("a root delete of someone's account - the server's own - is not asked", async () => {
    await expect(
      userHooks.onBeforeDelete(
        userDelete({ isRoot: true }, REAUTH_OTHER_USER_ID),
      ),
    ).resolves.toBeDefined();
  });

  test("a delete that reaches their own account and someone else's asks as deleting their own", async () => {
    jest
      .spyOn(
        UserService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<Array<User>>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([ownRow(), someonesRow()] as never);

    expectRefusal(
      await refusalOf(
        userHooks.onBeforeDelete(
          userDelete(masterAdmin(), REAUTH_OTHER_USER_ID),
        ),
      ),
      ReauthenticationPurpose.DeleteAccount,
    );
  });

  test("a delete that reaches no account asks nothing: nothing is deleted", async () => {
    jest
      .spyOn(
        UserService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<Array<User>>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([] as never);
    const assertConfirmed: SpyInstance<
      typeof Reauthentication.assertConfirmed
    > = jest.spyOn(Reauthentication, "assertConfirmed");

    await expect(
      userHooks.onBeforeDelete(userDelete(masterAdmin(), REAUTH_OTHER_USER_ID)),
    ).resolves.toBeDefined();
    expect(assertConfirmed).not.toHaveBeenCalled();
  });
});

/*
 * RECORDED (#10330): an account in no project has no audit log to say it
 * went, so the server's log says whose it was and who deleted it - by
 * their ids, never an address.
 */
describe("a deleted account is recorded for whoever runs the server", () => {
  test.each([
    [
      "by a master admin",
      (): DatabaseCommonInteractionProps => {
        return masterAdmin();
      },
      REAUTH_OTHER_USER_ID,
      `Account of user ${REAUTH_OTHER_USER_ID.toString()} deleted by master admin ${REAUTH_USER_ID.toString()}.`,
    ],
    [
      "by its owner",
      (): DatabaseCommonInteractionProps => {
        return ownSession();
      },
      REAUTH_USER_ID,
      `Account of user ${REAUTH_USER_ID.toString()} deleted by its owner.`,
    ],
    [
      "by OneUptime",
      (): DatabaseCommonInteractionProps => {
        return { isRoot: true };
      },
      REAUTH_OTHER_USER_ID,
      `Account of user ${REAUTH_OTHER_USER_ID.toString()} deleted by OneUptime.`,
    ],
  ] as Array<[string, () => DatabaseCommonInteractionProps, ObjectID, string]>)(
    "%s: once it is gone, by their ids",
    async (
      _name: string,
      props: () => DatabaseCommonInteractionProps,
      accountId: ObjectID,
      line: string,
    ) => {
      jest
        .spyOn(RealtimeAccessChanges, "announce")
        .mockImplementation(() => {});
      const info: SpyInstance<typeof logger.info> = jest
        .spyOn(logger, "info")
        .mockImplementation(() => {});

      await userHooks.onDeleteSuccess(
        { deleteBy: userDelete(props(), accountId), carryForward: null },
        [accountId],
      );

      expect(info).toHaveBeenCalledWith(line);
      expect(
        UserServiceClass.getAccountDeletedLogLine({
          userId: accountId,
          props: props(),
        }),
      ).toBe(line);
      // Never an address.
      expect(line).not.toContain("@");
    },
  );
});

/*
 * TURNING THE MASTER API KEY BACK ON (#10330): Admin Dashboard > Settings >
 * API Key's Enabled switch, or a write of isMasterApiKeyEnabled through the
 * API. Its value cannot be read back, so whoever holds the session cannot
 * use it, but whoever holds the key could again. Making a new one has
 * asked since #10216; turning one back on asks the same now. Turning it off
 * asks nothing.
 */
describe("turning the master API key back on (Admin Dashboard > Settings > API Key, #10330)", () => {
  const switchUpdate: (
    value: unknown,
    props: DatabaseCommonInteractionProps,
  ) => UpdateBy<GlobalConfig> = (
    value: unknown,
    props: DatabaseCommonInteractionProps,
  ): UpdateBy<GlobalConfig> => {
    return {
      query: { _id: ObjectID.getZeroObjectID().toString() },
      data: { isMasterApiKeyEnabled: value },
      props: props,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<GlobalConfig>;
  };

  test("refused until the master admin's own session confirms, through inside the window, refused after it", async () => {
    expectRefusal(
      await refusalOf(
        globalConfigHooks.onBeforeUpdate(switchUpdate(true, masterAdmin())),
      ),
      ReauthenticationPurpose.AdminChange,
    );

    await confirm();

    await expect(
      globalConfigHooks.onBeforeUpdate(switchUpdate(true, masterAdmin())),
    ).resolves.toBeDefined();

    minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

    expectRefusal(
      await refusalOf(
        globalConfigHooks.onBeforeUpdate(switchUpdate(true, masterAdmin())),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test.each([
    ["the text true", "true"],
    ["the number 1", 1],
    ["yes", "yes"],
  ] as Array<[string, unknown]>)(
    "a value the database reads as on - %s - is asked as on is",
    async (_name: string, value: unknown) => {
      expectRefusal(
        await refusalOf(
          globalConfigHooks.onBeforeUpdate(switchUpdate(value, masterAdmin())),
        ),
        ReauthenticationPurpose.AdminChange,
      );
    },
  );

  test.each([
    ["turned off", false],
    ["cleared", null],
  ] as Array<[string, unknown]>)(
    "%s, it asks nothing: taking a way in away must be possible at once",
    async (_name: string, value: unknown) => {
      const assertConfirmed: SpyInstance<
        typeof Reauthentication.assertConfirmed
      > = jest.spyOn(Reauthentication, "assertConfirmed");

      await expect(
        globalConfigHooks.onBeforeUpdate(switchUpdate(value, masterAdmin())),
      ).resolves.toBeDefined();
      expect(assertConfirmed).not.toHaveBeenCalled();
    },
  );

  test("the master API key cannot turn itself back on, nor be turned on with it: refused, with what to do", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        globalConfigHooks.onBeforeUpdate(switchUpdate(true, masterApiKey())),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("the master API key can still turn itself off", async () => {
    await expect(
      globalConfigHooks.onBeforeUpdate(switchUpdate(false, masterApiKey())),
    ).resolves.toBeDefined();
  });

  test("OneUptime's own write - a new key, turned on as it is made - is not asked", async () => {
    await expect(
      globalConfigHooks.onBeforeUpdate(switchUpdate(true, { isRoot: true })),
    ).resolves.toBeDefined();
  });

  test("a setting beside it that is not the switch asks nothing", async () => {
    const assertConfirmed: SpyInstance<
      typeof Reauthentication.assertConfirmed
    > = jest.spyOn(Reauthentication, "assertConfirmed");

    await expect(
      globalConfigHooks.onBeforeUpdate({
        query: { _id: ObjectID.getZeroObjectID().toString() },
        data: { disableSignup: true },
        props: masterAdmin(),
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<GlobalConfig>),
    ).resolves.toBeDefined();
    expect(assertConfirmed).not.toHaveBeenCalled();
  });

  test("a create through the API that turns it on is asked as an update is", async () => {
    const config: GlobalConfig = new GlobalConfig();
    config.isMasterApiKeyEnabled = true;

    const created: (
      props: DatabaseCommonInteractionProps,
    ) => Promise<unknown> = (
      props: DatabaseCommonInteractionProps,
    ): Promise<unknown> => {
      return globalConfigHooks.onBeforeCreate({
        data: config,
        props: props,
      } as unknown as CreateBy<GlobalConfig>);
    };

    expectRefusal(
      await refusalOf(created(masterAdmin())),
      ReauthenticationPurpose.AdminChange,
    );
    expectNoSessionRefusal(
      await refusalOf(created(masterApiKey())),
      ReauthenticationPurpose.AdminChange,
    );

    await confirm();

    await expect(created(masterAdmin())).resolves.toBeDefined();
  });

  describe("recorded for whoever runs the server, with who did it", () => {
    test.each([
      [
        "turned on by a master admin",
        true,
        (): DatabaseCommonInteractionProps => {
          return masterAdmin();
        },
        `The master API key was turned on by master admin ${REAUTH_USER_ID.toString()}.`,
      ],
      [
        "turned off by a master admin",
        false,
        (): DatabaseCommonInteractionProps => {
          return masterAdmin();
        },
        `The master API key was turned off by master admin ${REAUTH_USER_ID.toString()}.`,
      ],
      [
        "turned off by the master API key itself",
        false,
        (): DatabaseCommonInteractionProps => {
          return masterApiKey();
        },
        'The master API key was turned off by the API key "Master API Key".',
      ],
    ] as Array<
      [string, unknown, () => DatabaseCommonInteractionProps, string]
    >)(
      "%s",
      async (
        _name: string,
        value: unknown,
        props: () => DatabaseCommonInteractionProps,
        line: string,
      ) => {
        const info: SpyInstance<typeof logger.info> = jest
          .spyOn(logger, "info")
          .mockImplementation(() => {});

        expect(
          GlobalConfigServiceClass.getMasterApiKeySwitchLogLine({
            data: { isMasterApiKeyEnabled: value },
            props: props(),
          }),
        ).toBe(line);

        await globalConfigHooks.onUpdateSuccess(
          { updateBy: switchUpdate(value, props()), carryForward: null },
          [ObjectID.getZeroObjectID()],
        );

        expect(info).toHaveBeenCalledWith(line);
      },
    );

    test("nothing is recorded for a write that does not switch it, nor for OneUptime's own", () => {
      expect(
        GlobalConfigServiceClass.getMasterApiKeySwitchLogLine({
          data: { disableSignup: true },
          props: masterAdmin(),
        }),
      ).toBeNull();
      expect(
        GlobalConfigServiceClass.getMasterApiKeySwitchLogLine({
          data: { isMasterApiKeyEnabled: true },
          props: { isRoot: true },
        }),
      ).toBeNull();
    });
  });
});

describe.each([
  [
    "the server's own SAML providers (Admin Dashboard > Settings > SSO)",
    GlobalSsoService as unknown as ProviderHooks<GlobalSso>,
    (): GlobalSso => {
      return new GlobalSso();
    },
  ],
  [
    "the server's own OpenID Connect providers",
    GlobalOidcService as unknown as ProviderHooks<GlobalOidc>,
    (): GlobalOidc => {
      return new GlobalOidc();
    },
  ],
] as Array<
  [string, ProviderHooks<GlobalSso | GlobalOidc>, () => GlobalSso | GlobalOidc]
>)(
  "%s",
  (
    _name: string,
    hooks: ProviderHooks<GlobalSso | GlobalOidc>,
    makeProvider: () => GlobalSso | GlobalOidc,
  ) => {
    // The lock on the server's sign-in rules a provider's change takes.
    let locked: Mock<(...args: Array<never>) => unknown>;

    beforeEach(() => {
      locked = jest
        .spyOn(GlobalSsoProviderChanges, "beforeProviderUpdate")
        .mockResolvedValue(undefined as never) as unknown as Mock<
        (...args: Array<never>) => unknown
      >;
      jest
        .spyOn(GlobalSsoProviderChanges, "beforeProviderWrite")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(GlobalSsoProviderChanges, "beforeProviderDelete")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IdentityProviderSignOutCheck, "beforeSamlProviderUpdate")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IdentityProviderSignOutCheck, "beforeUpdate")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IdentityProviderSignOutCheck, "beforeCreate")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IdentityProviderSignOutCheck, "beforeSamlProviderCreate")
        .mockReturnValue(undefined);
    });

    const create: (
      props: DatabaseCommonInteractionProps,
    ) => OnCreate<GlobalSso | GlobalOidc> = (
      props: DatabaseCommonInteractionProps,
    ): OnCreate<GlobalSso | GlobalOidc> => {
      return {
        createBy: { data: makeProvider(), props: props },
        carryForward: null,
      } as unknown as OnCreate<GlobalSso | GlobalOidc>;
    };

    const update: (
      props: DatabaseCommonInteractionProps,
    ) => UpdateBy<GlobalSso | GlobalOidc> = (
      props: DatabaseCommonInteractionProps,
    ): UpdateBy<GlobalSso | GlobalOidc> => {
      return {
        query: { _id: ObjectID.generate().toString() },
        data: { isEnabled: true },
        props: props,
        limit: 1,
        skip: 0,
      } as unknown as UpdateBy<GlobalSso | GlobalOidc>;
    };

    const remove: (
      props: DatabaseCommonInteractionProps,
    ) => DeleteBy<GlobalSso | GlobalOidc> = (
      props: DatabaseCommonInteractionProps,
    ): DeleteBy<GlobalSso | GlobalOidc> => {
      return {
        query: { _id: ObjectID.generate().toString() },
        props: props,
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<GlobalSso | GlobalOidc>;
    };

    test("adding one: refused until the master admin's session confirms, then let through", async () => {
      expectRefusal(
        await refusalOf(hooks.onCreatePermitted(create(masterAdmin()))),
        ReauthenticationPurpose.AdminChange,
      );

      await confirm();

      await expect(
        hooks.onCreatePermitted(create(masterAdmin())),
      ).resolves.toBeUndefined();
    });

    test("changing one: refused before the server's sign-in rules are locked", async () => {
      expectRefusal(
        await refusalOf(hooks.onUpdatePermitted(update(masterAdmin()))),
        ReauthenticationPurpose.AdminChange,
      );
      expect(locked).not.toHaveBeenCalled();

      await confirm();

      await expect(
        hooks.onUpdatePermitted(update(masterAdmin())),
      ).resolves.toBeUndefined();
      expect(locked).toHaveBeenCalledTimes(1);

      minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

      expectRefusal(
        await refusalOf(hooks.onUpdatePermitted(update(masterAdmin()))),
        ReauthenticationPurpose.AdminChange,
      );
    });

    test("deleting one: refused until the master admin's session confirms", async () => {
      expectRefusal(
        await refusalOf(hooks.onBeforeDelete(remove(masterAdmin()))),
        ReauthenticationPurpose.AdminChange,
      );
      expect(
        GlobalSsoProviderChanges.beforeProviderDelete,
      ).not.toHaveBeenCalled();

      await confirm();

      await expect(
        hooks.onBeforeDelete(remove(masterAdmin())),
      ).resolves.toBeDefined();
    });

    test("the master API key cannot add, change or delete one", async () => {
      expectNoSessionRefusal(
        await refusalOf(hooks.onCreatePermitted(create(masterApiKey()))),
        ReauthenticationPurpose.AdminChange,
      );
      expectNoSessionRefusal(
        await refusalOf(hooks.onUpdatePermitted(update(masterApiKey()))),
        ReauthenticationPurpose.AdminChange,
      );
      expectNoSessionRefusal(
        await refusalOf(hooks.onBeforeDelete(remove(masterApiKey()))),
        ReauthenticationPurpose.AdminChange,
      );
    });

    test("OneUptime's own writes are not asked", async () => {
      await expect(
        hooks.onUpdatePermitted(update({ isRoot: true })),
      ).resolves.toBeUndefined();
      await expect(
        hooks.onCreatePermitted(create({ isRoot: true })),
      ).resolves.toBeUndefined();
    });
  },
);

describe("the server's email settings (Admin Dashboard > Settings > Emails)", () => {
  const settingsUpdate: (
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ) => UpdateBy<GlobalConfig> = (
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): UpdateBy<GlobalConfig> => {
    return {
      query: { _id: ObjectID.getZeroObjectID().toString() },
      data: data,
      props: props,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<GlobalConfig>;
  };

  test.each([
    ["the mail server", { smtpHost: "mail.taken-over.example.com" }],
    ["its password", { smtpPassword: "a password of their own" }],
    ["another provider's key", { sendgridApiKey: "SG.theirs" }],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s: refused until the master admin's session confirms, then let through",
    async (_name: string, data: Record<string, unknown>) => {
      expectRefusal(
        await refusalOf(
          globalConfigHooks.onBeforeUpdate(settingsUpdate(data, masterAdmin())),
        ),
        ReauthenticationPurpose.AdminChange,
      );

      await confirm();

      await expect(
        globalConfigHooks.onBeforeUpdate(settingsUpdate(data, masterAdmin())),
      ).resolves.toBeDefined();
    },
  );

  test("from the master API key: refused", async () => {
    expectNoSessionRefusal(
      await refusalOf(
        globalConfigHooks.onBeforeUpdate(
          settingsUpdate({ smtpHost: "mail.example.com" }, masterApiKey()),
        ),
      ),
      ReauthenticationPurpose.AdminChange,
    );
  });

  test("a setting that carries no email - whether people may sign up - asks nothing", async () => {
    await expect(
      globalConfigHooks.onBeforeUpdate(
        settingsUpdate({ disableSignup: true }, masterAdmin()),
      ),
    ).resolves.toBeDefined();
  });

  test("OneUptime's own writes are not asked", async () => {
    await expect(
      globalConfigHooks.onBeforeUpdate(
        settingsUpdate({ smtpHost: "mail.example.com" }, { isRoot: true }),
      ),
    ).resolves.toBeDefined();
  });
});
