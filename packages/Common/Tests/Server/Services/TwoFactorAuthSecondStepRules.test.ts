jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

import UserService, {
  Service as UserServiceClass,
} from "../../../Server/Services/UserService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import User from "../../../Models/DatabaseModels/User";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../Models/DatabaseModels/UserWebAuthn";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import TwoFactorAuthSetupUtil, {
  TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
} from "../../../Types/TwoFactorAuthSetup";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TWO-FACTOR AUTHENTICATION AND THE SECOND STEPS BEHIND IT (issue #9666).
 *
 * The profile could say "Enabled" over nothing: turned on with no
 * authenticator app, security key or passkey, or left on once the last one
 * was removed. The second of those is what this suite holds:
 *
 *   - UserService.assertTwoFactorAuthKeepsASecondStep refuses a delete that
 *     leaves an account with two-factor authentication on and no verified
 *     second step - counted over every row the delete removes, so a delete
 *     of two that leaves none is refused as a delete of the last one is
 *     (the guard that was taken out passed it twice);
 *   - both authenticator services ask it for their own writes, with the
 *     rows the delete removes (findRowsAndHoldDeleteToThem), and never for
 *     OneUptime's: a master admin's Reset two-factor authentication;
 *   - an unfinished setup, which no sign-in can ask for, can always go.
 *
 * And what the profile reads (GET /user/two-factor-auth-status):
 * getTwoFactorAuthSetup says "pending setup", never "configured", for an
 * account that is on with nothing behind it, and counts as the guards do.
 */

const OWNER_ID: ObjectID = new ObjectID("9e000000-0000-4000-8000-000000000001");
const OTHER_ID: ObjectID = new ObjectID("9e000000-0000-4000-8000-000000000002");

type Account = { enableTwoFactorAuth: boolean } | null;

let accounts: Map<string, Account>;
let verifiedApps: Map<string, number>;
let verifiedKeys: Map<string, number>;
let findUser: jest.SpyInstance;
let countApps: jest.SpyInstance;
let countKeys: jest.SpyInstance;

const removed: (
  userId: ObjectID | undefined,
  isVerified: boolean | undefined,
) => { userId?: ObjectID | undefined; isVerified?: boolean | undefined } = (
  userId: ObjectID | undefined,
  isVerified: boolean | undefined,
): { userId?: ObjectID | undefined; isVerified?: boolean | undefined } => {
  return { userId: userId, isVerified: isVerified };
};

const countFor: (
  counts: Map<string, number>,
) => (data: {
  query: { userId: unknown; isVerified: unknown };
}) => Promise<PositiveNumber> = (counts: Map<string, number>) => {
  return async (data: {
    query: { userId: unknown; isVerified: unknown };
  }): Promise<PositiveNumber> => {
    // Only finished setups are ever counted.
    expect(data.query.isVerified).toBe(true);
    return new PositiveNumber(counts.get(String(data.query.userId)) || 0);
  };
};

beforeEach(() => {
  accounts = new Map<string, Account>([
    [OWNER_ID.toString(), { enableTwoFactorAuth: true }],
    [OTHER_ID.toString(), { enableTwoFactorAuth: true }],
  ]);
  verifiedApps = new Map<string, number>();
  verifiedKeys = new Map<string, number>();

  findUser = getJestSpyOn(UserService, "findOneBy").mockImplementation(
    async (data: { query: { _id: unknown } }): Promise<User | null> => {
      const account: Account | undefined = accounts.get(String(data.query._id));

      if (!account) {
        return null;
      }

      const user: User = new User();
      user._id = String(data.query._id);
      user.enableTwoFactorAuth = account.enableTwoFactorAuth;
      return user;
    },
  );

  countApps = getJestSpyOn(UserTotpAuthService, "countBy").mockImplementation(
    countFor(verifiedApps) as never,
  );
  countKeys = getJestSpyOn(UserWebAuthnService, "countBy").mockImplementation(
    countFor(verifiedKeys) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserService.assertTwoFactorAuthKeepsASecondStep", () => {
  test("refuses removing the only second step while it is on", async () => {
    verifiedApps.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
      ]),
    ).rejects.toThrow(
      new BadDataException(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE),
    );
  });

  test("lets one of two go", async () => {
    verifiedApps.set(OWNER_ID.toString(), 1);
    verifiedKeys.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
      ]),
    ).resolves.toBeUndefined();
  });

  test("refuses a delete of two that leaves none, which the old guard let through", async () => {
    verifiedApps.set(OWNER_ID.toString(), 2);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
        removed(OWNER_ID, true),
      ]),
    ).rejects.toThrow(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE);
  });

  test("lets a delete of two of three go", async () => {
    verifiedApps.set(OWNER_ID.toString(), 2);
    verifiedKeys.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
        removed(OWNER_ID, true),
      ]),
    ).resolves.toBeUndefined();
  });

  test("counts a security key or a passkey as a second step, so an app can go while one stays", async () => {
    verifiedApps.set(OWNER_ID.toString(), 1);
    verifiedKeys.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
      ]),
    ).resolves.toBeUndefined();
    expect(countKeys).toHaveBeenCalledTimes(1);
  });

  test("an unfinished setup can always go, and nothing is read for it", async () => {
    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, false),
        removed(OWNER_ID, undefined),
      ]),
    ).resolves.toBeUndefined();

    expect(findUser).not.toHaveBeenCalled();
    expect(countApps).not.toHaveBeenCalled();
    expect(countKeys).not.toHaveBeenCalled();
  });

  test("the last one goes while two-factor authentication is off, without counting", async () => {
    accounts.set(OWNER_ID.toString(), { enableTwoFactorAuth: false });
    verifiedApps.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
      ]),
    ).resolves.toBeUndefined();
    expect(countApps).not.toHaveBeenCalled();
  });

  test("an account that is gone has nothing to keep", async () => {
    accounts.delete(OWNER_ID.toString());

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
      ]),
    ).resolves.toBeUndefined();
  });

  test("judges each account on its own rows", async () => {
    verifiedApps.set(OWNER_ID.toString(), 2);
    verifiedApps.set(OTHER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
        removed(OTHER_ID, true),
      ]),
    ).rejects.toThrow(TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE);

    verifiedApps.set(OTHER_ID.toString(), 2);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(OWNER_ID, true),
        removed(OTHER_ID, true),
      ]),
    ).resolves.toBeUndefined();
  });

  test("a row with no owner is not counted against anybody", async () => {
    verifiedApps.set(OWNER_ID.toString(), 1);

    await expect(
      UserService.assertTwoFactorAuthKeepsASecondStep([
        removed(undefined, true),
      ]),
    ).resolves.toBeUndefined();
    expect(findUser).not.toHaveBeenCalled();
  });

  test("reads whether it is on as OneUptime, from the account itself", async () => {
    verifiedApps.set(OWNER_ID.toString(), 2);

    await UserService.assertTwoFactorAuthKeepsASecondStep([
      removed(OWNER_ID, true),
    ]);

    const call: Record<string, unknown> = findUser.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(call["select"]).toEqual({ _id: true, enableTwoFactorAuth: true });
    expect(call["props"]).toEqual({ isRoot: true });
  });
});

describe.each([
  ["UserTotpAuthService", UserTotpAuthService, UserTotpAuth],
  ["UserWebAuthnService", UserWebAuthnService, UserWebAuthn],
])(
  "%s.onBeforeDelete",
  (
    _name: string,
    service: typeof UserTotpAuthService | typeof UserWebAuthnService,
    modelType: typeof UserTotpAuth | typeof UserWebAuthn,
  ) => {
    let findRowsAndHold: jest.SpyInstance;

    const row: (isVerified: boolean) => UserTotpAuth | UserWebAuthn = (
      isVerified: boolean,
    ): UserTotpAuth | UserWebAuthn => {
      const item: UserTotpAuth | UserWebAuthn = new modelType();
      item._id = ObjectID.generate().toString();
      item.userId = OWNER_ID;
      item.isVerified = isVerified;
      return item;
    };

    const callOnBeforeDelete: (
      deleteBy: DeleteBy<UserTotpAuth | UserWebAuthn>,
    ) => Promise<unknown> = async (
      deleteBy: DeleteBy<UserTotpAuth | UserWebAuthn>,
    ): Promise<unknown> => {
      return await (
        service as unknown as {
          onBeforeDelete: (d: unknown) => Promise<unknown>;
        }
      ).onBeforeDelete(deleteBy);
    };

    const selfServiceDelete: () => DeleteBy<
      UserTotpAuth | UserWebAuthn
    > = (): DeleteBy<UserTotpAuth | UserWebAuthn> => {
      return {
        query: { _id: ObjectID.generate().toString() },
        limit: 1,
        skip: 0,
        props: { userId: OWNER_ID, isRoot: false },
      } as unknown as DeleteBy<UserTotpAuth | UserWebAuthn>;
    };

    beforeEach(() => {
      findRowsAndHold = getJestSpyOn(
        service,
        "findRowsAndHoldDeleteToThem",
      ).mockResolvedValue([row(true)]);
    });

    test("refuses the owner removing the last second step while it is on", async () => {
      if (service === UserTotpAuthService) {
        verifiedApps.set(OWNER_ID.toString(), 1);
      } else {
        verifiedKeys.set(OWNER_ID.toString(), 1);
      }

      await expect(callOnBeforeDelete(selfServiceDelete())).rejects.toThrow(
        TWO_FACTOR_AUTH_LAST_METHOD_MESSAGE,
      );
    });

    test("judges the rows the delete removes, read and held as the delete's own", async () => {
      verifiedApps.set(OWNER_ID.toString(), 1);
      verifiedKeys.set(OWNER_ID.toString(), 1);
      const deleteBy: DeleteBy<UserTotpAuth | UserWebAuthn> =
        selfServiceDelete();

      await expect(callOnBeforeDelete(deleteBy)).resolves.toEqual({
        deleteBy: deleteBy,
        carryForward: null,
      });

      expect(findRowsAndHold).toHaveBeenCalledTimes(1);
      expect(findRowsAndHold.mock.calls[0]![0]).toBe(deleteBy);
      expect(findRowsAndHold.mock.calls[0]![1]).toEqual({
        _id: true,
        userId: true,
        isVerified: true,
      });
    });

    test("lets an unfinished setup go even while it is on with nothing else set up", async () => {
      findRowsAndHold.mockResolvedValue([row(false)]);

      await expect(
        callOnBeforeDelete(selfServiceDelete()),
      ).resolves.toBeDefined();
    });

    test("a master admin's Reset two-factor authentication is OneUptime's delete, and is never asked", async () => {
      if (service === UserTotpAuthService) {
        verifiedApps.set(OWNER_ID.toString(), 1);
      } else {
        verifiedKeys.set(OWNER_ID.toString(), 1);
      }

      await expect(
        callOnBeforeDelete({
          query: { userId: OWNER_ID },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        } as unknown as DeleteBy<UserTotpAuth | UserWebAuthn>),
      ).resolves.toBeDefined();

      expect(findRowsAndHold).not.toHaveBeenCalled();
      expect(findUser).not.toHaveBeenCalled();
      expect(countApps).not.toHaveBeenCalled();
      expect(countKeys).not.toHaveBeenCalled();
    });
  },
);

describe("UserService.getTwoFactorAuthSetup: what the profile is told", () => {
  test.each([
    [false, 0, 0, TwoFactorAuthStatus.NotEnabled],
    [false, 1, 1, TwoFactorAuthStatus.NotEnabled],
    [true, 0, 0, TwoFactorAuthStatus.EnabledPendingSetup],
    [true, 1, 0, TwoFactorAuthStatus.EnabledConfigured],
    [true, 0, 2, TwoFactorAuthStatus.EnabledConfigured],
  ])(
    "on: %s, apps: %s, keys and passkeys: %s -> %s",
    async (
      enableTwoFactorAuth: boolean,
      apps: number,
      keys: number,
      status: TwoFactorAuthStatus,
    ) => {
      accounts.set(OWNER_ID.toString(), { enableTwoFactorAuth });
      verifiedApps.set(OWNER_ID.toString(), apps);
      verifiedKeys.set(OWNER_ID.toString(), keys);

      await expect(
        UserService.getTwoFactorAuthSetup(OWNER_ID),
      ).resolves.toEqual({ status: status, verifiedMethodCount: apps + keys });
    },
  );

  test("an account that does not exist is not found", async () => {
    accounts.delete(OWNER_ID.toString());

    await expect(UserService.getTwoFactorAuthSetup(OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  test("the admin pages derive their status the same way, so the two never disagree", () => {
    for (const isTwoFactorAuthEnabled of [false, true]) {
      for (const verifiedMethodCount of [0, 1, 2]) {
        expect(
          UserServiceClass.deriveTwoFactorAuthStatus({
            isTwoFactorAuthEnabled,
            verifiedMethodCount,
          }),
        ).toBe(
          TwoFactorAuthSetupUtil.getStatus({
            isTwoFactorAuthEnabled,
            verifiedMethodCount,
          }),
        );
      }
    }
  });
});
